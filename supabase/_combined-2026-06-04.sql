-- ============================================================
-- Residente — combined prod patch (2026-06-04). Idempotent: safe to re-run.
-- Paste the whole thing into the Supabase SQL editor and Run.
--   1) my_permissions()  — fix fresh-admin /admin lockout
--   2) platform_overview() — add billing columns for the Subscriptions tab
--   3) platform residents — list + remove from the Platform Console
-- ============================================================

-- 1) my_permissions(): a freshly provisioned owner/board member has a resident
--    row with role_id NULL — don't lock them out; fall through to profiles.role.
create or replace function public.my_permissions()
returns text[] language sql stable security definer as $func$
  select case
    when public.is_platform_admin(auth.uid()) then array['*']
    when exists (select 1 from public.residents r where r.profile_id = auth.uid() and r.role_id is not null) then (
      select case when ro.is_admin then array['*'] else coalesce(ro.permissions, '{}') end
      from public.residents r join public.ev_roles ro on ro.id = r.role_id
      where r.profile_id = auth.uid() limit 1
    )
    when exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','board_member')) then array['*']
    else '{}'::text[]
  end;
$func$;
grant execute on function public.my_permissions() to authenticated;

-- 2) platform_overview(): add plan/home_count/unit_count/stripe_subscription_id.
--    Drop first — the RETURNS TABLE signature changed.
drop function if exists public.platform_overview();
create or replace function public.platform_overview()
returns table (
  id uuid, name text, location text, subscription_status text, join_code text,
  created_at timestamptz, resident_count bigint, board_count bigint,
  plan text, home_count int, unit_count int, stripe_subscription_id text
) language plpgsql stable security definer as $func$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  return query
    select c.id, c.name, c.location, c.subscription_status, c.join_code, c.created_at,
      (select count(*) from public.residents r where r.community_id = c.id),
      (select count(*) from public.residents r where r.community_id = c.id and r.is_board),
      c.plan, c.home_count, c.unit_count, c.stripe_subscription_id
    from public.communities c
    order by c.created_at desc nulls last;
end $func$;
grant execute on function public.platform_overview() to authenticated;

-- 3) Platform Console: list + remove a community's residents (operator only).
create or replace function public.platform_community_residents(p_community uuid)
returns table (id uuid, full_name text, email text, unit_number text, board_position text, is_board boolean, created_at timestamptz)
language plpgsql stable security definer as $func$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'not a platform admin'; end if;
  return query
    select r.id, r.full_name, r.email, r.unit_number, r.board_position, r.is_board, r.created_at
    from public.residents r
    where r.community_id = p_community
    order by r.is_board desc, r.full_name nulls last;
end $func$;
grant execute on function public.platform_community_residents(uuid) to authenticated;

create or replace function public.platform_remove_resident(p_resident uuid)
returns void language plpgsql security definer as $func$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'not a platform admin'; end if;
  delete from public.residents where id = p_resident;
end $func$;
grant execute on function public.platform_remove_resident(uuid) to authenticated;
