import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const mock = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), latest: vi.fn(), ids: vi.fn(), read: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/knowledge-auth", () => ({ getKnowledgeAuth: mock.auth }));
vi.mock("@/lib/supabase-server", () => ({ getServerSupabaseClient: mock.client }));
vi.mock("@/lib/knowledge-latest-approved", () => ({ resolveLatestApprovedKnowledge: mock.latest }));
vi.mock("@/lib/knowledge-usage-context-store", () => ({ readUsageContext: mock.read }));
vi.mock("@/lib/knowledge-usage-search", async importOriginal => ({ ...await importOriginal<object>(), listUsageJobIds: mock.ids }));
const user = "123e4567-e89b-42d3-a456-426614174001";
const id = "123e4567-e89b-42d3-a456-426614174002";
const id2 = "123e4567-e89b-42d3-a456-426614174003";
const request = (query = "") => new Request(`http://localhost:3000/api/knowledge/usage-contexts${query}`);
function row(jobId: string) {
  const markdown = `Approved ${jobId}`;
  const hash = createHash("sha256").update(`v1\n${jobId}\n1\n${markdown}`).digest("hex");
  return { id: jobId, title: "본문 제목", source_url: "https://youtu.be/abc_DEF-123", studio_draft: { markdown, revision: 1 }, approved_at: "2026-09-13T00:00:00Z", approval_intent_hash: hash, result_approval_intent_hash: hash };
}
let data: unknown[]; let error: object | null;
const eq = vi.fn(); const inIds = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FOCUS_FEED_USAGE_ROOT", process.cwd()); vi.stubEnv("FOCUS_FEED_BRAIN_ROOT", process.cwd());
  mock.auth.mockResolvedValue({ status: "authenticated", user: { id: user } });
  mock.ids.mockResolvedValue([id]); data = [row(id)]; error = null;
  const chain = { eq, in: inIds }; eq.mockReturnValue(chain); inIds.mockImplementation(async () => ({ data, error }));
  mock.client.mockReturnValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }) });
  mock.latest.mockImplementation(async ({ snapshots }) => snapshots.map((snapshot: object) => ({ ...snapshot, versionScope: "brain-verified" })));
  mock.read.mockResolvedValue({ revision: 1, updatedAt: "2026-09-13T00:00:00Z", savedReason: "영상 작업에 참고", links: [{ kind: "project", ref: "요한브레인" }, { kind: "question", ref: "어떻게 적용할까?" }] });
});
afterEach(() => vi.unstubAllEnvs());

describe("usage context search API", () => {
  it("lists notes without a query, verifies owner/completed and emits no original body", async () => {
    const response = await GET(request()); const result = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(eq.mock.calls).toEqual([["user_id", user], ["status", "completed"]]);
    expect(inIds).toHaveBeenCalledWith("id", [id]); expect(mock.ids).toHaveBeenCalledWith(process.cwd(), user);
    expect(result.total).toBe(1); expect(result.items[0]).toMatchObject({ jobId: id, version: { kind: "original", revision: 1 } });
    expect(result.items[0]).not.toHaveProperty("markdown"); expect(result.items[0]).not.toHaveProperty("userId");
  });
  it("searches all words in reason and links, but not title or source body", async () => {
    expect((await (await GET(request("?q=" + encodeURIComponent("영상 요한브레인")))).json()).total).toBe(1);
    expect((await (await GET(request("?q=" + encodeURIComponent("본문 제목")))).json()).total).toBe(0);
    expect((await (await GET(request("?q=missing"))).json()).total).toBe(0);
  });
  it("never reads another user's or non-completed document notes", async () => {
    mock.ids.mockResolvedValue([id, id2]);
    const result = await (await GET(request())).json();
    expect(result.unavailableDocuments).toBe(1); expect(mock.read).toHaveBeenCalledTimes(1); expect(mock.read.mock.calls[0][2]).toBe(id);
  });
  it("reports missing current notes without searching old versions", async () => {
    mock.latest.mockResolvedValue([{ id, title: "문서", markdown: "new", revision: 2, amendmentId: id2 }]);
    mock.read.mockResolvedValue({ revision: 0, updatedAt: null, savedReason: "", links: [] });
    const result = await (await GET(request())).json();
    expect(result.total).toBe(0); expect(result.noCurrentMemo).toBe(1);
    expect(mock.read.mock.calls[0][3]).toMatchObject({ kind: "amendment", revision: 2, amendmentId: id2 });
  });
  it("fails the entire query on corrupt notes, over-limit enumeration, invalid approvals, or database failures", async () => {
    mock.read.mockRejectedValue(new Error("corrupt")); expect((await GET(request())).status).toBe(503);
    mock.ids.mockRejectedValue(new Error("limit")); expect((await GET(request())).status).toBe(503);
    mock.ids.mockResolvedValue([id]); data = [{ ...row(id), approval_intent_hash: "a".repeat(64) }]; expect((await GET(request())).status).toBe(503);
    data = [row(id)]; error = { message: "unavailable" }; expect((await GET(request())).status).toBe(503);
  });
  it("distinguishes empty storage, login, outage and invalid query", async () => {
    mock.ids.mockResolvedValue([]); const empty = await GET(request()); expect(empty.status).toBe(200); expect((await empty.json()).total).toBe(0); expect(inIds).not.toHaveBeenCalled();
    mock.auth.mockResolvedValue({ status: "login_required" }); expect((await GET(request())).status).toBe(401);
    mock.auth.mockResolvedValue({ status: "unavailable" }); expect((await GET(request())).status).toBe(503);
    expect((await GET(request("?page=50"))).status).toBe(400); expect((await GET(request("?q=" + "x".repeat(121)))).status).toBe(400);
  });
  it("sorts by saved time with stable ties and returns bounded pages", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}`);
    mock.ids.mockResolvedValue(ids); data = ids.map(row);
    const result = await (await GET(request("?page=1"))).json();
    expect(result.total).toBe(25); expect(result.items).toHaveLength(5); expect(result.items.map((item: { jobId: string }) => item.jobId)).toEqual(ids.slice(20));
  });
});
