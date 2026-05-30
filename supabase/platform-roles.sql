-- ============================================================
-- Residente — Platform: operator roles + audit log
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Turns the flat "every platform admin has god mode" model into a real team
-- tool you can hand to employees:
--   • roles      — owner / operator / support, enforced in the DB (not just UI)
--   • audit log  — every sensitive action is recorded with who + when
--   • manage     — owners add/remove operators and change roles from the console
--
-- Role powers:
--   owner    — everything, PLUS manage operators (add/remove/change roles)
--   operator — see every community, drop in to manage it, work the support inbox
--   support  — work the support inbox only; CANNOT enter communities
-- All three see the audit log (transparency is the point).

-- ---------- ROLES ON platform_admins ----------
alter table public.platform_admins add column if not exists role     text not null default 'operator';
alter table public.platform_admins add column if not exists added_by uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.platform_admins
    add constraint platform_admins_role_chk check (role in ('owner','operator','support'));
exception when duplicate_object then null; end $$;

-- Everyone who was a platform admin BEFORE roles existed had full god-mode, so
-- they all become owners. Those rows have added_by = null (only the new
-- add-operator flow sets it), which makes this idempotent: operators added later
-- through the console keep their assigned role.
update public.platform_admins set role = 'owner' where added_by is null;

-- The signed-in operator's role (null if not an operator at all).
create or replace function public.platform_role(uid uuid)
returns text language sql stable security definer as $$
  select role from public.platform_admins where profile_id = uid;
$$;
grant execute on function public.platform_role(uuid) to authenticated;

create or replace function public.is_platform_owner(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.platform_admins where profile_id = uid and role = 'owner');
$$;
grant execute on function public.is_platform_owner(uuid) to authenticated;

-- ---------- AUDIT LOG ----------
create table if not exists public.platform_audit_log (
  id               uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name       text,   -- snapshot, so the trail survives profile deletion
  actor_email      text,
  action           text not null,
  target_type      text,
  target_id        text,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
alter table public.platform_audit_log enable row level security;
grant select on public.platform_audit_log to authenticated;  -- NO insert grant: definer fns only

drop policy if exists "platform admins read audit" on public.platform_audit_log;
create policy "platform admins read audit"
  on public.platform_audit_log for select to authenticated
  using ( public.is_platform_admin(auth.uid()) );

-- Internal writer. Not granted to authenticated: it's only ever called from
-- inside the security-definer functions / trigger below (which run as owner),
-- so callers can't forge audit entries.
create or replace function public.platform_log(
  p_action text, p_target_type text, p_target_id text, p_detail jsonb default '{}'::jsonb
) returns void language plpgsql security definer as $$
declare a_name text; a_email text;
begin
  select coalesce(full_name, 'Operator'), email into a_name, a_email
  from public.profiles where id = auth.uid();
  insert into public.platform_audit_log
    (actor_profile_id, actor_name, actor_email, action, target_type, target_id, detail)
  values
    (auth.uid(), a_name, a_email, p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb));
end $$;

-- Read the log (any operator). Capped so a huge table can't be pulled at once.
create or replace function public.platform_audit(p_limit int default 100)
returns table (
  id uuid, actor_name text, actor_email text, action text,
  target_type text, target_id text, detail jsonb, created_at timestamptz
) language plpgsql stable security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  return query
    select l.id, l.actor_name, l.actor_email, l.action,
           l.target_type, l.target_id, l.detail, l.created_at
    from public.platform_audit_log l
    order by l.created_at desc
    limit greatest(1, least(p_limit, 500));
end $$;
grant execute on function public.platform_audit(int) to authenticated;

-- ---------- OPERATORS LIST (now with role + who added them) ----------
-- Return signature changed, so drop before recreate.
drop function if exists public.platform_operators();
create or replace function public.platform_operators()
returns table (
  profile_id uuid, name text, email text, role text,
  added_by_name text, added_at timestamptz
) language plpgsql stable security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  return query
    select pa.profile_id, coalesce(p.full_name, 'Operator'), p.email, pa.role,
           ab.full_name, pa.added_at
    from public.platform_admins pa
    join public.profiles p on p.id = pa.profile_id
    left join public.profiles ab on ab.id = pa.added_by
    order by case pa.role when 'owner' then 0 when 'operator' then 1 else 2 end, pa.added_at asc;
end $$;
grant execute on function public.platform_operators() to authenticated;

-- ---------- MANAGE OPERATORS (owner-only) ----------
-- Add (or re-role) an operator by email. They must already have a Residente account.
create or replace function public.platform_add_operator(target_email text, target_role text default 'operator')
returns void language plpgsql security definer as $$
declare tgt uuid;
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'only owners can manage operators';
  end if;
  if target_role not in ('owner','operator','support') then
    raise exception 'invalid role';
  end if;
  select id into tgt from public.profiles where lower(email) = lower(trim(target_email));
  if tgt is null then
    raise exception 'No Residente account found for %', target_email;
  end if;
  insert into public.platform_admins (profile_id, role, added_by)
  values (tgt, target_role, auth.uid())
  on conflict (profile_id) do update set role = excluded.role;
  perform public.platform_log('operator_added', 'operator', tgt::text,
    jsonb_build_object('email', target_email, 'role', target_role));
end $$;
grant execute on function public.platform_add_operator(text, text) to authenticated;

-- Remove an operator. Guard: never drop the last owner.
create or replace function public.platform_remove_operator(target uuid)
returns void language plpgsql security definer as $$
declare tgt_role text; tgt_email text; owner_count int;
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'only owners can manage operators';
  end if;
  select role into tgt_role from public.platform_admins where profile_id = target;
  if tgt_role is null then return; end if;  -- already gone
  if tgt_role = 'owner' then
    select count(*) into owner_count from public.platform_admins where role = 'owner';
    if owner_count <= 1 then raise exception 'cannot remove the last owner'; end if;
  end if;
  select email into tgt_email from public.profiles where id = target;
  delete from public.platform_admins where profile_id = target;
  perform public.platform_log('operator_removed', 'operator', target::text,
    jsonb_build_object('email', tgt_email, 'role', tgt_role));
end $$;
grant execute on function public.platform_remove_operator(uuid) to authenticated;

-- Change an operator's role. Guard: never demote the last owner.
create or replace function public.platform_set_operator_role(target uuid, new_role text)
returns void language plpgsql security definer as $$
declare cur_role text; owner_count int;
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'only owners can manage operators';
  end if;
  if new_role not in ('owner','operator','support') then
    raise exception 'invalid role';
  end if;
  select role into cur_role from public.platform_admins where profile_id = target;
  if cur_role is null then raise exception 'not an operator'; end if;
  if cur_role = 'owner' and new_role <> 'owner' then
    select count(*) into owner_count from public.platform_admins where role = 'owner';
    if owner_count <= 1 then raise exception 'cannot demote the last owner'; end if;
  end if;
  update public.platform_admins set role = new_role where profile_id = target;
  perform public.platform_log('operator_role_changed', 'operator', target::text,
    jsonb_build_object('from', cur_role, 'to', new_role));
end $$;
grant execute on function public.platform_set_operator_role(uuid, text) to authenticated;

-- ---------- ENTER A COMMUNITY (now role-gated + audited) ----------
-- Replaces the version in platform-enter.sql: support operators are blocked,
-- and every drop-in is recorded.
create or replace function public.platform_enter_community(target uuid)
returns void language plpgsql security definer as $$
declare r text; cname text;
begin
  r := public.platform_role(auth.uid());
  if r is null then raise exception 'not a platform admin'; end if;
  if r = 'support' then raise exception 'support operators cannot enter communities'; end if;
  update public.profiles set community_id = target where id = auth.uid();
  select name into cname from public.communities where id = target;
  perform public.platform_log('entered_community', 'community', target::text,
    jsonb_build_object('name', cname));
end $$;
grant execute on function public.platform_enter_community(uuid) to authenticated;

-- ---------- SUPPORT TICKET STATUS CHANGES (audited via trigger) ----------
-- Status changes go through plain RLS UPDATEs, so a trigger is the only place
-- that catches them all regardless of how they're issued.
create or replace function public.platform_requests_audit()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.platform_log('ticket_status', 'platform_request', new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status, 'subject', new.subject));
  end if;
  return new;
end $$;

drop trigger if exists trg_platform_requests_audit on public.platform_requests;
create trigger trg_platform_requests_audit
  after update on public.platform_requests
  for each row execute function public.platform_requests_audit();
