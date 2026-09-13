import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "docs/supabase-migrations/025_knowledge_studio_approval.sql"), "utf8");
const rollback = readFileSync(join(process.cwd(), "docs/supabase-migrations/025_knowledge_studio_approval.rollback.sql"), "utf8");
const draftCli = readFileSync(join(process.cwd(), "scripts/knowledge-studio-draft.mjs"), "utf8");
const verifier = readFileSync(join(process.cwd(), "scripts/verify-knowledge-supabase-rest.mjs"), "utf8");

describe("작업실 저장·승인 SQL 계약", () => {
  it("JSON 본문으로 받은 원래 스냅샷과 검토 상태를 원자적으로 비교한다", () => {
    const save = migration.slice(0, migration.indexOf("create or replace function public.begin_knowledge_studio_approval"));
    expect(save).toContain("p_expected_result jsonb");
    expect(save).toContain("(p_result - 'studio_draft') is distinct from (p_expected_result - 'studio_draft')");
    expect(save).toMatch(/update public\.knowledge_jobs\s+set result = p_result\s+where id = p_job_id and user_id = p_user_id\s+and status = 'review_required'\s+and result = p_expected_result/);
    expect(save).toMatch(/if not found then\s+return null;/);
  });

  it("같은 행 잠금 안에서 승인할 본문·버전을 확인하고 기존 CAS를 호출한다", () => {
    const approval = migration.slice(migration.indexOf("create or replace function public.begin_knowledge_studio_approval"));
    expect(approval).toMatch(/where id = p_job_id and user_id = p_user_id\s+for update;/);
    expect(approval).toContain("(v_job.result #> '{studio_draft,revision}') is distinct from to_jsonb(p_revision)");
    expect(approval).toContain("(v_job.result #> '{studio_draft,markdown}') is distinct from to_jsonb(p_markdown)");
    expect(approval.indexOf("raise exception 'studio draft changed'")).toBeLessThan(approval.indexOf("return public.begin_knowledge_approval("));
    expect(approval).toContain("v_job.approval_intent_hash is distinct from p_intent_hash");
  });

  it("브라우저 역할의 직접 호출을 막고 기존 작업·CLI 승인을 보존한다", () => {
    expect(migration.match(/coalesce\(auth.role\(\), ''\) <> 'service_role'/g)).toHaveLength(2);
    expect(migration.match(/from public, anon, authenticated, service_role;/g)).toHaveLength(2);
    expect(migration.match(/to service_role;/g)).toHaveLength(2);
    expect(migration).toContain("notify pgrst, 'reload schema'");
    expect(migration).not.toMatch(/create or replace function public\.begin_knowledge_approval\(/);
    expect(rollback).toContain("drop function if exists public.patch_knowledge_studio_draft");
    expect(rollback).toContain("drop function if exists public.begin_knowledge_studio_approval");
    expect(rollback).not.toMatch(/(?:update|delete from|truncate) public\.knowledge_jobs/i);
  });

  it("터미널 편집도 같은 CAS를 쓰고 운영 검증이 새 RPC를 요구한다", () => {
    expect(draftCli).toContain('supabase.rpc("patch_knowledge_studio_draft"');
    expect(draftCli).toContain("p_expected_result: row.result");
    expect(draftCli).not.toContain(".update({ result: applied.result })");
    expect(verifier).toContain('"patch_knowledge_studio_draft"');
    expect(verifier).toContain('"begin_knowledge_studio_approval"');
  });
});
