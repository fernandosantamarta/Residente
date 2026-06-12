-- ============================================================
-- Residente — Transferable community ownership + DB-enforced role walls
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Three fixes in one migration:
--   1. OWNERSHIP IS A HAT, NOT A POSSESSION. communities.owner_profile_id is
--      the current owner (reassignable); created_by stays as history. The
--      owner can hand the hat to any board member; a Residente operator can
--      reassign it from the Platform Console (orphaned-community backstop).
--   2. OPERATORS DON'T NEED A COMMUNITY. platform_exit_community() lets an
--      operator park at community_id = NULL — /platform is their home.
--   3. ROLE WALLS LIVE IN THE DB. platform_overview now masks money fields
--      (plan, Stripe id) unless the caller is owner/billing, and returns only
--      a minimal directory to support. Resident rosters and removals are
--      role-gated and removals are audited. Deleting React that hides a tab
--      no longer exposes anything.

-- ============================================================
-- PART 1 — TRANSFERABLE OWNERSHIP
-- ============================================================

alter table public.communities
  add column if not exists owner_profile_id uuid references public.profiles(id) on delete set null;

-- Backfill: the founding admin if they still belong to the community; else the
-- earliest board member with an account; else any community admin who isn't
-- Residente staff (an operator may be temporarily "entered" into the community
-- and must never be picked up as its owner). Re-runnable: only fills nulls.
update public.communities c
set owner_profile_id = coalesce(
  (select p.id from public.profiles p
     where p.id = c.created_by and p.community_id = c.id),
  (select r.profile_id from public.residents r
     where r.community_id = c.id and r.is_board and r.profile_id is not null
     order by r.created_at nulls last limit 1),
  (select p.id from public.profiles p
     where p.community_id = c.id and p.role = 'admin'
       and not public.is_platform_admin(p.id)
     limit 1)
)
where c.owner_profile_id is null;

-- The caller's community's current owner (for the community Settings page).
-- Definer so the name/email resolve regardless of profiles RLS.
create or replace function public.community_owner_info()
returns table (owner_profile_id uuid, owner_name text, owner_email text)
language plpgsql stable security definer as $$
declare cid uuid;
begin
  select p.community_id into cid from public.profiles p where p.id = auth.uid();
  if cid is null then return; end if;
  return query
    select c.owner_profile_id, pr.full_name, pr.email
    from public.communities c
    left join public.profiles pr on pr.id = c.owner_profile_id
    where c.id = cid;
end $$;
grant execute on function public.community_owner_info() to authenticated;

-- Who the owner can hand the hat to: members of the caller's community with an
-- account who hold a board seat (or admin/board profile role). Excludes the
-- current owner and Residente staff. Owner (or an operator) only.
create or replace function public.community_owner_candidates()
returns table (profile_id uuid, full_name text, email text, board_position text)
language plpgsql stable security definer as $$
declare cid uuid; oid uuid;
begin
  select p.community_id into cid from public.profiles p where p.id = auth.uid();
  if cid is null then return; end if;
  select c.owner_profile_id into oid from public.communities c where c.id = cid;
  if auth.uid() is distinct from oid and not public.is_platform_admin(auth.uid()) then
    raise exception 'only the community owner can transfer ownership';
  end if;
  -- distinct on (p.id): a member can hold several roster rows (multi-role),
  -- but must appear once in the picker — prefer their board row.
  return query
    select distinct on (p.id)
      p.id, coalesce(r.full_name, p.full_name), coalesce(r.email, p.email), r.board_position
    from public.profiles p
    left join public.residents r on r.profile_id = p.id and r.community_id = cid
    where p.community_id = cid
      and p.id is distinct from oid
      and not public.is_platform_admin(p.id)
      and (p.role in ('admin','board_member') or r.is_board is true)
    order by p.id, r.is_board desc nulls last;
end $$;
grant execute on function public.community_owner_candidates() to authenticated;

-- Transfer ownership. Allowed: the community's current owner, or a Residente
-- owner/operator (the Platform Console backstop for orphaned communities —
-- support/billing staff cannot). The new owner must hold an account in the
-- community and must not be Residente staff. Ownership grants admin access,
-- so the new owner's profile role is promoted; the old owner keeps whatever
-- role they had (demotion is a separate, deliberate act). Always audited.
create or replace function public.community_transfer_ownership(p_community uuid, p_new_owner uuid)
returns void language plpgsql security definer as $$
declare cur_owner uuid; cname text; op_role text; tgt_name text;
begin
  select c.owner_profile_id, c.name into cur_owner, cname
  from public.communities c where c.id = p_community;
  if not found then raise exception 'community not found'; end if;
  op_role := public.platform_role(auth.uid());
  if auth.uid() is distinct from cur_owner
     and (op_role is null or op_role not in ('owner','operator')) then
    raise exception 'only the community owner or a Residente operator can transfer ownership';
  end if;
  if public.is_platform_admin(p_new_owner) then
    raise exception 'Residente staff cannot own a community';
  end if;
  if not exists (select 1 from public.profiles p
                 where p.id = p_new_owner and p.community_id = p_community) then
    raise exception 'the new owner must have an account in this community';
  end if;
  update public.communities set owner_profile_id = p_new_owner where id = p_community;
  update public.profiles set role = 'admin' where id = p_new_owner and role <> 'admin';
  select coalesce(full_name, email) into tgt_name from public.profiles where id = p_new_owner;
  perform public.platform_log('ownership_transferred', 'community', p_community::text,
    jsonb_build_object('name', cname, 'to', tgt_name, 'by_operator', op_role is not null));
end $$;
grant execute on function public.community_transfer_ownership(uuid, uuid) to authenticated;

-- ============================================================
-- PART 2 — OPERATORS WITHOUT A COMMUNITY
-- ============================================================

-- Leave whatever community the operator is currently pointed at and park at
-- "no community" — /platform is the operator's home. (Returning to a real home
-- community still goes through platform_enter_community, which audits.)
create or replace function public.platform_exit_community()
returns void language plpgsql security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  update public.profiles set community_id = null where id = auth.uid();
end $$;
grant execute on function public.platform_exit_community() to authenticated;

-- ============================================================
-- PART 3 — ROLE WALLS IN THE DB (not just hidden tabs)
-- ============================================================

-- platform_overview, role-aware. What each operator role gets back:
--   owner / billing — everything, including money (plan, Stripe id)
--   operator        — full operational detail, money fields NULLed
--   support         — a minimal directory (id/name/location/created_at) so the
--                     inbox can resolve community names; everything else NULL
-- The UI's tab-hiding is now cosmetic on top of this, not the wall itself.
-- Signature changed (owner columns added) → drop before recreate.
drop function if exists public.platform_overview();
create or replace function public.platform_overview()
returns table (
  id uuid, name text, location text, subscription_status text, join_code text,
  created_at timestamptz, resident_count bigint, board_count bigint,
  plan text, home_count int, unit_count int, stripe_subscription_id text,
  created_by_name text, created_by_email text,
  owner_profile_id uuid, owner_name text, owner_email text
) language plpgsql stable security definer as $$
declare r text; money boolean; ops boolean;
begin
  r := public.platform_role(auth.uid());
  if r is null then raise exception 'not a platform admin'; end if;
  money := r in ('owner','billing');   -- who may see revenue fields
  ops   := r <> 'support';             -- who may see operational detail
  return query
    select c.id, c.name, c.location,
      case when ops then c.subscription_status end,
      case when ops then c.join_code end,
      c.created_at,
      case when ops then (select count(*) from public.residents r2 where r2.community_id = c.id) end,
      case when ops then (select count(*) from public.residents r2 where r2.community_id = c.id and r2.is_board) end,
      case when money then c.plan end,
      case when ops then c.home_count end,
      case when ops then c.unit_count end,
      case when money then c.stripe_subscription_id end,
      case when ops then coalesce(
        (select r2.full_name from public.residents r2 where r2.community_id = c.id and r2.profile_id = c.created_by limit 1),
        (select r2.full_name from public.residents r2 where r2.community_id = c.id and r2.is_board order by r2.created_at nulls last limit 1)
      ) end,
      case when ops then coalesce(
        (select r2.email from public.residents r2 where r2.community_id = c.id and r2.profile_id = c.created_by limit 1),
        (select r2.email from public.residents r2 where r2.community_id = c.id and r2.is_board order by r2.created_at nulls last limit 1)
      ) end,
      case when ops then c.owner_profile_id end,
      case when ops then (select pr.full_name from public.profiles pr where pr.id = c.owner_profile_id) end,
      case when ops then (select pr.email from public.profiles pr where pr.id = c.owner_profile_id) end
    from public.communities c
    order by c.created_at desc nulls last;
end $$;
grant execute on function public.platform_overview() to authenticated;

-- Rosters: support staff work the inbox only — no pulling resident lists.
-- Signature changed (profile_id added, for the ownership-transfer picker) →
-- drop before recreate.
drop function if exists public.platform_community_residents(uuid);
create or replace function public.platform_community_residents(p_community uuid)
returns table (
  id uuid, profile_id uuid, full_name text, email text, unit_number text,
  board_position text, is_board boolean, created_at timestamptz
) language plpgsql stable security definer as $$
declare r text;
begin
  r := public.platform_role(auth.uid());
  if r is null or r = 'support' then raise exception 'not allowed for this role'; end if;
  return query
    select res.id, res.profile_id, res.full_name, res.email, res.unit_number,
           res.board_position, res.is_board, res.created_at
    from public.residents res
    where res.community_id = p_community
    order by res.is_board desc, res.full_name nulls last;
end $$;
grant execute on function public.platform_community_residents(uuid) to authenticated;

-- Removing a resident is destructive: owner/operator only, and audited.
create or replace function public.platform_remove_resident(p_resident uuid)
returns void language plpgsql security definer as $$
declare r text; v_name text; v_comm text;
begin
  r := public.platform_role(auth.uid());
  if r is null or r not in ('owner','operator') then
    raise exception 'not allowed for this role';
  end if;
  select res.full_name, c.name into v_name, v_comm
  from public.residents res left join public.communities c on c.id = res.community_id
  where res.id = p_resident;
  delete from public.residents where id = p_resident;
  perform public.platform_log('resident_removed', 'resident', p_resident::text,
    jsonb_build_object('name', v_name, 'community', v_comm));
end $$;
grant execute on function public.platform_remove_resident(uuid) to authenticated;
