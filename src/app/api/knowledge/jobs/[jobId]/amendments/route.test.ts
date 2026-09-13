import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentUserFromCookies: vi.fn(),
  getServerSupabaseClient: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase-server-cookies", () => ({ getCurrentUserFromCookies: mocks.getCurrentUserFromCookies }));
vi.mock("@/lib/supabase-server", () => ({ getServerSupabaseClient: mocks.getServerSupabaseClient }));

import { GET, POST } from "./route";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const USER_ID = "user-a";
const MARKDOWN = "# 승인 문서\n\n본문";
const AMENDMENT = "# 수정 문서\n\n수정 본문";
const hashFor = (id: string, revision: number, markdown: string) =>
  createHash("sha256").update(`v1\n${id}\n${revision}\n${markdown}`, "utf8").digest("hex");

const baseRow = () => ({
  id: JOB_ID,
  title: "승인 문서",
  source_url: "https://youtu.be/abc_DEF-123",
  video_id: "abc_DEF-123",
  studio_draft: { markdown: MARKDOWN, revision: 2 },
  approved_at: "2026-09-11T01:00:00.000Z",
  approval_intent_hash: hashFor(JOB_ID, 2, MARKDOWN),
  result_approval_intent_hash: hashFor(JOB_ID, 2, MARKDOWN),
});

function makeTable(result: unknown) {
  const table = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
  table.select.mockReturnValue(table);
  table.eq.mockReturnValue(table);
  table.order.mockReturnValue(table);
  table.limit.mockResolvedValue(result);
  table.maybeSingle.mockResolvedValue(result);
  return table;
}

function makeClient(options: {
  base?: { data: unknown; error: { code?: string; message: string } | null };
  list?: { data: unknown[] | null; error: { code?: string; message: string } | null };
  current?: { data: unknown; error: { code?: string; message: string } | null };
  rpc?: { data: unknown; error: { code?: string; message: string } | null };
} = {}) {
  const base = makeTable(options.base ?? { data: baseRow(), error: null });
  const list = makeTable(options.list ?? { data: [], error: null });
  const current = makeTable(options.current ?? { data: null, error: null });
  const rpc = vi.fn().mockResolvedValue(options.rpc ?? {
    data: { id: "amendment-1", user_id: USER_ID, job_id: JOB_ID, amendment_revision: 1, base_revision: 2, base_intent_hash: "private-hash", markdown: AMENDMENT, created_at: "2026-09-12T00:00:00.000Z" },
    error: null,
  });
  const from = vi.fn()
    .mockReturnValueOnce(base)
    .mockReturnValueOnce(list)
    .mockReturnValueOnce(current);
  return { client: { from, rpc }, base, list, current, rpc };
}

const context = { params: Promise.resolve({ jobId: JOB_ID }) };
const callGet = (query = "") => GET(new Request(`https://focus-feed.test/api/knowledge/jobs/${JOB_ID}/amendments${query}`), context);
const callPost = (body: unknown, headers: Record<string, string> = {}) => POST(new Request(`https://focus-feed.test/api/knowledge/jobs/${JOB_ID}/amendments`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
}), context);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.getCurrentUserFromCookies.mockResolvedValue({ id: USER_ID });
});

describe("GET /api/knowledge/jobs/:jobId/amendments", () => {
  it("비로그인 요청은 DB를 조회하지 않고 401을 반환한다", async () => {
    mocks.getCurrentUserFromCookies.mockResolvedValue(null);
    expect((await callGet()).status).toBe(401);
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("완료된 소유 문서의 검증된 기준본을 읽고 storageReady를 표시한다", async () => {
    const { client, base } = makeClient();
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const body = await (await callGet()).json();
    expect(body).toMatchObject({ storageReady: true, base: { id: JOB_ID, title: "승인 문서", revision: 2, markdown: MARKDOWN }, history: [], current: null });
    expect(base.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(base.eq).toHaveBeenCalledWith("status", "completed");
    expect(base.eq).toHaveBeenCalledWith("id", JOB_ID);
  });

  it("기준본 approval hash가 맞지 않으면 기준 문서를 노출하지 않는다", async () => {
    const { client } = makeClient({ base: { data: { ...baseRow(), approval_intent_hash: "0".repeat(64) }, error: null } });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    expect((await callGet()).status).toBe(404);
  });

  it("amendments 저장소가 없으면 검증된 기준본과 함께 storageReady=false를 반환한다", async () => {
    const { client } = makeClient({ list: { data: null, error: { code: "PGRST205", message: "missing table" } } });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const body = await (await callGet()).json();
    expect(body).toMatchObject({ storageReady: false, base: { id: JOB_ID, revision: 2 }, history: [], current: null });
  });

  it("history와 current에는 공개 버전 필드만 반환한다", async () => {
    const { client } = makeClient({
      list: { data: [{ id: "a", amendment_revision: 2, base_revision: 2, created_at: "2026-09-12T00:00:00.000Z", base_intent_hash: "secret-list" }], error: null },
      current: { data: { id: "a", amendment_revision: 2, base_revision: 2, markdown: AMENDMENT, created_at: "2026-09-12T00:00:00.000Z", base_intent_hash: "secret-current" }, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const body = await (await callGet("?revision=2")).json();
    expect(body.current).toEqual({ id: "a", revision: 2, baseRevision: 2, createdAt: "2026-09-12T00:00:00.000Z", markdown: AMENDMENT });
    expect(body.history[0]).toEqual({ id: "a", revision: 2, baseRevision: 2, createdAt: "2026-09-12T00:00:00.000Z" });
    expect(JSON.stringify(body)).not.toContain("secret-");
  });
});

describe("POST /api/knowledge/jobs/:jobId/amendments", () => {
  it("uses the browser-facing Host when Next rewrites the internal request URL", async () => {
    mocks.getServerSupabaseClient.mockReturnValue(makeClient().client);
    const response = await POST(new Request(`http://localhost:3000/api/knowledge/jobs/${JOB_ID}/amendments`, {
      method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2 }),
    }), { params: Promise.resolve({ jobId: JOB_ID }) });
    expect(response.status).toBe(200);
    expect((await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2 }, { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3001" })).status).toBe(403);
  });
  it("cross-origin 요청은 인증과 DB 조회 전에 403을 반환한다", async () => {
    expect((await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2 }, { origin: "https://evil.test" })).status).toBe(403);
    expect(mocks.getCurrentUserFromCookies).not.toHaveBeenCalled();
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("알 수 없는 필드나 잘못된 본문은 400, 512KB 초과는 413이다", async () => {
    mocks.getServerSupabaseClient.mockReturnValue(makeClient().client);
    expect((await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2, metadata: "spoof" })).status).toBe(400);
    mocks.getServerSupabaseClient.mockReturnValue(makeClient().client);
    expect((await callPost("x".repeat(512_001))).status).toBe(413);
  });

  it("클라이언트 metadata와 owner를 받지 않고 기준 hash와 revision을 RPC에 전달한다", async () => {
    const { client, rpc } = makeClient();
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callPost({ markdown: AMENDMENT, expectedRevision: 4, baseRevision: 2, ownerId: "spoof", metadata: { title: "spoof" } });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    const second = makeClient();
    mocks.getServerSupabaseClient.mockReturnValue(second.client);
    await callPost({ markdown: AMENDMENT, expectedRevision: 4, baseRevision: 2 });
    expect(second.rpc).toHaveBeenCalledWith("save_knowledge_amendment", {
      p_user_id: USER_ID,
      p_job_id: JOB_ID,
      p_expected_revision: 4,
      p_base_revision: 2,
      p_base_intent_hash: hashFor(JOB_ID, 2, MARKDOWN),
      p_markdown: AMENDMENT,
    });
  });

  it("기준 revision 불일치와 serialization conflict는 409이고 RPC를 생략한다", async () => {
    const { client, rpc } = makeClient({ rpc: { data: null, error: { code: "40001", message: "serialization failure" } } });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    expect((await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 99 })).status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
    const second = makeClient({ rpc: { data: null, error: { code: "40001", message: "serialization failure" } } });
    mocks.getServerSupabaseClient.mockReturnValue(second.client);
    expect((await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2 })).status).toBe(409);
    const third = makeClient({ rpc: { data: null, error: { code: "22023", message: "revision conflict" } } });
    mocks.getServerSupabaseClient.mockReturnValue(third.client);
    expect((await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2 })).status).toBe(409);
  });

  it("RPC가 없으면 503, 성공하면 amendment version 본문만 반환한다", async () => {
    const missing = makeClient({ rpc: { data: null, error: { code: "PGRST202", message: "missing function" } } });
    mocks.getServerSupabaseClient.mockReturnValue(missing.client);
    expect((await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2 })).status).toBe(503);

    const success = makeClient();
    mocks.getServerSupabaseClient.mockReturnValue(success.client);
    const body = await (await callPost({ markdown: AMENDMENT, expectedRevision: 0, baseRevision: 2 })).json();
    expect(body).toEqual({ amendment: { id: "amendment-1", revision: 1, baseRevision: 2, createdAt: "2026-09-12T00:00:00.000Z", markdown: AMENDMENT } });
    expect(JSON.stringify(body)).not.toContain("private-hash");
  });
});
