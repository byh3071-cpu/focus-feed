/**
 * 지식 작업실 초안 계약.
 * 클라이언트와 서버가 같이 쓰므로 Node 전용 API를 넣지 않는다.
 */

import type {
  KnowledgeClaimType,
  KnowledgeJobSummary,
  KnowledgeReviewDetail,
} from "./knowledge-capture";
import { buildReferenceContext, referenceDocumentUrl, referenceVersionLabel, type StudioReferenceDocument } from "./knowledge-reference-context";

export const MAX_STUDIO_MARKDOWN_CHARS = 80_000;
export const MAX_SOURCE_GUIDE_CHARS = 32_000;
export const MAX_STUDIO_CHAT_MESSAGE_CHARS = 500;
export const MIN_STUDIO_CHAT_MESSAGE_CHARS = 2;

export const CLAIM_TYPE_LABELS: Record<KnowledgeClaimType, string> = {
  fact: "사실",
  interpretation: "해석",
  recommendation: "권고",
};

export interface KnowledgeStudioDraft {
  markdown: string;
  revision: number;
  updatedAt: string;
}

export interface KnowledgeStudioDraftView {
  markdown: string;
  revision: number;
  updatedAt: string | null;
  seeded: boolean;
}

export type StudioPreviewBlock =
  | { type: "h1" | "h2" | "p"; text: string }
  | { type: "ul"; items: string[] };

export interface KnowledgeStudioPayload {
  studioAvailable: boolean;
  job: KnowledgeJobSummary;
  statusLabel: string;
  sourceGuide?: string;
  review?: KnowledgeReviewDetail;
  studioDraft?: KnowledgeStudioDraftView;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function seedKnowledgeStudioMarkdown(
  title: string,
  review: KnowledgeReviewDetail,
): string {
  const heading = title.trim() || "제목 없음";
  const sections = [`# ${heading}`, "", review.summary.trim()];

  if (review.keyPoints.length > 0) {
    sections.push("", "## 핵심", "");
    for (const point of review.keyPoints) {
      sections.push(`- ${point}`);
    }
  }

  if (review.claims.length > 0) {
    sections.push("", "## 주장", "");
    for (const claim of review.claims) {
      sections.push(`- (${CLAIM_TYPE_LABELS[claim.type]}) ${claim.statement}`);
    }
  }

  return `${sections.join("\n").trim()}\n`;
}

export function parseStudioDraft(value: unknown): KnowledgeStudioDraft | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.markdown !== "string") return undefined;
  const markdown = record.markdown;
  if (!markdown.trim() || markdown.length > MAX_STUDIO_MARKDOWN_CHARS) return undefined;
  if (!Number.isInteger(record.revision) || (record.revision as number) < 1) return undefined;
  if (!isIsoDate(record.updatedAt)) return undefined;
  return {
    markdown,
    revision: record.revision as number,
    updatedAt: record.updatedAt,
  };
}

export function studioDraftFromResult(result: unknown): KnowledgeStudioDraft | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  return parseStudioDraft(record.studio_draft);
}

export function resolveStudioDraft(input: {
  result: unknown;
  title: string;
  review: KnowledgeReviewDetail;
}): KnowledgeStudioDraftView {
  const stored = studioDraftFromResult(input.result);
  if (stored) {
    return { ...stored, seeded: false };
  }
  return {
    markdown: seedKnowledgeStudioMarkdown(input.title, input.review),
    revision: 0,
    updatedAt: null,
    seeded: true,
  };
}

export function sanitizeSourceGuide(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, MAX_SOURCE_GUIDE_CHARS);
}

export function applyStudioDraftPatch(input: {
  result: unknown;
  markdown: unknown;
  expectedRevision: unknown;
  now?: Date;
}):
  | { ok: true; result: Record<string, unknown>; draft: KnowledgeStudioDraft }
  | { ok: false; code: "invalid" | "conflict" } {
  if (typeof input.markdown !== "string") return { ok: false, code: "invalid" };
  const markdown = input.markdown;
  if (!markdown.trim() || markdown.length > MAX_STUDIO_MARKDOWN_CHARS) {
    return { ok: false, code: "invalid" };
  }
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
    return { ok: false, code: "invalid" };
  }

  const current = studioDraftFromResult(input.result);
  const currentRevision = current?.revision ?? 0;
  if (input.expectedRevision !== currentRevision) {
    return { ok: false, code: "conflict" };
  }

  const draft: KnowledgeStudioDraft = {
    markdown,
    revision: currentRevision + 1,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  const base = asRecord(input.result) ?? {};
  return {
    ok: true,
    result: { ...base, studio_draft: draft },
    draft,
  };
}

export function studioMarkdownPreviewBlocks(markdown: string): StudioPreviewBlock[] {
  const blocks: StudioPreviewBlock[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push({ type: "ul", items: listItems });
    listItems = [];
  };

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      blocks.push({ type: "h1", text: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      blocks.push({ type: "h2", text: trimmed.slice(3).trim() });
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push(bullet[1] ?? "");
      continue;
    }
    flushList();
    blocks.push({ type: "p", text: trimmed });
  }
  flushList();
  return blocks;
}

export function parseStudioChatMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.trim();
  if (
    message.length < MIN_STUDIO_CHAT_MESSAGE_CHARS
    || message.length > MAX_STUDIO_CHAT_MESSAGE_CHARS
  ) {
    return undefined;
  }
  return message;
}

function looksLikeStudioMarkdown(text: string): boolean {
  return /^#{1,2}\s+\S/m.test(text) || /^[-*]\s+\S/m.test(text);
}

export function studioChatWantsDraftApply(message: string): boolean {
  return /(고치|고쳐|다듬|정리|짧게|길게|패치|수정|다시\s*써|반영|바꿔|줄여|늘려|요약해|다시 작성)/.test(message);
}

export function parseStudioChatReply(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const fenced = trimmed.match(/```(?:markdown|md)\s*\n([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim();
  if (!candidate || candidate.length > MAX_STUDIO_MARKDOWN_CHARS) return undefined;
  if (!looksLikeStudioMarkdown(candidate)) return undefined;
  return candidate.endsWith("\n") ? candidate : `${candidate}\n`;
}

export type StudioParagraphSelection = { text: string; start: number; revision: number };

export function studioParagraphSelections(markdown: string, revision: number): StudioParagraphSelection[] {
  return [...markdown.matchAll(/[^\r\n]+/g)].flatMap(match => {
    const text = match[0].trim();
    if (!text || /^(?:#{1,2} |[-*]\s)/.test(text)) return [];
    return [{ text, start: match.index + match[0].indexOf(text), revision }];
  });
}

export function resolveStudioParagraphReply(message: string, reply: string): string | undefined {
  if (!studioChatWantsDraftApply(message)) return undefined;
  const text = reply.match(/```(?:markdown|md)\s*\n([\s\S]*?)```/i)?.[1]?.trim();
  if (!text || text.length > 10_000 || /\n\s*\n|^\s*[#>-]|^\s*[-*]\s/m.test(text)) return undefined;
  return text;
}

export function replaceStudioParagraph(markdown: string, revision: number, selection: StudioParagraphSelection, replacement: string): string | undefined {
  if (revision !== selection.revision || !Number.isSafeInteger(selection.start) || selection.start < 0 || !selection.text) return undefined;
  if (markdown.slice(selection.start, selection.start + selection.text.length) !== selection.text) return undefined;
  const next = markdown.slice(0, selection.start) + replacement + markdown.slice(selection.start + selection.text.length);
  return next.length <= MAX_STUDIO_MARKDOWN_CHARS ? next : undefined;
}

export function resolveStudioChatDraft(message: string, reply: string): string | undefined {
  if (!studioChatWantsDraftApply(message)) return undefined;
  return parseStudioChatReply(reply);
}

export function studioChatEvidenceLines(review: KnowledgeReviewDetail): string[] {
  return review.claims.flatMap((claim) => {
    if (!claim.citationVerified || !claim.citation) return [];
    const excerpt = claim.evidenceExcerpt ? ` — "${claim.evidenceExcerpt}"` : "";
    return [`${claim.citation} (${CLAIM_TYPE_LABELS[claim.type]}) ${claim.statement}${excerpt}`];
  });
}

const STUDIO_EVIDENCE_SCOPE = "아래는 최초 자동 분석의 근거 후보다. 시간 위치 확인은 주장·발췌의 의미 일치나 외부 사실의 정확성을 보장하지 않는다. 현재 본문은 이후 사람이 수정했을 수 있으므로 이전 주장을 현재 본문의 검증 결과로 취급하지 않는다. 서로 충돌하거나 뒷받침할 원문이 없으면 확인되지 않았다고 밝힌다.";

export function buildStudioChatPrompt(input: {
  markdown: string;
  message: string;
  sourceGuide: string;
  evidenceLines: string[];
  history?: { role: "user" | "assistant"; content: string }[];
}): string {
  const evidence = input.evidenceLines.length > 0
    ? input.evidenceLines.map((line) => `- ${line}`).join("\n")
    : "- (시간 위치가 확인된 근거 후보 없음)";
  const history = (input.history ?? [])
    .slice(-6)
    .map((turn) => {
      const role = turn.role === "user" ? "사용자" : "어시스턴트";
      const content = turn.content.replace(/\s+/g, " ").trim().slice(0, 420);
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return [
    "너는 Focus Feed 지식 작업실의 편집기다. 사용자가 말한 대로 현재 Markdown 초안을 고친다.",
    "출력은 완성된 초안 Markdown 전체만 한다. 인사, 설명, 코드펜스를 붙이지 않는다.",
    "자막 전문을 만들지 않는다. 아래 근거에 없는 타임스탬프나 발췌를 지어내지 않는다.",
    "사실과 해석을 나누라는 요청이면 주장 유형을 분명히 유지한다.",
    "",
    "## 현재 초안",
    input.markdown.slice(0, MAX_STUDIO_MARKDOWN_CHARS),
    "",
    "## 소스 가이드",
    (input.sourceGuide || "(없음)").slice(0, MAX_SOURCE_GUIDE_CHARS),
    "",
    "## 시간 위치가 확인된 자동 분석 근거 후보",
    STUDIO_EVIDENCE_SCOPE,
    evidence,
    history ? `\n## 최근 대화\n${history}` : "",
    "",
    "## 사용자 요청",
    input.message,
  ].filter((part) => part !== "").join("\n");
}

export function buildStudioAgentPrompt(input: {
  scope?: "paragraph" | "document";
  markdown: string;
  message: string;
  sourceGuide: string;
  evidenceLines: string[];
  history?: { role: "user" | "assistant"; content: string }[];
  references?: StudioReferenceDocument[];
  currentDocument?: { id: string; revision: number };
  approvedDocument?: StudioReferenceDocument;
}): string {
  const evidence = input.evidenceLines.length > 0
    ? input.evidenceLines.map((line) => `- ${line}`).join("\n")
    : "- (시간 위치가 확인된 근거 후보 없음)";
  const history = (input.history ?? [])
    .slice(-6)
    .map((turn) => {
      const role = turn.role === "user" ? "사용자" : "어시스턴트";
      const content = turn.content.replace(/\s+/g, " ").trim().slice(0, 420);
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return [
    "너는 Focus Feed 지식 작업실의 편집 파트너다. 로컬 구독 Claude Code, Cursor, 또는 Codex로 실행된다.",
    "인사·질문·확인이면 초안을 출력하지 말고 짧게 대화만 한다. 가운데 페이지를 덮지 않는다.",
    input.scope === "paragraph"
      ? "편집 범위는 선택 문단 하나다. 명시적인 수정 요청이면 변경 이유 한 줄과 대체 문단 하나만 ```markdown 펜스에 넣는다. 제목이나 다른 문단을 추가하지 않는다."
      : "사용자가 초안을 고치라고 분명히 말한 때에만 완성된 Markdown 전체를 하나의 ```markdown 펜스에 넣는다.",
    "펜스 없는 제목·불릿은 초안이 아니다. 자막 전문을 만들지 않는다. 아래 근거에 없는 타임스탬프나 발췌를 지어내지 않는다.",
    "사실과 해석을 나누라는 요청이면 주장 유형을 분명히 유지한다.",
    "",
    "## 현재 초안",
    input.approvedDocument
      ? `현재 승인 문서: ${referenceDocumentUrl(input.approvedDocument)} · ${referenceVersionLabel(input.approvedDocument)} · 승인 시각 ${input.approvedDocument.approvedAt}. 본문에 남아 있는 과거 상태와 구분한다. 수정 요청은 별도 수정안 후보이며 기존 승인본을 바꾸지 않는다.`
      : input.currentDocument ? `현재 문서: /knowledge?job=${encodeURIComponent(input.currentDocument.id)} · revision ${input.currentDocument.revision}` : "",
    (input.approvedDocument?.markdown ?? input.markdown).slice(0, MAX_STUDIO_MARKDOWN_CHARS),
    "",
    "## 소스 가이드",
    (input.sourceGuide || "(없음)").slice(0, MAX_SOURCE_GUIDE_CHARS),
    "",
    "## 시간 위치가 확인된 자동 분석 근거 후보",
    STUDIO_EVIDENCE_SCOPE,
    evidence,
    buildReferenceContext(input.references ?? []),
    history ? `\n## 최근 대화\n${history}` : "",
    "",
    "## 사용자 요청",
    input.message,
  ].filter((part) => part !== "").join("\n");
}

export function planStudioApproval(input: {
  result: unknown;
  markdown: unknown;
  expectedRevision: unknown;
  now?: Date;
}):
  | { ok: true; persist: false; draft: KnowledgeStudioDraft }
  | { ok: true; persist: true; result: Record<string, unknown>; draft: KnowledgeStudioDraft }
  | { ok: false; code: "invalid" | "conflict" } {
  const stored = studioDraftFromResult(input.result);
  const currentRevision = stored?.revision ?? 0;
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
    return { ok: false, code: "invalid" };
  }
  if (input.expectedRevision !== currentRevision) {
    return { ok: false, code: "conflict" };
  }
  if (typeof input.markdown !== "string") return { ok: false, code: "invalid" };
  if (stored && input.markdown === stored.markdown && stored.revision >= 1) {
    return { ok: true, persist: false, draft: stored };
  }
  const applied = applyStudioDraftPatch(input);
  if (!applied.ok) return applied;
  return { ok: true, persist: true, result: applied.result, draft: applied.draft };
}

export async function studioApprovalIntentHash(
  jobId: string,
  revision: number,
  markdown: string,
): Promise<string> {
  const payload = `v1\n${jobId}\n${revision}\n${markdown}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const DEFERRED_JOBS_STORAGE_KEY = "ff_knowledge_deferred_jobs";
const DEFERRED_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDeferredJobIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && DEFERRED_JOB_ID.test(id))
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function addDeferredJobId(ids: string[], jobId: string): string[] {
  if (!DEFERRED_JOB_ID.test(jobId)) return ids;
  if (ids.includes(jobId)) return ids;
  return [...ids, jobId].slice(-100);
}

export function loadDeferredJobIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseDeferredJobIds(window.localStorage.getItem(DEFERRED_JOBS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function storeDeferredJobIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEFERRED_JOBS_STORAGE_KEY, JSON.stringify(ids));
}

function firstMarkdownHeading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function markdownSectionHeadings(markdown: string): string[] {
  return [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
}

export function summarizeStudioDraftChange(before: string, after: string): string {
  if (before === after) return "같은 초안";
  const parts: string[] = [];
  const previousTitle = firstMarkdownHeading(before);
  const nextTitle = firstMarkdownHeading(after);
  if (previousTitle !== nextTitle) {
    parts.push(previousTitle && nextTitle
      ? `제목: ${previousTitle} → ${nextTitle}`
      : "제목 바꿈");
  }
  const previousSections = new Set(markdownSectionHeadings(before));
  const nextSections = markdownSectionHeadings(after);
  const added = nextSections.filter((heading) => !previousSections.has(heading));
  if (added.length > 0) parts.push(`절 추가: ${added.join(", ")}`);
  const removed = [...previousSections].filter((heading) => !nextSections.includes(heading));
  if (removed.length > 0) parts.push(`절 삭제: ${removed.join(", ")}`);
  const lineDelta = after.split("\n").length - before.split("\n").length;
  if (lineDelta !== 0) {
    parts.push(lineDelta > 0 ? `+${lineDelta}줄` : `${lineDelta}줄`);
  }
  return parts.length > 0 ? parts.join(" · ") : "문장만 고침";
}
