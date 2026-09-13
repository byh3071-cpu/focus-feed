/**
 * Goal 3 — 에이전트가 job 초안을 읽고 패치하는 공개 계약.
 * Brain 파일·승인 RPC·NotebookLM ID는 이 계약 밖이다.
 */

export const KNOWLEDGE_DRAFT_NPM_COMMAND = "npm run knowledge:draft --";

export const NOTEBOOKLM_PUBLIC_URL = "https://notebooklm.google.com/";

export const KNOWLEDGE_STUDIO_HTTP_TEMPLATE = "/api/knowledge/jobs/:jobId/studio";

export function knowledgeDraftGetCommand(jobId: string): string {
  return `${KNOWLEDGE_DRAFT_NPM_COMMAND} get ${jobId}`;
}

export function knowledgeDraftPatchCommand(jobId: string, revision: number): string {
  return `${KNOWLEDGE_DRAFT_NPM_COMMAND} patch ${jobId} --file draft.md --revision ${revision}`;
}

export const KNOWLEDGE_JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const KNOWLEDGE_DRAFT_USAGE = [
  "Usage:",
  `  ${KNOWLEDGE_DRAFT_NPM_COMMAND} get <jobId> [--markdown]`,
  `  ${KNOWLEDGE_DRAFT_NPM_COMMAND} patch <jobId> --file <path.md> [--revision N]`,
  "",
  "Reads/writes result.studio_draft only. Never writes Brain files or calls approval RPCs.",
  "Auth: FOCUS_FEED_COOKIE + running app, or local SUPABASE_SERVICE_ROLE_KEY.",
].join("\n");

export const AGENT_OUTPUT_FORBIDDEN = [
  "notebook_id",
  "approval_token",
  "source_hash",
  "transcript_hash",
  "review_path",
] as const;

export type KnowledgeDraftCliCommand =
  | { ok: true; action: "get"; jobId: string; markdownOnly: boolean }
  | { ok: true; action: "patch"; jobId: string; filePath: string; expectedRevision: number | null }
  | { ok: false; error: string };

export interface PublicStudioDraftView {
  jobId: string;
  revision: number;
  status: string;
  statusLabel: string;
  markdown: string;
  updatedAt: string | null;
  seeded: boolean;
}

export function knowledgeStudioHttpPath(jobId: string): string {
  return `/api/knowledge/jobs/${encodeURIComponent(jobId)}/studio`;
}

export function parseKnowledgeDraftArgv(argv: string[]): KnowledgeDraftCliCommand {
  const args = argv.filter((part) => part !== "--");
  const action = args[0];
  if (action !== "get" && action !== "patch") {
    return { ok: false, error: KNOWLEDGE_DRAFT_USAGE };
  }

  const jobId = args[1] ?? "";
  if (!KNOWLEDGE_JOB_ID_PATTERN.test(jobId)) {
    return { ok: false, error: "검토 항목 ID가 올바르지 않아요." };
  }

  let markdownOnly = false;
  let filePath: string | null = null;
  let expectedRevision: number | null = null;

  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--markdown") {
      markdownOnly = true;
      continue;
    }
    if (flag === "--file" || flag === "-f") {
      filePath = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (flag === "--revision") {
      const raw = args[index + 1];
      const parsed = raw === undefined ? Number.NaN : Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { ok: false, error: "revision이 올바르지 않아요." };
      }
      expectedRevision = parsed;
      index += 1;
      continue;
    }
    return { ok: false, error: `알 수 없는 옵션: ${flag}` };
  }

  if (action === "get") {
    if (filePath !== null || expectedRevision !== null) {
      return { ok: false, error: "get은 --file/--revision을 쓰지 않아요." };
    }
    return { ok: true, action: "get", jobId, markdownOnly };
  }

  if (!filePath) {
    return { ok: false, error: "patch는 --file <path.md>가 필요해요. 표준 입력은 --file -" };
  }
  if (markdownOnly) {
    return { ok: false, error: "patch는 --markdown을 쓰지 않아요." };
  }
  return { ok: true, action: "patch", jobId, filePath, expectedRevision };
}

export function publicStudioDraftView(input: Record<string, unknown>): PublicStudioDraftView | null {
  if (typeof input.jobId !== "string" || !KNOWLEDGE_JOB_ID_PATTERN.test(input.jobId)) return null;
  if (typeof input.markdown !== "string") return null;
  if (!Number.isInteger(input.revision) || (input.revision as number) < 0) return null;
  if (typeof input.status !== "string" || !input.status.trim()) return null;
  const statusLabel = typeof input.statusLabel === "string" && input.statusLabel.trim()
    ? input.statusLabel
    : input.status;
  return {
    jobId: input.jobId,
    revision: input.revision as number,
    status: input.status,
    statusLabel,
    markdown: input.markdown,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
    seeded: input.seeded === true,
  };
}

export function publicDraftJsonContainsSecrets(json: string): boolean {
  const lower = json.toLowerCase();
  return AGENT_OUTPUT_FORBIDDEN.some((key) => lower.includes(key))
    || json.includes("secret-notebook")
    || /[A-Za-z]:[\\/]/.test(json);
}
