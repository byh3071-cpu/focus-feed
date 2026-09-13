import { describe, expect, it } from "vitest";
import { parseUsageContent, parseUsageVersion } from "./knowledge-usage-context";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const SHA = "a".repeat(64);

describe("knowledge usage context contract", () => {
  it("accepts exact bounded values", () => {
    expect(parseUsageVersion({ kind: "amendment", revision: 2, amendmentId: ID, bodySha256: SHA })).toEqual({ kind: "amendment", revision: 2, amendmentId: ID, bodySha256: SHA });
    expect(parseUsageContent({ savedReason: "why\r\nnext", links: [{ kind: "project", ref: "Focus", label: "Now" }, { kind: "document", ref: "https://example.com/doc" }] })).toMatchObject({ savedReason: "why\r\nnext", links: expect.any(Array) });
  });

  it("rejects unknown, inconsistent, unsafe, control, and oversized input", () => {
    expect(() => parseUsageVersion({ kind: "original", revision: 1, amendmentId: ID, bodySha256: SHA })).toThrow();
    expect(() => parseUsageVersion({ kind: "original", revision: 1, amendmentId: null, bodySha256: SHA, extra: true })).toThrow();
    for (const ref of ["javascript:alert(1)", "file:///private", "https://user:pass@example.com", "https://example.com/a\nnext"]) {
      expect(() => parseUsageContent({ savedReason: "", links: [{ kind: "document", ref }] })).toThrow();
    }
    expect(() => parseUsageContent({ savedReason: "x".repeat(2001), links: [] })).toThrow();
    expect(() => parseUsageContent({ savedReason: "", links: Array.from({ length: 9 }, () => ({ kind: "question", ref: "q" })) })).toThrow();
    expect(() => parseUsageContent({ savedReason: "bad\u0001", links: [] })).toThrow();
    expect(() => parseUsageContent({ savedReason: "", links: [{ kind: "project", ref: " x " }] })).toThrow();
  });
});
