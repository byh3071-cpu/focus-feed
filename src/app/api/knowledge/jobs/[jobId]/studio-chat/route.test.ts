import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentUserFromCookies: vi.fn(),
  getServerSupabaseClient: vi.fn(),
  generateGeminiTextResult: vi.fn(),
  guardRateLimit: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase-server-cookies", () => ({
  getCurrentUserFromCookies: mocks.getCurrentUserFromCookies,
}));
vi.mock("@/lib/supabase-server", () => ({
  getServerSupabaseClient: mocks.getServerSupabaseClient,
}));
vi.mock("@/lib/gemini", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gemini")>("@/lib/gemini");
  return {
    ...actual,
    generateGeminiTextResult: mocks.generateGeminiTextResult,
  };
});
vi.mock("@/lib/gemini-rate-limit", () => ({
  guardGeminiActionRateLimit: mocks.guardRateLimit,
}));

import { POST } from "./route";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const STUDIO_ROW = {
  id: JOB_ID,
  user_id: "user-a",
  video_id: "abc_DEF-123",
  source_url: "https://www.youtube.com/watch?v=abc_DEF-123",
  title: "작업실 영상",
  channel_name: "작업 채널",
  source_guide: "## YouTube 소스 가이드\n- 제목: 작업실 영상",
  status: "review_required" as const,
  failure_code: null as string | null,
  capture_ready: true,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:01:00.000Z",
  quality_score: 96 as number | null,
  quality_report: { warnings: ["외부 사실은 별도 확인"] } as unknown,
  result: {
    review_path: "C:/private/reviews/job.json",
    source_hash: "private-source-hash",
    notebook_id: "secret-notebook",
    draft: {
      summary: "사용자가 확인할 수 있는 검토 요약",
      key_points: ["핵심 요점"],
      claims: [{
        type: "fact",
        statement: "타임스탬프로 확인할 사실",
        evidence_quote: "a short private evidence excerpt for review",
        citation: "[00:51]",
        citation_verified: true,
        requires_crosscheck: false,
      }],
      coverage: {},
      uncertainties: ["없음"],
    },
  },
};

function makePatchClient(options: {
  get: { data: typeof STUDIO_ROW | null; error: { code?: string; message: string } | null };
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

  const rpc = vi.fn().mockResolvedValue(options.update ?? { data: { result: {} }, error: null });
  const from = vi.fn().mockReturnValue(getTable);
  return { client: { from, rpc }, rpc };
}

const callPost = (body: unknown, jobId = JOB_ID) => POST(
  new Request(`https://focus-feed.test/api/knowledge/jobs/${jobId}/studio-chat`, {
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
  mocks.guardRateLimit.mockResolvedValue({ ok: true });
  mocks.generateGeminiTextResult.mockResolvedValue({
    ok: true,
    text: "```markdown\n# 짧은 초안\n\n핵심만 남겼습니다.\n```",
  });
});

describe("POST /api/knowledge/jobs/:jobId/studio-chat", () => {
  it("잘못된 ID는 모델을 호출하지 않는다", async () => {
    const response = await callPost({ message: "더 짧게", markdown: "# 초안", expectedRevision: 0 }, "not-a-job-id");
    expect(response.status).toBe(400);
    expect(mocks.generateGeminiTextResult).not.toHaveBeenCalled();
  });

  it("비로그인은 초안을 바꾸지 않는다", async () => {
    mocks.getCurrentUserFromCookies.mockResolvedValue(null);
    const response = await callPost({ message: "더 짧게", markdown: "# 초안", expectedRevision: 0 });
    expect(response.status).toBe(401);
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.generateGeminiTextResult).not.toHaveBeenCalled();
  });

  it("요청 한도면 초안을 유지한다", async () => {
    mocks.guardRateLimit.mockResolvedValue({ ok: false, error: "요청이 너무 잦습니다. 12초 후 다시 시도해 주세요." });
    const response = await callPost({ message: "더 짧게", markdown: "# 초안", expectedRevision: 0 });
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.error).toContain("요청이 너무 잦습니다");
    expect(mocks.generateGeminiTextResult).not.toHaveBeenCalled();
  });

  it("채팅이 초안을 고치고 비밀 필드는 프롬프트에 넣지 않는다", async () => {
    const { client, rpc } = makePatchClient({ get: { data: STUDIO_ROW, error: null } });
    mocks.getServerSupabaseClient.mockReturnValue(client);

    const response = await callPost({
      message: "더 짧게",
      markdown: "# 작업실 영상\n\n긴 초안입니다.",
      expectedRevision: 0,
    });
    const body = await response.json();
    const prompt = mocks.generateGeminiTextResult.mock.calls[0]?.[0] as string;
    const written = rpc.mock.calls[0]?.[1] as { p_result?: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.notice).toBe("초안을 고쳤어요");
    expect(body.studioDraft.markdown).toContain("# 짧은 초안");
    expect(body.studioDraft.revision).toBe(1);
    expect(written.p_result?.draft).toEqual(STUDIO_ROW.result.draft);
    expect(prompt).toContain("더 짧게");
    expect(prompt).toContain("긴 초안입니다");
    expect(prompt).not.toContain("private-source-hash");
    expect(prompt).not.toContain("secret-notebook");
    expect(JSON.stringify(body)).not.toContain("private-source-hash");
  });

  it("인사만으로는 초안을 저장하지 않는다", async () => {
    const { client, rpc } = makePatchClient({ get: { data: STUDIO_ROW, error: null } });
    mocks.getServerSupabaseClient.mockReturnValue(client);

    const response = await callPost({
      message: "ㅎㅇ",
      markdown: "# 작업실 영상\n\n긴 초안입니다.",
      expectedRevision: 0,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notice).toBe("초안은 그대로 두었어요");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("모델 오류면 초안을 저장하지 않는다", async () => {
    const { client, rpc } = makePatchClient({ get: { data: STUDIO_ROW, error: null } });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    mocks.generateGeminiTextResult.mockResolvedValue({ ok: false, kind: "rate_limited" });

    const response = await callPost({
      message: "더 짧게",
      markdown: "# 초안",
      expectedRevision: 0,
    });
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error).toContain("일시적으로 많습니다");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("모델 응답을 기다리는 동안 승인되거나 편집되면 저장을 거절한다", async () => {
    const { client, rpc } = makePatchClient({
      get: { data: STUDIO_ROW, error: null },
      update: { data: null, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callPost({ message: "더 짧게", markdown: "# 초안", expectedRevision: 0 });
    expect(rpc).toHaveBeenCalledWith("patch_knowledge_studio_draft", expect.objectContaining({
      p_user_id: "user-a", p_job_id: JOB_ID, p_expected_result: STUDIO_ROW.result,
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).studioDraft).toBeUndefined();
  });
});
