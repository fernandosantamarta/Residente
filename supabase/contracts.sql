-- ============================================================
-- Residente — Procurement: competitive bidding, written contracts &
-- management-agreement required terms
-- (condo + HOA — FS 718.3026 / 720.3055 / 718.3025)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: compliance-foundation.sql (community profile columns),
--             budget_categories (the reserves-inclusive budget basis).
-- ============================================================
--
-- A board records significant vendor + management contracts at /admin/contracts.
-- The threshold math (condo 5% / HOA 10% of the total annual budget INCLUDING
-- reserves), the writing requirement (services or contracts over one year), and
-- the condo management-agreement required-terms attestation (FS 718.3025) live in
-- lib/compliance/contracts.ts; the /admin/compliance dashboard + the weekly
-- compliance-scan cron read this table to raise advisory signals. Nothing here
-- blocks a board action. Director/officer conflicts of interest (718.3027 /
-- 720.3033) are handled separately in the governance domain.
--
-- REQUIRES ATTORNEY REVIEW — the 5%/10% thresholds, the reserves-inclusive
--   basis, the exceptions, and the 718.3025 required-terms list must be
--   confirmed by Florida community-association counsel.

create table if not exists public.ev_contracts (
  id                      uuid primary key default gen_random_uuid(),
  community_id            uuid not null references public.communities(id) on delete cascade,
  vendor                  text,
  description             text,
  amount                  numeric,          -- aggregate payment under the contract
  contract_kind           text not null default 'services'
                            check (contract_kind in ('products','services','management')),
  term_months             int,              -- contract term (drives the >1-year writing rule)
  executed_on             date,
  bids_obtained           boolean not null default false,
  written_contract        boolean not null default false,
  exception_basis         text              -- null/none, or one of the recognised statutory exceptions
                            check (exception_basis is null or exception_basis in
                              ('none','emergency','sole_source','professional_service','employee',
                               'franchise','renewal_cancelable','pre_2004','opt_out','governing_docs')),
  required_terms_attested boolean not null default false, -- condo management agreements (718.3025)
  document_id             uuid references public.documents(id) on delete set null, -- the signed contract
  notes                   text,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now()
);

create index if not exists ev_contracts_community_idx
  on public.ev_contracts (community_id, created_at desc);

alter table public.ev_contracts enable row level security;
grant select, insert, update, delete on public.ev_contracts to authenticated;
grant select, insert, update, delete on public.ev_contracts to service_role;

-- Every member may read their community's contracts (advisory transparency).
drop policy if exists "community reads contracts" on public.ev_contracts;
create policy "community reads contracts"
  on public.ev_contracts for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes contracts" on public.ev_contracts;
create policy "board writes contracts"
  on public.ev_contracts for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Refresh the PostgREST schema cache so the new table is queryable.
notify pgrst, 'reload schema';
