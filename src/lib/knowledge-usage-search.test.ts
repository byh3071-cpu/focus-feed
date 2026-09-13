import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveUsageContext } from "./knowledge-usage-context-store";
import { listUsageJobIds, MAX_USAGE_JOBS, usageHasContent, usageMatches } from "./knowledge-usage-search";

const USER_A = "123e4567-e89b-42d3-a456-426614174000";
const USER_B = "223e4567-e89b-42d3-a456-426614174000";
const JOB_A = "323e4567-e89b-42d3-a456-426614174000";
const JOB_B = "423e4567-e89b-42d3-a456-426614174000";
const VERSION = { kind: "original", revision: 1, amendmentId: null, bodySha256: "a".repeat(64) } as const;
const roots: string[] = [];

async function fixture() { const path = await mkdtemp(join(tmpdir(), "focus-usage-search-")); roots.push(path); return path; }
afterEach(async () => {
  for (const path of roots.splice(0)) {
    const target = resolve(path);
    if (dirname(target) !== resolve(tmpdir()) || !target.includes("focus-usage-search-")) throw new Error("unsafe fixture cleanup");
    await rm(target, { recursive: true, force: true });
  }
});

describe("usage job discovery", () => {
  it("returns empty for missing roots and owners, then isolates users", async () => {
    const root = await fixture();
    await expect(listUsageJobIds(join(root, "missing"), USER_A)).resolves.toEqual([]);
    await expect(listUsageJobIds(root, USER_A)).resolves.toEqual([]);
    await saveUsageContext(root, USER_A, JOB_B, VERSION, { savedReason: "b", links: [] }, 0);
    await saveUsageContext(root, USER_A, JOB_A, VERSION, { savedReason: "a", links: [] }, 0);
    await saveUsageContext(root, USER_B, JOB_B, VERSION, { savedReason: "other", links: [] }, 0);
    await expect(listUsageJobIds(root, USER_A)).resolves.toEqual([JOB_A, JOB_B]);
    await expect(listUsageJobIds(root, USER_B)).resolves.toEqual([JOB_B]);
  });

  it("rejects traversal, unknown owner entries, and linked job directories", async ({ skip }) => {
    const root = await fixture();
    await expect(listUsageJobIds("relative", USER_A)).rejects.toThrow("absolute");
    await expect(listUsageJobIds(root, "../owner")).rejects.toThrow("owner");
    await saveUsageContext(root, USER_A, JOB_A, VERSION, { savedReason: "a", links: [] }, 0);
    const owner = join(root, createHash("sha256").update(USER_A).digest("hex"));
    await mkdir(join(owner, "runtime-junk"));
    await expect(listUsageJobIds(root, USER_A)).rejects.toThrow("corrupted");
    await rm(join(owner, "runtime-junk"), { recursive: true });
    const outside = await fixture();
    try { await symlink(outside, join(owner, JOB_B), process.platform === "win32" ? "junction" : "dir"); } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { skip(); return; }
      throw error;
    }
    await expect(listUsageJobIds(root, USER_A)).rejects.toThrow("unsafe");
  });

  it("rejects linked owner directories and refuses partial over-limit results", async ({ skip }) => {
    const linkedRoot = await fixture();
    const outside = await fixture();
    const ownerSegment = createHash("sha256").update(USER_A).digest("hex");
    try { await symlink(outside, join(linkedRoot, ownerSegment), process.platform === "win32" ? "junction" : "dir"); } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { skip(); return; }
      throw error;
    }
    await expect(listUsageJobIds(linkedRoot, USER_A)).rejects.toThrow("unsafe");

    const boundedRoot = await fixture();
    await saveUsageContext(boundedRoot, USER_A, JOB_A, VERSION, { savedReason: "a", links: [] }, 0);
    const owner = join(boundedRoot, ownerSegment);
    await Promise.all(Array.from({ length: MAX_USAGE_JOBS }, (_, index) =>
      mkdir(join(owner, `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`))
    ));
    await expect(listUsageJobIds(boundedRoot, USER_A)).rejects.toThrow("limit exceeded");
  });
});

describe("usage content search", () => {
  const content = { savedReason: "다음 분기 Launch 계획", links: [{ kind: "project" as const, ref: "Focus Feed", label: "로드맵" }, { kind: "question" as const, ref: "What should ship next?" }] };

  it("matches every Unicode-casefolded word across reason and links", () => {
    expect(usageMatches(content, "ＦＯＣＵＳ 다음")).toBe(true);
    expect(usageMatches(content, "launch roadmap")).toBe(false);
    expect(usageMatches(content, "ship missing")).toBe(false);
    expect(usageMatches(content, "   ")).toBe(false);
  });

  it("treats cleared notes as empty while links still count", () => {
    expect(usageHasContent({ savedReason: " \n", links: [] })).toBe(false);
    expect(usageHasContent({ savedReason: "", links: [{ kind: "document", ref: "https://example.com" }] })).toBe(true);
  });
});
