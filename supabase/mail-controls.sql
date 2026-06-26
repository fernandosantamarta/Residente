-- mail-controls.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Cost controls + accounting for Lob-mailed collection letters.
--
--   ev_collection_cases.mailing_cost_balance — recoverable MAILING cost on a case,
--     tracked separately from collection/attorney costs so the payoff ledger can
--     show a dedicated "Mailing" line. Rolled into the payoff total like any cost.
--
--   communities.lob_enabled — operator kill switch. When false, the mail-letter
--     edge function refuses to mail (so a non-paying community can't run up
--     Residente's Lob bill). Defaults true.
--
--   ev_mail_log — one row per Lob send, so the Platform Console can show what
--     Residente actually spent per community (the recoverable charge ≠ our cost,
--     but this is the operator's cost-tracking ledger). Service-role only.

alter table public.ev_collection_cases
  add column if not exists mailing_cost_balance numeric not null default 0;

alter table public.communities
  add column if not exists lob_enabled boolean not null default true;

create table if not exists public.ev_mail_log (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  case_id       uuid references public.ev_collection_cases(id) on delete set null,
  kind          text,                 -- the notice kind mailed
  certified     boolean not null default false,
  cost          numeric not null default 0,   -- recoverable charge added to the owner
  lob_id        text,                 -- Lob letter id (ltr_...)
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists ev_mail_log_community_idx on public.ev_mail_log (community_id, created_at desc);

alter table public.ev_mail_log enable row level security;

-- Board/admin can read their own community's mail log; operators read via the
-- service role (Platform Console). No client INSERT — only the edge function
-- (service role) writes.
drop policy if exists "board reads community mail log" on public.ev_mail_log;
create policy "board reads community mail log"
  on public.ev_mail_log for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member', 'admin')
  );

-- The mail-letter edge function runs under the board member's JWT, so allow a
-- board/admin to log a send for their own community.
drop policy if exists "board logs community mail" on public.ev_mail_log;
create policy "board logs community mail"
  on public.ev_mail_log for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member', 'admin')
  );
