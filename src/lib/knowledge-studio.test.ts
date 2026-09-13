import { describe, expect, it } from "vitest";
import {
  CLAIM_TYPE_LABELS,
  studioParagraphSelections,
  resolveStudioParagraphReply,
  replaceStudioParagraph,
  MAX_STUDIO_CHAT_MESSAGE_CHARS,
  MAX_STUDIO_MARKDOWN_CHARS,
  applyStudioDraftPatch,
  addDeferredJobId,
  parseDeferredJobIds,
  planStudioApproval,
  studioApprovalIntentHash,
  buildStudioAgentPrompt,
  buildStudioChatPrompt,
  parseStudioChatMessage,
  parseStudioChatReply,
  resolveStudioChatDraft,
  studioChatWantsDraftApply,
  parseStudioDraft,
  resolveStudioDraft,
  seedKnowledgeStudioMarkdown,
  studioChatEvidenceLines,
  studioDraftFromResult,
  studioMarkdownPreviewBlocks,
  summarizeStudioDraftChange,
} from "./knowledge-studio";
import type { KnowledgeReviewDetail } from "./knowledge-capture";

it("중복 문단과 CRLF에서도 실제 원문 범위를 선택한다", () => {
  const markdown = "# 같은 문단\r\n\r\n같은 문단\r\n\r\n  같은 문단  \r\n";
  const selections = studioParagraphSelections(markdown, 3);
  expect(selections).toHaveLength(2);
  expect(replaceStudioParagraph(markdown, 3, selections[1], "수정된 둘째 문단"))
    .toBe("# 같은 문단\r\n\r\n같은 문단\r\n\r\n  수정된 둘째 문단  \r\n");
});

it("문단 수정 프롬프트는 전체 문서 출력 지시와 충돌하지 않는다", () => {
  const prompt = buildStudioAgentPrompt({scope:"paragraph",markdown:"선택 문단",message:"다듬어줘",sourceGuide:"",evidenceLines:[]});
  expect(prompt).toContain("대체 문단 하나만");
  expect(prompt).not.toContain("완성된 Markdown 전체");
});

const review = (overrides: Partial<KnowledgeReviewDetail> = {}): KnowledgeReviewDetail => ({
  formatVersion: 1,
  summary: "한 줄 요약입니다.",
  keyPoints: ["핵심 하나", "핵심 둘"],
  claims: [{
    type: "fact",
    statement: "타임스탬프로 확인할 사실",
    citation: "[00:51]",
    citationVerified: true,
    requiresCrosscheck: false,
    evidenceExcerpt: "짧은 원문",
  }],
  coverage: [],
  uncertainties: [],
  category: "YT · 미분류 · Inbox",
  qualityWarnings: [],
  ecosystemApplications: [],
  evidenceMap: [],
  ...overrides,
});

describe("seedKnowledgeStudioMarkdown", () => {
  it("제목·요약·핵심·주장을 마크다운으로 시드한다", () => {
    const markdown = seedKnowledgeStudioMarkdown("영상 제목", review());
    expect(markdown).toContain("# 영상 제목");
    expect(markdown).toContain("한 줄 요약입니다.");
    expect(markdown).toContain("## 핵심");
    expect(markdown).toContain("- 핵심 하나");
    expect(markdown).toContain("## 주장");
    expect(markdown).toContain(`- (${CLAIM_TYPE_LABELS.fact}) 타임스탬프로 확인할 사실`);
  });

  it("빈 핵심·주장은 해당 절을 생략한다", () => {
    const markdown = seedKnowledgeStudioMarkdown("제목", review({ keyPoints: [], claims: [] }));
    expect(markdown).not.toContain("## 핵심");
    expect(markdown).not.toContain("## 주장");
  });
});

describe("parseStudioDraft", () => {
  it("허용된 초안만 읽고 내부 경로는 버린다", () => {
    const draft = parseStudioDraft({
      markdown: "# 초안",
      revision: 2,
      updatedAt: "2026-09-04T00:00:00.000Z",
      review_path: "C:/secret.json",
    });
    expect(draft).toEqual({
      markdown: "# 초안",
      revision: 2,
      updatedAt: "2026-09-04T00:00:00.000Z",
    });
    expect(JSON.stringify(draft)).not.toContain("C:/secret");
  });

  it("비정상 revision·빈 본문은 거부한다", () => {
    expect(parseStudioDraft({ markdown: "", revision: 1, updatedAt: "2026-09-04T00:00:00.000Z" })).toBeUndefined();
    expect(parseStudioDraft({ markdown: "# x", revision: 0, updatedAt: "2026-09-04T00:00:00.000Z" })).toBeUndefined();
    expect(parseStudioDraft({ markdown: "x".repeat(MAX_STUDIO_MARKDOWN_CHARS + 1), revision: 1, updatedAt: "2026-09-04T00:00:00.000Z" })).toBeUndefined();
  });
});

describe("studioDraftFromResult", () => {
  it("result.studio_draft만 꺼낸다", () => {
    const draft = studioDraftFromResult({
      studio_draft: { markdown: "# 저장본", revision: 3, updatedAt: "2026-09-04T01:00:00.000Z" },
      source_hash: "private-hash",
    });
    expect(draft?.markdown).toBe("# 저장본");
    expect(draft?.revision).toBe(3);
    expect(JSON.stringify(draft)).not.toContain("private-hash");
  });
});

describe("resolveStudioDraft", () => {
  it("저장된 초안이 없으면 시드하고 revision 0으로 둔다", () => {
    const view = resolveStudioDraft({
      result: { draft: { summary: "x" }, source_hash: "private-hash" },
      title: "영상 제목",
      review: review(),
    });
    expect(view.seeded).toBe(true);
    expect(view.revision).toBe(0);
    expect(view.updatedAt).toBeNull();
    expect(view.markdown).toContain("# 영상 제목");
    expect(JSON.stringify(view)).not.toContain("private-hash");
  });
});

describe("applyStudioDraftPatch", () => {
  it("기존 draft를 지우고 studio_draft만 올리지 않는다", () => {
    const applied = applyStudioDraftPatch({
      result: {
        draft: { summary: "worker 초안" },
        source_hash: "private-hash",
      },
      markdown: "# 고친 초안",
      expectedRevision: 0,
      now: new Date("2026-09-04T02:00:00.000Z"),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.draft.revision).toBe(1);
    expect(applied.result.draft).toEqual({ summary: "worker 초안" });
    expect(applied.result.studio_draft).toEqual(applied.draft);
    expect(applied.result.source_hash).toBe("private-hash");
  });

  it("revision이 다르면 충돌로 거부한다", () => {
    const applied = applyStudioDraftPatch({
      result: {
        studio_draft: { markdown: "# 저장본", revision: 2, updatedAt: "2026-09-04T01:00:00.000Z" },
      },
      markdown: "# 다른 탭",
      expectedRevision: 1,
    });
    expect(applied).toEqual({ ok: false, code: "conflict" });
  });
});

describe("planStudioApproval", () => {
  it("저장된 초안이 같으면 persist하지 않는다", () => {
    const stored = { markdown: "# 저장본", revision: 2, updatedAt: "2026-09-04T01:00:00.000Z" };
    const planned = planStudioApproval({
      result: { studio_draft: stored },
      markdown: "# 저장본",
      expectedRevision: 2,
    });
    expect(planned).toEqual({ ok: true, persist: false, draft: stored });
  });

  it("시드(revision 0)는 승인 전에 studio_draft로 저장한다", () => {
    const planned = planStudioApproval({
      result: { draft: { summary: "worker" } },
      markdown: "# 시드",
      expectedRevision: 0,
      now: new Date("2026-09-04T03:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok || !planned.persist) return;
    expect(planned.draft.revision).toBe(1);
    expect(planned.result.studio_draft).toEqual(planned.draft);
    expect(planned.result.draft).toEqual({ summary: "worker" });
  });
});

describe("studioApprovalIntentHash", () => {
  it("같은 초안은 64자 hex가 같고 본문이 바뀌면 달라진다", async () => {
    const a = await studioApprovalIntentHash("123e4567-e89b-42d3-a456-426614174000", 1, "# 초안\n");
    const b = await studioApprovalIntentHash("123e4567-e89b-42d3-a456-426614174000", 1, "# 초안\n");
    const c = await studioApprovalIntentHash("123e4567-e89b-42d3-a456-426614174000", 1, "# 다른 초안\n");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("deferred job ids", () => {
  it("UUID만 남기고 잘못된 값은 버린다", () => {
    expect(parseDeferredJobIds(`["123e4567-e89b-42d3-a456-426614174000","nope"]`)).toEqual([
      "123e4567-e89b-42d3-a456-426614174000",
    ]);
    expect(addDeferredJobId([], "123e4567-e89b-42d3-a456-426614174000")).toEqual([
      "123e4567-e89b-42d3-a456-426614174000",
    ]);
    expect(addDeferredJobId(["123e4567-e89b-42d3-a456-426614174000"], "not-id")).toEqual([
      "123e4567-e89b-42d3-a456-426614174000",
    ]);
  });
});

describe("studioMarkdownPreviewBlocks", () => {
  it("제목·목록·문단만 블록으로 나눈다", () => {
    expect(studioMarkdownPreviewBlocks("# 제목\n\n한 줄\n\n## 핵심\n- 하나\n- 둘")).toEqual([
      { type: "h1", text: "제목" },
      { type: "p", text: "한 줄" },
      { type: "h2", text: "핵심" },
      { type: "ul", items: ["하나", "둘"] },
    ]);
  });
});

describe("parseStudioChatMessage", () => {
  it("공백·길이 밖 메시지는 거부한다", () => {
    expect(parseStudioChatMessage(" ")).toBeUndefined();
    expect(parseStudioChatMessage("짧")).toBeUndefined();
    expect(parseStudioChatMessage("더 짧게")).toBe("더 짧게");
    expect(parseStudioChatMessage("x".repeat(MAX_STUDIO_CHAT_MESSAGE_CHARS + 1))).toBeUndefined();
  });
});

describe("parseStudioChatReply", () => {
  it("```markdown 펜스 안의 초안만 받는다", () => {
    expect(parseStudioChatReply("```markdown\n# 짧은 초안\n\n한 줄\n```")).toBe("# 짧은 초안\n\n한 줄\n");
    expect(parseStudioChatReply("# 바로 본문\n\n- 항목")).toBeUndefined();
    expect(parseStudioChatReply("ㅎㅇ. 초안 보고 있어.\n\n- 주장 여섯 개")).toBeUndefined();
    expect(parseStudioChatReply("죄송합니다. 도와드릴 수 없습니다.")).toBeUndefined();
  });
});

describe("resolveStudioChatDraft", () => {
  it("인사만으로는 초안을 덮지 않는다", () => {
    expect(studioChatWantsDraftApply("ㅎㅇ")).toBe(false);
    expect(studioChatWantsDraftApply("안녕하세요")).toBe(false);
    expect(studioChatWantsDraftApply("초안 어때")).toBe(false);
    expect(studioChatWantsDraftApply("정리해줘")).toBe(true);
    expect(studioChatWantsDraftApply("더 짧게")).toBe(true);
    expect(resolveStudioChatDraft(
      "ㅎㅇ",
      "```markdown\n# 덮이면 안 됨\n\n- 항목\n```",
    )).toBeUndefined();
    expect(resolveStudioChatDraft(
      "더 짧게",
      "```markdown\n# 짧은 초안\n\n한 줄\n```",
    )).toBe("# 짧은 초안\n\n한 줄\n");
  });
});

describe("studio chat prompt", () => {
  it("근거 줄은 검증된 짧은 발췌만 넣고 프롬프트에 해시를 넣지 않는다", () => {
    const lines = studioChatEvidenceLines(review({
      claims: [
        {
          type: "fact",
          statement: "확인된 사실",
          citation: "[00:51]",
          citationVerified: true,
          requiresCrosscheck: false,
          evidenceExcerpt: "짧은 원문",
        },
        {
          type: "interpretation",
          statement: "검증 안 된 해석",
          citationVerified: false,
          requiresCrosscheck: true,
        },
      ],
    }));
    expect(lines).toEqual(['[00:51] (사실) 확인된 사실 — "짧은 원문"']);
    const prompt = buildStudioChatPrompt({
      markdown: "# 초안\n",
      message: "더 짧게",
      sourceGuide: "## YouTube 소스 가이드",
      evidenceLines: lines,
    });
    expect(prompt).toContain("# 초안");
    expect(prompt).toContain("더 짧게");
    expect(prompt).toContain("짧은 원문");
    expect(prompt).not.toContain("source_hash");
    expect(prompt).not.toContain("transcript");
  });
});

describe.each([
  ["편집", buildStudioChatPrompt],
  ["대화", buildStudioAgentPrompt],
] as const)("%s 근거의 검증 범위", (_name, buildPrompt) => {
  it("원래 자동 주장과 수정 본문이 충돌해도 의미 검증으로 승격하지 않는다", () => {
    const prompt = buildPrompt({
      markdown: "# 검토한 본문\n50% 절감이라는 수치는 확인되지 않았다.",
      message: "시간이 얼마나 절약됐어?",
      sourceGuide: "",
      evidenceLines: ['[00:51] (사실) 50% 절감 — "업무가 편해졌다"'],
    });
    expect(prompt).toContain("50% 절감이라는 수치는 확인되지 않았다.");
    expect(prompt).toContain("시간 위치 확인은 주장·발췌의 의미 일치나 외부 사실의 정확성을 보장하지 않는다");
    expect(prompt).toContain("이전 주장을 현재 본문의 검증 결과로 취급하지 않는다");
    expect(prompt).toContain("서로 충돌하거나 뒷받침할 원문이 없으면 확인되지 않았다고 밝힌다");
    expect(prompt).not.toContain("## 검증된 짧은 근거");
  });

  it("근거 후보가 없으면 부재를 명시한다", () => {
    const prompt = buildPrompt({ markdown: "# 문서", message: "근거는?", sourceGuide: "", evidenceLines: [] });
    expect(prompt).toContain("(시간 위치가 확인된 근거 후보 없음)");
  });
});

describe("studio agent prompt", () => {
  it("대화와 펜스 초안을 허용하고 해시는 넣지 않는다", () => {
    const prompt = buildStudioAgentPrompt({
      markdown: "# 초안\n",
      message: "제목만 짧게",
      sourceGuide: "## YouTube 소스 가이드",
      evidenceLines: ['[00:51] (사실) 확인된 사실'],
    });
    expect(prompt).toContain("```markdown");
    expect(prompt).toContain("제목만 짧게");
    expect(prompt).toContain("확인된 사실");
    expect(prompt).toContain("Cursor");
    expect(prompt).not.toContain("source_hash");
  });
});

describe("summarizeStudioDraftChange", () => {
  it("제목·절·줄 수 차이를 한 줄로 말한다", () => {
    expect(summarizeStudioDraftChange("# 같은\n\n본문", "# 같은\n\n본문")).toBe("같은 초안");
    expect(summarizeStudioDraftChange(
      "# 옛 제목\n\n본문",
      "# 새 제목\n\n본문\n\n## 주장\n\n- 한 줄",
    )).toBe("제목: 옛 제목 → 새 제목 · 절 추가: 주장 · +4줄");
    expect(summarizeStudioDraftChange("# 제목\n\n옛 문장", "# 제목\n\n새 문장")).toBe("문장만 고침");
  });
});


describe("선택 문단 수정", () => {
  it("수정 요청과 명시적인 펜스가 있을 때만 일반 문단을 후보로 받는다", () => {
    expect(resolveStudioParagraphReply("이 문단을 다듬어줘", "이유 한 줄\n```markdown\n더 명확한 문장입니다.\n```" )).toBe("더 명확한 문장입니다.");
    expect(resolveStudioParagraphReply("안녕", "```markdown\n바뀐 문장\n```" )).toBeUndefined();
    expect(resolveStudioParagraphReply("다듬어줘", "일반적인 답변" )).toBeUndefined();
    expect(resolveStudioParagraphReply("다듬어줘", "```markdown\n# 전체 문서\n\n본문\n```" )).toBeUndefined();
  });
  it("revision과 원문 위치를 검증해 선택 부분만 바꾼다", () => {
    const original = "# 제목\n\n첫 문단\n\n마지막 문단";
    const target = {text:"첫 문단",start:6,revision:2};
    expect(replaceStudioParagraph(original,2,target,"고친 문단")).toBe("# 제목\n\n고친 문단\n\n마지막 문단");
    expect(replaceStudioParagraph(original,3,target,"고친 문단")).toBeUndefined();
    expect(replaceStudioParagraph(original.replace("첫 문단","새 문단"),2,target,"고친 문단")).toBeUndefined();
  });
});
