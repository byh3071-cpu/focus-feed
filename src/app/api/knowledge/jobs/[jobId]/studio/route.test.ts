import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET, PATCH } from "./route";

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

type StudioRow = Omit<typeof STUDIO_ROW, "status" | "result"> & {
  status: string;
  result: typeof STUDIO_ROW.result | null;
};

function makeGetClient(result: { data: StudioRow | null; error: { code?: string; message: string } | null }) {
  const table = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  table.select.mockReturnValue(table);
  table.eq.mockReturnValue(table);
  table.maybeSingle.mockResolvedValue(result);
  return { client: { from: vi.fn(() => table) }, table };
}

function makePatchClient(options: {
  get: { data: StudioRow | null; error: { code?: string; message: string } | null };
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

const callGet = (jobId = JOB_ID) => GET(
  new Request(`https://focus-feed.test/api/knowledge/jobs/${jobId}/studio`),
  { params: Promise.resolve({ jobId }) },
);

const callPatch = (body: unknown, jobId = JOB_ID) => PATCH(
  new Request(`https://focus-feed.test/api/knowledge/jobs/${jobId}/studio`, {
    method: "PATCH",
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

describe("GET /api/knowledge/jobs/:jobId/studio", () => {
  it("잘못된 ID는 DB를 조회하지 않고 거부한다", async () => {
    const response = await callGet("not-a-job-id");
    expect(response.status).toBe(400);
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("비로그인 요청은 작업실을 조회하지 않는다", async () => {
    mocks.getCurrentUserFromCookies.mockResolvedValue(null);
    const response = await callGet();
    expect(response.status).toBe(401);
    expect(mocks.getServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("허용된 작업실 필드만 주고 시드 초안을 만든다", async () => {
    const { client, table } = makeGetClient({ data: STUDIO_ROW, error: null });
    mocks.getServerSupabaseClient.mockReturnValue(client);

    const response = await callGet();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(table.select).toHaveBeenCalledWith(
      "id, user_id, video_id, source_url, title, channel_name, source_guide, status, failure_code, capture_ready, created_at, updated_at, quality_score, quality_report, result",
    );
    expect(table.eq).toHaveBeenNthCalledWith(1, "user_id", "user-a");
    expect(table.eq).toHaveBeenNthCalledWith(2, "id", JOB_ID);
    expect(body.studioAvailable).toBe(true);
    expect(body.job).toMatchObject({
      id: JOB_ID,
      videoId: "abc_DEF-123",
      title: "작업실 영상",
      status: "review_required",
    });
    expect(body.sourceGuide).toContain("YouTube 소스 가이드");
    expect(body.review.summary).toBe("사용자가 확인할 수 있는 검토 요약");
    expect(body.studioDraft.seeded).toBe(true);
    expect(body.studioDraft.revision).toBe(0);
    expect(body.studioDraft.markdown).toContain("# 작업실 영상");
    expect(JSON.stringify(body)).not.toContain("private-source-hash");
    expect(JSON.stringify(body)).not.toContain("C:/private");
    expect(JSON.stringify(body)).not.toContain("secret-notebook");
  });

  it("queued 작업은 작업실 없이 상태만 돌려준다", async () => {
    const { client } = makeGetClient({
      data: {
        ...STUDIO_ROW,
        status: "queued",
        result: null,
        quality_score: null,
        quality_report: null,
      },
      error: null,
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callGet();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.studioAvailable).toBe(false);
    expect(body.job.status).toBe("queued");
    expect(body.studioDraft).toBeUndefined();
    expect(body.review).toBeUndefined();
  });

  it("완료된 작업은 작업실을 읽기 전용으로 연다", async () => {
    const { client } = makeGetClient({
      data: { ...STUDIO_ROW, status: "completed" },
      error: null,
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callGet();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.studioAvailable).toBe(true);
    expect(body.job.status).toBe("completed");
    expect(body.review.summary).toBe("사용자가 확인할 수 있는 검토 요약");
  });
});

describe("PATCH /api/knowledge/jobs/:jobId/studio", () => {
  it("기존 result.draft를 유지한 채 studio_draft만 병합한다", async () => {
    const { client, rpc } = makePatchClient({ get: { data: STUDIO_ROW, error: null } });
    mocks.getServerSupabaseClient.mockReturnValue(client);

    const response = await callPatch({ markdown: "# 고친 초안", expectedRevision: 0 });
    const body = await response.json();
    const written = rpc.mock.calls[0]?.[1] as { p_result?: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(written.p_result?.draft).toEqual(STUDIO_ROW.result.draft);
    expect(written.p_result?.studio_draft).toMatchObject({ markdown: "# 고친 초안", revision: 1 });
    expect(written.p_result?.source_hash).toBe("private-source-hash");
    expect(body.studioDraft.revision).toBe(1);
    expect(body.studioDraft.markdown).toBe("# 고친 초안");
    expect(JSON.stringify(body)).not.toContain("private-source-hash");
  });

  it("revision 충돌은 저장하지 않는다", async () => {
    const row = {
      ...STUDIO_ROW,
      result: {
        ...STUDIO_ROW.result,
        studio_draft: { markdown: "# 저장본", revision: 2, updatedAt: "2026-09-04T01:00:00.000Z" },
      },
    };
    const { client, rpc } = makePatchClient({ get: { data: row, error: null } });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callPatch({ markdown: "# 다른 탭", expectedRevision: 1 });
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("읽은 뒤 다른 편집이나 승인이 선점하면 원래 result로 덮지 않는다", async () => {
    const { client, rpc } = makePatchClient({
      get: { data: STUDIO_ROW, error: null },
      update: { data: null, error: null },
    });
    mocks.getServerSupabaseClient.mockReturnValue(client);
    const response = await callPatch({ markdown: "# 늦게 저장한 초안", expectedRevision: 0 });
    expect(rpc).toHaveBeenCalledWith("patch_knowledge_studio_draft", expect.objectContaining({
      p_user_id: "user-a", p_job_id: JOB_ID, p_expected_result: STUDIO_ROW.result,
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).studioDraft).toBeUndefined();
  });
});
