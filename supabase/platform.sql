-- ============================================================
-- Residente — Platform layer (the company that runs the communities)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Two things normal community admins never get:
--   1. platform_admins  — the Residente founders (cross-community operators)
--   2. platform_requests — "Contact Residente" support tickets from boards
-- Cross-community reads go through the guarded, security-definer
-- platform_overview() function — NOT through loosened base-table RLS — so a
-- community can never see another community's data. Only platform admins can
-- call it.

-- ---------- PLATFORM ADMINS (the founders) ----------
create table if not exists public.platform_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now()
);

-- security definer so it can read platform_admins from inside other policies
-- without recursion / without granting blanket select on the table.
create or replace function public.is_platform_admin(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.platform_admins where profile_id = uid);
$$;
grant execute on function public.is_platform_admin(uuid) to authenticated;

alter table public.platform_admins enable row level security;
grant select on public.platform_admins to authenticated;
drop policy if exists "platform admins read admins" on public.platform_admins;
create policy "platform admins read admins"
  on public.platform_admins for select to authenticated
  using ( public.is_platform_admin(auth.uid()) );

-- Seed the three founders (idempotent).
insert into public.platform_admins (profile_id)
select id from public.profiles
where email in (
  'fernandosantamarta@rocketmail.com',
  'carballodominic@gmail.com',
  'andresvegalaw@icloud.com'
)
on conflict (profile_id) do nothing;

-- ---------- PLATFORM OVERVIEW (all communities + stats) ----------
-- Guarded definer function: the ONLY cross-community read path. Raises if the
-- caller isn't a platform admin.
-- created_by records the founding admin (set by signup-provision). Older
-- communities won't have it; platform_overview falls back to the earliest board
-- member for the "Created by" column.
alter table public.communities add column if not exists created_by uuid;

-- Drop first: the RETURNS TABLE signature changed (added billing columns), and
-- Postgres won't CREATE OR REPLACE a function whose OUT columns differ.
drop function if exists public.platform_overview();
create or replace function public.platform_overview()
returns table (
  id uuid, name text, location text, subscription_status text, join_code text,
  created_at timestamptz, resident_count bigint, board_count bigint,
  plan text, home_count int, unit_count int, stripe_subscription_id text,
  created_by_name text, created_by_email text
) language plpgsql stable security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not a platform admin';
  end if;
  return query
    select c.id, c.name, c.location, c.subscription_status, c.join_code, c.created_at,
      (select count(*) from public.residents r where r.community_id = c.id),
      (select count(*) from public.residents r where r.community_id = c.id and r.is_board),
      c.plan, c.home_count, c.unit_count, c.stripe_subscription_id,
      coalesce(
        (select r.full_name from public.residents r where r.community_id = c.id and r.profile_id = c.created_by limit 1),
        (select r.full_name from public.residents r where r.community_id = c.id and r.is_board order by r.created_at nulls last limit 1)
      ),
      coalesce(
        (select r.email from public.residents r where r.community_id = c.id and r.profile_id = c.created_by limit 1),
        (select r.email from public.residents r where r.community_id = c.id and r.is_board order by r.created_at nulls last limit 1)
      )
    from public.communities c
    order by c.created_at desc nulls last;
end $$;
grant execute on function public.platform_overview() to authenticated;

-- ---------- PLATFORM: a community's residents (operator only) ----------
-- Lets the Platform Console list + remove residents of any community without
-- entering it. Guarded definer fns — raise for non-operators.
create or replace function public.platform_community_residents(p_community uuid)
returns table (id uuid, full_name text, email text, unit_number text, board_position text, is_board boolean, created_at timestamptz)
language plpgsql stable security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'not a platform admin'; end if;
  return query
    select r.id, r.full_name, r.email, r.unit_number, r.board_position, r.is_board, r.created_at
    from public.residents r
    where r.community_id = p_community
    order by r.is_board desc, r.full_name nulls last;
end $$;
grant execute on function public.platform_community_residents(uuid) to authenticated;

create or replace function public.platform_remove_resident(p_resident uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'not a platform admin'; end if;
  delete from public.residents where id = p_resident;
end $$;
grant execute on function public.platform_remove_resident(uuid) to authenticated;

-- ---------- CONTACT RESIDENTE (support tickets) ----------
create table if not exists public.platform_requests (
  id               uuid primary key default gen_random_uuid(),
  from_profile_id  uuid references public.profiles(id) on delete set null,
  from_community_id uuid references public.communities(id) on delete set null,
  from_name        text,
  from_email       text,
  subject          text not null,
  body             text,
  status           text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at       timestamptz not null default now()
);
alter table public.platform_requests enable row level security;
grant select, insert, update on public.platform_requests to authenticated;

-- A board/admin opens a ticket for their own account.
drop policy if exists "board submits platform request" on public.platform_requests;
create policy "board submits platform request"
  on public.platform_requests for insert to authenticated
  with check (
    from_profile_id = auth.uid()
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- The submitter sees their own tickets; platform admins see + manage all.
drop policy if exists "submitter reads own platform request" on public.platform_requests;
create policy "submitter reads own platform request"
  on public.platform_requests for select to authenticated
  using ( from_profile_id = auth.uid() );

drop policy if exists "platform admins read requests" on public.platform_requests;
create policy "platform admins read requests"
  on public.platform_requests for select to authenticated
  using ( public.is_platform_admin(auth.uid()) );

drop policy if exists "platform admins update requests" on public.platform_requests;
create policy "platform admins update requests"
  on public.platform_requests for update to authenticated
  using ( public.is_platform_admin(auth.uid()) );
