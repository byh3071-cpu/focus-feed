/**
 * Focus Feed → 지식 처리 대기열의 입력 계약.
 * 이 모듈은 클라이언트와 서버 양쪽에서 쓰므로 Node 전용 API를 넣지 않는다.
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
export const KNOWLEDGE_STATUS_QUERY_LIMIT = 50;
export const KNOWLEDGE_JOBS_CHANGED_EVENT = "focus-feed:knowledge-jobs-changed";
const PROMOTIONAL_DESCRIPTION_PATTERN =
  /^(?:구독|좋아요|알림(?:\s*설정)?|멤버십|후원|광고|협찬|비즈니스\s*문의|business\s*(?:inquir|contact)|subscribe|like\s*(?:and|&)?\s*share|쿠팡\s*파트너스)/i;
const USEFUL_DESCRIPTION_PATTERN =
  /(?:^|\s)(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\s|$)|https?:\/\/|(?:타임라인|목차|챕터|참고|자료|링크|출처|관련|공식|코드|문서|뉴스레터|커뮤니티|설명|내용|주요)/i;

export type KnowledgeJobStatus =
  | "queued"
  | "processing"
  | "review_required"
  | "approving"
  | "completed"
  | "action_required"
  | "failed"
  | "cancelled";

export interface KnowledgeJobSummary {
  id: string;
  videoId: string;
  sourceUrl?: string;
  title?: string;
  channelName?: string | null;
  status: KnowledgeJobStatus;
  failureCode?: string | null;
  captureReady: boolean;
  createdAt: string;
  updatedAt: string;
  reviewAvailable?: boolean;
  review?: KnowledgeReviewDetail;
}

export type KnowledgeClaimType = "fact" | "interpretation" | "recommendation";

export interface KnowledgeReviewClaim {
  id?: string;
  type: KnowledgeClaimType;
  statement: string;
  evidenceExcerpt?: string;
  citation?: string;
  citationVerified: boolean;
  requiresCrosscheck: boolean;
}

export interface KnowledgeEvidenceMapItem {
  claimId: string;
  statement: string;
  timestamps: string[];
  note?: string;
}

export interface KnowledgeEcosystemApplication {
  area: string;
  application: string;
  expectedEffect?: string;
}

export interface KnowledgeTwoWeekExperiment {
  hypothesis: string;
  action: string;
  metric: string;
  stopCondition: string;
}

export interface KnowledgeReviewCoverage {
  part: "start" | "middle" | "end";
  statement: string;
  evidenceExcerpt?: string;
  citation?: string;
  citationVerified: boolean;
}

export interface KnowledgeReviewDetail {
  formatVersion: 1 | 2;
  summary: string;
  keyPoints: string[];
  claims: KnowledgeReviewClaim[];
  coverage: KnowledgeReviewCoverage[];
  uncertainties: string[];
  relevance?: string;
  category: string;
  qualityScore?: number;
  qualityWarnings: string[];
  creatorThesis?: string;
  audienceContext?: string;
  criticalAnalysis?: string;
  ecosystemApplications: KnowledgeEcosystemApplication[];
  twoWeekExperiment?: KnowledgeTwoWeekExperiment;
  evidenceMap: KnowledgeEvidenceMapItem[];
}

export type KnowledgeJobMap = Record<string, KnowledgeJobSummary>;

const KNOWLEDGE_JOB_STATUS_LABELS: Record<KnowledgeJobStatus, string> = {
  queued: "담김",
  processing: "처리 중",
  review_required: "검토 필요",
  approving: "승인 적재 중",
  completed: "적재됨",
  action_required: "조치 필요",
  failed: "처리 실패",
  cancelled: "처리 취소",
};

export function knowledgeJobStatusLabel(status: KnowledgeJobStatus): string {
  return KNOWLEDGE_JOB_STATUS_LABELS[status];
}

export function knowledgeJobStudioPath(jobId: string): string {
  return `/knowledge?job=${encodeURIComponent(jobId)}`;
}

export function knowledgeJobCanOpenStudio(status: KnowledgeJobStatus): boolean {
  return status === "review_required" || status === "approving" || status === "completed";
}

export function knowledgeQueueOpenLabel(status: KnowledgeJobStatus): string | null {
  if (status === "review_required") return "작업실 열기";
  if (status === "approving" || status === "completed") return "작업실 보기";
  return null;
}

export type KnowledgeCaptureAction =
  | { kind: "capture" | "retry" | "busy"; label: string; compactLabel: string }
  | { kind: "open"; label: string; compactLabel: string; href: string };

export function knowledgeCaptureAction(job: KnowledgeJobSummary | null | undefined): KnowledgeCaptureAction {
  if (!job) {
    return { kind: "capture", label: "지식으로 담기", compactLabel: "담기" };
  }
  if (!job.captureReady) {
    return { kind: "retry", label: "처리 준비 다시 시도", compactLabel: "다시 시도" };
  }
  if (knowledgeJobCanOpenStudio(job.status)) {
    return {
      kind: "open",
      label: knowledgeQueueOpenLabel(job.status) ?? knowledgeJobStatusLabel(job.status),
      compactLabel: job.status === "review_required"
        ? "검토"
        : job.status === "completed"
          ? "적재됨"
          : "적재 중",
      href: knowledgeJobStudioPath(job.id),
    };
  }
  if (job.status === "action_required" || job.status === "failed") {
    return {
      kind: "open",
      label: knowledgeJobStatusLabel(job.status),
      compactLabel: "조치",
      href: "/knowledge",
    };
  }
  return {
    kind: "busy",
    label: knowledgeJobStatusLabel(job.status),
    compactLabel: knowledgeJobStatusLabel(job.status),
  };
}

export function knowledgeJobIsOpen(status: KnowledgeJobStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export function notifyKnowledgeJobsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(KNOWLEDGE_JOBS_CHANGED_EVENT));
  }
}

const KNOWLEDGE_ACTION_MESSAGES: Record<string, string> = {
  NLM_AUTH_REQUIRED: "NotebookLM 로그인이 필요합니다. 인증을 다시 연결한 뒤 재처리해 주세요.",
  NLM_AUTH_EXPIRED: "저장된 NotebookLM 인증이 만료됐습니다. 다시 로그인한 뒤 재처리해 주세요.",
  NLM_TIMEOUT: "NotebookLM 응답 시간이 초과됐습니다. 잠시 뒤 재처리해 주세요.",
  NLM_RATE_LIMITED: "NotebookLM 요청 한도에 도달했습니다. 잠시 기다린 뒤 재처리해 주세요.",
  NLM_TRANSPORT_FAILED: "NotebookLM 연결 프로세스가 끊겼습니다. CLI 상태를 확인한 뒤 재처리해 주세요.",
  TRANSCRIPT_TIMEOUT: "YouTube 자막 요청 시간이 초과됐습니다. 잠시 뒤 재처리해 주세요.",
  TRANSCRIPT_DISABLED: "이 영상은 공개 자막이 비활성화되어 자동 검증을 진행할 수 없습니다.",
  TRANSCRIPT_UNAVAILABLE: "검증 가능한 공개 자막을 찾지 못했습니다.",
  TRANSCRIPT_RATE_LIMITED: "YouTube 자막 요청 한도에 도달했습니다. 잠시 뒤 재처리해 주세요.",
  TRANSCRIPT_FETCH_FAILED: "YouTube 자막을 가져오지 못했습니다. 연결 상태를 확인한 뒤 재처리해 주세요.",
  TRANSCRIPT_EVIDENCE_UNAVAILABLE: "타임스탬프가 있는 원문 근거를 확보하지 못해 요약을 저장하지 않았습니다.",
  NOTEBOOKLM_AUTH_REQUIRED: "집 PC에서 NotebookLM 로그인을 다시 연결한 뒤 재처리해 주세요.",
  NOTEBOOKLM_CAPTION_UNAVAILABLE: "공개 자막이 없는 영상입니다. P0에서는 자동 전사를 하지 않아요.",
  NOTEBOOKLM_VIDEO_UNAVAILABLE: "비공개·삭제·접근 제한 영상인지 YouTube에서 확인해 주세요.",
  YTDLP_CAPTION_UNAVAILABLE: "공개 자막이 없는 영상입니다. P0에서는 자동 전사를 하지 않아요.",
  YTDLP_VIDEO_UNAVAILABLE: "비공개·삭제·접근 제한 영상인지 YouTube에서 확인해 주세요.",
  YTDLP_CAPTION_FETCH_FAILED: "유튜브 응답 제한으로 자막을 읽지 못했습니다. 잠시 뒤 Codex에서 다시 처리해 주세요.",
  NOTEBOOKLM_LIMIT_REACHED: "NotebookLM 소스 한도에 도달했습니다. 노트북 회전 승인이 필요해요.",
  NOTEBOOKLM_SOURCE_NOT_READY: "최근 추가된 영상이 아직 처리 중입니다. 잠시 뒤 다시 처리해 주세요.",
  NLM_QUERY_NOT_STRUCTURED: "NotebookLM 요약 형식을 확인해야 합니다. Codex에서 이 작업을 다시 점검해 주세요.",
  NLM_EVIDENCE_NOT_GROUNDED: "NotebookLM 근거가 원문·공개 자막과 일치하지 않아 멈췄습니다. Codex에서 다시 점검해 주세요.",
  NLM_EVIDENCE_NOT_SUPPORTED: "근거 구절이 요약 주장을 충분히 뒷받침하지 못해 저장을 멈췄습니다. Codex에서 다시 점검해 주세요.",
  NLM_DRAFT_CONTRACT_INVALID: "NotebookLM 응답에 허용되지 않은 필드가 있어 저장하지 않았습니다. 처리기 업데이트가 필요합니다.",
  NLM_PROCESSING_FAILED: "NotebookLM 처리 중 오류가 발생했습니다. 집에서 Codex에 이 작업을 다시 처리해 달라고 요청해 주세요.",
  QUALITY_GATE_FAILED: "원문 커버리지나 타임스탬프가 부족해 자동 승인을 멈췄습니다.",
  PUBLIC_CAPTION_TIMESTAMPS_REQUIRED:
    "공개 자막 타임스탬프 근거가 없는 이전 요약입니다. 재처리하면 검증된 근거로 다시 만듭니다.",
  max_attempts_exceeded: "worker가 세 번 중단됐습니다. Codex에서 작업 상태를 점검해 주세요.",
};

export function knowledgeJobActionMessage(job: KnowledgeJobSummary): string | null {
  if (job.status !== "action_required" && job.status !== "failed") return null;
  if (job.failureCode && KNOWLEDGE_ACTION_MESSAGES[job.failureCode]) {
    return KNOWLEDGE_ACTION_MESSAGES[job.failureCode];
  }
  return job.status === "failed"
    ? "처리에 실패했습니다. Codex에서 작업 상태와 로컬 worker 로그를 확인해 주세요."
    : "사람 확인이 필요합니다. 집에서 Codex에 이 작업의 조치 방법을 확인해 달라고 요청해 주세요.";
}

const REVIEW_TEXT_LIMIT = 12_000;
const REVIEW_LIST_LIMIT = 64;
const TIMESTAMP_PATTERN = /^\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]$/;

function reviewRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reviewText(value: unknown, maxLength = REVIEW_TEXT_LIMIT): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function reviewTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, REVIEW_LIST_LIMIT)
    .map((item) => reviewText(item, 4_000))
    .filter((item): item is string => Boolean(item));
}

function reviewTimestamp(value: unknown): string | undefined {
  const raw = reviewText(value, 16);
  if (!raw) return undefined;
  const wrapped = raw.startsWith("[") ? raw : `[${raw}]`;
  return TIMESTAMP_PATTERN.test(wrapped) ? wrapped : undefined;
}

function reviewEcosystemApplications(value: unknown): KnowledgeEcosystemApplication[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    const record = reviewRecord(item);
    const area = reviewText(record?.area, 160);
    const application = reviewText(record?.application, 4_000);
    if (!area || !application) return [];
    const expectedEffect = reviewText(record?.expected_effect, 2_000) ?? undefined;
    return [{ area, application, ...(expectedEffect ? { expectedEffect } : {}) }];
  });
}

function reviewTwoWeekExperiment(value: unknown): KnowledgeTwoWeekExperiment | undefined {
  const record = reviewRecord(value);
  const hypothesis = reviewText(record?.hypothesis, 2_000);
  const action = reviewText(record?.action, 3_000);
  const metric = reviewText(record?.metric, 2_000);
  const stopCondition = reviewText(record?.stop_condition, 2_000);
  if (!hypothesis || !action || !metric || !stopCondition) return undefined;
  return { hypothesis, action, metric, stopCondition };
}

function reviewEvidenceExcerpt(value: unknown): string | undefined {
  const text = reviewText(value, 1_000)?.replace(/\s+/g, " ");
  if (!text) return undefined;
  const words = text.split(" ");
  const excerpt = words.slice(0, 20).join(" ").slice(0, 240);
  return excerpt.length < text.length ? `${excerpt.trimEnd()}…` : excerpt;
}

/**
 * DB result에서 브라우저에 공개해도 되는 검토 필드만 허용 목록으로 재구성한다.
 * review_path, hash, lease, NotebookLM 내부 ID와 원문 전체는 반환하지 않는다.
 */
export function parseKnowledgeReviewDetail(input: {
  status: KnowledgeJobStatus;
  result: unknown;
  qualityScore: number | null;
  qualityReport: unknown;
}): KnowledgeReviewDetail | undefined {
  if (input.status !== "review_required" && input.status !== "approving" && input.status !== "completed") {
    return undefined;
  }
  const result = reviewRecord(input.result);
  const draft = reviewRecord(result?.draft);
  const summary = reviewText(draft?.summary);
  if (!summary) return undefined;
  const formatVersion: 1 | 2 = draft?.summary_format_version === 2 ? 2 : 1;
  const rawEvidenceMap = (Array.isArray(draft?.evidence_map) ? draft.evidence_map : [])
    .slice(0, REVIEW_LIST_LIMIT)
    .flatMap((value) => {
      const item = reviewRecord(value);
      const claimId = reviewText(item?.claim_id, 80);
      const timestamps = (Array.isArray(item?.timestamps) ? item.timestamps : [])
        .map(reviewTimestamp)
        .filter((timestamp): timestamp is string => Boolean(timestamp));
      if (!claimId || timestamps.length === 0) return [];
      return [{ claimId, timestamps, note: reviewText(item?.note, 1_000) ?? undefined }];
    });
  const evidenceByClaimId = new Map(rawEvidenceMap.map((item) => [item.claimId, item]));

  const claims = (Array.isArray(draft?.claims) ? draft.claims : [])
    .slice(0, REVIEW_LIST_LIMIT)
    .map((value): KnowledgeReviewClaim | null => {
      const claim = reviewRecord(value);
      const statement = reviewText(claim?.statement, 4_000);
      const type = claim?.type;
      if (!statement || !["fact", "interpretation", "recommendation"].includes(String(type))) return null;
      const id = reviewText(claim?.id, 80) ?? undefined;
      const mappedEvidence = id ? evidenceByClaimId.get(id) : undefined;
      const validCitation = reviewTimestamp(claim?.citation) ?? mappedEvidence?.timestamps[0];
      const citationVerified = Boolean(validCitation) && claim?.citation_verified === true;
      const evidenceExcerpt = type === "fact" && citationVerified
        ? reviewEvidenceExcerpt(claim?.evidence_quote ?? claim?.caption_quote ?? mappedEvidence?.note)
        : undefined;
      return {
        ...(id ? { id } : {}),
        type: type as KnowledgeClaimType,
        statement,
        ...(evidenceExcerpt ? { evidenceExcerpt } : {}),
        citation: validCitation,
        citationVerified,
        requiresCrosscheck: claim?.requires_crosscheck === true,
      };
    })
    .filter((claim): claim is KnowledgeReviewClaim => Boolean(claim));

  const rawCoverage = reviewRecord(draft?.coverage);
  const coverage = (["start", "middle", "end"] as const).flatMap((part) => {
    const rawItem = rawCoverage?.[part];
    const item = reviewRecord(rawItem);
    const statement = reviewText(item?.statement ?? rawItem, 4_000);
    if (!statement) return [];
    const validCitation = reviewTimestamp(item?.citation);
    const citationVerified = item?.citation_verified === true && Boolean(validCitation);
    const evidenceExcerpt = citationVerified
      ? reviewEvidenceExcerpt(item?.evidence_quote ?? item?.caption_quote)
      : undefined;
    return [{
      part,
      statement,
      ...(evidenceExcerpt ? { evidenceExcerpt } : {}),
      citation: validCitation,
      citationVerified,
    } satisfies KnowledgeReviewCoverage];
  });

  const quality = reviewRecord(input.qualityReport);
  const qualityWarnings = [
    ...reviewTextList(quality?.hard_failures),
    ...reviewTextList(quality?.warnings),
  ];
  const qualityScore = typeof input.qualityScore === "number"
    && Number.isFinite(input.qualityScore)
    && input.qualityScore >= 0
    && input.qualityScore <= 100
    ? input.qualityScore
    : undefined;
  const evidenceMap: KnowledgeEvidenceMapItem[] = rawEvidenceMap.map((item) => ({
    claimId: item.claimId,
    statement: claims.find((claim) => claim.id === item.claimId)?.statement ?? "연결된 주장 없음",
    timestamps: item.timestamps,
    ...(item.note ? { note: item.note } : {}),
  }));

  return {
    formatVersion,
    summary,
    keyPoints: reviewTextList(draft?.key_points),
    claims,
    coverage,
    uncertainties: reviewTextList(draft?.uncertainties),
    relevance: reviewText(draft?.yohan_relevance, 8_000) ?? undefined,
    category: reviewText(result?.category, 160) ?? "YT · 미분류 · Inbox",
    qualityScore,
    qualityWarnings,
    creatorThesis: reviewText(draft?.creator_thesis, 8_000) ?? undefined,
    audienceContext: reviewText(draft?.audience_context, 8_000) ?? undefined,
    criticalAnalysis: reviewText(draft?.critical_analysis, 8_000) ?? undefined,
    ecosystemApplications: reviewEcosystemApplications(draft?.ecosystem_applications),
    twoWeekExperiment: reviewTwoWeekExperiment(draft?.two_week_experiment),
    evidenceMap,
  };
}

export function knowledgeCitationSeconds(citation: string | undefined): number | null {
  if (!citation) return null;
  const match = citation.match(TIMESTAMP_PATTERN);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

export function knowledgeCitationUrl(sourceUrl: string | undefined, citation: string | undefined): string | null {
  const normalized = sourceUrl ? normalizeYouTubeUrl(sourceUrl) : null;
  const seconds = knowledgeCitationSeconds(citation);
  if (!normalized || seconds === null) return null;
  const url = new URL(normalized);
  url.searchParams.set("t", `${seconds}s`);
  return url.toString();
}

/** 상태 API의 쉼표 구분 video ID를 중복 제거하고 최대 50개로 제한한다. */
export function parseKnowledgeStatusVideoIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const videoIds = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (videoIds.length === 0 || videoIds.length > KNOWLEDGE_STATUS_QUERY_LIMIT) return null;
  return videoIds.every((videoId) => VIDEO_ID_PATTERN.test(videoId)) ? videoIds : null;
}

/** PostgreSQL 직접 오류와 PostgREST schema-cache 오류를 같은 일시 중단 경계로 묶는다. */
export function isKnowledgeJobsUnavailableError(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  const message = (error.message ?? "").toLowerCase();
  const mentionsKnowledgeContract = message.includes("knowledge_jobs")
    || message.includes("enqueue_knowledge_job")
    || message.includes("enqueue_knowledge_canary_job")
    || message.includes("enrich_knowledge_job");
  if (error.code === "PGRST202" && mentionsKnowledgeContract) return true;
  return message.includes("schema cache") && mentionsKnowledgeContract;
}

/** 늦게 도착한 조회 응답이 더 최신 POST·poll 상태를 되돌리지 않도록 video ID별로 병합한다. */
export function mergeKnowledgeJobMaps(
  current: KnowledgeJobMap,
  incoming: KnowledgeJobMap,
): KnowledgeJobMap {
  const merged = { ...current };
  for (const [videoId, job] of Object.entries(incoming)) {
    const previous = merged[videoId];
    const previousTime = previous ? Date.parse(previous.updatedAt) : Number.NaN;
    const incomingTime = Date.parse(job.updatedAt);
    if (!previous || !Number.isFinite(previousTime) || !Number.isFinite(incomingTime) || incomingTime >= previousTime) {
      merged[videoId] = previous ? { ...previous, ...job } : job;
    }
  }
  return merged;
}

export interface KnowledgeCaptureMetadata {
  videoId: string;
  sourceUrl: string;
  title: string;
  channelName: string | null;
  sourceGuide: string;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanSingleLine(value: string | null | undefined, maxLength: number): string {
  return cleanLine(value ?? "").slice(0, maxLength);
}

/** 공유 문자열 안의 첫 YouTube URL을 포함해 video ID를 읽는다. */
export function extractYouTubeVideoId(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s]+/i);
  const candidate = (match?.[0] ?? input).replace(/[)>\],.]+$/, "").trim();
  if (!candidate) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  let videoId: string | null = null;
  if (url.hostname.toLowerCase().endsWith("youtu.be")) {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
  } else {
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0] ?? "")) {
      videoId = parts[1] ?? null;
    }
  }

  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

/** 이 대기열의 멱등 키로 쓰는 정규 YouTube watch URL. */
export function normalizeYouTubeUrl(input: string): string | null {
  const videoId = extractYouTubeVideoId(input);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

/**
 * 설명란 전체를 다시 보관하지 않는다. 시간표·참고자료·링크와 설명의 앞부분만 남겨
 * 나중에 원문을 다시 열 필요 없는 "소스 가이드"를 만든다.
 */
export function selectUsefulDescription(description: string | null | undefined): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  let contextLines = 0;

  for (const rawLine of (description ?? "").split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line || PROMOTIONAL_DESCRIPTION_PATTERN.test(line)) continue;

    const useful = USEFUL_DESCRIPTION_PATTERN.test(line);
    const keepAsContext = contextLines < 3 && line.length <= 360;
    if (!useful && !keepAsContext) continue;

    const key = line.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(line);
    if (!useful) contextLines += 1;

    if (selected.length >= 16) break;
  }

  return selected;
}

export function buildKnowledgeSourceGuide(input: {
  sourceUrl: string;
  videoId: string;
  title: string;
  channelName?: string | null;
  description?: string | null;
  capturedAt?: Date;
}): string {
  const capturedAt = input.capturedAt ?? new Date();
  const title = cleanSingleLine(input.title, 300) || "제목 확인 필요";
  const channelName = cleanSingleLine(input.channelName, 180) || "채널 확인 필요";
  const lines = selectUsefulDescription(input.description);
  const selectedDescription = lines.length > 0
    ? lines.map((line) => `- ${line}`).join("\n")
    : "- 공개 설명란에서 보존할 정보가 없습니다.";

  return [
    "## YouTube 소스 가이드",
    `- 제목: ${title}`,
    `- 채널: ${channelName}`,
    `- URL: ${input.sourceUrl}`,
    `- Video ID: ${input.videoId}`,
    `- 수집 시각: ${capturedAt.toISOString()}`,
    "",
    "### 영상 설명에서 선별한 정보",
    selectedDescription,
  ].join("\n");
}

export function buildKnowledgeCaptureMetadata(input: {
  sourceUrl: string;
  title?: string | null;
  channelName?: string | null;
  description?: string | null;
  capturedAt?: Date;
}): KnowledgeCaptureMetadata | null {
  const videoId = extractYouTubeVideoId(input.sourceUrl);
  const sourceUrl = normalizeYouTubeUrl(input.sourceUrl);
  if (!videoId || !sourceUrl) return null;

  const title = cleanSingleLine(input.title, 300) || `YouTube ${videoId}`;
  const channelName = cleanSingleLine(input.channelName, 180) || null;
  return {
    videoId,
    sourceUrl,
    title,
    channelName,
    sourceGuide: buildKnowledgeSourceGuide({
      sourceUrl,
      videoId,
      title,
      channelName,
      description: input.description,
      capturedAt: input.capturedAt,
    }),
  };
}
