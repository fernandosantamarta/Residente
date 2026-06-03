-- ============================================================
-- Residente — Community custom roles & permissions
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- Turns the coarse "board_member sees ALL of /admin" model into per-board-member
-- permissions a community can shape itself. Mirrors the platform-roles.sql
-- pattern (DB-enforced via security-definer functions, lockout guards, audit).
--
--   • ev_roles            — named roles per community, each with a permission set
--   • residents.role_id   — which role a board member holds (null = legacy/full)
--   • has_permission()    — the check RLS policies and the app both call
--   • manage functions    — create / update / delete / assign, admin-gated
--
-- BACKWARD COMPATIBLE: a board_member with no role assigned keeps full access,
-- so nothing breaks the moment this runs. Permissions only narrow once a role
-- is assigned to that member.

-- ---------- PERMISSION TAXONOMY ----------
-- Permission keys are plain text, grouped by admin area. The app and RLS share
-- this list (mirror it in lib/permissions.ts). 'is_admin' roles bypass the list.
--   community.manage     — community settings, setup
--   residents.view / .manage   — roster (Easy Track)
--   financials.view / .manage  — budgets, expenses, reserves, reports
--   payments.view / .manage    — dues, collections
--   documents.manage     — documents, rules
--   violations.manage    — violations, compliance, enforcement
--   voice.manage         — meetings, voting, board, committees, requests
--   schedule.manage      — calendar, amenities
--   roles.manage         — create/assign roles (the meta-permission)

-- ---------- ROLES TABLE ----------
create table if not exists public.ev_roles (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  name          text not null,
  permissions   text[] not null default '{}',
  is_admin      boolean not null default false,   -- full access, ignores permissions[]
  is_system     boolean not null default false,   -- seeded default; cannot be deleted
  created_at    timestamptz not null default now(),
  unique (community_id, name)
);

alter table public.residents
  add column if not exists role_id uuid references public.ev_roles(id) on delete set null;

-- ---------- THE CHECK (used by RLS + the app) ----------
-- True when the signed-in user holds a role granting `perm` in their community,
-- OR is a legacy board_member/admin with no custom role assigned yet (full access
-- until a role is explicitly given — keeps existing boards working on day one).
create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer as $$
  select
    exists (
      select 1
      from public.residents r
      join public.ev_roles ro on ro.id = r.role_id
      where r.profile_id = auth.uid()
        and (ro.is_admin or perm = any(ro.permissions))
    )
    or exists (
      -- Legacy fallback: board_member/admin who hasn't been given a role yet.
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('board_member', 'admin')
        and not exists (
          select 1 from public.residents r2
          where r2.profile_id = auth.uid() and r2.role_id is not null
        )
    );
$$;
grant execute on function public.has_permission(text) to authenticated;

-- Convenience: the caller's full permission set (for the app to gate UI without
-- a round-trip per permission). Returns ['*'] for admin/legacy-full.
create or replace function public.my_permissions()
returns text[] language sql stable security definer as $$
  select case
    when exists (
      select 1 from public.residents r join public.ev_roles ro on ro.id = r.role_id
      where r.profile_id = auth.uid() and ro.is_admin
    ) then array['*']
    when exists (
      select 1 from public.residents r where r.profile_id = auth.uid() and r.role_id is not null
    ) then (
      select coalesce(ro.permissions, '{}')
      from public.residents r join public.ev_roles ro on ro.id = r.role_id
      where r.profile_id = auth.uid() limit 1
    )
    when exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('board_member','admin')
    ) then array['*']
    else '{}'::text[]
  end;
$$;
grant execute on function public.my_permissions() to authenticated;

-- ---------- RLS ON ev_roles ITSELF ----------
alter table public.ev_roles enable row level security;
grant select on public.ev_roles to authenticated;  -- writes go through definer fns only

drop policy if exists "roles readable in community" on public.ev_roles;
create policy "roles readable in community"
  on public.ev_roles for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

-- ---------- SEED DEFAULT SYSTEM ROLES (per community) ----------
-- Idempotent: only inserts a (community, name) pair that's missing. Tweak the
-- permission sets to taste — boards can clone/edit these from the UI later.
insert into public.ev_roles (community_id, name, permissions, is_admin, is_system)
select c.id, v.name, v.perms, v.is_admin, true
from public.communities c
cross join (values
  ('Admin',      '{}'::text[], true),
  ('Treasurer',  array['financials.view','financials.manage','payments.view','payments.manage','residents.view'], false),
  ('Secretary',  array['documents.manage','voice.manage','residents.view'], false),
  ('Board member', array['residents.view','financials.view','payments.view','voice.manage'], false)
) as v(name, perms, is_admin)
on conflict (community_id, name) do nothing;

-- ---------- BACKFILL: give existing board members the Admin role ----------
-- So today's boards land in an explicit, editable role instead of the legacy
-- fallback. Only touches board members who don't already have a role.
update public.residents r
set role_id = (
  select ro.id from public.ev_roles ro
  where ro.community_id = r.community_id and ro.is_admin limit 1
)
where r.role_id is null
  and r.board_position is not null
  and exists (
    select 1 from public.profiles p
    where p.id = r.profile_id and p.role in ('board_member','admin')
  );

-- ---------- MANAGE FUNCTIONS (roles.manage-gated) ----------
-- Create or rename+repermission a role. is_admin/is_system roles are protected
-- from having their admin/system flags flipped here.
create or replace function public.ev_role_save(p_id uuid, p_name text, p_perms text[])
returns uuid language plpgsql security definer as $$
declare cid uuid; rid uuid;
begin
  if not public.has_permission('roles.manage') then raise exception 'not allowed'; end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'no community'; end if;
  if p_id is null then
    insert into public.ev_roles (community_id, name, permissions)
    values (cid, trim(p_name), coalesce(p_perms,'{}')) returning id into rid;
  else
    update public.ev_roles
      set name = trim(p_name), permissions = coalesce(p_perms,'{}')
      where id = p_id and community_id = cid and not is_admin
      returning id into rid;
    if rid is null then raise exception 'role not found or protected'; end if;
  end if;
  return rid;
end $$;
grant execute on function public.ev_role_save(uuid, text, text[]) to authenticated;

-- Delete a role (not system/admin). Members holding it fall back to null (=legacy
-- full access only if they're board_member; otherwise no admin access).
create or replace function public.ev_role_delete(p_id uuid)
returns void language plpgsql security definer as $$
declare cid uuid;
begin
  if not public.has_permission('roles.manage') then raise exception 'not allowed'; end if;
  select community_id into cid from public.profiles where id = auth.uid();
  delete from public.ev_roles
    where id = p_id and community_id = cid and not is_system and not is_admin;
  if not found then raise exception 'role not found or protected'; end if;
end $$;
grant execute on function public.ev_role_delete(uuid) to authenticated;

-- Assign a role to a resident (board member). Guard: never strip the LAST person
-- who can manage roles, so a community can't lock itself out.
create or replace function public.ev_role_assign(p_resident uuid, p_role uuid)
returns void language plpgsql security definer as $$
declare cid uuid; admins_left int;
begin
  if not public.has_permission('roles.manage') then raise exception 'not allowed'; end if;
  select community_id into cid from public.profiles where id = auth.uid();
  -- If this change would remove the resident's roles.manage ability, ensure
  -- someone else still has it.
  if exists (
    select 1 from public.residents r join public.ev_roles ro on ro.id = r.role_id
    where r.id = p_resident and (ro.is_admin or 'roles.manage' = any(ro.permissions))
  ) and not (
    p_role is not null and exists (
      select 1 from public.ev_roles ro where ro.id = p_role
        and (ro.is_admin or 'roles.manage' = any(ro.permissions))
    )
  ) then
    select count(*) into admins_left
    from public.residents r join public.ev_roles ro on ro.id = r.role_id
    where r.community_id = cid and r.id <> p_resident
      and (ro.is_admin or 'roles.manage' = any(ro.permissions));
    if admins_left < 1 then raise exception 'cannot remove the last role manager'; end if;
  end if;
  update public.residents set role_id = p_role
    where id = p_resident and community_id = cid;
  if not found then raise exception 'resident not found'; end if;
end $$;
grant execute on function public.ev_role_assign(uuid, uuid) to authenticated;
