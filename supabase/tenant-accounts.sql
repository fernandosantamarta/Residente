-- tenant-accounts.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Part of the tenant-accounts feature (2026-06-23): a unit that's LEASED can give
-- its tenant their own app account, bound to the unit, but NON-VOTING.
--
-- VOTING SAFETY (the important part): the unit's single vote stays with the
-- OWNER. A tenant can never cast because:
--   • ev_ballots.unit_number is NOT NULL and the cast RLS requires
--     unit_number = (select unit_number from profiles where id = auth.uid());
--   • the only thing that writes profiles.unit_number is sync_profile_unit(),
--     which keys on residents.profile_id (the OWNER) — never tenant_profile_id.
--   So a tenant's profile keeps unit_number = NULL → the cast check is NULL → false.
-- We deliberately do NOT touch sync_profile_unit here.

-- ============================================================================
-- 1. LINK COLUMN — the tenant's account (distinct from profile_id = the owner).
-- ============================================================================
alter table public.residents
  add column if not exists tenant_profile_id uuid
    references public.profiles(id) on delete set null;
create index if not exists residents_tenant_profile_id_idx
  on public.residents (tenant_profile_id);

-- ============================================================================
-- 2. RLS — let the tenant READ their own unit's roster row (board write +
--    owner read policies are untouched; RLS combines permissive policies with OR).
-- ============================================================================
drop policy if exists "tenant reads own unit" on public.residents;
create policy "tenant reads own unit"
  on public.residents for select to authenticated
  using (tenant_profile_id = auth.uid());

-- ============================================================================
-- 3. MEMBERSHIP — a tenant becomes a community member (so they can sign in and
--    see the community) by extending ev_membership_upsert to also fire for
--    tenant_profile_id. Role 'resident' (NON-voting; voting is gated by
--    unit_number, which tenants never get — see the safety note above).
-- ============================================================================
create or replace function public.ev_membership_upsert()
returns trigger language plpgsql security definer as $$
begin
  -- Owner activation (unchanged).
  if new.profile_id is not null
     and (tg_op = 'INSERT' or old.profile_id is distinct from new.profile_id)
  then
    insert into public.ev_membership (profile_id, community_id, role)
    values (
      new.profile_id, new.community_id,
      coalesce((select role from public.profiles where id = new.profile_id), 'resident')
    )
    on conflict (profile_id, community_id) do nothing;
  end if;

  -- Tenant activation (new): a leased unit's tenant joins as a 'resident' member.
  -- They never receive a unit_number, so they remain non-voting.
  if new.tenant_profile_id is not null
     and (tg_op = 'INSERT' or old.tenant_profile_id is distinct from new.tenant_profile_id)
  then
    insert into public.ev_membership (profile_id, community_id, role)
    values (new.tenant_profile_id, new.community_id, 'resident')
    on conflict (profile_id, community_id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists ev_membership_upsert_trg on public.residents;
create trigger ev_membership_upsert_trg
  after insert or update of profile_id, tenant_profile_id on public.residents
  for each row execute function public.ev_membership_upsert();
