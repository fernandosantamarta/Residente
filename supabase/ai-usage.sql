-- AI usage metering + the per-community monthly $ cap.
--
-- Records one row per AI extraction call (extract-roster / extract-setup /
-- extract-doc). The edge functions sum the community's month-to-date spend and
-- refuse once it crosses the cap (default $5/mo). The Platform Console "AI
-- Insights" tab reads aggregates via security-definer RPCs (platform admins
-- only), mirroring platform_overview().
--
-- Safe to re-run. Run once in the Supabase SQL editor. The edge functions fail
-- OPEN until this exists (so the readers keep working before it's applied).

-- Per-community monthly cap in cents. Default $5.00. Raise/lower per community
-- (or, later, per plan tier). 0 = AI turned OFF for that community (the kill
-- switch); NULL = the edge-function default. The Platform Console's AI Insights
-- tab edits this (numeric cap + an On/Off toggle that flips between $0 and $5).
alter table public.communities
  add column if not exists ai_monthly_cap_cents int default 500;

create table if not exists public.ev_ai_usage (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  fn text not null,                       -- 'extract-roster' | 'extract-setup' | 'extract-doc'
  kind text,                              -- 'roster' | 'budget' | 'insurance' | 'rules' | null
  model text,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_cents numeric(12,4) default 0,     -- computed in the edge fn from token usage
  created_by uuid,
  created_at timestamptz default now()
);
create index if not exists ev_ai_usage_comm_time on public.ev_ai_usage (community_id, created_at desc);

alter table public.ev_ai_usage enable row level security;
-- The edge functions write/read via the service role (bypasses RLS). The only
-- client-side reader is the Platform Console's AI Insights tab, which is
-- OWNER-ONLY — no other Residente operator role can read AI cost/budget data.
drop policy if exists "platform admin reads ai usage" on public.ev_ai_usage;
drop policy if exists "platform owner reads ai usage" on public.ev_ai_usage;
create policy "platform owner reads ai usage" on public.ev_ai_usage
  for select to authenticated using ( public.is_platform_owner(auth.uid()) );

-- ---------- PLATFORM: AI usage per community (operator only) ----------
-- Current-calendar-month spend + calls, lifetime spend + calls, the cap, and
-- when each community last used AI. Ordered by this month's spend, highest first.
drop function if exists public.platform_ai_usage();
create or replace function public.platform_ai_usage()
returns table (
  community_id uuid, name text, plan text,
  cap_cents int,
  month_cost_cents numeric, month_calls bigint,
  total_cost_cents numeric, total_calls bigint,
  last_used_at timestamptz
) language plpgsql stable security definer as $$
begin
  -- Owner-only: AI cost/budget is restricted to platform owners.
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'not a platform owner';
  end if;
  return query
    select c.id, c.name, c.plan,
      coalesce(c.ai_monthly_cap_cents, 500),
      coalesce((select sum(u.cost_cents) from public.ev_ai_usage u
        where u.community_id = c.id and u.created_at >= date_trunc('month', now())), 0),
      (select count(*) from public.ev_ai_usage u
        where u.community_id = c.id and u.created_at >= date_trunc('month', now())),
      coalesce((select sum(u.cost_cents) from public.ev_ai_usage u where u.community_id = c.id), 0),
      (select count(*) from public.ev_ai_usage u where u.community_id = c.id),
      (select max(u.created_at) from public.ev_ai_usage u where u.community_id = c.id)
    from public.communities c
    order by 5 desc nulls last, c.name;
end $$;
grant execute on function public.platform_ai_usage() to authenticated;

-- ---------- PLATFORM: set a community's monthly AI cap (operator only) ----------
create or replace function public.platform_set_ai_cap(p_community uuid, p_cents int)
returns void language plpgsql security definer as $$
begin
  -- Owner-only: changing a community's AI cap / kill switch.
  if not public.is_platform_owner(auth.uid()) then raise exception 'not a platform owner'; end if;
  update public.communities set ai_monthly_cap_cents = greatest(0, coalesce(p_cents, 500))
    where id = p_community;
end $$;
grant execute on function public.platform_set_ai_cap(uuid, int) to authenticated;

-- ---------- PLATFORM: AI usage broken down by FEATURE (operator/owner only) ----------
-- "Where is AI being used most" — one row per (function, document kind): roster,
-- budget, insurance, rules, categorize (records filing), minutes, violation photos.
-- This-month + lifetime spend/calls. Ordered by this month's spend, highest first.
drop function if exists public.platform_ai_usage_by_kind();
create or replace function public.platform_ai_usage_by_kind()
returns table (
  fn text, kind text,
  month_cost_cents numeric, month_calls bigint,
  total_cost_cents numeric, total_calls bigint
) language plpgsql stable security definer as $$
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'not a platform owner';
  end if;
  return query
    select u.fn, coalesce(u.kind, '') as kind,
      coalesce(sum(u.cost_cents) filter (where u.created_at >= date_trunc('month', now())), 0),
      coalesce(count(*) filter (where u.created_at >= date_trunc('month', now())), 0),
      coalesce(sum(u.cost_cents), 0),
      count(*)
    from public.ev_ai_usage u
    group by u.fn, coalesce(u.kind, '')
    order by 3 desc nulls last;
end $$;
grant execute on function public.platform_ai_usage_by_kind() to authenticated;
