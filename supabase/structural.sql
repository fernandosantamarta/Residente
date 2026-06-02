-- ============================================================
-- Residente — Structural integrity: milestone inspections, SIRS & turnover
-- (CONDO ONLY — FS 553.899, 718.112(2)(g), 718.301(4))
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: compliance-foundation.sql (community profile columns),
--             documents table (sealed inspection reports).
-- ============================================================
--
-- A board manages buildings + their structural assessments at /admin/structural
-- (condo-only; the page renders N/A for HOAs). The statutory date math
-- (milestone 25/30-yr trigger, 10-yr recurrence, 180-day Phase 1, 45-day owner
-- summary, SIRS 2025-12-31 deadline) lives in lib/compliance/structural.ts; the
-- /admin/compliance dashboard + the weekly compliance-scan cron read these
-- tables to raise advisory signals. Nothing here blocks a board action.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — trigger years, coastal definition, the SIRS
--   component list, deadlines, the $ threshold, and accepted credential types
--   must be confirmed by Florida community-association counsel.

-- ---------- 1) BUILDINGS ----------
create table if not exists public.ev_buildings (
  id                            uuid primary key default gen_random_uuid(),
  community_id                  uuid not null references public.communities(id) on delete cascade,
  name                          text,            -- "Tower A", "Building 1"
  address                       text,
  stories                       int,             -- habitable stories (SIRS/milestone scope ≥3)
  units                         int,
  certificate_of_occupancy_date date,            -- milestone trigger anchor
  coastal                       boolean not null default false, -- within 3 mi of coastline (25-yr trigger)
  notes                         text,
  created_by                    uuid references public.profiles(id) on delete set null,
  created_at                    timestamptz not null default now()
);

create index if not exists ev_buildings_community_idx on public.ev_buildings (community_id, created_at desc);

alter table public.ev_buildings enable row level security;
grant select, insert, update, delete on public.ev_buildings to authenticated;
grant select, insert, update, delete on public.ev_buildings to service_role;

-- Every member may read their community's buildings (advisory transparency).
drop policy if exists "community reads buildings" on public.ev_buildings;
create policy "community reads buildings"
  on public.ev_buildings for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes buildings" on public.ev_buildings;
create policy "board writes buildings"
  on public.ev_buildings for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 2) STRUCTURAL ASSESSMENTS (milestone | sirs | turnover) ----------
-- One lifecycle table covering all three inspection regimes. building_id is
-- nullable: a SIRS or turnover assessment may be community-wide.
create table if not exists public.ev_structural_assessments (
  id                   uuid primary key default gen_random_uuid(),
  community_id         uuid not null references public.communities(id) on delete cascade,
  building_id          uuid references public.ev_buildings(id) on delete set null,
  kind                 text not null
                         check (kind in ('milestone','sirs','turnover')),
  status               text not null default 'not_started'
                         check (status in ('not_started','scheduled','in_progress','report_received','completed','cancelled')),
  due_date             date,            -- statutory deadline (milestone Phase 1 due / SIRS deadline)
  inspection_date      date,            -- when the inspection was performed
  performer_name       text,
  performer_type       text             -- PE | RA | CAI-RS | APRA-PRA | other
                         check (performer_type is null or performer_type in ('PE','RA','CAI-RS','APRA-PRA','other')),
  performer_license    text,
  report_document_id   uuid references public.documents(id) on delete set null, -- sealed report
  report_received_at   date,
  phase_1_completed_at date,            -- milestone Phase 1 report completion
  requires_phase_2     boolean not null default false, -- substantial structural deterioration found
  phase_2_due          date,
  repair_commence_due  date,            -- ≤365d after Phase 2 (+185d extension)
  next_due_date        date,            -- recurring 10-yr milestone
  owner_notice_sent_at date,            -- 45-day owner summary clock
  dbpr_submitted_at    date,            -- local-enforcement / DBPR report
  notes                text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists ev_structural_assessments_community_idx
  on public.ev_structural_assessments (community_id, created_at desc);
create index if not exists ev_structural_assessments_building_idx
  on public.ev_structural_assessments (building_id);
create index if not exists ev_structural_assessments_kind_idx
  on public.ev_structural_assessments (community_id, kind, status);

alter table public.ev_structural_assessments enable row level security;
grant select, insert, update, delete on public.ev_structural_assessments to authenticated;
grant select, insert, update, delete on public.ev_structural_assessments to service_role;

drop policy if exists "community reads assessments" on public.ev_structural_assessments;
create policy "community reads assessments"
  on public.ev_structural_assessments for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes assessments" on public.ev_structural_assessments;
create policy "board writes assessments"
  on public.ev_structural_assessments for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 3) SIRS COMPONENTS (the mandatory visual-inspection items) ----------
create table if not exists public.ev_sirs_components (
  id                          uuid primary key default gen_random_uuid(),
  community_id                uuid not null references public.communities(id) on delete cascade,
  assessment_id               uuid references public.ev_structural_assessments(id) on delete cascade,
  component                   text not null,       -- one of SIRS_COMPONENTS (lib/compliance/structural.ts)
  estimated_cost              numeric,             -- replacement / deferred-maintenance cost
  remaining_useful_life_years int,
  current_reserve_balance     numeric,
  funding_status              text not null default 'not_funded'
                                check (funding_status in ('not_funded','underfunded','fully_funded')),
  notes                       text,
  created_at                  timestamptz not null default now()
);

create index if not exists ev_sirs_components_community_idx
  on public.ev_sirs_components (community_id);
create index if not exists ev_sirs_components_assessment_idx
  on public.ev_sirs_components (assessment_id);

alter table public.ev_sirs_components enable row level security;
grant select, insert, update, delete on public.ev_sirs_components to authenticated;
grant select, insert, update, delete on public.ev_sirs_components to service_role;

drop policy if exists "community reads sirs components" on public.ev_sirs_components;
create policy "community reads sirs components"
  on public.ev_sirs_components for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes sirs components" on public.ev_sirs_components;
create policy "board writes sirs components"
  on public.ev_sirs_components for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
