/**
 * 집 PC 작업실 에이전트 사이드카 계약.
 * 브라우저는 여기로만 붙고, 구독 CLI spawn은 사이드카가 한다.
 */

export const DEFAULT_KNOWLEDGE_AGENT_ORIGIN = "http://127.0.0.1:8787";
export const DEFAULT_KNOWLEDGE_AGENT_PORT = 8787;
export const KNOWLEDGE_AGENT_START_COMMAND = "npm run knowledge:agent";
export const MAX_AGENT_PROMPT_CHARS = 160_000;

const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export const KNOWLEDGE_AGENT_PROVIDERS = ["claude", "codex", "cursor"] as const;
export type KnowledgeAgentProvider = (typeof KNOWLEDGE_AGENT_PROVIDERS)[number];

const AGENT_MODEL_ID = /^[a-z0-9][a-z0-9._:[\]=, -]{0,120}$/i;

export function isKnowledgeAgentProvider(value: unknown): value is KnowledgeAgentProvider {
  return value === "claude" || value === "codex" || value === "cursor";
}

export interface KnowledgeAgentModelOption {
  id: string;
  label: string;
}

export const KNOWLEDGE_AGENT_MODELS: Record<KnowledgeAgentProvider, KnowledgeAgentModelOption[]> = {
  claude: [
    { id: "claude-fable-5-1", label: "Fable 5.1" },
    { id: "opus", label: "Opus" },
    { id: "sonnet", label: "Sonnet" },
    { id: "haiku", label: "Haiku" },
  ],
  codex: [
    { id: "gpt-6-astra", label: "GPT-6 Astra" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
  cursor: [
    { id: "composer-2.5", label: "Composer 2.5" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
    { id: "auto", label: "Auto" },
    { id: "cursor-grok-4.6-high-fast", label: "Grok 4.6 Fast" },
    { id: "gpt-5.3-codex", label: "Codex 5.3" },
    { id: "gpt-5.6-sol-medium", label: "GPT-5.6 Sol" },
  ],
};

export const DEFAULT_KNOWLEDGE_AGENT_MODEL: Record<KnowledgeAgentProvider, string> = {
  claude: "claude-fable-5-1",
  codex: "gpt-6-astra",
  cursor: "composer-2.5",
};

export interface KnowledgeAgentHealth {
  ok: boolean;
  providers: { claude: boolean; codex: boolean; cursor: boolean };
  runtime?: { claude?: string; codex?: string; cursor?: string };
  transport?: { http?: boolean; websocket?: boolean };
  models?: Record<KnowledgeAgentProvider, KnowledgeAgentModelOption[]>;
  defaults?: Partial<Record<KnowledgeAgentProvider, string>>;
}

export interface KnowledgeAgentChatRequest {
  provider: KnowledgeAgentProvider;
  jobId: string;
  prompt: string;
  model: string;
  sessionId?: string;
}

export function knowledgeAgentModelOptions(
  provider: KnowledgeAgentProvider,
): KnowledgeAgentModelOption[] {
  return KNOWLEDGE_AGENT_MODELS[provider];
}

export function isKnowledgeAgentModelId(value: string): boolean {
  const model = value.trim();
  return model.length > 0 && !model.includes(" ") && AGENT_MODEL_ID.test(model);
}

export function knowledgeAgentModelLabel(
  provider: KnowledgeAgentProvider,
  model: string,
  catalog?: KnowledgeAgentModelOption[],
): string {
  const options = catalog ?? knowledgeAgentModelOptions(provider);
  return options.find((item) => item.id === model)?.label ?? model;
}

export function resolveKnowledgeAgentModel(
  provider: KnowledgeAgentProvider,
  value: unknown,
): string | undefined {
  if (value == null || value === "") return DEFAULT_KNOWLEDGE_AGENT_MODEL[provider];
  if (typeof value !== "string") return undefined;
  const model = value.trim();
  return isKnowledgeAgentModelId(model) ? model : undefined;
}

export function parseCursorModelList(text: string): KnowledgeAgentModelOption[] {
  const seen = new Set<string>();
  const options: KnowledgeAgentModelOption[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([a-z0-9][a-z0-9._:[\]=,-]{0,80})\s+-\s+(.+)$/i);
    if (!match) continue;
    const id = match[1].trim();
    const label = match[2].trim();
    if (!isKnowledgeAgentModelId(id) || !label || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

export function parseCodexDebugModels(value: unknown): KnowledgeAgentModelOption[] {
  const record = asRecord(value);
  const models = Array.isArray(record?.models) ? record.models : Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const options: KnowledgeAgentModelOption[] = [];
  for (const item of models) {
    const row = asRecord(item);
    const id = typeof row?.slug === "string"
      ? row.slug.trim()
      : typeof row?.id === "string" ? row.id.trim() : "";
    const label = typeof row?.display_name === "string" && row.display_name.trim()
      ? row.display_name.trim()
      : id;
    if (!isKnowledgeAgentModelId(id) || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

export type KnowledgeAgentSseEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; text: string; provider?: KnowledgeAgentProvider; sessionId?: string }
  | { type: "error"; message: string };

export type ClaudeStreamEvent =
  | { kind: "ignore" }
  | { kind: "session"; sessionId: string }
  | { kind: "delta"; text: string; sessionId?: string }
  | { kind: "assistant"; text: string; sessionId?: string }
  | { kind: "result"; text: string; sessionId?: string }
  | { kind: "error"; message: string; sessionId?: string };

export type CodexExecEvent =
  | { kind: "ignore" }
  | { kind: "session"; sessionId: string }
  | { kind: "status"; text: string }
  | { kind: "message"; text: string }
  | { kind: "error"; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function knowledgeAgentWsUrl(): string {
  return `${knowledgeAgentBaseUrl().replace(/^http/i, "ws")}/ws`;
}

export function knowledgeAgentBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_KNOWLEDGE_AGENT_URL?.trim();
  if (!raw) return DEFAULT_KNOWLEDGE_AGENT_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_KNOWLEDGE_AGENT_ORIGIN;
    }
    return url.origin;
  } catch {
    return DEFAULT_KNOWLEDGE_AGENT_ORIGIN;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  return LOOPBACK_ORIGIN.test(origin.trim());
}

export function isAllowedKnowledgeAgentOrigin(
  origin: string | undefined,
  extras: string[] = [],
): boolean {
  if (!origin) return false;
  if (isLoopbackOrigin(origin)) return true;
  return extras.includes(origin);
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.trim().toLowerCase().split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function parseKnowledgeAgentHealth(value: unknown): KnowledgeAgentHealth | undefined {
  const record = asRecord(value);
  const providers = asRecord(record?.providers);
  if (!record || !providers) return undefined;
  const runtime = asRecord(record.runtime);
  const transport = asRecord(record.transport);
  const models = asRecord(record.models);
  const defaults = asRecord(record.defaults);
  return {
    ok: record.ok === true,
    providers: {
      claude: providers.claude === true,
      codex: providers.codex === true,
      cursor: providers.cursor === true,
    },
    ...(runtime
      ? {
        runtime: {
          claude: typeof runtime.claude === "string" ? runtime.claude : undefined,
          codex: typeof runtime.codex === "string" ? runtime.codex : undefined,
          cursor: typeof runtime.cursor === "string" ? runtime.cursor : undefined,
        },
      }
      : {}),
    ...(transport
      ? {
        transport: {
          http: transport.http === true,
          websocket: transport.websocket === true,
        },
      }
      : {}),
    ...(models
      ? {
        models: {
          claude: parseModelOptions(models.claude) ?? KNOWLEDGE_AGENT_MODELS.claude,
          codex: parseModelOptions(models.codex) ?? KNOWLEDGE_AGENT_MODELS.codex,
          cursor: parseModelOptions(models.cursor) ?? KNOWLEDGE_AGENT_MODELS.cursor,
        },
      }
      : {}),
    ...(defaults
      ? {
        defaults: {
          claude: typeof defaults.claude === "string" ? defaults.claude : undefined,
          codex: typeof defaults.codex === "string" ? defaults.codex : undefined,
          cursor: typeof defaults.cursor === "string" ? defaults.cursor : undefined,
        },
      }
      : {}),
  };
}

function parseModelOptions(value: unknown): KnowledgeAgentModelOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || typeof record.label !== "string") return [];
    const id = record.id.trim();
    const label = record.label.trim();
    return id && label ? [{ id, label }] : [];
  });
  return options.length > 0 ? options : undefined;
}

export function parseKnowledgeAgentChatRequest(value: unknown): KnowledgeAgentChatRequest | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (record.type && record.type !== "chat") return undefined;
  const provider = isKnowledgeAgentProvider(record.provider) ? record.provider : undefined;
  const jobId = typeof record.jobId === "string" ? record.jobId : "";
  const prompt = typeof record.prompt === "string" ? record.prompt : "";
  if (!provider || !JOB_ID_PATTERN.test(jobId)) return undefined;
  if (!prompt.trim() || prompt.length > MAX_AGENT_PROMPT_CHARS) return undefined;
  const model = resolveKnowledgeAgentModel(provider, record.model);
  if (!model) return undefined;
  if (record.sessionId != null &&
      (typeof record.sessionId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(record.sessionId))) return undefined;
  const sessionId = typeof record.sessionId === "string" && record.sessionId.trim()
    ? record.sessionId.trim()
    : undefined;
  return { provider, jobId, prompt, model, sessionId };
}

export function parseSseBuffer(buffer: string): {
  events: KnowledgeAgentSseEvent[];
  rest: string;
} {
  const events: KnowledgeAgentSseEvent[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  while (true) {
    const split = rest.indexOf("\n\n");
    if (split === -1) break;
    const event = parseSseBlock(rest.slice(0, split));
    rest = rest.slice(split + 2);
    if (event) events.push(event);
  }
  return { events, rest };
}

function parseSseBlock(block: string): KnowledgeAgentSseEvent | undefined {
  let name = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!name || dataLines.length === 0) return undefined;
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(dataLines.join("\n")) as unknown;
    const record = asRecord(parsed);
    if (!record) return undefined;
    data = record;
  } catch {
    return undefined;
  }
  if (name === "delta" && typeof data.text === "string") {
    return { type: "delta", text: data.text };
  }
  if (name === "status" && typeof data.text === "string") {
    return { type: "status", text: data.text };
  }
  if (name === "done" && typeof data.text === "string") {
    return {
      type: "done",
      text: data.text,
      sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined,
      provider: isKnowledgeAgentProvider(data.provider) ? data.provider : undefined,
    };
  }
  if (name === "error" && typeof data.message === "string") {
    return { type: "error", message: data.message };
  }
  return undefined;
}

export async function readKnowledgeAgentSse(
  response: Response,
  onEvent: (event: KnowledgeAgentSseEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("사이드카 응답이 비었어요.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
  if (buffer.trim()) {
    const parsed = parseSseBuffer(`${buffer}\n\n`);
    for (const event of parsed.events) onEvent(event);
  }
}

function sessionIdFrom(record: Record<string, unknown>, nested?: Record<string, unknown> | null): string | undefined {
  if (typeof record.session_id === "string" && record.session_id) return record.session_id;
  if (nested && typeof nested.session_id === "string" && nested.session_id) return nested.session_id;
  return undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    const record = asRecord(part);
    return typeof record?.text === "string" ? record.text : "";
  }).join("");
}

export function parseClaudeStreamJsonLine(line: string): ClaudeStreamEvent {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "ignore" };
  }
  const record = asRecord(parsed);
  if (!record) return { kind: "ignore" };
  const message = asRecord(record.message);
  const sessionId = sessionIdFrom(record, message);

  if (record.type === "system" && record.subtype === "init" && sessionId) {
    return { kind: "session", sessionId };
  }

  if (record.type === "stream_event" || record.type === "content_block_delta") {
    const event = asRecord(record.event) ?? record;
    const delta = asRecord(event.delta) ?? event;
    const nested = asRecord(delta.delta);
    const text = typeof delta.text === "string"
      ? delta.text
      : typeof nested?.text === "string" ? nested.text : "";
    return text ? { kind: "delta", text, sessionId } : { kind: "ignore" };
  }

  if (record.type === "assistant") {
    const text = textFromContent(message?.content ?? record.content);
    return text ? { kind: "assistant", text, sessionId } : { kind: "ignore" };
  }

  if (record.type === "result") {
    if (record.is_error === true || record.subtype === "error") {
      const messageText = typeof record.result === "string"
        ? record.result
        : typeof record.error === "string" ? record.error : "Claude가 실패했어요.";
      return { kind: "error", message: messageText, sessionId };
    }
    const text = typeof record.result === "string" ? record.result : "";
    return { kind: "result", text, sessionId };
  }

  if (record.type === "error") {
    const error = asRecord(record.error);
    const messageText = typeof record.error === "string"
      ? record.error
      : typeof error?.message === "string" ? error.message : "Claude가 실패했어요.";
    return { kind: "error", message: messageText, sessionId };
  }

  return { kind: "ignore" };
}

export function parseCursorAgentJsonLine(line: string): ClaudeStreamEvent {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "ignore" };
  }
  const record = asRecord(parsed);
  if (!record) return { kind: "ignore" };
  const message = asRecord(record.message);
  const sessionId = sessionIdFrom(record, message);

  if (record.type === "system" && record.subtype === "init" && sessionId) {
    return { kind: "session", sessionId };
  }

  if (record.type === "assistant") {
    const text = textFromContent(message?.content ?? record.content);
    if (!text) return { kind: "ignore" };
    if (record.model_call_id != null) return { kind: "ignore" };
    if (typeof record.timestamp_ms === "number") {
      return { kind: "delta", text, sessionId };
    }
    return { kind: "assistant", text, sessionId };
  }

  if (record.type === "result") {
    if (record.is_error === true || record.subtype === "error") {
      const messageText = typeof record.result === "string"
        ? record.result
        : typeof record.error === "string" ? record.error : "Cursor가 실패했어요.";
      return { kind: "error", message: messageText, sessionId };
    }
    const text = typeof record.result === "string" ? record.result : "";
    return { kind: "result", text, sessionId };
  }

  if (record.type === "error") {
    const error = asRecord(record.error);
    const messageText = typeof record.error === "string"
      ? record.error
      : typeof error?.message === "string" ? error.message : "Cursor가 실패했어요.";
    return { kind: "error", message: messageText, sessionId };
  }

  return { kind: "ignore" };
}

export function parseCodexExecJsonLine(line: string): CodexExecEvent {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "ignore" };
  }
  const record = asRecord(parsed);
  if (!record || typeof record.type !== "string") return { kind: "ignore" };

  if (record.type === "thread.started" && typeof record.thread_id === "string" && record.thread_id) {
    return { kind: "session", sessionId: record.thread_id };
  }
  if (record.type === "turn.started") {
    return { kind: "status", text: "Codex 작성 중" };
  }
  if (record.type === "item.completed") {
    const item = asRecord(record.item);
    if (item?.type === "agent_message" && typeof item.text === "string" && item.text) {
      return { kind: "message", text: item.text };
    }
    if (item?.type === "error") {
      return {
        kind: "error",
        message: typeof item.message === "string" ? item.message : "Codex가 실패했어요.",
      };
    }
  }
  if (record.type === "item.started") {
    const item = asRecord(record.item);
    if (item?.type === "command_execution") {
      return { kind: "status", text: "Codex가 명령을 실행하려고 해요" };
    }
  }
  if (record.type === "error" || record.type === "turn.failed") {
    const error = asRecord(record.error);
    const message = typeof record.message === "string"
      ? record.message
      : typeof error?.message === "string" ? error.message : "Codex가 실패했어요.";
    return { kind: "error", message };
  }
  return { kind: "ignore" };
}

export function formatClaudeStreamUserLine(text: string): string {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  })}\n`;
}

export type CodexRpcLine =
  | { kind: "ignore" }
  | { kind: "response"; id: number; result?: unknown; error?: string }
  | { kind: "request"; id: number; method: string; params?: unknown }
  | { kind: "notification"; method: string; params?: unknown };

export function parseCodexRpcLine(line: string): CodexRpcLine {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "ignore" };
  }
  const record = asRecord(parsed);
  if (!record) return { kind: "ignore" };
  const id = typeof record.id === "number" ? record.id : undefined;
  const method = typeof record.method === "string" ? record.method : undefined;
  if (id !== undefined && method && !("result" in record) && !("error" in record)) {
    return { kind: "request", id, method, params: record.params };
  }
  if (id !== undefined && ("result" in record || "error" in record)) {
    const error = asRecord(record.error);
    return {
      kind: "response",
      id,
      result: record.result,
      error: typeof record.error === "string"
        ? record.error
        : typeof error?.message === "string" ? error.message : undefined,
    };
  }
  if (method) {
    return { kind: "notification", method, params: record.params };
  }
  return { kind: "ignore" };
}

export function parseKnowledgeAgentSocketEvent(value: unknown): KnowledgeAgentSseEvent | undefined {
  const record = asRecord(value);
  if (!record || typeof record.type !== "string") return undefined;
  if (record.type === "delta" && typeof record.text === "string") {
    return { type: "delta", text: record.text };
  }
  if (record.type === "status" && typeof record.text === "string") {
    return { type: "status", text: record.text };
  }
  if (record.type === "done" && typeof record.text === "string") {
    return {
      type: "done",
      text: record.text,
      sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
      provider: isKnowledgeAgentProvider(record.provider) ? record.provider : undefined,
    };
  }
  if (record.type === "error" && typeof record.message === "string") {
    return { type: "error", message: record.message };
  }
  return undefined;
}

export function extractCodexAppServerDelta(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.text === "string" && record.text) return record.text;
  if (typeof record.delta === "string" && record.delta) return record.delta;
  const delta = asRecord(record.delta);
  if (typeof delta?.text === "string" && delta.text) return delta.text;
  const item = asRecord(record.item);
  if (item?.type === "agentMessage" && typeof item.text === "string" && item.text) {
    return item.text;
  }
  return undefined;
}
