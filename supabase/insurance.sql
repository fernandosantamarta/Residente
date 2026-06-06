-- ============================================================
-- Residente — Insurance: property (replacement-cost appraisal) & fidelity bond
-- (condo + HOA — FS 718.111(11)(a)/(h), FS 720.3033(5))
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: compliance-foundation.sql (community profile columns),
--             documents table (the 'Insurance' records category).
-- ============================================================
--
-- A board records insurance policies at /admin/insurance: the master PROPERTY
-- policy (condo only) with its independent replacement-cost appraisal date, and
-- the FIDELITY BOND (both regimes) covering everyone who controls or disburses
-- association funds. The statutory date/amount math (36-month appraisal clock,
-- the "maximum funds in custody" bond floor, the HOA annual waiver) lives in
-- lib/compliance/insurance.ts; the /admin/compliance dashboard + the weekly
-- compliance-scan cron read this table to raise advisory signals. Nothing here
-- blocks a board action.
--
-- REQUIRES ATTORNEY REVIEW — the 36-month interval, the bond-floor basis, who
--   must be covered, and the HOA waiver mechanics must be confirmed by Florida
--   community-association counsel.

-- ---------- 1) INSURANCE POLICIES (property | fidelity_bond) ----------
create table if not exists public.ev_insurance_policies (
  id                      uuid primary key default gen_random_uuid(),
  community_id            uuid not null references public.communities(id) on delete cascade,
  kind                    text not null
                            check (kind in ('property','fidelity_bond')),
  carrier                 text,
  policy_number           text,
  amount                  numeric,          -- coverage limit / bond amount
  effective_date          date,
  expiration_date         date,
  last_appraisal_date     date,             -- property only: anchors the 36-month clock
  replacement_cost_value  numeric,          -- property only: appraised replacement cost
  document_id             uuid references public.documents(id) on delete set null, -- evidence (Insurance category)
  notes                   text,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now()
);

create index if not exists ev_insurance_policies_community_idx
  on public.ev_insurance_policies (community_id, created_at desc);
create index if not exists ev_insurance_policies_kind_idx
  on public.ev_insurance_policies (community_id, kind);

alter table public.ev_insurance_policies enable row level security;
grant select, insert, update, delete on public.ev_insurance_policies to authenticated;
grant select, insert, update, delete on public.ev_insurance_policies to service_role;

-- Every member may read their community's insurance policies (transparency).
drop policy if exists "community reads insurance policies" on public.ev_insurance_policies;
create policy "community reads insurance policies"
  on public.ev_insurance_policies for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes insurance policies" on public.ev_insurance_policies;
create policy "board writes insurance policies"
  on public.ev_insurance_policies for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- 2) COMMUNITY PROFILE COLUMNS ----------
-- fidelity_bond_waiver_fy: the fiscal year for which the HOA members waived the
--   fidelity bond (NULL = not waived). Condominiums cannot waive, so this is
--   only consumed for HOAs.
-- estimated_max_funds: a board-entered estimate of the maximum funds in the
--   association's (or its manager's) custody at any one time — the statutory
--   bond floor. When NULL/0 the dashboard falls back to summed reserve balances.
alter table public.communities add column if not exists fidelity_bond_waiver_fy int;
alter table public.communities add column if not exists estimated_max_funds numeric;

-- Refresh the PostgREST schema cache so the new table/columns are queryable.
notify pgrst, 'reload schema';
