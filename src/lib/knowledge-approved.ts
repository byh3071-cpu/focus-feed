import { normalizeYouTubeUrl } from "./knowledge-capture";

export const APPROVED_KNOWLEDGE_QUERY_LIMIT = 120;
export const APPROVED_KNOWLEDGE_ID_LIMIT = 3;
export const APPROVED_KNOWLEDGE_RECENT_LIMIT = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type ApprovedKnowledgeQuery =
  | { mode: "search"; query: string }
  | { mode: "ids"; ids: string[] };

export interface ApprovedKnowledgeSnapshot {
  amendmentId?: string;
  baseRevision?: number;
  versionScope?: "original-only" | "brain-verified";
  id: string;
  title: string;
  sourceUrl: string;
  revision: number;
  approvedAt: string;
  markdown: string;
  approvalIntentHash: string;
  resultApprovalIntentHash: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseApprovedKnowledgeQuery(params: URLSearchParams): ApprovedKnowledgeQuery | null {
  const hasQuery = params.has("q");
  const hasIds = params.has("ids");
  if (hasQuery && hasIds) return null;

  if (hasIds) {
    const raw = params.get("ids") ?? "";
    const values = raw.split(",").map((value) => value.trim().toLowerCase());
    if (
      values.length === 0
      || values.length > APPROVED_KNOWLEDGE_ID_LIMIT
      || values.some((id) => !UUID_PATTERN.test(id))
      || new Set(values).size !== values.length
    ) return null;
    return { mode: "ids", ids: values };
  }

  const query = params.get("q") ?? "";
  if (query.length > APPROVED_KNOWLEDGE_QUERY_LIMIT) return null;
  return { mode: "search", query: query.trim() };
}

export function parseApprovedKnowledgeSnapshot(value: unknown): ApprovedKnowledgeSnapshot | null {
  const row = record(value);
  const draft = record(row?.studio_draft);
  if (!row || !draft || !UUID_PATTERN.test(String(row.id ?? ""))) return null;
  if (typeof row.title !== "string" || !row.title.trim()) return null;
  if (typeof draft.markdown !== "string" || !draft.markdown.trim()) return null;
  if (!Number.isInteger(draft.revision) || (draft.revision as number) < 1) return null;
  if (typeof row.approved_at !== "string" || !row.approved_at.trim() || !Number.isFinite(Date.parse(row.approved_at))) return null;
  if (!SHA256_PATTERN.test(String(row.approval_intent_hash ?? ""))) return null;
  if (!SHA256_PATTERN.test(String(row.result_approval_intent_hash ?? ""))) return null;

  const sourceUrl = typeof row.source_url === "string" ? normalizeYouTubeUrl(row.source_url) : null;
  const videoId = typeof row.video_id === "string" && VIDEO_ID_PATTERN.test(row.video_id)
    ? row.video_id
    : null;
  if (!sourceUrl && !videoId) return null;

  return {
    id: row.id as string,
    title: row.title.trim(),
    sourceUrl: sourceUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId!)}`,
    revision: draft.revision as number,
    approvedAt: row.approved_at,
    markdown: draft.markdown,
    approvalIntentHash: String(row.approval_intent_hash).toLowerCase(),
    resultApprovalIntentHash: String(row.result_approval_intent_hash).toLowerCase(),
  };
}

export function approvedKnowledgeMatches(
  source: Pick<ApprovedKnowledgeSnapshot, "title" | "markdown">,
  query: string,
): boolean {
  if (!query) return true;
  const keyword = query.toLocaleLowerCase("ko-KR");
  return source.title.toLocaleLowerCase("ko-KR").includes(keyword)
    || source.markdown.toLocaleLowerCase("ko-KR").includes(keyword);
}

export function approvedKnowledgeExcerpt(markdown: string): string {
  const text = markdown.replace(/\s+/g, " ").trim();
  return text.length <= 280 ? text : `${text.slice(0, 279).trimEnd()}…`;
}
