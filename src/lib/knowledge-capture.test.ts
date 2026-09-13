import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_STATUS_QUERY_LIMIT,
  buildKnowledgeCaptureMetadata,
  extractYouTubeVideoId,
  isKnowledgeJobsUnavailableError,
  knowledgeJobIsOpen,
  knowledgeJobStatusLabel,
  knowledgeCaptureAction,
  knowledgeJobCanOpenStudio,
  knowledgeJobStudioPath,
  knowledgeQueueOpenLabel,
  knowledgeCitationSeconds,
  knowledgeCitationUrl,
  mergeKnowledgeJobMaps,
  knowledgeJobActionMessage,
  normalizeYouTubeUrl,
  parseKnowledgeReviewDetail,
  parseKnowledgeStatusVideoIds,
  selectUsefulDescription,
  type KnowledgeJobSummary,
} from "./knowledge-capture";

const job = (
  videoId: string,
  status: KnowledgeJobSummary["status"],
  updatedAt: string,
): KnowledgeJobSummary => ({
  id: `job-${videoId}`,
  videoId,
  status,
  captureReady: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt,
});

describe("YouTube 지식 캡처 URL 계약", () => {
  it("watch·shorts·짧은 URL에서 같은 video ID를 읽는다", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=abc_DEF-123&si=share")).toBe("abc_DEF-123");
    expect(extractYouTubeVideoId("https://youtube.com/shorts/abc_DEF-123?feature=share")).toBe("abc_DEF-123");
    expect(extractYouTubeVideoId("https://youtu.be/abc_DEF-123?t=21")).toBe("abc_DEF-123");
  });

  it("공유 텍스트에서는 첫 URL을 읽고, 유사 도메인은 거부한다", () => {
    expect(extractYouTubeVideoId("이 영상 봐 https://youtu.be/abc_DEF-123 정말 좋아")).toBe("abc_DEF-123");
    expect(extractYouTubeVideoId("https://youtube.com.evil.example/watch?v=abc_DEF-123")).toBeNull();
  });

  it("멱등 키는 추적 파라미터 없는 canonical URL이다", () => {
    expect(normalizeYouTubeUrl("https://youtu.be/abc_DEF-123?si=tracking")).toBe(
      "https://www.youtube.com/watch?v=abc_DEF-123",
    );
  });
});

describe("지식 상태 배치 조회 계약", () => {
  it("완료·취소를 제외한 상태를 열린 작업 배지에 포함한다", () => {
    expect(knowledgeJobIsOpen("queued")).toBe(true);
    expect(knowledgeJobIsOpen("review_required")).toBe(true);
    expect(knowledgeJobIsOpen("action_required")).toBe(true);
    expect(knowledgeJobIsOpen("failed")).toBe(true);
    expect(knowledgeJobIsOpen("completed")).toBe(false);
    expect(knowledgeJobIsOpen("cancelled")).toBe(false);
  });

  it("video ID 중복을 제거하고 순서를 유지한다", () => {
    expect(parseKnowledgeStatusVideoIds("abc_DEF-123,xyz_ABC-789,abc_DEF-123")).toEqual([
      "abc_DEF-123",
      "xyz_ABC-789",
    ]);
  });

  it("PostgREST schema-cache의 knowledge_jobs 미노출도 일시 중단으로 분류한다", () => {
    expect(isKnowledgeJobsUnavailableError({
      message: "Could not find the table 'public.knowledge_jobs' in the schema cache",
    })).toBe(true);
    expect(isKnowledgeJobsUnavailableError({ code: "42703", message: "capture_ready does not exist" })).toBe(true);
    expect(isKnowledgeJobsUnavailableError({ code: "PGRST204", message: "capture_ready not found" })).toBe(true);
    expect(isKnowledgeJobsUnavailableError({ code: "PGRST205", message: "not found" })).toBe(true);
    expect(isKnowledgeJobsUnavailableError({
      code: "PGRST202",
      message: "enrich_knowledge_job is not available in the schema cache",
    })).toBe(true);
    expect(isKnowledgeJobsUnavailableError({
      code: "PGRST202",
      message: "enqueue_knowledge_canary_job is not available in the schema cache",
    })).toBe(true);
  });

  it("최대 개수를 넘기거나 잘못된 video ID가 섞이면 거부한다", () => {
    const tooMany = Array.from(
      { length: KNOWLEDGE_STATUS_QUERY_LIMIT + 1 },
      (_, index) => `video_${String(index).padStart(3, "0")}`,
    ).join(",");
    expect(parseKnowledgeStatusVideoIds(tooMany)).toBeNull();
    expect(parseKnowledgeStatusVideoIds("abc_DEF-123,not valid")).toBeNull();
  });

  it("worker의 모든 상태를 사람이 이해할 수 있는 문구로 표시한다", () => {
    expect([
      "queued",
      "processing",
      "review_required",
      "approving",
      "completed",
      "action_required",
      "failed",
      "cancelled",
    ].map((status) => knowledgeJobStatusLabel(status as Parameters<typeof knowledgeJobStatusLabel>[0]))).toEqual([
      "담김",
      "처리 중",
      "검토 필요",
      "승인 적재 중",
      "적재됨",
      "조치 필요",
      "처리 실패",
      "처리 취소",
    ]);
  });

  it("담기 CTA는 상태에 따라 접수·대기·작업실 입구로 나뉜다", () => {
    expect(knowledgeCaptureAction(null)).toEqual({
      kind: "capture",
      label: "지식으로 담기",
      compactLabel: "담기",
    });
    expect(knowledgeCaptureAction(job("queued-1", "queued", "2026-08-01T00:02:00.000Z"))).toMatchObject({
      kind: "busy",
      compactLabel: "담김",
    });
    expect(knowledgeCaptureAction(job("review-1", "review_required", "2026-08-01T00:02:00.000Z"))).toEqual({
      kind: "open",
      label: "작업실 열기",
      compactLabel: "검토",
      href: knowledgeJobStudioPath("job-review-1"),
    });
    expect(knowledgeJobCanOpenStudio("processing")).toBe(false);
    expect(knowledgeQueueOpenLabel("completed")).toBe("작업실 보기");
  });
});

describe("지식 상태 응답 병합", () => {
  it("늦은 응답은 최신 상태를 되돌리지 않고 응답에 없는 새 캡처도 보존한다", () => {
    const merged = mergeKnowledgeJobMaps(
      {
        video_a: job("video_a", "processing", "2026-08-01T00:02:00.000Z"),
        video_b: job("video_b", "queued", "2026-08-01T00:02:00.000Z"),
      },
      {
        video_a: job("video_a", "queued", "2026-08-01T00:01:00.000Z"),
        video_c: job("video_c", "completed", "2026-08-01T00:03:00.000Z"),
      },
    );

    expect(merged.video_a.status).toBe("processing");
    expect(merged.video_b.status).toBe("queued");
    expect(merged.video_c.status).toBe("completed");
  });

  it("상태 전용 poll 응답은 목록에서 받은 표시 필드를 지우지 않는다", () => {
    const current = job("video_a", "processing", "2026-08-01T00:01:00.000Z");
    const merged = mergeKnowledgeJobMaps(
      {
        video_a: {
          ...current,
          sourceUrl: "https://www.youtube.com/watch?v=video_a",
          title: "목록 제목",
          channelName: "목록 채널",
          failureCode: null,
          reviewAvailable: true,
        },
      },
      { video_a: job("video_a", "review_required", "2026-08-01T00:02:00.000Z") },
    );

    expect(merged.video_a).toMatchObject({
      status: "review_required",
      title: "목록 제목",
      channelName: "목록 채널",
      reviewAvailable: true,
    });
  });
});

describe("설명란 소스 가이드 정제", () => {
  it("광고성 문구는 빼고, 시간표·참고 링크는 남긴다", () => {
    const lines = selectUsefulDescription([
      "이 영상은 에이전트 운영 원칙을 다룹니다.",
      "구독과 좋아요 부탁드립니다.",
      "00:00 문제 정의",
      "12:30 NotebookLM MCP 설계",
      "참고 문서: https://example.com/guide",
      "비즈니스 문의: hello@example.com",
    ].join("\n"));
    expect(lines).toContain("00:00 문제 정의");
    expect(lines).toContain("12:30 NotebookLM MCP 설계");
    expect(lines).toContain("참고 문서: https://example.com/guide");
    expect(lines.join("\n")).not.toMatch(/구독과 좋아요|비즈니스 문의/);
  });

  it("완성된 메타는 UI 입력이 없어도 안정된 기본값을 만든다", () => {
    const metadata = buildKnowledgeCaptureMetadata({
      sourceUrl: "https://youtu.be/abc_DEF-123",
      capturedAt: new Date("2026-07-27T00:00:00.000Z"),
    });
    expect(metadata).toMatchObject({
      videoId: "abc_DEF-123",
      sourceUrl: "https://www.youtube.com/watch?v=abc_DEF-123",
      title: "YouTube abc_DEF-123",
      channelName: null,
    });
    expect(metadata?.sourceGuide).toContain("공개 설명란에서 보존할 정보가 없습니다.");
  });
});

describe("조치 필요 안내", () => {
  it("인증 만료와 자막 없음에 구체적인 다음 행동을 안내한다", () => {
    const base = job("video_a", "action_required", "2026-08-01T00:02:00.000Z");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NOTEBOOKLM_AUTH_REQUIRED" })).toContain("로그인");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NOTEBOOKLM_CAPTION_UNAVAILABLE" })).toContain("공개 자막");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "YTDLP_CAPTION_UNAVAILABLE" })).toContain("공개 자막");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "YTDLP_CAPTION_FETCH_FAILED" })).toContain("다시 처리");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NLM_EVIDENCE_NOT_GROUNDED" })).toContain("원문·공개 자막");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NLM_EVIDENCE_NOT_SUPPORTED" })).toContain("뒷받침하지 못해");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NLM_DRAFT_CONTRACT_INVALID" })).toContain("저장하지 않았습니다");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NLM_PROCESSING_FAILED" })).toContain("다시 처리");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NLM_AUTH_EXPIRED" })).toContain("만료");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "NLM_TIMEOUT" })).toContain("초과");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "TRANSCRIPT_DISABLED" })).toContain("비활성화");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "TRANSCRIPT_EVIDENCE_UNAVAILABLE" })).toContain("저장하지 않았습니다");
    expect(knowledgeJobActionMessage({ ...base, failureCode: "PUBLIC_CAPTION_TIMESTAMPS_REQUIRED" })).toContain("재처리");
  });

  it("정상 처리 상태에는 조치 문구를 만들지 않는다", () => {
    expect(knowledgeJobActionMessage(job("video_a", "processing", "2026-08-01T00:02:00.000Z"))).toBeNull();
  });
});

describe("검토 상세 공개 계약", () => {
  const reviewResult = {
    review_path: "C:/private/reviews/job.json",
    transcript_hash: "secret-hash",
    draft: {
      summary: "원문 사실과 해석을 구분한 충분히 긴 검토 요약입니다.",
      key_points: ["핵심 1", "핵심 2", "핵심 3"],
      claims: [
        {
          type: "fact",
          statement: "검증된 사실 주장",
          evidence_quote: "This is a short source excerpt used to verify the factual claim without exposing the transcript.",
          citation: "[01:05]",
          citation_verified: true,
          requires_crosscheck: false,
        },
        {
          type: "interpretation",
          statement: "원문을 바탕으로 한 해석",
          evidence_quote: "검증되지 않은 해석 원문은 브라우저에 노출하지 않는다",
          requires_crosscheck: true,
        },
        { type: "unknown", statement: "허용하지 않는 주장" },
      ],
      coverage: {
        start: { statement: "시작 근거", evidence_quote: "short opening excerpt", citation: "[00:10]", citation_verified: true },
        middle: { statement: "중간 근거", evidence_quote: "short middle excerpt", citation: "[10:00]", citation_verified: true },
        end: { statement: "마지막 근거", evidence_quote: "short ending excerpt", citation: "[20:30]", citation_verified: true },
      },
      uncertainties: ["표본이 제한적임"],
      yohan_relevance: "지식 워크플로우 설계에 참고할 수 있음",
    },
  };

  it("review_required 결과에서 사용자 검토 필드만 허용 목록으로 반환한다", () => {
    const review = parseKnowledgeReviewDetail({
      status: "review_required",
      result: reviewResult,
      qualityScore: 100,
      qualityReport: { hard_failures: [], warnings: ["외부 사실 검증은 별도"] },
    });

    expect(review).toMatchObject({
      qualityScore: 100,
      category: "YT · 미분류 · Inbox",
      claims: [
        { type: "fact", evidenceExcerpt: expect.stringContaining("short source excerpt"), citation: "[01:05]", citationVerified: true },
        { type: "interpretation", requiresCrosscheck: true },
      ],
      coverage: [
        { part: "start", evidenceExcerpt: "short opening excerpt", citation: "[00:10]" },
        { part: "middle", citation: "[10:00]" },
        { part: "end", citation: "[20:30]" },
      ],
      qualityWarnings: ["외부 사실 검증은 별도"],
    });
    expect(review).not.toHaveProperty("review_path");
    expect(review).not.toHaveProperty("transcript_hash");
    expect(review?.claims[1]).not.toHaveProperty("evidenceExcerpt");
  });

  it("검토 상태가 아니면 처리 결과를 브라우저에 공개하지 않는다", () => {
    expect(parseKnowledgeReviewDetail({
      status: "action_required",
      result: reviewResult,
      qualityScore: 70,
      qualityReport: {},
    })).toBeUndefined();
  });

  it("승인 적재 중에도 사용자가 검토 근거를 다시 볼 수 있다", () => {
    expect(parseKnowledgeReviewDetail({
      status: "approving",
      result: reviewResult,
      qualityScore: 100,
      qualityReport: {},
    })?.summary).toContain("검토 요약");
  });

  it("적재 완료 작업실에서는 같은 검토 근거를 읽기 전용으로 연다", () => {
    expect(parseKnowledgeReviewDetail({
      status: "completed",
      result: reviewResult,
      qualityScore: 100,
      qualityReport: {},
    })?.summary).toContain("검토 요약");
  });

  it("타임스탬프를 초 단위 원본 YouTube 링크로 바꾼다", () => {
    expect(knowledgeCitationSeconds("[01:05]")).toBe(65);
    expect(knowledgeCitationSeconds("[1:02:03]")).toBe(3723);
    expect(knowledgeCitationUrl("https://youtu.be/abc_DEF-123", "[01:05]")).toBe(
      "https://www.youtube.com/watch?v=abc_DEF-123&t=65s",
    );
    expect(knowledgeCitationUrl("https://example.com/video", "[01:05]")).toBeNull();
  });

  it("V2 본문 필드와 별도 근거 맵을 허용 목록으로 변환한다", () => {
    const review = parseKnowledgeReviewDetail({
      status: "review_required",
      qualityScore: 95,
      qualityReport: { warnings: [] },
      result: {
        category: "2026-08 AI",
        draft: {
          summary_format_version: 2,
          summary: "잔기술 암기보다 문제 정의와 검증 능력을 공부해야 한다.",
          key_points: ["모델 성능", "문제 정의", "검증"],
          creator_thesis: "AI 성능이 사용법 암기의 가치를 빠르게 낮춘다는 주장이다.",
          audience_context: "댓글 미수집",
          critical_analysis: "공부 중단이 아니라 학습 대상 전환으로 읽어야 한다.",
          claims: [{ id: "F1", type: "fact", statement: "잔기술보다 AI 기본 성능의 영향이 커졌다." }],
          coverage: { start: "문제 제기", middle: "바이브 코딩", end: "사람마다 차이가 나는 이유" },
          ecosystem_applications: [{ area: "Focus Feed", application: "근거와 요약을 분리한다.", expected_effect: "검토가 쉬워진다." }],
          two_week_experiment: {
            hypothesis: "분리된 근거 맵이 검토 시간을 줄인다.",
            action: "영상 다섯 편에 적용한다.",
            metric: "검토 시간과 수정 건수",
            stop_condition: "수정 건수가 줄지 않으면 중단한다.",
          },
          evidence_map: [{ claim_id: "F1", timestamps: ["03:14", "[04:04]"], note: "직접 발언" }],
          uncertainties: ["댓글 미수집"],
          yohan_relevance: "요한 생태계의 수집·검증·승격 흐름에 적용한다.",
        },
      },
    });

    expect(review).toMatchObject({
      formatVersion: 2,
      creatorThesis: expect.stringContaining("AI 성능"),
      audienceContext: "댓글 미수집",
      criticalAnalysis: expect.stringContaining("학습 대상"),
      ecosystemApplications: [{ area: "Focus Feed", expectedEffect: "검토가 쉬워진다." }],
      twoWeekExperiment: { metric: "검토 시간과 수정 건수" },
      evidenceMap: [{ claimId: "F1", timestamps: ["[03:14]", "[04:04]"] }],
      claims: [{ id: "F1", citation: "[03:14]", citationVerified: false }],
      coverage: [
        { part: "start", statement: "문제 제기" },
        { part: "middle", statement: "바이브 코딩" },
        { part: "end", statement: "사람마다 차이가 나는 이유" },
      ],
    });
  });

  it("근거 맵의 타임스탬프만으로 원문 검증 완료를 주장하지 않는다", () => {
    const review = parseKnowledgeReviewDetail({
      status: "review_required",
      qualityScore: 95,
      qualityReport: {},
      result: {
        draft: {
          summary_format_version: 2,
          summary: "검증 상태를 보수적으로 표시하는 충분히 긴 요약입니다.",
          claims: [{ id: "F1", type: "fact", statement: "근거 맵에만 연결된 주장" }],
          coverage: { start: "시작", middle: "중간", end: "끝" },
          critical_analysis: "타임스탬프 존재와 의미 검증 완료를 구분해야 한다.",
          ecosystem_applications: [{ area: "Focus Feed", application: "검증 표기를 보수적으로 표시한다." }],
          two_week_experiment: {
            hypothesis: "보수적 표기가 오판을 줄인다.",
            action: "검토 화면을 확인한다.",
            metric: "잘못된 검증 완료 표시 수",
            stop_condition: "표시 오류가 남으면 재설계한다.",
          },
          evidence_map: [{ claim_id: "F1", timestamps: ["03:14"], note: "구조상 연결" }],
        },
      },
    });

    expect(review?.claims[0]).toMatchObject({ citation: "[03:14]", citationVerified: false });
  });
});
