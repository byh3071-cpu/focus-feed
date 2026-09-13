begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.knowledge_amendments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  job_id uuid not null references public.knowledge_jobs(id) on delete cascade,
  amendment_revision integer not null check (amendment_revision >= 1),
  base_revision integer not null check (base_revision >= 1),
  base_intent_hash text not null check (base_intent_hash ~ '^[0-9a-f]{64}$'),
  markdown text not null check (
    char_length(markdown) between 1 and 80000
    and markdown ~ '[^[:space:]]'
  ),
  created_at timestamptz not null default now(),
  unique (job_id, amendment_revision)
);

alter table public.knowledge_amendments enable row level security;

revoke all privileges on table public.knowledge_amendments
  from public, anon, authenticated, service_role;
grant select on table public.knowledge_amendments to service_role;

create or replace function public.save_knowledge_amendment(
  p_user_id uuid,
  p_job_id uuid,
  p_expected_revision integer,
  p_base_revision integer,
  p_base_intent_hash text,
  p_markdown text
)
returns public.knowledge_amendments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.knowledge_jobs;
  v_latest public.knowledge_amendments;
  v_amendment public.knowledge_amendments;
  v_computed_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_job_id is null then
    raise exception 'knowledge job not found' using errcode = 'P0002';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or p_base_revision is null or p_base_revision < 1
    or p_base_intent_hash is null or p_base_intent_hash !~ '^[0-9a-f]{64}$'
    or p_markdown is null or p_markdown !~ '[^[:space:]]'
    or char_length(p_markdown) > 80000 then
    raise exception 'invalid knowledge amendment' using errcode = '22023';
  end if;

  select * into v_job
  from public.knowledge_jobs
  where id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'knowledge job not found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'completed' then
    raise exception 'knowledge job is not completed' using errcode = '22023';
  end if;

  v_computed_hash := encode(
    sha256(convert_to('v1' || chr(10) || p_job_id::text || chr(10)
      || p_base_revision::text || chr(10)
      || (v_job.result #>> '{studio_draft,markdown}'), 'UTF8')),
    'hex'
  );
  if (v_job.result #> '{studio_draft,revision}') is distinct from to_jsonb(p_base_revision)
    or v_job.approval_intent_hash is distinct from p_base_intent_hash
    or (v_job.result ->> 'approval_intent_hash') is distinct from p_base_intent_hash
    or v_computed_hash is distinct from p_base_intent_hash then
    raise exception 'knowledge amendment base conflict' using errcode = '40001';
  end if;

  select * into v_latest
  from public.knowledge_amendments
  where job_id = p_job_id
  order by amendment_revision desc
  limit 1;

  if found
    and v_latest.markdown = p_markdown
    and v_latest.base_revision = p_base_revision
    and v_latest.base_intent_hash = p_base_intent_hash then
    return v_latest;
  end if;

  if coalesce(v_latest.amendment_revision, 0) <> p_expected_revision then
    raise exception 'knowledge amendment revision conflict' using errcode = '40001';
  end if;

  insert into public.knowledge_amendments (
    user_id, job_id, amendment_revision, base_revision, base_intent_hash, markdown
  ) values (
    p_user_id, p_job_id, coalesce(v_latest.amendment_revision, 0) + 1,
    p_base_revision, p_base_intent_hash, p_markdown
  )
  returning * into v_amendment;

  return v_amendment;
end;
$$;

revoke all on function public.save_knowledge_amendment(uuid, uuid, integer, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_knowledge_amendment(uuid, uuid, integer, integer, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
