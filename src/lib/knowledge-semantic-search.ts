import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import type { LatestApprovedKnowledgeSnapshot } from "./knowledge-latest-approved";

export class KnowledgeSemanticUnavailableError extends Error {
  constructor() { super("승인 자료의 자연어 검색을 일시적으로 사용할 수 없어요. 키워드 검색을 이용해 주세요."); }
}

interface Match { jobId: string; revision: number; amendmentId: string | null; baseRevision: number; approvedAt: string }
export function selectSemanticKnowledge(value: unknown, snapshots: LatestApprovedKnowledgeSnapshot[]) {
  const row = value as { matches?: unknown; missingJobIds?: unknown } | null;
  if (!row || !Array.isArray(row.matches) || row.matches.length > 20 || !Array.isArray(row.missingJobIds)) throw new KnowledgeSemanticUnavailableError();
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const seen = new Set<string>();
  const sources = row.matches.map((entry) => {
    const match = entry as Match | null;
    const source = match && byId.get(match.jobId);
    if (!match || !source || seen.has(source.id) || source.versionScope !== "brain-verified"
      || match.revision !== source.revision || match.amendmentId !== (source.amendmentId ?? null)
      || match.baseRevision !== (source.baseRevision ?? source.revision)
      || typeof match.approvedAt !== "string" || Date.parse(match.approvedAt) !== Date.parse(source.approvedAt)) throw new KnowledgeSemanticUnavailableError();
    seen.add(source.id);
    return source;
  });
  const missing = new Set<string>();
  for (const id of row.missingJobIds) {
    if (typeof id !== "string" || !byId.has(id) || missing.has(id) || seen.has(id)) throw new KnowledgeSemanticUnavailableError();
    missing.add(id);
  }
  return { sources, unindexedCount: missing.size };
}

export async function searchSemanticKnowledge(options: {
  query: string; snapshots: LatestApprovedKnowledgeSnapshot[]; brainRoot?: string; mcpRoot?: string;
}) {
  const { query, snapshots, brainRoot, mcpRoot } = options;
  if (!brainRoot || !mcpRoot || !isAbsolute(brainRoot) || !isAbsolute(mcpRoot)
    || !query.trim() || query.length > 120 || snapshots.length > 100
    || snapshots.some((source) => source.versionScope !== "brain-verified")) throw new KnowledgeSemanticUnavailableError();
  if (!snapshots.length) return { sources: [], unindexedCount: 0 };
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(join(mcpRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
        [join(mcpRoot, "scripts", "search_approved_knowledge.py"), "--brain-root", brainRoot],
        { cwd: mcpRoot, env: { ...process.env, PYTHONUTF8: "1" }, timeout: 50_000, maxBuffer: 64_000, windowsHide: true },
        (error, stdout) => error ? reject(new KnowledgeSemanticUnavailableError()) : resolve(stdout));
      child.stdin?.on("error", () => reject(new KnowledgeSemanticUnavailableError()));
      child.stdin?.end(JSON.stringify({ query: query.trim(), jobIds: snapshots.map((source) => source.id) }));
    });
    return selectSemanticKnowledge(JSON.parse(stdout), snapshots);
  } catch {
    throw new KnowledgeSemanticUnavailableError();
  }
}
