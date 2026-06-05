-- ============================================================
-- Residente — Directors: eligibility, certification, conflicts & CAM
-- (FS 718.112(2)(d), 718.1265, 718.3027 / 720.3033 / Ch. 468 Part VIII)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: residents (board roster: is_board / board_position — ensured below),
--             vendors, documents, compliance-foundation.sql.
-- ============================================================
--
-- Director identity = residents.id (the board roster is residents.is_board).
-- The statutory math (8-year term limit, 90-day certification, recert windows,
-- CAM trigger) lives in lib/compliance/governance.ts; the /admin/compliance
-- dashboard + the weekly compliance-scan cron read these tables to raise
-- ADVISORY signals. Nothing here blocks — the platform never auto-removes a
-- director or auto-voids a contract.
--
-- RLS note: eligibility + conflict rows hold sensitive director information and
-- are BOARD-READ-ONLY; terms, certifications and the CAM (manager) record are
-- community-readable for transparency (FS 468.432 manager disclosure).
--
-- ⚠ REQUIRES ATTORNEY REVIEW — term-limit counting, certification windows, the
--   eligibility criteria, conflict-approval thresholds and the CAM trigger must
--   be confirmed by Florida community-association counsel.

-- ---------- 0) BOARD ROSTER COLUMNS (ensure they exist) ----------
-- The board roster lives on residents (is_board / board_position). These were
-- added directly in prod earlier; this idempotent ALTER documents the dependency
-- and makes this migration self-sufficient on a fresh database.
alter table public.residents
  add column if not exists is_board       boolean not null default false,
  add column if not exists board_position text;

-- ---------- 1) BOARD TERMS (consecutive-service / 8-year limit) ----------
create table if not exists public.ev_board_terms (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  resident_id  uuid not null references public.residents(id) on delete cascade,
  position     text,
  elected_at   date,
  term_start   date,
  term_end     date,
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists ev_board_terms_community_idx on public.ev_board_terms (community_id);
create index if not exists ev_board_terms_resident_idx on public.ev_board_terms (resident_id);

-- Slice-1 precision fix (FS 718.112(2)(d)2): a director may serve beyond the
-- 8-year consecutive limit if re-elected by a two-thirds vote of all votes cast
-- OR there are not enough eligible candidates. Recorded on the re-electing term
-- so a validly re-elected director is not flagged "overdue".
alter table public.ev_board_terms
  add column if not exists term_limit_exception text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ev_board_terms_term_limit_exception_check') then
    alter table public.ev_board_terms
      add constraint ev_board_terms_term_limit_exception_check
      check (term_limit_exception is null or term_limit_exception in ('supermajority_vote','insufficient_candidates'));
  end if;
end $$;

alter table public.ev_board_terms enable row level security;
grant select, insert, update, delete on public.ev_board_terms to authenticated;
grant select, insert, update, delete on public.ev_board_terms to service_role;

drop policy if exists "community reads board terms" on public.ev_board_terms;
create policy "community reads board terms"
  on public.ev_board_terms for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );
drop policy if exists "board writes board terms" on public.ev_board_terms;
create policy "board writes board terms"
  on public.ev_board_terms for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 2) DIRECTOR CERTIFICATIONS ----------
create table if not exists public.ev_director_certifications (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  resident_id  uuid not null references public.residents(id) on delete cascade,
  kind         text not null default 'initial'
                 check (kind in ('initial','continuing','recert')),
  completed_at date,
  hours        numeric,
  expires_at   date,
  provider     text,
  document_id  uuid references public.documents(id) on delete set null,
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists ev_director_certifications_community_idx on public.ev_director_certifications (community_id);
create index if not exists ev_director_certifications_resident_idx on public.ev_director_certifications (resident_id);

alter table public.ev_director_certifications enable row level security;
grant select, insert, update, delete on public.ev_director_certifications to authenticated;
grant select, insert, update, delete on public.ev_director_certifications to service_role;

drop policy if exists "community reads director certs" on public.ev_director_certifications;
create policy "community reads director certs"
  on public.ev_director_certifications for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );
drop policy if exists "board writes director certs" on public.ev_director_certifications;
create policy "board writes director certs"
  on public.ev_director_certifications for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 3) DIRECTOR ELIGIBILITY (BOARD-READ-ONLY — sensitive) ----------
create table if not exists public.ev_director_eligibility (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities(id) on delete cascade,
  resident_id         uuid not null references public.residents(id) on delete cascade,
  delinquent          boolean not null default false,
  delinquent_since    date,
  felony_conviction   boolean not null default false,
  charged_pending     boolean not null default false,
  co_owner_conflict   boolean not null default false,
  signed_certification boolean not null default false,
  notes               text,
  updated_by          uuid references public.profiles(id) on delete set null,
  updated_at          timestamptz not null default now(),
  unique (community_id, resident_id)
);
create index if not exists ev_director_eligibility_community_idx on public.ev_director_eligibility (community_id);

alter table public.ev_director_eligibility enable row level security;
grant select, insert, update, delete on public.ev_director_eligibility to authenticated;
grant select, insert, update, delete on public.ev_director_eligibility to service_role;

-- Board-read-only (NOT member-readable — holds felony / charge flags).
drop policy if exists "board reads director eligibility" on public.ev_director_eligibility;
create policy "board reads director eligibility"
  on public.ev_director_eligibility for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
drop policy if exists "board writes director eligibility" on public.ev_director_eligibility;
create policy "board writes director eligibility"
  on public.ev_director_eligibility for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 4) CONFLICT DISCLOSURES (BOARD-READ-ONLY) ----------
create table if not exists public.ev_conflict_disclosures (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  resident_id       uuid references public.residents(id) on delete set null,
  subject           text not null,
  related_vendor_id uuid references public.vendors(id) on delete set null,
  disclosed_at      date,
  vote_at           date,
  approved          boolean not null default false,
  approval_basis    text,
  notes             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists ev_conflict_disclosures_community_idx on public.ev_conflict_disclosures (community_id);

alter table public.ev_conflict_disclosures enable row level security;
grant select, insert, update, delete on public.ev_conflict_disclosures to authenticated;
grant select, insert, update, delete on public.ev_conflict_disclosures to service_role;

drop policy if exists "board reads conflict disclosures" on public.ev_conflict_disclosures;
create policy "board reads conflict disclosures"
  on public.ev_conflict_disclosures for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
drop policy if exists "board writes conflict disclosures" on public.ev_conflict_disclosures;
create policy "board writes conflict disclosures"
  on public.ev_conflict_disclosures for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 5) MANAGERS (CAM) ----------
create table if not exists public.ev_managers (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid not null references public.communities(id) on delete cascade,
  name                   text not null,
  company                text,
  license_number         text,
  license_type           text check (license_type is null or license_type in ('cam','cab','other')),
  license_expiry         date,
  dbpr_verified          boolean not null default false,
  dbpr_verified_at       date,
  status                 text not null default 'active' check (status in ('active','inactive')),
  annual_meeting_attended boolean not null default false,
  notes                  text,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index if not exists ev_managers_community_idx on public.ev_managers (community_id);

alter table public.ev_managers enable row level security;
grant select, insert, update, delete on public.ev_managers to authenticated;
grant select, insert, update, delete on public.ev_managers to service_role;

-- Community-readable (CAM disclosure is transparency-facing, FS 468.432).
drop policy if exists "community reads managers" on public.ev_managers;
create policy "community reads managers"
  on public.ev_managers for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );
drop policy if exists "board writes managers" on public.ev_managers;
create policy "board writes managers"
  on public.ev_managers for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 6) VENDORS: director-affiliation (conflict tracking) ----------
alter table public.vendors
  add column if not exists director_owned     boolean not null default false,
  add column if not exists director_equity_pct numeric
    check (director_equity_pct is null or (director_equity_pct >= 0 and director_equity_pct <= 100));
