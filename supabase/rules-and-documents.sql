-- ============================================================
-- Residente — Rules & Documents setup
-- Run once in the Supabase SQL editor (SQL editor → new query → paste → run).
-- Safe to re-run: tables/bucket use IF NOT EXISTS / ON CONFLICT.
-- ============================================================

-- ---------- RULES ----------
create table if not exists public.rules (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  section      text,
  title        text not null,
  body         text,
  fine         numeric,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.rules enable row level security;
grant select, insert, update, delete on public.rules to authenticated;

create policy "members read rules"
  on public.rules for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes rules"
  on public.rules for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- DOCUMENTS (metadata) ----------
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title        text not null,
  category     text,
  storage_path text not null,
  file_size    bigint,
  uploaded_at  timestamptz not null default now()
);
alter table public.documents enable row level security;
grant select, insert, update, delete on public.documents to authenticated;

create policy "members read documents"
  on public.documents for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes documents"
  on public.documents for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- DOCUMENTS (file storage) ----------
-- Private bucket — files are only reachable via short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Files are stored under <community_id>/<uuid>.<ext>. The first path segment
-- is the community id, so each policy matches it against the caller's community.
create policy "members read community files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
  );

create policy "board uploads community files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

create policy "board deletes community files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
