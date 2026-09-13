import { describe, expect, it } from "vitest";
import { parseBrainApprovalStatus } from "./knowledge-brain-status";
const job = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const v = { id, revision: 2, approved: true, approvedAt: "2026-09-12T00:00:00Z", bodySha256: "a".repeat(64) };
const data = { jobId: job, ownerUserId: id, checkedAt: "2026-09-12T00:00:01Z", versions: [v] };
describe("Brain approval status boundary", () => {
  it("chooses latest approved candidate rather than latest unapproved candidate", () => {
    const parsed = parseBrainApprovalStatus({ ...data, versions: [v, { ...v, id: other, revision: 3, approved: false }], latestApproved: { revision: 99 } }, job, id);
    expect(parsed.latestApproved?.revision).toBe(2);
    expect(parsed).not.toHaveProperty("ownerUserId");
  });
  it("rejects wrong owner/job, duplicates, malformed digest and missing approval timestamp", () => {
    for (const invalid of [{ ...data, ownerUserId: other }, { ...data, jobId: other }, { ...data, versions: [v, v] }, { ...data, versions: [{ ...v, bodySha256: "bad" }] }, { ...data, versions: [{ ...v, approvedAt: null }] }]) expect(() => parseBrainApprovalStatus(invalid, job, id)).toThrow();
  });
  it("does not treat an empty successful query as disconnected", () => {
    expect(parseBrainApprovalStatus({ ...data, versions: [] }, job, id).latestApproved).toBeNull();
  });
});
