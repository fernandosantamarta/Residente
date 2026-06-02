-- ============================================================
-- Residente — Violations, fines, hearings & suspension (Domain G)
-- (FS 718.303 condo / FS 720.305 & 720.3085 HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: easy-violations.sql (ev_violations), communities, profiles,
--             residents, easy-voice notices (ev_notices / ev_notice_recipients).
-- ============================================================
--
-- The board issues warnings / fines at /admin/violations (Easy Documents). This
-- migration adds the ENFORCEMENT layer that Florida law wraps around a fine or a
-- use-rights suspension: an independent fining committee, the 14-day notice +
-- opportunity for a hearing, the $100/day & $1,000-aggregate caps, and the
-- voting/use-rights suspension track. The statutory math lives in
-- lib/compliance/enforcement.ts; the /admin/enforcement workspace + the
-- /admin/compliance dashboard read these tables to raise ADVISORY signals.
--
-- Posture: Enable + Monitor — ADVISORY ONLY. Nothing here auto-levies a fine,
-- auto-suspends an owner, or hard-blocks a board action.
--
-- RLS note: committee membership is community-readable (transparency — the owner
-- is entitled to know the committee is independent); a hearing record and a
-- suspension are readable by the BOARD and by the one OWNER they concern.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the $100/day & $1,000 caps (and whether the HOA
--   declaration waives the aggregate cap), the 14-day notice, the committee-
--   independence test, the no-lien rule for fines, and the 90-day-delinquency
--   voting-suspension (no hearing) must be confirmed by Florida community-
--   association counsel and against the governing documents.

-- ---------- 1) ENFORCEMENT COLUMNS ON ev_violations ----------
-- Plain warnings / simple fines issued at /admin/violations leave these at their
-- defaults (enforcement_stage = 'none'); a fine that must run the statutory
-- hearing gauntlet advances through the stages below.
alter table public.ev_violations
  add column if not exists fine_per_day      numeric,            -- continuing-violation daily rate
  add column if not exists fine_continuing   boolean not null default false,
  add column if not exists fine_started_on   date,               -- first day the continuing fine accrues
  add column if not exists cure_by           date,               -- opportunity-to-cure deadline (if any)
  add column if not exists hearing_required  boolean not null default false,
  add column if not exists levied_at         date,               -- date the fine became effective (post-hearing)
  add column if not exists enforcement_stage text not null default 'none'
    check (enforcement_stage in ('none','proposed','notice_sent','hearing_set','upheld','rejected','levied'));

-- ---------- 2) FINING COMMITTEE (independent members) ----------
-- FS 718.303(3)(b) / 720.305(2)(b): the committee must be at least three members
-- appointed by the board who are NOT officers, directors, or employees of the
-- association, nor the spouse, parent, child, brother, or sister of one.
create table if not exists public.ev_fining_committee_members (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  full_name         text not null,
  email             text,
  -- Board-attested independence (not an officer/director/employee or their relative).
  is_independent    boolean not null default true,
  relationship_note text,                                        -- if NOT independent, why
  appointed_at      date,
  active            boolean not null default true,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists ev_fining_committee_members_community_idx
  on public.ev_fining_committee_members (community_id, active);

alter table public.ev_fining_committee_members enable row level security;
grant select, insert, update, delete on public.ev_fining_committee_members to authenticated;
grant select, insert, update, delete on public.ev_fining_committee_members to service_role;

-- Community-readable (the owner is entitled to confirm the committee is independent).
drop policy if exists "community reads fining committee" on public.ev_fining_committee_members;
create policy "community reads fining committee"
  on public.ev_fining_committee_members for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );
drop policy if exists "board writes fining committee" on public.ev_fining_committee_members;
create policy "board writes fining committee"
  on public.ev_fining_committee_members for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 3) VIOLATION HEARINGS (14-day notice + committee decision) ----------
create table if not exists public.ev_violation_hearings (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.communities(id) on delete cascade,
  violation_id    uuid not null references public.ev_violations(id) on delete cascade,
  notice_sent_at  date,                                          -- start of the 14-day clock
  scheduled_at    date,                                          -- hearing date
  held_at         date,
  decision        text not null default 'pending'
                    check (decision in ('pending','upheld','rejected','waived')),
  committee_present int,                                         -- independent members present (≥3)
  vote_for          int,
  vote_against      int,
  minutes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists ev_violation_hearings_community_idx on public.ev_violation_hearings (community_id);
create index if not exists ev_violation_hearings_violation_idx on public.ev_violation_hearings (violation_id);

alter table public.ev_violation_hearings enable row level security;
grant select, insert, update, delete on public.ev_violation_hearings to authenticated;
grant select, insert, update, delete on public.ev_violation_hearings to service_role;

-- The board reads + manages every hearing; the targeted owner reads their own.
drop policy if exists "board reads hearings" on public.ev_violation_hearings;
create policy "board reads hearings"
  on public.ev_violation_hearings for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
drop policy if exists "owner reads own hearings" on public.ev_violation_hearings;
create policy "owner reads own hearings"
  on public.ev_violation_hearings for select to authenticated
  using (
    exists (select 1 from public.ev_violations v where v.id = violation_id and v.profile_id = auth.uid())
  );
drop policy if exists "board writes hearings" on public.ev_violation_hearings;
create policy "board writes hearings"
  on public.ev_violation_hearings for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 4) SUSPENSIONS (voting / common-area use rights) ----------
-- Two tracks:
--   • basis='delinquency_90' — >90 days delinquent in a monetary obligation;
--     voting + use-rights may be suspended by board majority at a properly
--     noticed meeting WITHOUT a hearing (requires_hearing = false).
--   • basis='rule_violation' — a use-rights suspension for a covenant violation;
--     requires the same 14-day notice + committee hearing as a fine
--     (requires_hearing = true; link the hearing).
create table if not exists public.ev_suspensions (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references public.communities(id) on delete cascade,
  profile_id       uuid references public.profiles(id) on delete set null,   -- the owner it's against
  resident_id      uuid references public.residents(id) on delete set null,
  unit_label       text,                                                     -- denormalized "Name · Unit"
  rights           text not null default 'voting'
                     check (rights in ('voting','use_common','both')),
  basis            text not null default 'delinquency_90'
                     check (basis in ('delinquency_90','unpaid_fine','rule_violation')),
  violation_id     uuid references public.ev_violations(id) on delete set null,
  hearing_id       uuid references public.ev_violation_hearings(id) on delete set null,
  requires_hearing boolean not null default false,
  amount_owed      numeric,
  delinquent_since date,
  approved_at      date,                                                     -- board-meeting approval
  started_at       date,
  ended_at         date,
  status           text not null default 'proposed'
                     check (status in ('proposed','active','lifted')),
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists ev_suspensions_community_idx on public.ev_suspensions (community_id, status);
create index if not exists ev_suspensions_profile_idx   on public.ev_suspensions (profile_id);

alter table public.ev_suspensions enable row level security;
grant select, insert, update, delete on public.ev_suspensions to authenticated;
grant select, insert, update, delete on public.ev_suspensions to service_role;

-- The board manages every suspension; the affected owner reads their own.
drop policy if exists "owner reads own suspensions" on public.ev_suspensions;
create policy "owner reads own suspensions"
  on public.ev_suspensions for select to authenticated
  using ( profile_id = auth.uid() );
drop policy if exists "board reads suspensions" on public.ev_suspensions;
create policy "board reads suspensions"
  on public.ev_suspensions for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
drop policy if exists "board writes suspensions" on public.ev_suspensions;
create policy "board writes suspensions"
  on public.ev_suspensions for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- INTERCONNECT: 14-day hearing notice -> PERSONAL notice ----------
-- When the board logs the 14-day hearing notice (on insert with notice_sent_at,
-- or when it is first set on update), fire a PERSONAL in-app notice to the one
-- owner the violation is against — mirroring ev_violation_notify(). The notice
-- uses a non-'in_app' channel on ev_notices so the broadcast fanout skips it,
-- then adds a single recipient row. security definer: residents can't write
-- ev_notices or other owners' recipient rows.
create or replace function public.ev_hearing_notify()
returns trigger language plpgsql security definer as $$
declare
  target uuid;
  comm   uuid;
  nid    uuid;
begin
  -- Only when the 14-day notice is newly recorded.
  if new.notice_sent_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.notice_sent_at is not null then return new; end if;

  select profile_id, community_id into target, comm
    from public.ev_violations where id = new.violation_id;
  if target is null then return new; end if;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    coalesce(comm, new.community_id),
    'custom_broadcast',
    array['personal'],
    'Notice of hearing',
    'A hearing on a rule violation has been scheduled'
      || case when new.scheduled_at is not null then ' for ' || to_char(new.scheduled_at, 'Mon DD, YYYY') else '' end
      || '. You have at least 14 days'' notice and the right to be heard before an independent committee. See the Contact tab for details.',
    new.created_by
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, coalesce(comm, new.community_id), target, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists ev_hearing_notify_ins on public.ev_violation_hearings;
create trigger ev_hearing_notify_ins
  after insert on public.ev_violation_hearings
  for each row execute function public.ev_hearing_notify();

drop trigger if exists ev_hearing_notify_upd on public.ev_violation_hearings;
create trigger ev_hearing_notify_upd
  after update of notice_sent_at on public.ev_violation_hearings
  for each row execute function public.ev_hearing_notify();
