import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUsageContext, saveUsageContext, UsageContextConflictError } from "./knowledge-usage-context-store";

const USER_A = "123e4567-e89b-42d3-a456-426614174000";
const USER_B = "223e4567-e89b-42d3-a456-426614174000";
const JOB = "323e4567-e89b-42d3-a456-426614174000";
const ORIGINAL = { kind: "original", revision: 1, amendmentId: null, bodySha256: "a".repeat(64) } as const;
const AMENDMENT = { kind: "amendment", revision: 1, amendmentId: "423e4567-e89b-42d3-a456-426614174000", bodySha256: "b".repeat(64) } as const;
const roots: string[] = [];

async function root() { const path = await mkdtemp(join(tmpdir(), "focus-usage-context-")); roots.push(path); return path; }
afterEach(async () => {
  for (const path of roots.splice(0)) {
    const target = resolve(path); const parent = resolve(tmpdir());
    if (!target.startsWith(parent + "\\") || !target.includes("focus-usage-context-")) throw new Error("unsafe fixture cleanup");
    await rm(target, { recursive: true, force: true });
  }
});

describe("local knowledge usage context store", () => {
  it("returns revision zero then persists immutable revisions", async () => {
    const path = await root();
    await expect(readUsageContext(path, USER_A, JOB, ORIGINAL)).resolves.toEqual({ revision: 0, updatedAt: null, savedReason: "", links: [] });
    const first = await saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "use for planning", links: [{ kind: "question", ref: "What next?" }] }, 0);
    expect(first.revision).toBe(1);
    await expect(readUsageContext(path, USER_A, JOB, ORIGINAL)).resolves.toEqual(first);
    const second = await saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "updated", links: [] }, 1);
    expect(second.revision).toBe(2);
    expect((await readUsageContext(path, USER_A, JOB, ORIGINAL)).savedReason).toBe("updated");
  });

  it("isolates owners and immutable approved versions", async () => {
    const path = await root();
    await saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "owner A original", links: [] }, 0);
    await saveUsageContext(path, USER_B, JOB, ORIGINAL, { savedReason: "owner B original", links: [] }, 0);
    await saveUsageContext(path, USER_A, JOB, AMENDMENT, { savedReason: "owner A amendment", links: [] }, 0);
    expect((await readUsageContext(path, USER_A, JOB, ORIGINAL)).savedReason).toBe("owner A original");
    expect((await readUsageContext(path, USER_B, JOB, ORIGINAL)).savedReason).toBe("owner B original");
    expect((await readUsageContext(path, USER_A, JOB, AMENDMENT)).savedReason).toBe("owner A amendment");
  });

  it("allows only one concurrent writer for the same expected revision", async () => {
    const path = await root();
    const settled = await Promise.allSettled([
      saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "one", links: [] }, 0),
      saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "two", links: [] }, 0),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected");
    expect(rejected && rejected.status === "rejected" && rejected.reason).toBeInstanceOf(UsageContextConflictError);
  });

  it("fails closed on corrupt latest records", async () => {
    const path = await root();
    await saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "valid", links: [] }, 0);
    const entries = await readdir(path, { recursive: true });
    const record = entries.find((entry) => entry.endsWith("1.json"));
    expect(record).toBeTruthy();
    await writeFile(join(path, record!), "{broken", "utf8");
    await expect(readUsageContext(path, USER_A, JOB, ORIGINAL)).rejects.toThrow("corrupted");
    await expect(saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "must not cover corruption", links: [] }, 1)).rejects.toThrow("corrupted");
  });

  it("rejects symlinked owner paths", async () => {
    const path = await root();
    const outside = await root();
    const ownerSegment = createHash("sha256").update(USER_A.toLowerCase()).digest("hex");
    await mkdir(join(outside, "target"));
    await symlink(join(outside, "target"), join(path, ownerSegment), process.platform === "win32" ? "junction" : "dir");
    await expect(saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "escape", links: [] }, 0)).rejects.toThrow("unsafe");

  });

  it("rejects symlinked record files", async ({ skip }) => {
    const outside = await root();
    const safeRoot = await root();
    await saveUsageContext(safeRoot, USER_A, JOB, ORIGINAL, { savedReason: "valid", links: [] }, 0);
    const entries = await readdir(safeRoot, { recursive: true });
    const record = entries.find((entry) => entry.endsWith("1.json"));
    expect(record).toBeTruthy();
    const recordPath = join(safeRoot, record!);
    const externalRecord = join(outside, "record.json");
    await writeFile(externalRecord, JSON.stringify({ revision: 1, updatedAt: new Date().toISOString(), savedReason: "foreign", links: [] }));
    await unlink(recordPath);
    try { await symlink(externalRecord, recordPath, "file"); } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { skip(); return; }
      throw error;
    }
    await expect(readUsageContext(safeRoot, USER_A, JOB, ORIGINAL)).rejects.toThrow("corrupted");
  });

  it("rejects relative roots, invalid identities, stale CAS, and unsafe content", async () => {
    const path = await root();
    await expect(readUsageContext("relative", USER_A, JOB, ORIGINAL)).rejects.toThrow("absolute");
    await expect(readUsageContext(path, "../owner", JOB, ORIGINAL)).rejects.toThrow("identity");
    await saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "ok", links: [] }, 0);
    await expect(saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "stale", links: [] }, 0)).rejects.toBeInstanceOf(UsageContextConflictError);
    await expect(saveUsageContext(path, USER_A, JOB, ORIGINAL, { savedReason: "bad\u0001", links: [] }, 1)).rejects.toThrow("content");
  });
});
