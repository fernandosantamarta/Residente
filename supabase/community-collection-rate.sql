-- community-collection-rate.sql — run-once, idempotent. Paste into the Supabase SQL editor.
--
-- One member-readable AGGREGATE for the community rating: how much of the dues
-- expected to date has actually been received. SECURITY DEFINER because a
-- resident's payments SELECT is own-rows-only — this exposes a single
-- community-wide ratio, never anyone's individual rows. Non-members get null.
--
-- Consumed by computeCommunityRating (lib/community-health.ts) on the resident
-- Home "Where your dues go" card and the admin Compliance dashboard. Until this
-- runs, both fall back to the budget-pace-only grade (rpc error → null).

create or replace function public.community_collection_rate(p_community uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  with member_check as (
    select 1 from public.profiles
    where id = auth.uid() and community_id = p_community
  ),
  -- Expected to date: per household, months owed so far (the month a home is
  -- added counts, then one per calendar month — mirrors lib/dues monthsOwed)
  -- times the community dues, plus any imported opening balance.
  expected as (
    select coalesce(sum(
      (
        greatest(0,
          (extract(year from now())::int  - extract(year from r.created_at)::int) * 12
        + (extract(month from now())::int - extract(month from r.created_at)::int)
        ) + 1
      ) * coalesce(c.monthly_dues, 0)
      + coalesce(r.opening_balance, 0)
    ), 0) as amt
    from public.residents r
    join public.communities c on c.id = r.community_id
    where r.community_id = p_community
  ),
  received as (
    select coalesce(sum(p.amount), 0) as amt
    from public.payments p
    where p.community_id = p_community
  )
  select case
    when not exists (select 1 from member_check) then null
    when (select amt from expected) <= 0 then null
    else least(1, round((select amt from received) / (select amt from expected), 4))
  end;
$$;

grant execute on function public.community_collection_rate(uuid) to authenticated;
