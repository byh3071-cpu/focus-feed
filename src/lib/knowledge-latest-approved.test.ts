import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { ApprovedKnowledgeSnapshot } from "./knowledge-approved";
import { resolveLatestApprovedKnowledge } from "./knowledge-latest-approved";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_ID = "323e4567-e89b-42d3-a456-426614174002";
const AMENDMENT_ONE = "423e4567-e89b-42d3-a456-426614174003";
const AMENDMENT_TWO = "523e4567-e89b-42d3-a456-426614174004";
const BASE_HASH = "a".repeat(64);

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function snapshot(): ApprovedKnowledgeSnapshot {
  return {
    id: JOB_ID,
    title: "원본 제목",
    sourceUrl: "https://www.youtube.com/watch?v=abc_DEF-123",
    revision: 3,
    approvedAt: "2026-09-11T01:00:00.000Z",
    markdown: "# 원본",
    approvalIntentHash: BASE_HASH,
    resultApprovalIntentHash: BASE_HASH,
  };
}

function amendment(id: string, revision: number, markdown: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: OWNER_ID,
    job_id: JOB_ID,
    amendment_revision: revision,
    base_revision: 3,
    base_intent_hash: BASE_HASH,
    markdown,
    created_at: `2026-09-11T0${revision}:00:00.000Z`,
    ...overrides,
  };
}

function amendmentClient(rows: unknown[]) {
  const table = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), limit: vi.fn() };
  let inColumn = "";
  let inValues: string[] = [];
  table.select.mockReturnValue(table);
  table.eq.mockReturnValue(table);
  table.in.mockImplementation((column: string, values: string[]) => {
    inColumn = column;
    inValues = values;
    return table;
  });
  table.limit.mockImplementation(async () => ({
    data: rows.filter((value) => {
      const row = value as Record<string, unknown>;
      return inColumn === "job_id" ? inValues.includes(String(row.job_id)) : inValues.includes(String(row.id));
    }),
    error: null,
    count: inColumn === "job_id" ? rows.filter((value) => inValues.includes(String((value as Record<string, unknown>).job_id))).length : undefined,
  }));
  return { client: { from: vi.fn(() => table) }, table };
}

describe("resolveLatestApprovedKnowledge", () => {
  it("uses the newest approved amendment while ignoring a newer unapproved candidate", async () => {
    const approvedBody = "# 최신 승인본";
    const newerBody = "# 미승인 최신 후보";
    const { client, table } = amendmentClient([
      amendment(AMENDMENT_TWO, 2, newerBody),
      amendment(AMENDMENT_ONE, 1, approvedBody),
    ]);
    const readStatus = vi.fn().mockResolvedValue({
      jobId: JOB_ID,
      checkedAt: "2026-09-11T04:00:00.000Z",
      versions: [
        { id: AMENDMENT_TWO, revision: 2, approved: false, bodySha256: sha256(newerBody) },
        { id: AMENDMENT_ONE, revision: 1, approved: true, approvedAt: "2026-09-11T03:00:00.000Z", bodySha256: sha256(approvedBody) },
      ],
      latestApproved: { id: AMENDMENT_ONE, revision: 1, approved: true, approvedAt: "2026-09-11T03:00:00.000Z", bodySha256: sha256(approvedBody) },
    });

    const [resolved] = await resolveLatestApprovedKnowledge({ snapshots: [snapshot()], userId: OWNER_ID, brainRoot: "C:\\brain", supabase: client, readStatus });

    expect(resolved).toMatchObject({
      id: JOB_ID,
      markdown: approvedBody,
      revision: 1,
      amendmentId: AMENDMENT_ONE,
      baseRevision: 3,
      approvedAt: "2026-09-11T03:00:00.000Z",
      versionScope: "brain-verified",
    });
    expect(table.select.mock.calls[0][0]).not.toContain("markdown");
    expect(table.select.mock.calls[1][0]).toContain("markdown");
    expect(table.in).toHaveBeenCalledWith("id", [AMENDMENT_ONE]);
  });

  it.each([
    ["owner", { user_id: "623e4567-e89b-42d3-a456-426614174005" }],
    ["base revision", { base_revision: 2 }],
    ["base hash", { base_intent_hash: "b".repeat(64) }],
  ])("rejects a candidate with a mismatched %s", async (_name, overrides) => {
    const body = "# 수정안";
    const { client } = amendmentClient([amendment(AMENDMENT_ONE, 1, body, overrides)]);
    const readStatus = vi.fn().mockResolvedValue({
      jobId: JOB_ID,
      checkedAt: "2026-09-11T04:00:00.000Z",
      versions: [{ id: AMENDMENT_ONE, revision: 1, approved: true, approvedAt: "2026-09-11T03:00:00.000Z", bodySha256: sha256(body) }],
      latestApproved: { id: AMENDMENT_ONE, revision: 1, approved: true, approvedAt: "2026-09-11T03:00:00.000Z", bodySha256: sha256(body) },
    });

    await expect(resolveLatestApprovedKnowledge({ snapshots: [snapshot()], userId: OWNER_ID, brainRoot: "C:\\brain", supabase: client, readStatus })).rejects.toThrow("unavailable");
  });

  it("rejects an amendment whose body does not match the approved receipt", async () => {
    const { client } = amendmentClient([amendment(AMENDMENT_ONE, 1, "# 변조된 수정안")]);
    const readStatus = vi.fn().mockResolvedValue({
      jobId: JOB_ID,
      checkedAt: "2026-09-11T04:00:00.000Z",
      versions: [{ id: AMENDMENT_ONE, revision: 1, approved: true, approvedAt: "2026-09-11T03:00:00.000Z", bodySha256: sha256("# 승인된 원문") }],
      latestApproved: { id: AMENDMENT_ONE, revision: 1, approved: true, approvedAt: "2026-09-11T03:00:00.000Z", bodySha256: sha256("# 승인된 원문") },
    });

    await expect(resolveLatestApprovedKnowledge({ snapshots: [snapshot()], userId: OWNER_ID, brainRoot: "C:\\brain", supabase: client, readStatus })).rejects.toThrow("unavailable");
  });

  it("labels original snapshots explicitly and skips amendment access without a Brain root", async () => {
    const { client } = amendmentClient([]);
    const readStatus = vi.fn();

    const [resolved] = await resolveLatestApprovedKnowledge({ snapshots: [snapshot()], userId: OWNER_ID, brainRoot: undefined, supabase: client, readStatus });

    expect(resolved).toMatchObject({ markdown: "# 원본", revision: 3, versionScope: "original-only" });
    expect(client.from).not.toHaveBeenCalled();
    expect(readStatus).not.toHaveBeenCalled();
  });

  it("fails the request after the verification time budget instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const { client } = amendmentClient([amendment(AMENDMENT_ONE, 1, "# 수정안")]);
      const pending = resolveLatestApprovedKnowledge({
        snapshots: [snapshot()],
        userId: OWNER_ID,
        brainRoot: "C:\\brain",
        supabase: client,
        readStatus: () => new Promise(() => undefined),
      });
      const rejection = expect(pending).rejects.toThrow("unavailable");

      await vi.advanceTimersByTimeAsync(45_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start another Brain check after one parallel check fails", async () => {
    const jobIds = Array.from({ length: 5 }, (_, index) => `${index + 1}23e4567-e89b-42d3-a456-42661417400${index}`);
    const amendmentIds = Array.from({ length: 5 }, (_, index) => `${index + 1}33e4567-e89b-42d3-a456-42661417401${index}`);
    const snapshots = jobIds.map((id) => ({ ...snapshot(), id }));
    const rows = jobIds.map((jobId, index) => ({
      ...amendment(amendmentIds[index], 1, `# 수정안 ${index}`),
      job_id: jobId,
    }));
    const { client } = amendmentClient(rows);
    const gates: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
    const readStatus = vi.fn((jobId: string) => new Promise((resolve, reject) => {
      gates.push({ resolve, reject });
    }).then(() => ({ jobId, checkedAt: "2026-09-11T04:00:00.000Z", versions: [], latestApproved: null })));
    const pending = resolveLatestApprovedKnowledge({ snapshots, userId: OWNER_ID, brainRoot: "C:\\brain", supabase: client, readStatus });
    const rejection = expect(pending).rejects.toThrow("unavailable");
    await vi.waitFor(() => expect(gates).toHaveLength(4));

    gates[0].reject(new Error("Brain failed"));
    gates.slice(1).forEach((gate) => gate.resolve(undefined));
    await rejection;
    await Promise.resolve();

    expect(readStatus).toHaveBeenCalledTimes(4);
  });
});
