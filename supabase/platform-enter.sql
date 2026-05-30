-- ============================================================
-- Residente — Platform: enter a community to manage it
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Lets a Residente operator drop into ANY community's admin to run it, by
-- repointing their own active community to the target. Operator-only — the
-- guard makes it impossible for a normal community admin to jump tenants.
-- The app remembers where to return (localStorage) and the Community Switcher
-- brings the operator back to their own community.

create or replace function public.platform_enter_community(target uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  update public.profiles set community_id = target where id = auth.uid();
end $$;

grant execute on function public.platform_enter_community(uuid) to authenticated;

-- The operators list (Residente founders) with names + emails. Definer so an
-- operator can read fellow operators' profiles regardless of profiles RLS.
create or replace function public.platform_operators()
returns table (name text, email text, added_at timestamptz)
language plpgsql stable security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  return query
    select coalesce(p.full_name, 'Operator'), p.email, pa.added_at
    from public.platform_admins pa
    join public.profiles p on p.id = pa.profile_id
    order by pa.added_at asc;
end $$;

grant execute on function public.platform_operators() to authenticated;
