-- ============================================================
-- Residente — Operator multi-role + owner step-down on transfer
-- Run once in the Supabase SQL editor, AFTER ownership-and-role-walls.sql.
-- Safe to re-run. (If you ever re-run ownership-and-role-walls.sql, re-run
-- this file after it — it supersedes several functions defined there.)
-- ============================================================
--
-- Two upgrades:
--   1. MULTI-ROLE OPERATORS. An employee can hold a primary team plus extra
--      teams (e.g. Onboarding + Billing). platform_admins.extra_roles carries
--      the extras; platform_roles(uid) returns the full set; every role wall
--      now checks the SET, so access is the union of their teams. "Manage
--      everything" stays what it always was: the owner (Founder) role.
--   2. OWNER STEP-DOWN. community_transfer_ownership gains p_step_down: the
--      outgoing owner can hand over the hat AND drop to a regular resident
--      (admin role, board seat, and any assigned custom role cleared) in the
--      same act, instead of always keeping admin.

-- ---------- EXTRA ROLES ON platform_admins ----------
alter table public.platform_admins
  add column if not exists extra_roles text[] not null default '{}';

-- Extras can only be the non-owner teams: owner stays a primary-only role so
-- the last-owner guards in platform-roles.sql keep working unchanged.
do $$ begin
  alter table public.platform_admins
    add constraint platform_admins_extra_roles_chk
    check (extra_roles <@ array['operator','support','billing']::text[]);
exception when duplicate_object then null; end $$;

-- The operator's FULL role set (primary + extras). Empty for non-operators.
create or replace function public.platform_roles(uid uuid)
returns text[] language sql stable security definer as $$
  select coalesce(
    (select array(select distinct r from unnest(array[pa.role] || pa.extra_roles) r)
     from public.platform_admins pa where pa.profile_id = uid),
    '{}'::text[]
  );
$$;
grant execute on function public.platform_roles(uuid) to authenticated;

-- Owner-only: set an operator's extra teams. An owner-primary operator already
-- has everything, so extras are forced empty for them. Audited.
create or replace function public.platform_set_operator_extra_roles(target uuid, extras text[])
returns void language plpgsql security definer as $$
declare cur_role text;
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'only owners can manage operators';
  end if;
  if not (coalesce(extras, '{}') <@ array['operator','support','billing']::text[]) then
    raise exception 'invalid extra role';
  end if;
  select role into cur_role from public.platform_admins where profile_id = target;
  if cur_role is null then raise exception 'not an operator'; end if;
  update public.platform_admins
  set extra_roles = case when cur_role = 'owner' then '{}'::text[]
                         else (select coalesce(array(select distinct e from unnest(coalesce(extras,'{}')) e where e <> cur_role), '{}')) end
  where profile_id = target;
  perform public.platform_log('operator_extra_roles', 'operator', target::text,
    jsonb_build_object('primary', cur_role, 'extras', coalesce(extras, '{}')));
end $$;
grant execute on function public.platform_set_operator_extra_roles(uuid, text[]) to authenticated;

-- ---------- OPERATORS LIST (now with extra_roles) ----------
-- Signature changed → drop before recreate.
drop function if exists public.platform_operators();
create or replace function public.platform_operators()
returns table (
  profile_id uuid, name text, email text, role text, extra_roles text[],
  added_by_name text, added_at timestamptz
) language plpgsql stable security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  return query
    select pa.profile_id, coalesce(p.full_name, 'Operator'), p.email, pa.role, pa.extra_roles,
           ab.full_name, pa.added_at
    from public.platform_admins pa
    join public.profiles p on p.id = pa.profile_id
    left join public.profiles ab on ab.id = pa.added_by
    order by case pa.role when 'owner' then 0 when 'operator' then 1 else 2 end, pa.added_at asc;
end $$;
grant execute on function public.platform_operators() to authenticated;

-- ---------- ROLE WALLS, NOW SET-AWARE ----------
-- Supersedes the single-role versions from ownership-and-role-walls.sql /
-- platform-roles.sql: access is the union of the operator's teams.

-- platform_overview: money needs owner/billing in the set; operational detail
-- needs anything beyond support.
drop function if exists public.platform_overview();
create or replace function public.platform_overview()
returns table (
  id uuid, name text, location text, subscription_status text, join_code text,
  created_at timestamptz, resident_count bigint, board_count bigint,
  plan text, home_count int, unit_count int, stripe_subscription_id text,
  created_by_name text, created_by_email text,
  owner_profile_id uuid, owner_name text, owner_email text
) language plpgsql stable security definer as $$
declare rs text[]; money boolean; ops boolean;
begin
  rs := public.platform_roles(auth.uid());
  if coalesce(array_length(rs, 1), 0) = 0 then raise exception 'not a platform admin'; end if;
  money := rs && array['owner','billing'];
  ops   := rs && array['owner','operator','billing'];
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

-- Rosters: any team beyond support.
drop function if exists public.platform_community_residents(uuid);
create or replace function public.platform_community_residents(p_community uuid)
returns table (
  id uuid, profile_id uuid, full_name text, email text, unit_number text,
  board_position text, is_board boolean, created_at timestamptz
) language plpgsql stable security definer as $$
declare rs text[];
begin
  rs := public.platform_roles(auth.uid());
  if not (rs && array['owner','operator','billing']) then
    raise exception 'not allowed for this role';
  end if;
  return query
    select res.id, res.profile_id, res.full_name, res.email, res.unit_number,
           res.board_position, res.is_board, res.created_at
    from public.residents res
    where res.community_id = p_community
    order by res.is_board desc, res.full_name nulls last;
end $$;
grant execute on function public.platform_community_residents(uuid) to authenticated;

-- Removing a resident: owner/operator team required. Audited.
create or replace function public.platform_remove_resident(p_resident uuid)
returns void language plpgsql security definer as $$
declare rs text[]; v_name text; v_comm text;
begin
  rs := public.platform_roles(auth.uid());
  if not (rs && array['owner','operator']) then
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

-- Entering a community: any team beyond support. Audited, as before.
create or replace function public.platform_enter_community(target uuid)
returns void language plpgsql security definer as $$
declare rs text[]; cname text;
begin
  rs := public.platform_roles(auth.uid());
  if coalesce(array_length(rs, 1), 0) = 0 then raise exception 'not a platform admin'; end if;
  if not (rs && array['owner','operator','billing']) then
    raise exception 'support operators cannot enter communities';
  end if;
  update public.profiles set community_id = target where id = auth.uid();
  select name into cname from public.communities where id = target;
  perform public.platform_log('entered_community', 'community', target::text,
    jsonb_build_object('name', cname));
end $$;
grant execute on function public.platform_enter_community(uuid) to authenticated;

-- ---------- OWNERSHIP TRANSFER, NOW WITH STEP-DOWN ----------
-- p_step_down = true: the outgoing owner becomes a regular resident — profile
-- role 'resident', board seat cleared, any assigned custom role removed. The
-- default (false) keeps the old behavior: they stay admin until someone
-- changes it on the roles page. Old 2-arg signature is dropped so there's
-- exactly one version.
drop function if exists public.community_transfer_ownership(uuid, uuid);
drop function if exists public.community_transfer_ownership(uuid, uuid, boolean);
create or replace function public.community_transfer_ownership(
  p_community uuid, p_new_owner uuid, p_step_down boolean default false
) returns void language plpgsql security definer as $$
declare cur_owner uuid; cname text; rs text[]; is_staff boolean; tgt_name text;
begin
  select c.owner_profile_id, c.name into cur_owner, cname
  from public.communities c where c.id = p_community;
  if not found then raise exception 'community not found'; end if;
  if p_new_owner = cur_owner then raise exception 'they already own this community'; end if;
  rs := public.platform_roles(auth.uid());
  is_staff := rs && array['owner','operator'];
  if auth.uid() is distinct from cur_owner and not is_staff then
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
  if p_step_down and cur_owner is not null then
    update public.profiles set role = 'resident' where id = cur_owner;
    update public.residents
    set role_id = null, is_board = false, board_position = null
    where profile_id = cur_owner and community_id = p_community;
  end if;
  select coalesce(full_name, email) into tgt_name from public.profiles where id = p_new_owner;
  perform public.platform_log('ownership_transferred', 'community', p_community::text,
    jsonb_build_object('name', cname, 'to', tgt_name,
                       'by_operator', coalesce(array_length(rs, 1), 0) > 0,
                       'step_down', p_step_down));
end $$;
grant execute on function public.community_transfer_ownership(uuid, uuid, boolean) to authenticated;
