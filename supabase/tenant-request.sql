-- tenant-request.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Owner-initiated tenant request: an owner who leases their unit submits their
-- tenant's name/email from their app Settings and requests board approval. The
-- owner only PROPOSES — the actual invite is the board-only edge function
-- (voice-invite-owner tenant:true), so an owner can't self-grant tenant access.
--
-- No new RLS needed: owners already update their own roster row via the existing
-- "residents update own row" policy (profile_id = auth.uid()), which is how they
-- write the tenant fields + this request flag. The board reads/approves via its
-- existing "board writes" access.

alter table public.residents
  add column if not exists tenant_request_state text,
  add column if not exists tenant_requested_at  date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'residents_tenant_request_state_chk') then
    alter table public.residents
      add constraint residents_tenant_request_state_chk
      check (tenant_request_state is null
             or tenant_request_state in ('pending','approved','rejected'));
  end if;
end $$;

-- Fast lookup of a community's pending tenant requests (board queue).
create index if not exists residents_tenant_request_pending_idx
  on public.residents (community_id) where tenant_request_state = 'pending';
