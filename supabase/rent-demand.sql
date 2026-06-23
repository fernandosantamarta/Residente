-- rent-demand.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- The Florida "demand rent from tenant" remedy: FS 720.3085(8) (HOA) /
-- 718.116(11) (condo). When a unit OWNER is delinquent and the unit is LEASED,
-- the association may demand that the TENANT pay rent directly to the HOA until
-- the owner's monetary obligation is paid in full. This table tracks one such
-- demand statefully (the point-in-time letter is logged in ev_collection_notices
-- as kind 'tenant_rent_demand', which already exists).
--
-- Payment + satisfaction are computed LIVE from the owner's balance (a tenant
-- pays the unit's resident_id via the normal dues checkout — the tenant RLS from
-- tenant-accounts.sql lets them read their unit), so we don't double-book money
-- here. obligation_at_demand is just the snapshot when the demand issued.

create table if not exists public.ev_rent_demands (
  id                   uuid primary key default gen_random_uuid(),
  community_id         uuid not null references public.communities(id) on delete cascade,
  case_id              uuid references public.ev_collection_cases(id) on delete set null,
  resident_id          uuid not null references public.residents(id) on delete cascade,
  owner_profile_id     uuid references public.profiles(id) on delete set null,
  tenant_profile_id    uuid references public.profiles(id) on delete set null, -- null if tenant has no app account yet
  status               text not null default 'active'
                         check (status in ('active','released')),
  obligation_at_demand numeric,        -- owner's total owed when the demand issued (dollars)
  monthly_rent         numeric,        -- statutory cap per period (optional)
  demanded_at          date not null default current_date,
  released_at          date,
  released_reason      text check (released_reason is null or released_reason in ('paid_in_full','withdrawn')),
  notes                text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now()
);

-- One active demand per unit at a time.
create unique index if not exists ev_rent_demands_one_active
  on public.ev_rent_demands (resident_id) where status = 'active';
create index if not exists ev_rent_demands_community_idx on public.ev_rent_demands (community_id, status);
create index if not exists ev_rent_demands_tenant_idx    on public.ev_rent_demands (tenant_profile_id) where status = 'active';

alter table public.ev_rent_demands enable row level security;
grant select, insert, update on public.ev_rent_demands to authenticated;
grant select, insert, update on public.ev_rent_demands to service_role;

-- Board manages demands in their own community.
drop policy if exists "board manages rent demands" on public.ev_rent_demands;
create policy "board manages rent demands"
  on public.ev_rent_demands for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- The tenant reads their OWN active demand (drives the in-app pay banner).
drop policy if exists "tenant reads own rent demand" on public.ev_rent_demands;
create policy "tenant reads own rent demand"
  on public.ev_rent_demands for select to authenticated
  using (tenant_profile_id = auth.uid());
