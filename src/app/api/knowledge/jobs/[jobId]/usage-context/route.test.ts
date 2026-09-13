import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";
import { UsageContextConflictError } from "@/lib/knowledge-usage-context-store";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), latest: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/knowledge-auth", () => ({ getKnowledgeAuth: mocks.auth }));
vi.mock("@/lib/supabase-server", () => ({ getServerSupabaseClient: mocks.client }));
vi.mock("@/lib/knowledge-latest-approved", () => ({ resolveLatestApprovedKnowledge: mocks.latest }));
vi.mock("@/lib/knowledge-usage-context-store", () => ({ readUsageContext: mocks.read, saveUsageContext: mocks.save, UsageContextConflictError: class extends Error {} }));

const userId = "123e4567-e89b-42d3-a456-426614174001";
const jobId = "123e4567-e89b-42d3-a456-426614174002";
const amendmentId = "123e4567-e89b-42d3-a456-426614174003";
const markdown = "# 승인한 원본";
const intent = createHash("sha256").update(`v1\n${jobId}\n1\n${markdown}`).digest("hex");
const version = { kind: "original", revision: 1, amendmentId: null, bodySha256: createHash("sha256").update(markdown).digest("hex") };
const record = { revision: 0, updatedAt: null, savedReason: "", links: [] };
const context = () => ({ params: Promise.resolve({ jobId }) });
const request = (body: unknown, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/knowledge/jobs/${jobId}/usage-context`, { method: "PUT", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
let eq: ReturnType<typeof vi.fn>;
let single: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.FOCUS_FEED_USAGE_ROOT = "C:/usage-test";
  process.env.FOCUS_FEED_BRAIN_ROOT = "C:/brain-test";
  mocks.auth.mockResolvedValue({ status: "authenticated", user: { id: userId } });
  single = vi.fn().mockResolvedValue({ data: { id: jobId, title: "문서", source_url: "https://www.youtube.com/watch?v=abc_DEF-123", video_id: "abc_DEF-123", studio_draft: { markdown, revision: 1 }, approved_at: "2026-09-13T00:00:00Z", approval_intent_hash: intent, result_approval_intent_hash: intent }, error: null });
  const query = { eq: vi.fn(), maybeSingle: single }; query.eq.mockReturnValue(query); eq = query.eq;
  mocks.client.mockReturnValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) }) });
  mocks.latest.mockImplementation(async ({ snapshots }) => snapshots.map((item: object) => ({ ...item, versionScope: "brain-verified" })));
  mocks.read.mockResolvedValue(record); mocks.save.mockResolvedValue({ ...record, revision: 1 });
});

describe("approved document usage context", () => {
  it("checks owner and completed state before reading a private version-bound record", async () => {
    const response = await GET(new Request("http://localhost"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(eq.mock.calls).toEqual([["user_id", userId], ["status", "completed"], ["id", jobId]]);
    expect(mocks.read).toHaveBeenCalledWith("C:/usage-test", userId, jobId, version);
    expect(await response.json()).toEqual({ title: "문서", version, record });
  });
  it("distinguishes session expiry from provider failure without reading storage", async () => {
    for (const [status, code] of [["login_required", 401], ["unavailable", 503]] as const) {
      mocks.auth.mockResolvedValue({ status });
      expect((await GET(new Request("http://localhost"), context())).status).toBe(code);
    }
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not read notes for another user's or missing completed document", async () => {
    single.mockResolvedValue({ data: null, error: null });
    expect((await GET(new Request("http://localhost"), context())).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("fails closed for an invalid approval hash and missing local root", async () => {
    single.mockResolvedValue({ data: { id: jobId, title: "문서", source_url: "https://youtu.be/abc_DEF-123", studio_draft: { markdown: `${markdown} changed`, revision: 1 }, approved_at: "2026-09-13T00:00:00Z", approval_intent_hash: intent, result_approval_intent_hash: intent }, error: null });
    expect((await GET(new Request("http://localhost"), context())).status).toBe(404);
    delete process.env.FOCUS_FEED_USAGE_ROOT;
    expect((await GET(new Request("http://localhost"), context())).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("stores only allowed content after exact live version validation", async () => {
    const content = { savedReason: "프로젝트에 참고", links: [{ kind: "project", ref: "요한브레인" }] };
    const response = await PUT(request({ version, expectedRevision: 0, content }), context());
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("C:/usage-test", userId, jobId, version, content, 0);
  });
  it("rejects a changed approval without copying the previous version's note", async () => {
    mocks.latest.mockResolvedValue([{ id: jobId, title: "문서", revision: 2, markdown: "새 승인", amendmentId, versionScope: "brain-verified" }]);
    expect((await PUT(request({ version, expectedRevision: 0, content: { savedReason: "메모", links: [] } }), context())).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
    const response = await GET(new Request("http://localhost"), context());
    expect((await response.json()).version).toMatchObject({ kind: "amendment", revision: 2, amendmentId });
    expect(mocks.read.mock.calls[0][3]).not.toEqual(version);
  });
  it("rejects cross-origin writes, unknown fields, oversized and unsafe inputs", async () => {
    expect((await PUT(request({}, "https://other.example"), context())).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect((await PUT(new Request("http://localhost:3000", { method: "PUT", body: "{}" }), context())).status).toBe(403);
    expect((await PUT(new Request("http://localhost:3000", { method: "PUT", headers: { origin: "http://localhost:3000" }, body: "{}" }), context())).status).toBe(415);
    const base = { version, expectedRevision: 0, content: { savedReason: "", links: [] } };
    expect((await PUT(request({ ...base, userId }), context())).status).toBe(400);
    expect((await PUT(request({ ...base, content: { savedReason: "", links: [{ kind: "document", ref: "javascript:alert(1)" }] } }), context())).status).toBe(400);
    expect((await PUT(request({ ...base, content: { savedReason: "x".repeat(40_000), links: [] } }), context())).status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reports conflicts and storage corruption without pretending the note is empty", async () => {
    mocks.save.mockRejectedValue(new UsageContextConflictError());
    expect((await PUT(request({ version, expectedRevision: 0, content: { savedReason: "", links: [] } }), context())).status).toBe(409);
    mocks.read.mockRejectedValue(new Error("corrupt"));
    expect((await GET(new Request("http://localhost"), context())).status).toBe(503);
  });
});
