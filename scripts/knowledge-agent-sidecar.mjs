#!/usr/bin/env node
/**
 * Focus Feed 지식 작업실 PC 사이드카 — 최대 계약.
 * 브라우저 ↔ WebSocket(또는 HTTP SSE) ↔ 장수명 Claude 세션 / Codex app-server / Cursor agent --mode ask.
 * 일회성 `claude -p` / `codex exec` 가 아니다. Cursor만 print 한 턴이고, 레포 파일은 쓰지 않는다.
 */
import { execFile } from "node:child_process";
import { spawnCli, findWindowsCli } from "./knowledge-agent-process.mjs";
import { createServer } from "node:http";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { WebSocketServer } from "ws";

const HOST = "127.0.0.1";
const PORT = Number(process.env.KNOWLEDGE_AGENT_PORT || 8787);
const MAX_BODY_BYTES = 200_000;
const MAX_PROMPT_CHARS = 160_000;
const TURN_TIMEOUT_MS = 180_000;
const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const CLAUDE_MODELS = [
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];
const CODEX_MODELS = [
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
];
const CURSOR_MODELS = [
  { id: "composer-2.5", label: "Composer 2.5" },
  { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
  { id: "auto", label: "Auto" },
  { id: "cursor-grok-4.6-high-fast", label: "Grok 4.6 Fast" },
  { id: "gpt-5.3-codex", label: "Codex 5.3" },
  { id: "gpt-5.6-sol-medium", label: "GPT-5.6 Sol" },
];
const DEFAULT_MODELS = {
  claude: "claude-fable-5-1",
  codex: "gpt-6-astra",
  cursor: "composer-2.5",
};
const AGENT_MODEL_ID = /^[a-z0-9][a-z0-9._:[\]=, -]{0,120}$/i;
const MODEL_LIST_TTL_MS = 5 * 60_000;
const modelCatalogCache = new Map();

const WORK_DIR = join(tmpdir(), "focus-feed-knowledge-agent");
mkdirSync(WORK_DIR, { recursive: true });

const claudeSessions = new Map();
const turnLocks = new Set();
const codexServer = {
  child: null,
  ready: null,
  nextId: 0,
  pending: new Map(),
  threads: new Map(),
};

function extraOrigins() {
  const extras = String(process.env.KNOWLEDGE_AGENT_ORIGINS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const key of ["FOCUS_FEED_ORIGIN", "NEXT_PUBLIC_SITE_URL"]) {
    const value = process.env[key]?.trim();
    if (value) extras.push(value.replace(/\/$/, ""));
  }
  return extras;
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (LOOPBACK_ORIGIN.test(origin)) return true;
  return extraOrigins().includes(origin);
}

function isLoopbackHost(host) {
  if (!host) return false;
  const hostname = host.trim().toLowerCase().split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("요청이 너무 커요."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isModelId(value) {
  const model = String(value ?? "").trim();
  return model.length > 0 && !model.includes(" ") && AGENT_MODEL_ID.test(model);
}

function fallbackModels(provider) {
  if (provider === "claude") return CLAUDE_MODELS;
  if (provider === "cursor") return CURSOR_MODELS;
  return CODEX_MODELS;
}

function resolveModel(provider, value) {
  if (value == null || value === "") return DEFAULT_MODELS[provider];
  if (typeof value !== "string") return null;
  const model = value.trim();
  return isModelId(model) ? model : null;
}

function parseCursorModelList(text) {
  const seen = new Set();
  const options = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-z0-9][a-z0-9._:[\]=,-]{0,80})\s+-\s+(.+)$/i);
    if (!match) continue;
    const id = match[1].trim();
    const label = match[2].trim();
    if (!isModelId(id) || !label || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

function parseCodexDebugModels(value) {
  const record = asRecord(value);
  const models = Array.isArray(record?.models) ? record.models : Array.isArray(value) ? value : [];
  const seen = new Set();
  const options = [];
  for (const item of models) {
    const row = asRecord(item);
    const id = typeof row?.slug === "string"
      ? row.slug.trim()
      : typeof row?.id === "string" ? row.id.trim() : "";
    const label = typeof row?.display_name === "string" && row.display_name.trim()
      ? row.display_name.trim()
      : id;
    if (!isModelId(id) || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

function preferredModel(provider, options) {
  const preferred = DEFAULT_MODELS[provider];
  if (options.some((item) => item.id === preferred)) return preferred;
  return options[0]?.id ?? preferred;
}

function runCommandText(command, args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const child = spawnCli(command, args, {
      cwd: WORK_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = Buffer.alloc(0);
    const timer = setTimeout(() => {
      child.kill();
      resolve("");
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      out = Buffer.concat([out, chunk]);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (out.length >= 2 && out[0] === 0xff && out[1] === 0xfe) {
        resolve(out.toString("utf16le"));
        return;
      }
      const text = out.toString("utf8");
      resolve(text.includes("\u0000") ? out.toString("utf16le") : text);
    });
  });
}

async function listLiveModels(provider) {
  if (provider === "cursor") {
    return parseCursorModelList(await runCommandText("agent", ["--list-models"]));
  }
  if (provider === "codex") {
    const raw = await runCommandText("codex", ["debug", "models"]);
    const start = raw.search(/[\{\[]/);
    if (start < 0) return [];
    try {
      return parseCodexDebugModels(JSON.parse(raw.slice(start)));
    } catch {
      return [];
    }
  }
  return [];
}

async function modelsFor(provider, installed) {
  const fallback = fallbackModels(provider);
  if (!installed) return fallback;
  const cached = modelCatalogCache.get(provider);
  if (cached && Date.now() - cached.at < MODEL_LIST_TTL_MS && cached.models.length > 0) {
    return cached.models;
  }
  const live = await listLiveModels(provider);
  const models = live.length > 0 ? live : fallback;
  modelCatalogCache.set(provider, { at: Date.now(), models });
  return models;
}

function parseChatRequest(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type && value.type !== "chat") return null;
  const provider = value.provider === "claude" || value.provider === "codex" || value.provider === "cursor"
    ? value.provider
    : null;
  const jobId = typeof value.jobId === "string" ? value.jobId : "";
  const prompt = typeof value.prompt === "string" ? value.prompt : "";
  if (!provider || !JOB_ID_PATTERN.test(jobId)) return null;
  if (!prompt.trim() || prompt.length > MAX_PROMPT_CHARS) return null;
  const model = resolveModel(provider, value.model);
  if (!model) return null;
  if (value.sessionId != null &&
      (typeof value.sessionId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value.sessionId))) return null;
  const sessionId = typeof value.sessionId === "string" && value.sessionId.trim()
    ? value.sessionId.trim()
    : undefined;
  return { provider, jobId, prompt, model, sessionId };
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    const record = asRecord(part);
    return typeof record?.text === "string" ? record.text : "";
  }).join("");
}

function parseClaudeStreamJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "ignore" };
  }
  const record = asRecord(parsed);
  if (!record) return { kind: "ignore" };
  const message = asRecord(record.message);
  const sessionId = typeof record.session_id === "string"
    ? record.session_id
    : typeof message?.session_id === "string" ? message.session_id : undefined;

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
    return {
      kind: "result",
      text: typeof record.result === "string" ? record.result : "",
      sessionId,
    };
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

function parseCursorAgentJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "ignore" };
  }
  const record = asRecord(parsed);
  if (!record) return { kind: "ignore" };
  const message = asRecord(record.message);
  const sessionId = typeof record.session_id === "string"
    ? record.session_id
    : typeof message?.session_id === "string" ? message.session_id : undefined;

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
    return {
      kind: "result",
      text: typeof record.result === "string" ? record.result : "",
      sessionId,
    };
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

function parseCodexRpcLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let parsed;
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
  if (method) return { kind: "notification", method, params: record.params };
  return { kind: "ignore" };
}

function extractCodexAppServerDelta(value) {
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.text === "string" && record.text) return record.text;
  if (typeof record.delta === "string" && record.delta) return record.delta;
  const delta = asRecord(record.delta);
  if (typeof delta?.text === "string" && delta.text) return delta.text;
  const item = asRecord(record.item);
  if (item && (item.type === "agentMessage" || item.type === "agent_message") && typeof item.text === "string") {
    return item.text;
  }
  return "";
}

function hasCommand(name) {
  if (process.platform === "win32") return Promise.resolve(Boolean(findWindowsCli(name)));
  const lookup = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(lookup, [name], { windowsHide: true }, (error) => resolve(!error));
  });
}

function formatClaudeUserLine(text) {
  return `${JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  })}\n`;
}

function claudeSessionKey(jobId, model) {
  return `${jobId}:${model}`;
}

function getClaudeSession(jobId, model, resumeId) {
  const key = claudeSessionKey(jobId, model);
  let session = claudeSessions.get(key);
  if (!session) {
    session = { jobId, model, child: null, sessionId: resumeId, waiters: [] };
    claudeSessions.set(key, session);
  } else if (resumeId && !session.sessionId) {
    session.sessionId = resumeId;
  }
  return session;
}

function attachClaudeStdout(session) {
  const rl = createInterface({ input: session.child.stdout });
  rl.on("line", (line) => {
    const event = parseClaudeStreamJsonLine(line);
    if (event.sessionId) session.sessionId = event.sessionId;
    const waiter = session.waiters[0];
    if (!waiter || event.kind === "ignore") return;
    if (event.kind === "delta") {
      waiter.streamed += event.text;
      waiter.onDelta(event.text);
    } else if (event.kind === "assistant") {
      waiter.assistant = event.text;
    } else if (event.kind === "result") {
      if (!waiter.streamed && (event.text || waiter.assistant)) {
        const text = event.text || waiter.assistant;
        waiter.streamed = text;
        waiter.onDelta(text);
      }
      const done = session.waiters.shift();
      done.resolve({ text: done.streamed, sessionId: session.sessionId });
    } else if (event.kind === "error") {
      const done = session.waiters.shift();
      done.reject(new Error(event.message));
    }
  });
}

function startClaudeProcess(session) {
  if (session.child && !session.child.killed) return;
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "dontAsk",
    "--model",
    session.model,
  ];
  if (session.sessionId) args.push("--resume", session.sessionId);
  const child = spawnCli("claude", args, {
    cwd: WORK_DIR,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  session.child = child;
  attachClaudeStdout(session);
  child.stderr?.on("data", () => undefined);
  child.on("exit", () => {
    session.child = null;
    const pending = session.waiters.splice(0);
    for (const waiter of pending) {
      waiter.reject(new Error("Claude 세션이 끝났어요."));
    }
  });
}

function runClaudeTurn(request, { onDelta, onStatus, signal }) {
  const session = getClaudeSession(request.jobId, request.model, request.sessionId);
  startClaudeProcess(session);
  onStatus("Claude Code 세션");
  return new Promise((resolve, reject) => {
    const waiter = {
      streamed: "",
      assistant: "",
      onDelta,
      resolve,
      reject,
    };
    const timer = setTimeout(() => {
      const index = session.waiters.indexOf(waiter);
      if (index >= 0) session.waiters.splice(index, 1);
      reject(new Error("Claude 세션이 시간 초과됐어요."));
    }, TURN_TIMEOUT_MS);
    const onAbort = () => {
      const index = session.waiters.indexOf(waiter);
      if (index >= 0) session.waiters.splice(index, 1);
      reject(new Error("요청이 취소됐어요."));
    };
    if (signal?.aborted) {
      reject(new Error("요청이 취소됐어요."));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    session.waiters.push(waiter);
    try {
      session.child.stdin.write(formatClaudeUserLine(request.prompt));
    } catch (error) {
      session.waiters = session.waiters.filter((item) => item !== waiter);
      reject(error);
      return;
    }
    const finish = (fn) => (value) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    waiter.resolve = finish(resolve);
    waiter.reject = finish(reject);
  });
}

function handleCodexLine(line) {
  const event = parseCodexRpcLine(line);
  if (event.kind === "response") {
    const pending = codexServer.pending.get(event.id);
    if (!pending) return;
    codexServer.pending.delete(event.id);
    if (event.error) pending.reject(new Error(event.error));
    else pending.resolve(event.result);
    return;
  }
  if (event.kind === "request") {
    try {
      codexServer.child?.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: event.id,
        result: { decision: "decline", action: "decline" },
      })}\n`);
    } catch {
      // ignore
    }
    const listener = codexServer.turnListener;
    listener?.onStatus?.("Codex 도구 요청을 거절했어요");
    return;
  }
  if (event.kind !== "notification") return;
  const listener = codexServer.turnListener;
  if (!listener) return;
  if (event.method === "item/agentMessage/delta") {
    const text = extractCodexAppServerDelta(event.params);
    if (text) {
      listener.streamed += text;
      listener.onDelta(text);
    }
    return;
  }
  if (event.method === "item/completed") {
    const text = extractCodexAppServerDelta(event.params);
    if (text && !listener.streamed) {
      listener.streamed = text;
      listener.onDelta(text);
    }
    return;
  }
  if (event.method === "turn/started") {
    listener.onStatus("Codex 작성 중");
    return;
  }
  if (event.method === "turn/completed") {
    const params = asRecord(event.params);
    const turn = asRecord(params?.turn);
    const status = turn?.status;
    const error = asRecord(turn?.error);
    if (status === "failed") {
      listener.reject(new Error(typeof error?.message === "string" ? error.message : "Codex가 실패했어요."));
      return;
    }
    listener.resolve({
      text: listener.streamed,
      sessionId: listener.threadId,
    });
    return;
  }
  if (event.method === "error") {
    const params = asRecord(event.params);
    const error = asRecord(params?.error);
    listener.reject(new Error(
      typeof error?.message === "string"
        ? error.message
        : typeof params?.message === "string" ? params.message : "Codex가 실패했어요.",
    ));
  }
}

function ensureCodexProcess() {
  if (codexServer.ready) return codexServer.ready;
  codexServer.ready = new Promise((resolve, reject) => {
    const child = spawnCli("codex", ["app-server"], {
      cwd: WORK_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    codexServer.child = child;
    const rl = createInterface({ input: child.stdout });
    rl.on("line", handleCodexLine);
    child.stderr?.on("data", () => undefined);
    child.on("exit", () => {
      codexServer.child = null;
      codexServer.ready = null;
      codexServer.threads.clear();
      for (const pending of codexServer.pending.values()) {
        pending.reject(new Error("Codex app-server가 끝났어요."));
      }
      codexServer.pending.clear();
      if (codexServer.turnListener) {
        codexServer.turnListener.reject(new Error("Codex app-server가 끝났어요."));
      }
    });
    child.on("error", reject);

    const id = ++codexServer.nextId;
    const timer = setTimeout(() => {
      reject(new Error("Codex app-server 초기화가 느려요."));
    }, 15_000);
    codexServer.pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        try {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        clientInfo: {
          name: "focus_feed_knowledge",
          title: "Focus Feed Knowledge",
          version: "0.1.0",
        },
      },
    })}\n`);
  });
  return codexServer.ready;
}

function codexRequest(method, params) {
  if (!codexServer.child) throw new Error("Codex app-server가 없어요.");
  const id = ++codexServer.nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      codexServer.pending.delete(id);
      reject(new Error(`${method}가 시간 초과됐어요.`));
    }, TURN_TIMEOUT_MS);
    codexServer.pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    codexServer.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function runCodexTurn(request, { onDelta, onStatus, signal }) {
  onStatus("Codex app-server");
  await ensureCodexProcess();
  const threadKey = `${request.jobId}:${request.model}`;
  let threadId = request.sessionId || codexServer.threads.get(threadKey);
  if (!threadId) {
    const started = asRecord(await codexRequest("thread/start", {
      cwd: WORK_DIR,
      model: request.model,
    }));
    const thread = asRecord(started?.thread);
    threadId = typeof thread?.id === "string"
      ? thread.id
      : typeof started?.threadId === "string" ? started.threadId : undefined;
    if (!threadId) throw new Error("Codex thread를 만들지 못했어요.");
    codexServer.threads.set(threadKey, threadId);
  }

  return new Promise((resolve, reject) => {
    if (codexServer.turnListener) {
      reject(new Error("이미 다른 Codex 대화를 처리 중이에요."));
      return;
    }
    const listener = {
      streamed: "",
      threadId,
      onDelta,
      onStatus,
      resolve: (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (codexServer.turnListener === listener) codexServer.turnListener = null;
        if (!value.text?.trim()) {
          reject(new Error("Codex가 빈 답을 보냈어요."));
          return;
        }
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (codexServer.turnListener === listener) codexServer.turnListener = null;
        reject(error);
      },
    };
    const timer = setTimeout(() => {
      listener.reject(new Error("Codex 세션이 시간 초과됐어요."));
    }, TURN_TIMEOUT_MS);
    const onAbort = () => listener.reject(new Error("요청이 취소됐어요."));
    if (signal?.aborted) {
      listener.reject(new Error("요청이 취소됐어요."));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    codexServer.turnListener = listener;
    void codexRequest("turn/start", {
      threadId,
      input: [{ type: "text", text: request.prompt }],
      cwd: WORK_DIR,
      model: request.model,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
    }).catch((error) => listener.reject(error));
  });
}

function runCursorTurn(request, { onDelta, onStatus, signal }) {
  onStatus("Cursor 작성 중");
  const promptName = `cursor-prompt-${request.jobId}.txt`;
  const promptPath = join(WORK_DIR, promptName);
  writeFileSync(promptPath, request.prompt, "utf8");
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--mode",
      "ask",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--trust",
      "--workspace",
      WORK_DIR,
      "--model",
      request.model,
    ];
    if (request.sessionId) args.push("--resume", request.sessionId);
    args.push(`Read ${promptName} and follow that request. Reply only. Do not edit files.`);
    const child = spawnCli("agent", args, {
      cwd: WORK_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let streamed = "";
    let sessionId = request.sessionId;
    let settled = false;
    let timer = null;
    const cleanupPrompt = () => {
      try {
        unlinkSync(promptPath);
      } catch {
        // ignore
      }
    };
    const settle = (fn) => (value) => {
      if (settled) return;
      settled = true;
      cleanupPrompt();
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const finish = settle(resolve);
    const fail = settle(reject);
    timer = setTimeout(() => {
      child.kill();
      fail(new Error("Cursor가 시간 초과됐어요."));
    }, TURN_TIMEOUT_MS);
    const onAbort = () => {
      child.kill();
      fail(new Error("요청이 취소됐어요."));
    };
    if (signal?.aborted) {
      child.kill();
      fail(new Error("요청이 취소됐어요."));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const event = parseCursorAgentJsonLine(line);
      if (event.sessionId) sessionId = event.sessionId;
      if (event.kind === "delta") {
        streamed += event.text;
        onDelta(event.text);
      } else if (event.kind === "assistant" && !streamed) {
        streamed = event.text;
        onDelta(event.text);
      } else if (event.kind === "result") {
        const text = streamed || event.text || "";
        if (!streamed && event.text) onDelta(event.text);
        child.kill();
        finish({ text, sessionId });
      } else if (event.kind === "error") {
        child.kill();
        fail(new Error(event.message));
      }
    });
    child.stderr?.on("data", () => undefined);
    child.on("error", (error) => fail(error));
    child.on("exit", (code) => {
      if (settled) return;
      if (code && code !== 0 && !streamed) {
        fail(new Error("Cursor가 실패했어요."));
        return;
      }
      finish({ text: streamed, sessionId });
    });
  });
}

async function runTurn(request, hooks) {
  const lockKey = `${request.provider}:${request.jobId}:${request.model}`;
  if (turnLocks.has(lockKey)) {
    throw new Error("이미 같은 세션에서 대화를 처리 중이에요.");
  }
  turnLocks.add(lockKey);
  try {
    if (request.provider === "claude") return await runClaudeTurn(request, hooks);
    if (request.provider === "cursor") return await runCursorTurn(request, hooks);
    return await runCodexTurn(request, hooks);
  } finally {
    turnLocks.delete(lockKey);
  }
}

function emitAll(emit, type, data) {
  emit(type, data);
}

async function handleTurnStream(request, emit, signal) {
  const onDelta = (text) => emitAll(emit, "delta", { text });
  const onStatus = (text) => emitAll(emit, "status", { text });
  try {
    const result = await runTurn(request, { onDelta, onStatus, signal });
    emitAll(emit, "done", {
      text: result.text,
      provider: request.provider,
      sessionId: result.sessionId,
    });
  } catch (error) {
    emitAll(emit, "error", {
      message: error instanceof Error ? error.message : "에이전트가 실패했어요.",
    });
  }
}

async function handleHttpChat(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (error) {
    sendJson(res, 413, { error: error instanceof Error ? error.message : "요청이 너무 커요." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "JSON이 올바르지 않아요." });
    return;
  }
  const request = parseChatRequest(parsed);
  if (!request) {
    sendJson(res, 400, { error: "provider·jobId·prompt가 올바르지 않아요." });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on("close", onClose);
  try {
    await handleTurnStream(request, (event, data) => writeSse(res, event, data), controller.signal);
  } finally {
    req.off("close", onClose);
    res.end();
  }
}

const server = createServer(async (req, res) => {
  applyCors(req, res);
  if (!isLoopbackHost(req.headers.host)) {
    sendJson(res, 403, { error: "이 사이드카는 이 PC에서만 열어요." });
    return;
  }
  const origin = req.headers.origin;
  if ((origin || req.method === "POST" || req.method === "OPTIONS") && !isAllowedOrigin(origin)) {
    sendJson(res, 403, { error: "허용된 작업실에서만 요청할 수 있어요." });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    const [claude, codex, cursor] = await Promise.all([
      hasCommand("claude"),
      hasCommand("codex"),
      hasCommand("agent"),
    ]);
    const [claudeModels, codexModels, cursorModels] = await Promise.all([
      modelsFor("claude", claude),
      modelsFor("codex", codex),
      modelsFor("cursor", cursor),
    ]);
    sendJson(res, 200, {
      ok: true,
      providers: { claude, codex, cursor },
      runtime: { claude: "session", codex: "app-server", cursor: "print-ask" },
      transport: { http: true, websocket: true },
      models: { claude: claudeModels, codex: codexModels, cursor: cursorModels },
      defaults: {
        claude: preferredModel("claude", claudeModels),
        codex: preferredModel("codex", codexModels),
        cursor: preferredModel("cursor", cursorModels),
      },
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/chat") {
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
      sendJson(res, 415, { error: "JSON 요청이 필요해요." });
      return;
    }
    await handleHttpChat(req, res);
    return;
  }
  sendJson(res, 404, { error: "없는 경로예요." });
});

const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (!isLoopbackHost(req.headers.host) || url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    sockets.emit("connection", ws, req);
  });
});

sockets.on("connection", (ws) => {
  let controller = null;
  ws.on("message", async (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "JSON이 올바르지 않아요." }));
      return;
    }
    const request = parseChatRequest(parsed);
    if (!request) {
      ws.send(JSON.stringify({ type: "error", message: "provider·jobId·prompt가 올바르지 않아요." }));
      return;
    }
    if (controller) {
      ws.send(JSON.stringify({ type: "error", message: "이미 같은 소켓에서 대화를 처리 중이에요." }));
      return;
    }
    controller = new AbortController();
    try {
      await handleTurnStream(request, (event, data) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: event, ...data }));
      }, controller.signal);
    } finally {
      controller = null;
    }
  });
  ws.on("close", () => controller?.abort());
});

server.listen(PORT, HOST, () => {
  console.log(`knowledge agent sidecar http://${HOST}:${PORT}`);
  console.log("WebSocket ws://127.0.0.1:" + `${PORT}/ws · Claude session + Codex app-server`);
});

function shutdown() {
  for (const session of claudeSessions.values()) {
    session.child?.kill();
  }
  codexServer.child?.kill();
  server.close(() => process.exit(0));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}
