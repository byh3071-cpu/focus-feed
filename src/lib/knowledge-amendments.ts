export const MAX_AMENDMENT_CHARS = 80_000;

export interface AmendmentVersion {
  id: string;
  revision: number;
  baseRevision: number;
  createdAt: string;
}

export interface AmendmentDocument extends AmendmentVersion { markdown: string }

export interface AmendmentWorkspace {
  storageReady: boolean;
  base: { id: string; title: string; revision: number; markdown: string };
  history: AmendmentVersion[];
  current: AmendmentDocument | null;
}

/** 저장된 특정 후보만 승인하도록 ID와 버전을 함께 고정한다. */
export function amendmentApprovalRequest(jobId: string, amendment: AmendmentVersion): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(jobId) || !uuid.test(amendment.id) || !Number.isSafeInteger(amendment.revision) || amendment.revision < 1) return null;
  return `요한브레인에서 저장된 수정안 v${amendment.revision}을 재승인해 줘. 기존 승인본을 보존하고 이 수정안의 승인 문서와 원본 연결을 검증해 줘.\n\nyohan-brain 저장소에서 실행:\nnpx tsx src/knowledge-amendment-approve-cli.ts --job ${jobId} --amendment ${amendment.id} --revision ${amendment.revision} --approve`;
}

export function parseAmendmentInput(value: unknown): { markdown: string; expectedRevision: number; baseRevision: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["markdown", "expectedRevision", "baseRevision"].includes(key))) return null;
  if (typeof row.markdown !== "string" || !row.markdown.trim() || row.markdown.length > MAX_AMENDMENT_CHARS) return null;
  if (!Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 0) return null;
  if (!Number.isSafeInteger(row.baseRevision) || (row.baseRevision as number) < 1) return null;
  return { markdown: row.markdown, expectedRevision: row.expectedRevision as number, baseRevision: row.baseRevision as number };
}

/** 같은 앞·뒤 행을 접어 바뀐 범위를 보여준다. 최소 편집 거리 diff는 아니다. */
export function amendmentChangedRange(before: string, after: string) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd--; }
  return { changed: before !== after, startLine: start + 1, before: oldLines.slice(start, oldEnd).join("\n"), after: newLines.slice(start, newEnd).join("\n") };
}
