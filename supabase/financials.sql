-- ============================================================
-- Residente — Financial reporting, audit tiers & reserve funding
-- (FS 718.111(13), 718.112(2)(f) condo / FS 720.303(6)-(7) HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: compliance-foundation.sql (communities profile cols),
--             easy-voice.sql (ev_meetings), the budget_categories table.
-- ============================================================
--
-- New per-fiscal-year compliance spine (ev_financial_filings) + reserve
-- components (ev_reserve_components) + budget-status columns on budget_categories.
-- The statutory math (audit tiers, AFR clocks, reserve funding) lives in
-- lib/compliance/financials.ts; the /admin/compliance dashboard + the weekly
-- compliance-scan cron read these to raise advisory signals. Nothing blocks.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — audit-revenue tiers (esp. the HOA 2026-07-01
--   drop to $250k), the AFR / budget-adoption clocks, and the SIRS reserve
--   no-waiver rule must be confirmed by Florida community-association counsel.

-- ---------- 1) BUDGET CATEGORIES: fiscal-year + adoption status ----------
alter table public.budget_categories
  add column if not exists fiscal_year       int,
  add column if not exists is_reserve        boolean not null default false,
  add column if not exists status            text not null default 'adopted'
    check (status in ('draft','proposed','adopted')),
  add column if not exists adopted_meeting_id uuid references public.ev_meetings(id) on delete set null;

-- ---------- 2) COMMUNITIES: explicit annual revenue (audit-tier basis) ----------
-- Optional board-entered figure; financials.ts falls back to the sum of
-- non-reserve budget lines when this is null/0.
alter table public.communities
  add column if not exists annual_revenue numeric;

-- ---------- 3) RESERVE COMPONENTS ----------
create table if not exists public.ev_reserve_components (
  id                    uuid primary key default gen_random_uuid(),
  community_id          uuid not null references public.communities(id) on delete cascade,
  name                  text not null,
  is_sirs               boolean not null default false,  -- a SIRS structural component (no-waiver)
  current_balance       numeric,
  fully_funded_balance  numeric,
  annual_contribution   numeric,
  remaining_useful_life_years int,
  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists ev_reserve_components_community_idx on public.ev_reserve_components (community_id);

alter table public.ev_reserve_components enable row level security;
grant select, insert, update, delete on public.ev_reserve_components to authenticated;
grant select, insert, update, delete on public.ev_reserve_components to service_role;

drop policy if exists "community reads reserve components" on public.ev_reserve_components;
create policy "community reads reserve components"
  on public.ev_reserve_components for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes reserve components" on public.ev_reserve_components;
create policy "board writes reserve components"
  on public.ev_reserve_components for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 4) FINANCIAL FILINGS (per-FY compliance spine) ----------
create table if not exists public.ev_financial_filings (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  fiscal_year   int not null,
  filing_type   text not null
                  check (filing_type in ('budget_adoption','annual_financial_report','reserve_study','audit_tier','reserve_waiver')),
  status        text not null default 'planned'
                  check (status in ('planned','in_progress','completed','delivered','waived')),
  audit_tier    text
                  check (audit_tier is null or audit_tier in ('cash','compiled','reviewed','audited')),
  completed_at  date,
  delivered_at  date,
  document_id   uuid references public.documents(id) on delete set null,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ev_financial_filings_community_idx on public.ev_financial_filings (community_id, fiscal_year desc);
create index if not exists ev_financial_filings_type_idx on public.ev_financial_filings (community_id, filing_type, fiscal_year);

alter table public.ev_financial_filings enable row level security;
grant select, insert, update, delete on public.ev_financial_filings to authenticated;
grant select, insert, update, delete on public.ev_financial_filings to service_role;

drop policy if exists "community reads financial filings" on public.ev_financial_filings;
create policy "community reads financial filings"
  on public.ev_financial_filings for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes financial filings" on public.ev_financial_filings;
create policy "board writes financial filings"
  on public.ev_financial_filings for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 5) RESERVE SUMMARY AGGREGATOR (member-scoped, counts not rows) ----------
-- Mirrors community_dues_summary(): security definer + a membership guard, returns
-- a single summary row. Used by the dashboard / reserve worksheet.
create or replace function public.community_reserve_summary(p_community uuid)
returns table (
  components       int,
  sirs_components  int,
  total_current    numeric,
  total_funded     numeric,
  pct_funded       int,
  underfunded      int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and community_id = p_community
  ) then
    raise exception 'not a member of this community';
  end if;

  select
    count(*)::int,
    count(*) filter (where is_sirs)::int,
    coalesce(sum(current_balance), 0),
    coalesce(sum(fully_funded_balance), 0),
    case when coalesce(sum(fully_funded_balance), 0) > 0
         then round(coalesce(sum(current_balance), 0) / sum(fully_funded_balance) * 100)::int
         else 100 end,
    count(*) filter (
      where coalesce(fully_funded_balance, 0) > 0
        and coalesce(current_balance, 0) / fully_funded_balance * 100 < 50
    )::int
  into components, sirs_components, total_current, total_funded, pct_funded, underfunded
  from public.ev_reserve_components
  where community_id = p_community;

  return next;
end $$;

grant execute on function public.community_reserve_summary(uuid) to authenticated;
