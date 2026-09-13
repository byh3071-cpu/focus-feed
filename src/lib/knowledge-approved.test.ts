import { describe, expect, it } from "vitest";

import {
  approvedKnowledgeExcerpt,
  parseApprovedKnowledgeQuery,
  parseApprovedKnowledgeSnapshot,
  approvedKnowledgeMatches,
} from "./knowledge-approved";

const ID = "123e4567-e89b-42d3-a456-426614174000";

describe("approved knowledge boundary", () => {
  it("accepts a verified completed studio snapshot shape", () => {
    expect(parseApprovedKnowledgeSnapshot({
      id: ID,
      title: "검증된 문서",
      source_url: "https://youtu.be/abc_DEF-123",
      video_id: "abc_DEF-123",
      studio_draft: { markdown: "# 본문\n\n검색할 내용", revision: 2 },
      approved_at: "2026-09-11T01:00:00.000Z",
      approval_intent_hash: "a".repeat(64),
      result_approval_intent_hash: "a".repeat(64),
    })).toMatchObject({ id: ID, revision: 2, sourceUrl: "https://www.youtube.com/watch?v=abc_DEF-123" });
  });

  it("rejects seed revisions, missing approval time, and unsafe fallback video IDs", () => {
    const base = {
      id: ID, title: "문서", source_url: "javascript:alert(1)", video_id: "bad id",
      studio_draft: { markdown: "# 본문", revision: 0 },
      approved_at: "", approval_intent_hash: "a".repeat(64), result_approval_intent_hash: "a".repeat(64),
    };
    expect(parseApprovedKnowledgeSnapshot(base)).toBeNull();
  });

  it("treats keyword metacharacters as literal text", () => {
    const source = { title: "100% 실전", markdown: "밑줄_과 쉼표, 그대로" };
    expect(approvedKnowledgeMatches(source, "% 실전")).toBe(true);
    expect(approvedKnowledgeMatches(source, "줄_과 쉼표,")).toBe(true);
    expect(approvedKnowledgeMatches(source, "100.*실전")).toBe(false);
  });

  it("bounds query and id attachment input", () => {
    expect(parseApprovedKnowledgeQuery(new URLSearchParams())).toEqual({ mode: "search", query: "" });
    expect(parseApprovedKnowledgeQuery(new URLSearchParams(`q=${"가".repeat(121)}`))).toBeNull();
    expect(parseApprovedKnowledgeQuery(new URLSearchParams("ids=not-a-uuid"))).toBeNull();
    expect(parseApprovedKnowledgeQuery(new URLSearchParams(`ids=${ID},${ID},${ID},${ID}`))).toBeNull();
    expect(parseApprovedKnowledgeQuery(new URLSearchParams(`q=x&ids=${ID}`))).toBeNull();
    expect(parseApprovedKnowledgeQuery(new URLSearchParams(`ids=${ID.toUpperCase()}`))).toEqual({
      mode: "ids", ids: [ID],
    });
  });

  it("builds a short whitespace-normalized excerpt", () => {
    expect(approvedKnowledgeExcerpt("# 제목\n\n  첫 문장   둘째 문장 ")).toBe("# 제목 첫 문장 둘째 문장");
    expect(approvedKnowledgeExcerpt("가".repeat(281)).endsWith("…")).toBe(true);
  });
});
