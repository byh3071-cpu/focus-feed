import { describe, expect, it } from "vitest";
import {
  extractCodexAppServerDelta,
  formatClaudeStreamUserLine,
  isAllowedKnowledgeAgentOrigin,
  isLoopbackHost,
  parseClaudeStreamJsonLine,
  parseCodexDebugModels,
  parseCodexExecJsonLine,
  parseCodexRpcLine,
  parseCursorAgentJsonLine,
  parseCursorModelList,
  parseKnowledgeAgentChatRequest,
  parseKnowledgeAgentHealth,
  parseKnowledgeAgentSocketEvent,
  parseSseBuffer,
} from "./knowledge-agent-protocol";

describe("knowledge agent origin", () => {
  it("루프백과 추가 origin만 허용한다", () => {
    expect(isAllowedKnowledgeAgentOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedKnowledgeAgentOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isAllowedKnowledgeAgentOrigin("https://evil.example")).toBe(false);
    expect(isAllowedKnowledgeAgentOrigin("https://focus.example", ["https://focus.example"])).toBe(true);
    expect(isLoopbackHost("127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});

describe("knowledge agent request", () => {
  it.each(["x&echo INJECTED", "--help", "a\nb", "x".repeat(129), 42])("위험하거나 잘못된 세션 값을 거부한다: %s", (sessionId) => {
    expect(parseKnowledgeAgentChatRequest({ provider: "claude", jobId: "123e4567-e89b-42d3-a456-426614174000", prompt: "test", sessionId })).toBeUndefined();
  });
  it("provider·job·prompt를 받고 모델은 기본값을 채운다", () => {
    expect(parseKnowledgeAgentChatRequest({
      type: "chat",
      provider: "claude",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
      sessionId: "sess-1",
    })).toEqual({
      provider: "claude",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
      model: "claude-fable-5-1",
      sessionId: "sess-1",
    });
    expect(parseKnowledgeAgentChatRequest({
      provider: "codex",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
      model: "gpt-5.6-sol",
    })).toEqual({
      provider: "codex",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
      model: "gpt-5.6-sol",
    });
    expect(parseKnowledgeAgentChatRequest({
      provider: "cursor",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
    })).toEqual({
      provider: "cursor",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
      model: "composer-2.5",
    });
    expect(parseKnowledgeAgentChatRequest({
      provider: "gemini",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
    })).toBeUndefined();
    expect(parseKnowledgeAgentChatRequest({
      provider: "claude",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
      model: "not valid!!",
    })).toBeUndefined();
    expect(parseKnowledgeAgentChatRequest({
      provider: "cursor",
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      prompt: "더 짧게",
      model: "cursor-grok-4.6-xhigh-fast",
    })?.model).toBe("cursor-grok-4.6-xhigh-fast");
    expect(parseKnowledgeAgentChatRequest({
      provider: "claude",
      jobId: "not-a-uuid",
      prompt: "더 짧게",
    })).toBeUndefined();
  });
});

describe("live model catalogs", () => {
  it("Cursor --list-models 줄과 Codex debug JSON을 읽는다", () => {
    expect(parseCursorModelList([
      "Available models",
      "auto - Auto (default)",
      "cursor-grok-4.6-xhigh-fast - Cursor Grok 4.6 Extra High Fast",
      "not a row",
    ].join("\n"))).toEqual([
      { id: "auto", label: "Auto (default)" },
      { id: "cursor-grok-4.6-xhigh-fast", label: "Cursor Grok 4.6 Extra High Fast" },
    ]);
    expect(parseCodexDebugModels({
      models: [
        { slug: "gpt-6-astra", display_name: "GPT-6-Astra" },
        { slug: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" },
        { slug: "gpt-6-astra", display_name: "dup" },
      ],
    })).toEqual([
      { id: "gpt-6-astra", label: "GPT-6-Astra" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    ]);
  });
});

describe("parseKnowledgeAgentHealth", () => {
  it("설치 여부만 읽는다", () => {
    expect(parseKnowledgeAgentHealth({
      ok: true,
      providers: { claude: true, codex: false },
    })).toEqual({
      ok: true,
      providers: { claude: true, codex: false, cursor: false },
    });
    expect(parseKnowledgeAgentHealth({ ok: true })).toBeUndefined();
  });
});

describe("parseSseBuffer", () => {
  it("잘린 청크를 이어 붙인다", () => {
    const first = parseSseBuffer('event: delta\ndata: {"text":"안"}\n\nevent: del');
    expect(first.events).toEqual([{ type: "delta", text: "안" }]);
    const second = parseSseBuffer(`${first.rest}ta\ndata: {"text":"녕"}\n\n`);
    expect(second.events).toEqual([{ type: "delta", text: "녕" }]);
    expect(second.rest).toBe("");
  });
});

describe("parseClaudeStreamJsonLine", () => {
  it("session·delta·result를 읽는다", () => {
    expect(parseClaudeStreamJsonLine(
      '{"type":"system","subtype":"init","session_id":"sess-9"}',
    )).toEqual({ kind: "session", sessionId: "sess-9" });
    expect(parseClaudeStreamJsonLine(JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "안녕" } },
    }))).toEqual({ kind: "delta", text: "안녕" });
    expect(parseClaudeStreamJsonLine(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "전체" }] },
    }))).toEqual({ kind: "assistant", text: "전체" });
    expect(parseClaudeStreamJsonLine(
      '{"type":"result","result":"끝","session_id":"sess-9"}',
    )).toEqual({ kind: "result", text: "끝", sessionId: "sess-9" });
  });
});

describe("parseCursorAgentJsonLine", () => {
  it("session·부분 출력·result를 읽는다", () => {
    expect(parseCursorAgentJsonLine(
      '{"type":"system","subtype":"init","session_id":"cur-1"}',
    )).toEqual({ kind: "session", sessionId: "cur-1" });
    expect(parseCursorAgentJsonLine(JSON.stringify({
      type: "assistant",
      timestamp_ms: 12,
      message: { content: [{ type: "text", text: "안" }] },
    }))).toEqual({ kind: "delta", text: "안" });
    expect(parseCursorAgentJsonLine(JSON.stringify({
      type: "assistant",
      model_call_id: "call-1",
      message: { content: [{ type: "text", text: "중복" }] },
    }))).toEqual({ kind: "ignore" });
    expect(parseCursorAgentJsonLine(
      '{"type":"result","result":"끝","session_id":"cur-1"}',
    )).toEqual({ kind: "result", text: "끝", sessionId: "cur-1" });
  });
});

describe("parseCodexExecJsonLine", () => {
  it("thread와 최종 agent_message를 읽는다", () => {
    expect(parseCodexExecJsonLine(
      '{"type":"thread.started","thread_id":"thr-1"}',
    )).toEqual({ kind: "session", sessionId: "thr-1" });
    expect(parseCodexExecJsonLine(JSON.stringify({
      type: "item.completed",
      item: { id: "item_3", type: "agent_message", text: "고친 초안" },
    }))).toEqual({ kind: "message", text: "고친 초안" });
    expect(parseCodexExecJsonLine('{"type":"turn.failed","error":{"message":"로그인 필요"}}'))
      .toEqual({ kind: "error", message: "로그인 필요" });
  });
});

describe("formatClaudeStreamUserLine", () => {
  it("같은 프로세스에 넣을 user NDJSON을 만든다", () => {
    const line = formatClaudeStreamUserLine("더 짧게");
    expect(JSON.parse(line)).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "더 짧게" }] },
    });
  });
});

describe("parseCodexRpcLine", () => {
  it("response·notification·server request를 나눈다", () => {
    expect(parseCodexRpcLine('{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"thr-1"}}}'))
      .toEqual({ kind: "response", id: 1, result: { thread: { id: "thr-1" } } });
    expect(parseCodexRpcLine(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { delta: { text: "안" } },
    }))).toEqual({
      kind: "notification",
      method: "item/agentMessage/delta",
      params: { delta: { text: "안" } },
    });
    expect(parseCodexRpcLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "item/commandExecution/requestApproval",
      params: { itemId: "i1" },
    }))).toEqual({
      kind: "request",
      id: 9,
      method: "item/commandExecution/requestApproval",
      params: { itemId: "i1" },
    });
  });
});

describe("parseKnowledgeAgentSocketEvent", () => {
  it("WS 이벤트를 SSE와 같은 모양으로 읽는다", () => {
    expect(parseKnowledgeAgentSocketEvent({
      type: "done",
      text: "끝",
      provider: "codex",
      sessionId: "thr-1",
    })).toEqual({ type: "done", text: "끝", provider: "codex", sessionId: "thr-1" });
  });
});

describe("extractCodexAppServerDelta", () => {
  it("흔한 delta 모양을 받는다", () => {
    expect(extractCodexAppServerDelta({ delta: { text: "한" } })).toBe("한");
    expect(extractCodexAppServerDelta({ text: "줄" })).toBe("줄");
    expect(extractCodexAppServerDelta({ item: { type: "agentMessage", text: "끝" } })).toBe("끝");
  });
});
