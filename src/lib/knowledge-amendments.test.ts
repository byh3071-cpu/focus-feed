import { describe, expect, it } from "vitest";
import { amendmentApprovalRequest, amendmentChangedRange, MAX_AMENDMENT_CHARS, parseAmendmentInput } from "./knowledge-amendments";

describe("amendment boundaries", () => {
  it("pins approval to a saved candidate and rejects command injection", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const version = { id, revision: 2, baseRevision: 1, createdAt: "2026-09-12T00:00:00Z" };
    expect(amendmentApprovalRequest(id, version)).toContain(`--job ${id} --amendment ${id} --revision 2 --approve`);
    expect(amendmentApprovalRequest(`${id}; whoami`, version)).toBeNull();
    expect(amendmentApprovalRequest(id, { ...version, id: "$(whoami)" })).toBeNull();
    expect(amendmentApprovalRequest(id, { ...version, revision: NaN })).toBeNull();
  });
  const input = { markdown: "  원문\n", expectedRevision: 0, baseRevision: 1 };
  it("preserves exact text for version comparisons", () => {
    expect(parseAmendmentInput(input)).toEqual(input);
  });
  it("rejects privileged fields and malformed revision counters", () => {
    expect(parseAmendmentInput({ ...input, user_id: "another-owner" })).toBeNull();
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(parseAmendmentInput({ ...input, expectedRevision: revision })).toBeNull();
    }
    expect(parseAmendmentInput({ ...input, baseRevision: 0 })).toBeNull();
  });
  it("enforces blank and size limits", () => {
    expect(parseAmendmentInput({ ...input, markdown: " \n\t" })).toBeNull();
    expect(parseAmendmentInput({ ...input, markdown: "a".repeat(MAX_AMENDMENT_CHARS) })).not.toBeNull();
    expect(parseAmendmentInput({ ...input, markdown: "a".repeat(MAX_AMENDMENT_CHARS + 1) })).toBeNull();
  });
  it("isolates inserted and removed lines while preserving shared context", () => {
    expect(amendmentChangedRange("a\nc", "a\nb\nc")).toEqual({ changed: true, startLine: 2, before: "", after: "b" });
    expect(amendmentChangedRange("a\nb\nc", "a\nc")).toEqual({ changed: true, startLine: 2, before: "b", after: "" });
  });
  it("distinguishes equality from trailing newline changes", () => {
    expect(amendmentChangedRange("a", "a").changed).toBe(false);
    expect(amendmentChangedRange("a", "a\n").changed).toBe(true);
  });
});
