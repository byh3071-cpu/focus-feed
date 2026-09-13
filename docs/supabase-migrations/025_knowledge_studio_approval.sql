-- Bind the stored studio draft to approval while holding the owned row lock.
-- The server computes the v1 SHA-256 intent; the Brain consumer independently
-- verifies it against the locked revision and Markdown before writing files.
-- Applying this migration does not approve or process existing jobs.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Send the expected JSON in a POST body: a full draft can exceed URL limits.
create or replace function public.patch_knowledge_studio_draft(
  p_user_id uuid,
  p_job_id uuid,
  p_expected_result jsonb,
  p_result jsonb
)
returns public.knowledge_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.knowledge_jobs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'owner user id required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_expected_result) is distinct from 'object'
    or jsonb_typeof(p_result) is distinct from 'object'
    or jsonb_typeof(p_result -> 'studio_draft') is distinct from 'object'
    or (p_result - 'studio_draft') is distinct from (p_expected_result - 'studio_draft') then
    raise exception 'invalid studio draft patch' using errcode = '22023';
  end if;

  update public.knowledge_jobs
  set result = p_result
  where id = p_job_id and user_id = p_user_id
    and status = 'review_required'
    and result = p_expected_result
  returning * into v_job;
  -- NULL means another save or approval won the race. No content was changed.
  if not found then
    return null;
  end if;
  return v_job;
end;
$$;

create or replace function public.begin_knowledge_studio_approval(
  p_user_id uuid,
  p_job_id uuid,
  p_revision integer,
  p_markdown text,
  p_intent_hash text
)
returns public.knowledge_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.knowledge_jobs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'owner user id required' using errcode = '22023';
  end if;
  if p_revision is null or p_revision < 1
    or p_markdown is null or length(btrim(p_markdown)) = 0
    or length(p_markdown) > 80000
    or p_intent_hash is null or p_intent_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid approval intent' using errcode = '22023';
  end if;

  select * into v_job
  from public.knowledge_jobs
  where id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'knowledge job not found';
  end if;
  if v_job.status not in ('review_required', 'approving', 'completed') then
    raise exception 'knowledge job is not reviewable';
  end if;
  if (v_job.result #> '{studio_draft,revision}') is distinct from to_jsonb(p_revision)
    or (v_job.result #> '{studio_draft,markdown}') is distinct from to_jsonb(p_markdown) then
    raise exception 'studio draft changed';
  end if;
  if v_job.status in ('approving', 'completed')
    and v_job.approval_intent_hash is distinct from p_intent_hash then
    raise exception 'approval already in progress with different intent';
  end if;

  -- The lock is held until this transaction returns, including the existing CAS.
  return public.begin_knowledge_approval(p_user_id, p_job_id, p_intent_hash);
end;
$$;

revoke all on function public.patch_knowledge_studio_draft(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.patch_knowledge_studio_draft(uuid, uuid, jsonb, jsonb)
  to service_role;

revoke all on function public.begin_knowledge_studio_approval(uuid, uuid, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_knowledge_studio_approval(uuid, uuid, integer, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
