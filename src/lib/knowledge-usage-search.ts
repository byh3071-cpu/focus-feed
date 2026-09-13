import { createHash } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isUsageContextUuid, type UsageContent } from "./knowledge-usage-context";

export const MAX_USAGE_JOBS = 1_000;

function ownerSegment(userId: string): string {
  return createHash("sha256").update(userId.toLowerCase()).digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return Boolean(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function listUsageJobIds(root: string, userId: string): Promise<string[]> {
  if (!isAbsolute(root) || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(root)) {
    throw new Error("usage context root must be absolute");
  }
  if (!isUsageContextUuid(userId)) throw new Error("invalid usage context owner");

  let canonicalRoot: string;
  try { canonicalRoot = await realpath(resolve(root)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const ownerPath = join(canonicalRoot, ownerSegment(userId));
  let ownerInfo;
  try { ownerInfo = await lstat(ownerPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (ownerInfo.isSymbolicLink() || !ownerInfo.isDirectory()) throw new Error("usage context owner path is unsafe");
  const canonicalOwner = await realpath(ownerPath);
  if (!isInside(canonicalRoot, canonicalOwner)) throw new Error("usage context owner path escaped root");

  const ids: string[] = [];
  const directory = await opendir(canonicalOwner);
  try {
    for await (const entry of directory) {
      if (!isUsageContextUuid(entry.name)) throw new Error("usage context owner directory is corrupted");
      const jobPath = join(canonicalOwner, entry.name);
      const info = await lstat(jobPath);
      if (entry.isSymbolicLink() || info.isSymbolicLink() || !entry.isDirectory() || !info.isDirectory()) {
        throw new Error("usage context job path is unsafe");
      }
      const canonicalJob = await realpath(jobPath);
      if (!isInside(canonicalOwner, canonicalJob)) throw new Error("usage context job path escaped owner");
      ids.push(entry.name.toLowerCase());
      if (ids.length > MAX_USAGE_JOBS) throw new Error("usage context job limit exceeded");
    }
  } finally {
    await directory.close().catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ERR_DIR_CLOSED") throw error;
    });
  }
  return ids.sort();
}

function casefold(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function usageHasContent(content: UsageContent): boolean {
  return content.savedReason.trim().length > 0 || content.links.length > 0;
}

export function usageMatches(content: UsageContent, query: string): boolean {
  const words = casefold(query).trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = casefold([
    content.savedReason,
    ...content.links.flatMap((link) => [link.ref, link.label ?? ""]),
  ].join("\n"));
  return words.every((word) => haystack.includes(word));
}
