import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isUsageContextUuid, parseUsageContent, parseUsageContextRecord, parseUsageVersion, type UsageContextRecord } from "./knowledge-usage-context";

export class UsageContextConflictError extends Error {
  readonly status = 409;
  constructor() { super("usage context revision conflict"); this.name = "UsageContextConflictError"; }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

async function contextDirectory(root: string, userId: string, jobId: string, versionInput: unknown, create: boolean) {
  if (!isAbsolute(root) || /[\u0000-\u001f\u007f]/.test(root)) throw new Error("usage context root must be absolute");
  if (!isUsageContextUuid(userId) || !isUsageContextUuid(jobId)) throw new Error("invalid usage context identity");
  const version = parseUsageVersion(versionInput);
  const rootPath = resolve(root);
  if (create) await mkdir(rootPath, { recursive: true });
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(rootPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return null;
    throw error;
  }
  const versionKey = JSON.stringify([version.kind, version.revision, version.amendmentId, version.bodySha256]);
  const segments = [hash(userId.toLowerCase()), jobId.toLowerCase(), hash(versionKey)];
  let directory = canonicalRoot;
  for (const segment of segments) {
    directory = join(directory, segment);
    let info;
    try { info = await lstat(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return null;
      try { await mkdir(directory); } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      }
      info = await lstat(directory);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("usage context path component is unsafe");
    const canonicalDirectory = await realpath(directory);
    const rel = relative(canonicalRoot, canonicalDirectory);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("usage context path escaped root");
    directory = canonicalDirectory;
  }
  return directory;
}

async function revisions(directory: string | null): Promise<number[]> {
  if (!directory) return [];
  let names: string[];
  try { names = await readdir(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.flatMap((name) => /^([1-9]\d*)\.json$/.test(name) ? [Number(name.slice(0, -5))] : [])
    .filter(Number.isSafeInteger).sort((a, b) => a - b);
}

export async function readUsageContext(root: string, userId: string, jobId: string, version: unknown): Promise<UsageContextRecord> {
  const directory = await contextDirectory(root, userId, jobId, version, false);
  return readLatestRecord(directory);
}

async function readLatestRecord(directory: string | null): Promise<UsageContextRecord> {
  const found = await revisions(directory);
  if (!directory || found.length === 0) return { revision: 0, updatedAt: null, savedReason: "", links: [] };
  const latest = found.at(-1)!;
  const path = join(directory, `${latest}.json`);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 32_768) throw new Error("usage context record is corrupted");
  const bytes = await readFile(path);
  if (bytes.byteLength > 32_768) throw new Error("usage context record is corrupted");
  const raw = bytes.toString("utf8");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("usage context record is corrupted"); }
  let parsed: UsageContextRecord;
  try { parsed = parseUsageContextRecord(value); } catch { throw new Error("usage context record is corrupted"); }
  if (parsed.revision !== latest) throw new Error("usage context record is corrupted");
  return parsed;
}

export async function saveUsageContext(root: string, userId: string, jobId: string, version: unknown, contentInput: unknown, expectedRevision: number): Promise<UsageContextRecord> {
  const content = parseUsageContent(contentInput);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("invalid expected revision");
  const directory = await contextDirectory(root, userId, jobId, version, true);
  if (!directory) throw new Error("usage context directory unavailable");
  const current = await readLatestRecord(directory);
  if (current.revision !== expectedRevision) throw new UsageContextConflictError();
  const record: UsageContextRecord = { revision: expectedRevision + 1, updatedAt: new Date().toISOString(), ...content };
  const temporary = join(directory, `.${record.revision}.${process.pid}.${randomUUID()}.tmp`);
  const destination = join(directory, `${record.revision}.json`);
  try {
    await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    try { await link(temporary, destination); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new UsageContextConflictError();
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return record;
}
