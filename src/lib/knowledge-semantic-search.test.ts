import { describe, expect, it } from "vitest";
import { selectSemanticKnowledge, searchSemanticKnowledge } from "./knowledge-semantic-search";
import type { LatestApprovedKnowledgeSnapshot } from "./knowledge-latest-approved";

const source: LatestApprovedKnowledgeSnapshot = {
  id: "123e4567-e89b-42d3-a456-426614174000", title: "자료", sourceUrl: "https://youtube.com/watch?v=abc",
  revision: 2, baseRevision: 1, amendmentId: "223e4567-e89b-42d3-a456-426614174000", versionScope: "brain-verified",
  approvedAt: "2026-09-11T23:12:52.641Z", markdown: "# 승인 본문", approvalIntentHash: "a".repeat(64), resultApprovalIntentHash: "a".repeat(64),
};
const match = { jobId: source.id, revision: 2, baseRevision: 1, amendmentId: source.amendmentId, approvedAt: source.approvedAt };
describe("approved semantic search boundary", () => {
  it("uses verified server snapshots instead of returning subprocess content", () => {
    const result = selectSemanticKnowledge({ matches: [{ ...match, title: "untrusted", markdown: "untrusted", path: "/private" }], missingJobIds: [] }, [source]);
    expect(result.sources).toEqual([source]);
    expect(result.unindexedCount).toBe(0);
  });
  it.each([
    { ...match, jobId: "other-user" }, { ...match, revision: 1 }, { ...match, amendmentId: null },
    { ...match, baseRevision: 2 }, { ...match, approvedAt: "2026-09-12T00:00:00Z" },
  ])("rejects unauthorized or stale versions", (entry) => {
    expect(() => selectSemanticKnowledge({ matches: [entry], missingJobIds: [] }, [source])).toThrow();
  });
  it("rejects duplicate results and inconsistent coverage", () => {
    expect(() => selectSemanticKnowledge({ matches: [match, match], missingJobIds: [] }, [source])).toThrow();
    expect(() => selectSemanticKnowledge({ matches: [match], missingJobIds: [source.id] }, [source])).toThrow();
    expect(() => selectSemanticKnowledge({ matches: [], missingJobIds: ["other-user"] }, [source])).toThrow();
    expect(selectSemanticKnowledge({ matches: [], missingJobIds: [source.id] }, [source])).toEqual({ sources: [], unindexedCount: 1 });
  });
  it("does not fall back to unverified originals when local connection is absent", async () => {
    await expect(searchSemanticKnowledge({ query: "find", snapshots: [source] })).rejects.toThrow("자연어 검색");
    expect(() => selectSemanticKnowledge({ matches: [match], missingJobIds: [] }, [{ ...source, versionScope: "original-only" }])).toThrow();
  });
});
