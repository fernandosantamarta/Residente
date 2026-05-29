-- ============================================================
-- Residente — Vendor ratings setup
-- Run once in the Supabase SQL editor (SQL editor → new query → paste → run).
-- Safe to re-run: IF NOT EXISTS / drop-policy-if-exists.
-- Pairs with supabase/vendors-and-reports.sql (the `vendors` table) and the
-- client storage layer in lib/vendor-ratings.ts.
-- ============================================================

-- Residents rate any vendor 1-5 stars with an optional written review.
-- One rating per resident per vendor (unique on vendor_id + profile_id);
-- submitting again updates the existing row. Averages on the Vendors page
-- aggregate every resident's rating across the community.
create table if not exists public.vendor_ratings (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  vendor_id    uuid not null references public.vendors(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  stars        int  not null check (stars between 1 and 5),
  review       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (vendor_id, profile_id)
);
alter table public.vendor_ratings enable row level security;
grant select, insert, update, delete on public.vendor_ratings to authenticated;

-- Everyone in the community can read all ratings (that's the whole point —
-- the average reflects the community). Mirrors the "members read vendors"
-- policy in vendors-and-reports.sql.
drop policy if exists "members read vendor ratings" on public.vendor_ratings;
create policy "members read vendor ratings"
  on public.vendor_ratings for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

-- A resident may only write their OWN rating, and only within their community.
drop policy if exists "residents write own rating" on public.vendor_ratings;
create policy "residents write own rating"
  on public.vendor_ratings for all to authenticated
  using (
    profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
  )
  with check (
    profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
  );
