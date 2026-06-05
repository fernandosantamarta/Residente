-- ============================================================
-- Residente — Elections & recall (Domain I)
-- (FS 718.112(2)(d) & (2)(j) condo / FS 720.306(9)-(10) HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: communities, profiles; optionally ev_meetings / ev_votes / ev_candidates
-- (the operational secret-ballot election runs on ev_votes type='election').
-- ============================================================
--
-- The operational election runs on ev_votes(type='election') + ev_candidates +
-- ev_ballots (easy-voice.sql). This migration adds the NOTICE-TIMELINE tracking
-- the statutory math in lib/compliance/elections.ts reads to raise ADVISORY
-- signals at /admin/elections + the dashboard: the condo 60-day first notice,
-- the 40-day candidate deadline, the 14–34-day second notice + ballot window,
-- the 20% election quorum, and the 5-business-day board-recall clock.
--
-- Posture: Enable + Monitor — ADVISORY ONLY. Nothing here runs or invalidates an
-- election or a recall.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the 60/40/14–34-day timeline (condo; HOA is
--   largely governing-document-driven), the 20% quorum, and the 5-business-day
--   recall-certification window.

-- ---------- 1) ELECTIONS (notice-timeline tracking) ----------
create table if not exists public.ev_elections (
  id                   uuid primary key default gen_random_uuid(),
  community_id         uuid not null references public.communities(id) on delete cascade,
  meeting_id           uuid,                       -- optional link to ev_meetings
  vote_id              uuid,                       -- optional link to ev_votes(type='election')
  election_date        date,
  first_notice_at      date,                       -- 60-day first notice (condo)
  candidate_deadline_at date,                      -- 40-day candidate-intent deadline
  second_notice_at     date,
  ballots_sent_at      date,                       -- 14–34-day second notice + ballot
  seats                int,
  candidate_count      int,
  ballots_cast         int,
  eligible_count       int,
  status               text not null default 'proposed'
                         check (status in ('proposed','first_notice_sent','candidates_closed','ballots_sent','completed','cancelled')),
  notes                text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now()
);
create index if not exists ev_elections_community_idx on public.ev_elections (community_id, election_date desc);

-- Slice-1: affidavit of compliance / mailing for the election notices
-- (condo FS 718.112(2)(d)3 incorporated into (d)4; HOA FS 720.306(5)).
alter table public.ev_elections
  add column if not exists affidavit_filed_at date;

alter table public.ev_elections enable row level security;
grant select, insert, update, delete on public.ev_elections to authenticated;
grant select, insert, update, delete on public.ev_elections to service_role;

-- Community-readable (the election timeline is transparency-facing); board writes.
drop policy if exists "community reads elections" on public.ev_elections;
create policy "community reads elections"
  on public.ev_elections for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );
drop policy if exists "board writes elections" on public.ev_elections;
create policy "board writes elections"
  on public.ev_elections for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 2) RECALLS (board-action clock) ----------
create table if not exists public.ev_recalls (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid not null references public.communities(id) on delete cascade,
  served_at              date,                     -- recall served on the board (starts the 5-business-day clock)
  method                 text check (method is null or method in ('written_agreement','meeting')),
  voting_interests_total int,
  signatures             int,
  board_certified        boolean not null default false,
  certified_at           date,
  outcome                text not null default 'pending'
                           check (outcome in ('pending','certified','rejected','arbitration')),
  arbitration_filed_at   date,
  notes                  text,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index if not exists ev_recalls_community_idx on public.ev_recalls (community_id, served_at desc);

alter table public.ev_recalls enable row level security;
grant select, insert, update, delete on public.ev_recalls to authenticated;
grant select, insert, update, delete on public.ev_recalls to service_role;

-- Community-readable (a recall affects every owner); board writes.
drop policy if exists "community reads recalls" on public.ev_recalls;
create policy "community reads recalls"
  on public.ev_recalls for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );
drop policy if exists "board writes recalls" on public.ev_recalls;
create policy "board writes recalls"
  on public.ev_recalls for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
