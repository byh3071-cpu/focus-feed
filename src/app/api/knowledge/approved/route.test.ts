import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentUserFromCookies: vi.fn(),
  getKnowledgeAuth: vi.fn(),
  getServerSupabaseClient: vi.fn(),
  readBrainApprovalStatus: vi.fn(),
  searchSemanticKnowledge: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase-server-cookies", () => ({ getCurrentUserFromCookies: mocks.getCurrentUserFromCookies }));
vi.mock("@/lib/knowledge-auth", () => ({ getKnowledgeAuth: mocks.getKnowledgeAuth }));
vi.mock("@/lib/supabase-server", () => ({ getServerSupabaseClient: mocks.getServerSupabaseClient }));
vi.mock("@/lib/knowledge-brain-status", () => ({ readBrainApprovalStatus: mocks.readBrainApprovalStatus }));
vi.mock("@/lib/knowledge-semantic-search", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/knowledge-semantic-search")>(), searchSemanticKnowledge: mocks.searchSemanticKnowledge }));

import { GET } from "./route";

const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "223e4567-e89b-42d3-a456-426614174001";
const OWNER_ID = "423e4567-e89b-42d3-a456-426614174003";
const MARKDOWN = "# 승인 문서\n\nliteral %_ keyword";
const hashFor = (id: string, revision: number, markdown: string) =>
  createHash("sha256").update(`v1\n${id}\n${revision}\n${markdown}`, "utf8").digest("hex");

function row(id = ID_A, overrides: Record<string, unknown> = {}) {
  const base = {
    id,
    title: "승인 제목",
    source_url: "https://youtu.be/abc_DEF-123",
    video_id: "abc_DEF-123",
    studio_draft: { markdown: MARKDOWN, revision: 2 },
    approved_at: "2026-09-11T01:00:00.000Z",
    approval_intent_hash: hashFor(id, 2, MARKDOWN),
    result_approval_intent_hash: hashFor(id, 2, MARKDOWN),
  };
  return { ...base, ...overrides };
}

function makeClient(result: { data: unknown[] | null; error: { code?: string; message: string } | null }) {
  const table = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), in: vi.fn() };
  table.select.mockReturnValue(table);
  table.eq.mockReturnValue(table);
  table.order.mockReturnValue(table);
  table.limit.mockResolvedValue(result);
  table.in.mockResolvedValue(result);
  return { client: { from: vi.fn(() => table) }, table };
}

function makeLatestClient(jobRows: unknown[], amendmentRows: unknown[]) {
  const jobs = makeClient({ data: jobRows, error: null });
  const amendments = makeClient({ data: amendmentRows, error: null });
  amendments.table.in.mockReturnValue(amendments.table);
  amendments.table.limit.mockResolvedValue({ data: amendmentRows, error: null, count: amendmentRows.length });
  return {
    client: {
      from: vi.fn((table: string) => table === "knowledge_amendments" ? amendments.table : jobs.table),
    },
  };
}

const call = (search = "") => GET(new Request(`https://focus-feed.test/api/knowledge/approved${search}`));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FOCUS_FEED_BRAIN_ROOT;
  delete process.env.FOCUS_FEED_MCP_ROOT;
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.getCurrentUserFromCookies.mockResolvedValue({ id: "user-a" });
  mocks.getKnowledgeAuth.mockImplementation(async () => {
    const user = await mocks.getCurrentUserFromCookies();
    return user ? { status: "authenticated", user } : { status: "login_required" };
  });
});

describe("GET /api/knowledge/approved", () => {
  it("keeps auth service failures separate from expired login", async () => {
    mocks.getKnowledgeAuth.mockResolvedValue({ status: "unavailable" });
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "auth_unavailable" });
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
    mocks.getKnowledgeAuth.mockResolvedValue({ status: "login_required" });
    const expired = await call();
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: "login_required" });
  });
  it("rejects empty natural-language queries and semantic ids requests", async () => {
    expect((await call("?search=semantic&q=")).status).toBe(400);
    expect((await call(`?search=semantic&ids=${ID_A}`)).status).toBe(400);
    expect(mocks.searchSemanticKnowledge).not.toHaveBeenCalled();
  });
  it("ranks only owner-verified snapshots and exposes no vector payload", async () => {
    process.env.FOCUS_FEED_BRAIN_ROOT = "C:/brain";
    process.env.FOCUS_FEED_MCP_ROOT = "C:/mcp";
    mocks.getServerSupabaseClient.mockReturnValue(makeLatestClient([row()], []).client);
    mocks.searchSemanticKnowledge.mockImplementation(async ({ snapshots }) => ({ sources: snapshots, unindexedCount: 0 }));
    const response = await call("?search=semantic&q=unrelated-natural-language");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.searchSemanticKnowledge).toHaveBeenCalledWith(expect.objectContaining({ query: "unrelated-natural-language", snapshots: [expect.objectContaining({ id: ID_A, versionScope: "brain-verified" })] }));
    expect(body).toMatchObject({ searchMode: "semantic", unindexedCount: 0, sources: [{ id: ID_A }] });
    expect(JSON.stringify(body)).not.toMatch(/markdown|hash|path/i);
  });
  it("returns 503 without silently changing to keyword search", async () => {
    const { KnowledgeSemanticUnavailableError } = await import("@/lib/knowledge-semantic-search");
    mocks.getServerSupabaseClient.mockReturnValue(makeClient({ data: [row()], error: null }).client);
    mocks.searchSemanticKnowledge.mockRejectedValue(new KnowledgeSemanticUnavailableError());
    const response = await call("?search=semantic&q=keyword");
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("sources");
  });
  it("authenticates before rejecting query input", async () => {
    mocks.getCurrentUserFromCookies.mockResolvedValue(null);
    const response = await call(`?q=${"x".repeat(121)}`);
    expect(response.status).toBe(401);
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("queries only the owner's latest 101 completed snapshots and filters literal text locally", async () => {
    const { client, table } = makeClient({ data: [row(), row(ID_B, { title: "다른 문서", studio_draft: { markdown: "# 없음", revision: 2 }, approval_intent_hash: "b".repeat(64), studio_snapshot_hash: "b".repeat(64) })], error: null });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await call("?q=%25_");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(table.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(table.eq).toHaveBeenCalledWith("status", "completed");
    expect(table.order).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(table.limit).toHaveBeenCalledWith(101);
    expect(table.select.mock.calls[0][0]).toContain("studio_draft:result->studio_draft");
    expect(table.select.mock.calls[0][0]).toContain("result_approval_intent_hash:result->>approval_intent_hash");
    expect(table.select.mock.calls[0][0]).not.toMatch(/(?:^|, )result(?:,|$)/);
    expect(body).toMatchObject({ scope: "recent-100", hasMore: false, sources: [{ id: ID_A, revision: 2 }] });
    expect(body.sources[0]).not.toHaveProperty("markdown");
    expect(JSON.stringify(body)).not.toMatch(/notebook|hash|path/i);
  });

  it("excludes a completed row when either approval hash is wrong", async () => {
    const { client } = makeClient({ data: [row(ID_A, { result_approval_intent_hash: "0".repeat(64) })], error: null });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const body = await (await call()).json();
    expect(body.sources).toEqual([]);
  });

  it("returns requested verified snapshots with markdown and requires every id", async () => {
    const { client, table } = makeClient({ data: [row(ID_A), row(ID_B)], error: null });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await call(`?ids=${ID_A},${ID_B}`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(table.in).toHaveBeenCalledWith("id", [ID_A, ID_B]);
    expect(table.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(table.eq).toHaveBeenCalledWith("status", "completed");
    expect(body.sources).toHaveLength(2);
    expect(body.sources[0].markdown).toBe(MARKDOWN);
  });

  it("returns one generic 404 without a partial attachment for missing or invalid snapshots", async () => {
    const { client } = makeClient({ data: [row(ID_A)], error: null });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await call(`?ids=${ID_A},${ID_B}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "승인된 지식 문서를 찾지 못했어요." });
  });

  it("returns 400 for malformed ids and 503/500 for known and unknown database errors", async () => {
    mocks.getServerSupabaseClient.mockReturnValue(makeClient({ data: [], error: null }).client);
    expect((await call("?ids=bad")).status).toBe(400);

    mocks.getServerSupabaseClient.mockReturnValue(makeClient({ data: null, error: { code: "42P01", message: "missing knowledge_jobs" } }).client);
    expect((await call()).status).toBe(503);

    mocks.getServerSupabaseClient.mockReturnValue(makeClient({ data: null, error: { message: "boom" } }).client);
    expect((await call()).status).toBe(500);
  });

  it("searches the verified amendment body and returns its explicit version identity", async () => {
    process.env.FOCUS_FEED_BRAIN_ROOT = "C:\\brain";
    mocks.getCurrentUserFromCookies.mockResolvedValue({ id: OWNER_ID });
    const amendmentId = "323e4567-e89b-42d3-a456-426614174002";
    const amendmentBody = "# 수정된 내용\n\n새표현은 수정안에만 있어요.";
    const bodySha256 = createHash("sha256").update(amendmentBody, "utf8").digest("hex");
    const base = row(ID_A, { studio_draft: { markdown: "# 원본만 있어요", revision: 2 } });
    const baseHash = hashFor(ID_A, 2, "# 원본만 있어요");
    Object.assign(base, { approval_intent_hash: baseHash, result_approval_intent_hash: baseHash });
    const { client } = makeLatestClient([base], [{
      id: amendmentId,
      user_id: OWNER_ID,
      job_id: ID_A,
      amendment_revision: 1,
      base_revision: 2,
      base_intent_hash: baseHash,
      markdown: amendmentBody,
      created_at: "2026-09-11T02:00:00.000Z",
    }]);
    mocks.getServerSupabaseClient.mockReturnValue(client);
    mocks.readBrainApprovalStatus.mockResolvedValue({
      jobId: ID_A,
      checkedAt: "2026-09-11T03:00:00.000Z",
      versions: [{ id: amendmentId, revision: 1, approved: true, approvedAt: "2026-09-11T02:30:00.000Z", bodySha256 }],
      latestApproved: { id: amendmentId, revision: 1, approved: true, approvedAt: "2026-09-11T02:30:00.000Z", bodySha256 },
    });

    const response = await call("?q=새표현");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sources).toEqual([expect.objectContaining({
      id: ID_A,
      revision: 1,
      amendmentId,
      baseRevision: 2,
      versionScope: "brain-verified",
    })]);
    expect(body.sources[0]).not.toHaveProperty("markdown");
  });

  it("returns a generic 503 when configured Brain verification is unavailable", async () => {
    process.env.FOCUS_FEED_BRAIN_ROOT = "C:\\brain";
    mocks.getCurrentUserFromCookies.mockResolvedValue({ id: OWNER_ID });
    const amendmentId = "323e4567-e89b-42d3-a456-426614174002";
    const base = row();
    const { client } = makeLatestClient([base], [{
      id: amendmentId,
      user_id: OWNER_ID,
      job_id: ID_A,
      amendment_revision: 1,
      base_revision: 2,
      base_intent_hash: hashFor(ID_A, 2, MARKDOWN),
      markdown: "# 수정안",
      created_at: "2026-09-11T02:00:00.000Z",
    }]);
    mocks.getServerSupabaseClient.mockReturnValue(client);
    mocks.readBrainApprovalStatus.mockRejectedValue(new Error("C:\\private\\brain failed"));

    const response = await call();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "최신 승인본을 일시적으로 확인할 수 없어요." });
  });
});
