import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { applyStudioDraftPatch } from "./knowledge-studio";
import {
  AGENT_OUTPUT_FORBIDDEN,
  KNOWLEDGE_DRAFT_NPM_COMMAND,
  KNOWLEDGE_JOB_ID_PATTERN,
  knowledgeDraftGetCommand,
  knowledgeDraftPatchCommand,
  knowledgeStudioHttpPath,
  NOTEBOOKLM_PUBLIC_URL,
  parseKnowledgeDraftArgv,
  publicDraftJsonContainsSecrets,
  publicStudioDraftView,
} from "./knowledge-studio-agent";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("parseKnowledgeDraftArgv", () => {
  it("get/patch 계약을 읽는다", () => {
    expect(parseKnowledgeDraftArgv(["get", JOB_ID])).toEqual({
      ok: true,
      action: "get",
      jobId: JOB_ID,
      markdownOnly: false,
    });
    expect(parseKnowledgeDraftArgv(["get", JOB_ID, "--markdown"])).toMatchObject({
      ok: true,
      markdownOnly: true,
    });
    expect(parseKnowledgeDraftArgv(["patch", JOB_ID, "--file", "draft.md", "--revision", "2"])).toEqual({
      ok: true,
      action: "patch",
      jobId: JOB_ID,
      filePath: "draft.md",
      expectedRevision: 2,
    });
    expect(parseKnowledgeDraftArgv(["patch", JOB_ID, "-f", "-"])).toMatchObject({
      ok: true,
      filePath: "-",
      expectedRevision: null,
    });
  });

  it("잘못된 ID·옵션은 거부한다", () => {
    expect(parseKnowledgeDraftArgv(["get", "not-a-job"]).ok).toBe(false);
    expect(parseKnowledgeDraftArgv(["patch", JOB_ID]).ok).toBe(false);
    expect(parseKnowledgeDraftArgv(["get", JOB_ID, "--file", "x.md"]).ok).toBe(false);
    expect(parseKnowledgeDraftArgv(["patch", JOB_ID, "--file", "x.md", "--revision", "x"]).ok).toBe(false);
  });
});

describe("publicStudioDraftView", () => {
  it("허용 필드만 남기고 NotebookLM ID·경로를 버린다", () => {
    const view = publicStudioDraftView({
      jobId: JOB_ID,
      revision: 1,
      status: "review_required",
      statusLabel: "검토 필요",
      markdown: "# 초안",
      updatedAt: "2026-09-05T00:00:00.000Z",
      seeded: false,
      notebook_id: "secret-notebook",
      review_path: "C:/private/reviews/job.json",
      source_hash: "private-source-hash",
    });
    expect(view).toEqual({
      jobId: JOB_ID,
      revision: 1,
      status: "review_required",
      statusLabel: "검토 필요",
      markdown: "# 초안",
      updatedAt: "2026-09-05T00:00:00.000Z",
      seeded: false,
    });
    const json = JSON.stringify(view);
    expect(publicDraftJsonContainsSecrets(json)).toBe(false);
    for (const key of AGENT_OUTPUT_FORBIDDEN) {
      expect(json).not.toContain(key);
    }
    expect(json).not.toContain("secret-notebook");
    expect(json).not.toContain("C:/private");
  });
});

describe("agent draft contract", () => {
  it("HTTP 경로와 npm 명령이 같다", () => {
    expect(KNOWLEDGE_JOB_ID_PATTERN.test(JOB_ID)).toBe(true);
    expect(knowledgeStudioHttpPath(JOB_ID)).toBe(`/api/knowledge/jobs/${JOB_ID}/studio`);
    expect(KNOWLEDGE_DRAFT_NPM_COMMAND).toBe("npm run knowledge:draft --");
    expect(knowledgeDraftGetCommand(JOB_ID)).toBe(`npm run knowledge:draft -- get ${JOB_ID}`);
    expect(knowledgeDraftPatchCommand(JOB_ID, 3)).toBe(
      `npm run knowledge:draft -- patch ${JOB_ID} --file draft.md --revision 3`,
    );
    expect(NOTEBOOKLM_PUBLIC_URL).toBe("https://notebooklm.google.com/");
  });

  it("패치는 studio_draft만 올리고 기존 draft를 유지한다", () => {
    const applied = applyStudioDraftPatch({
      result: {
        draft: { summary: "검토 요약" },
        notebook_id: "secret-notebook",
        source_hash: "private-source-hash",
      },
      markdown: "# 에이전트 초안",
      expectedRevision: 0,
      now: new Date("2026-09-05T00:00:00.000Z"),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.result.draft).toEqual({ summary: "검토 요약" });
    expect(applied.result.studio_draft).toMatchObject({
      markdown: "# 에이전트 초안",
      revision: 1,
    });
    expect(applied.result.notebook_id).toBe("secret-notebook");
    const publicJson = JSON.stringify(publicStudioDraftView({
      jobId: JOB_ID,
      revision: applied.draft.revision,
      status: "review_required",
      statusLabel: "검토 필요",
      markdown: applied.draft.markdown,
      updatedAt: applied.draft.updatedAt,
      seeded: false,
    }));
    expect(publicDraftJsonContainsSecrets(publicJson)).toBe(false);
  });
});

describe("knowledge-studio-draft CLI", () => {
  it("인자 없이 사용법을 내고 시크릿을 찍지 않는다", () => {
    const result = spawnSync(process.execPath, ["scripts/knowledge-studio-draft.mjs"], {
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain("knowledge:draft");
    expect(output).toContain("studio_draft");
    expect(output).not.toMatch(/SERVICE_ROLE_KEY\s*=\s*\S+/);
    expect(output).not.toContain("secret-notebook");
  });

  it("잘못된 job id는 DB에 닿기 전에 거부한다", () => {
    const result = spawnSync(process.execPath, ["scripts/knowledge-studio-draft.mjs", "get", "not-a-job"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("검토 항목 ID");
  });
});
