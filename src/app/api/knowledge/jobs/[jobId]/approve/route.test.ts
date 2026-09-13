import { beforeEach, describe, expect, it, vi } from "vitest";
import { studioApprovalIntentHash } from "@/lib/knowledge-studio";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentUserFromCookies: vi.fn(),
  getServerSupabaseClient: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase-server-cookies", () => ({
  getCurrentUserFromCookies: mocks.getCurrentUserFromCookies,
}));
vi.mock("@/lib/supabase-server", () => ({
  getServerSupabaseClient: mocks.getServerSupabaseClient,
}));

import { POST } from "./route";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const MARKDOWN = "# 저장본\n\n본문";
const STUDIO_ROW = {
  id: JOB_ID,
  user_id: "user-a",
  video_id: "abc_DEF-123",
  source_url: "https://www.youtube.com/watch?v=abc_DEF-123",
  title: "작업실 영상",
  channel_name: "작업 채널",
  source_guide: "## YouTube 소스 가이드",
  status: "review_required" as const,
  failure_code: null as string | null,
  capture_ready: true,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:01:00.000Z",
  quality_score: 96 as number | null,
  quality_report: { warnings: [] } as unknown,
  result: {
    draft: { summary: "worker" },
    studio_draft: {
      markdown: MARKDOWN,
      revision: 2,
      updatedAt: "2026-09-04T01:00:00.000Z",
    },
  },
};

function makeClient(options: {
  get: { data: (Omit<typeof STUDIO_ROW, "status"> & { status: string }) | null; error: { code?: string; message: string } | null };
  rpc: { data: unknown; error: { code?: string; message: string } | null };
  update?: { data: { result: unknown } | null; error: { code?: string; message: string } | null };
}) {
  const getTable = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  getTable.select.mockReturnValue(getTable);
  getTable.eq.mockReturnValue(getTable);
  getTable.maybeSingle.mockResolvedValue(options.get);

  const from = vi.fn().mockReturnValue(getTable);
  const rpc = vi.fn().mockImplementation((name: string) => Promise.resolve(
    name === "patch_knowledge_studio_draft"
      ? options.update ?? { data: { result: {} }, error: null }
      : options.rpc,
  ));
  return { client: { from, rpc }, rpc };
}

const callPost = (body: unknown, jobId = JOB_ID) => POST(
  new Request(`https://focus-feed.test/api/knowledge/jobs/${jobId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ jobId }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.getCurrentUserFromCookies.mockResolvedValue({ id: "user-a" });
});

describe("POST /api/knowledge/jobs/:jobId/approve", () => {
  it("로그인 전에는 RPC를 부르지 않는다", async () => {
    mocks.getCurrentUserFromCookies.mockResolvedValue(null);
    const response = await callPost({ markdown: MARKDOWN, expectedRevision: 2 });
    expect(response.status).toBe(401);
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("저장된 초안이면 본문과 revision을 잠금 승인 RPC에 전달한다", async () => {
    const { client, rpc } = makeClient({
      get: { data: STUDIO_ROW, error: null },
      rpc: { data: { ...STUDIO_ROW, status: "approving" }, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);

    const response = await callPost({ markdown: MARKDOWN, expectedRevision: 2 });
    const body = await response.json() as { job?: { status?: string }; studioDraft?: { revision?: number } };
    const intentHash = await studioApprovalIntentHash(JOB_ID, 2, MARKDOWN);

    expect(response.status).toBe(200);
    expect(body.job?.status).toBe("approving");
    expect(body.studioDraft?.revision).toBe(2);
    expect(JSON.stringify(body)).not.toContain("approval_token");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("begin_knowledge_studio_approval", {
      p_user_id: "user-a",
      p_job_id: JOB_ID,
      p_revision: 2,
      p_markdown: MARKDOWN,
      p_intent_hash: intentHash,
    });
  });

  it("CAS 충돌이면 409이고 RPC를 부르지 않는다", async () => {
    const { client, rpc } = makeClient({
      get: { data: STUDIO_ROW, error: null },
      rpc: { data: null, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callPost({ markdown: MARKDOWN, expectedRevision: 1 });
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("저장 직전 다른 편집이나 승인이 선점하면 승인을 시작하지 않는다", async () => {
    const { client, rpc } = makeClient({
      get: { data: STUDIO_ROW, error: null },
      update: { data: null, error: null },
      rpc: { data: null, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callPost({ markdown: "# 변경한 본문", expectedRevision: 2 });
    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("patch_knowledge_studio_draft", expect.objectContaining({
      p_user_id: "user-a", p_job_id: JOB_ID, p_expected_result: STUDIO_ROW.result,
    }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("저장과 승인 사이에 초안이 바뀌면 RPC 충돌을 전달한다", async () => {
    const { client } = makeClient({
      get: { data: STUDIO_ROW, error: null },
      rpc: { data: null, error: { message: "studio draft changed" } },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    expect((await callPost({ markdown: MARKDOWN, expectedRevision: 2 })).status).toBe(409);
  });

  it("새 RPC가 없으면 연결 준비 전으로 표시한다", async () => {
    const { client } = makeClient({
      get: { data: STUDIO_ROW, error: null },
      rpc: { data: null, error: { code: "PGRST202", message: "function not found" } },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    expect((await callPost({ markdown: MARKDOWN, expectedRevision: 2 })).status).toBe(503);
  });

  it("승인 RPC의 최신 스냅샷으로 응답한다", async () => {
    const approvedAt = "2026-09-11T01:00:00.000Z";
    const { client } = makeClient({
      get: { data: STUDIO_ROW, error: null },
      rpc: { data: {
        ...STUDIO_ROW,
        status: "approving",
        result: { ...STUDIO_ROW.result, studio_draft: {
          ...STUDIO_ROW.result.studio_draft, updatedAt: approvedAt,
        } },
      }, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callPost({ markdown: MARKDOWN, expectedRevision: 2 });
    expect(response.status).toBe(200);
    expect((await response.json()).studioDraft.updatedAt).toBe(approvedAt);
  });

  it("RPC가 다른 본문을 반환하면 성공으로 표시하지 않는다", async () => {
    const { client } = makeClient({
      get: { data: STUDIO_ROW, error: null },
      rpc: { data: {
        ...STUDIO_ROW,
        status: "approving",
        result: { ...STUDIO_ROW.result, studio_draft: {
          ...STUDIO_ROW.result.studio_draft, markdown: "# 다른 본문",
        } },
      }, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    expect((await callPost({ markdown: MARKDOWN, expectedRevision: 2 })).status).toBe(409);
  });

  it("승인 중 재시도는 같은 초안으로만 기존 의도를 회수한다", async () => {
    const row = { ...STUDIO_ROW, status: "approving" };
    const { client, rpc } = makeClient({
      get: { data: row, error: null },
      rpc: { data: row, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    expect((await callPost({ markdown: "# 다른 초안", expectedRevision: 2 })).status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
    expect((await callPost({ markdown: MARKDOWN, expectedRevision: 2 })).status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
