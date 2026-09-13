import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface BrainApprovalVersion { id: string; revision: number; approved: boolean; approvedAt?: string; bodySha256: string }
export interface BrainApprovalStatus { jobId: string; checkedAt: string; versions: BrainApprovalVersion[]; latestApproved: BrainApprovalVersion | null }

export function parseBrainApprovalStatus(value: unknown, jobId: string, ownerUserId: string): BrainApprovalStatus {
  const row = value as Record<string, unknown> | null;
  if (!row || row.jobId !== jobId || row.ownerUserId !== ownerUserId || typeof row.checkedAt !== "string" || !Number.isFinite(Date.parse(row.checkedAt)) || !Array.isArray(row.versions) || row.versions.length > 200) throw new Error("Invalid Brain approval status");
  const ids = new Set<string>(); const revisions = new Set<number>();
  const versions = row.versions.map((entry): BrainApprovalVersion => {
    const item = entry as Record<string, unknown>;
    if (!item || typeof item.id !== "string" || !UUID.test(item.id) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1 || typeof item.approved !== "boolean" || typeof item.bodySha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.bodySha256)) throw new Error("Invalid approval version");
    if (ids.has(item.id) || revisions.has(Number(item.revision))) throw new Error("Duplicate approval version");
    ids.add(item.id); revisions.add(Number(item.revision));
    if (item.approved && (typeof item.approvedAt !== "string" || !Number.isFinite(Date.parse(item.approvedAt)))) throw new Error("Missing approval timestamp");
    return { id: item.id, revision: Number(item.revision), approved: item.approved, bodySha256: item.bodySha256, ...(item.approved ? { approvedAt: item.approvedAt as string } : {}) };
  }).sort((a, b) => b.revision - a.revision);
  return { jobId, checkedAt: row.checkedAt, versions, latestApproved: versions.find(item => item.approved) ?? null };
}

export async function readBrainApprovalStatus(jobId: string, ownerUserId: string, root: string) {
  if (!UUID.test(jobId) || !UUID.test(ownerUserId) || !isAbsolute(root)) throw new Error("Invalid Brain configuration");
  const { stdout } = await execute(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "src", "knowledge-amendment-status-cli.ts"), "--job", jobId, "--owner", ownerUserId], { cwd: root, env: { ...process.env, YOHAN_OS_ROOT: root }, timeout: 30_000, maxBuffer: 512_000, windowsHide: true });
  return parseBrainApprovalStatus(JSON.parse(stdout), jobId, ownerUserId);
}
