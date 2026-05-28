-- ============================================================
-- Residente — Vendors & Reports setup
-- Run once in the Supabase SQL editor (SQL editor → new query → paste → run).
-- Safe to re-run: tables/bucket use IF NOT EXISTS / ON CONFLICT.
-- ============================================================

-- ---------- VENDORS ----------
-- Board-curated list of trusted service providers. Shows on each
-- resident's Vendors page (/app/vendor). `featured` pins a vendor to
-- the "Featured Vendors" row; `category` drives the icon + filter grid.
create table if not exists public.vendors (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name         text not null,
  category     text not null default 'property',  -- property|cleaning|security|plumbing|electrical|hvac
  phone        text,
  email        text,
  blurb        text,
  badge        text,                              -- e.g. "Preferred"
  featured     boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.vendors enable row level security;
grant select, insert, update, delete on public.vendors to authenticated;

create policy "members read vendors"
  on public.vendors for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes vendors"
  on public.vendors for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- REPORTS (metadata) ----------
-- Board-published reports residents browse at /app/reports. Optional
-- file lives in the `reports` storage bucket (storage_path); reports
-- without a file are link/summary rows. `status` mirrors the resident
-- pill (published|updated|draft); `featured` pins to the top row.
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title        text not null,
  category     text not null default 'financial', -- financial|maintenance|operations|community|safety|vendor|compliance|board
  status       text not null default 'published', -- published|updated|draft
  blurb        text,
  storage_path text,
  file_size    bigint,
  featured     boolean not null default false,
  report_date  date not null default current_date,
  created_at   timestamptz not null default now()
);
alter table public.reports enable row level security;
grant select, insert, update, delete on public.reports to authenticated;

-- Residents only see published/updated reports; drafts stay board-only.
create policy "members read published reports"
  on public.reports for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      status in ('published','updated')
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );

create policy "board writes reports"
  on public.reports for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- REPORTS (file storage) ----------
-- Private bucket — files are only reachable via short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

-- Files are stored under <community_id>/<uuid>.<ext>. The first path segment
-- is the community id, so each policy matches it against the caller's community.
create policy "members read community reports"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'reports'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
  );

create policy "board uploads community reports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reports'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

create policy "board deletes community reports"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'reports'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
