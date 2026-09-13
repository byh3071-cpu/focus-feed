-- Restore the previous app version before rollback. Existing approvals and
-- the CLI's begin_knowledge_approval function are preserved.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop function if exists public.begin_knowledge_studio_approval(uuid, uuid, integer, text, text);
drop function if exists public.patch_knowledge_studio_draft(uuid, uuid, jsonb, jsonb);

notify pgrst, 'reload schema';

commit;
