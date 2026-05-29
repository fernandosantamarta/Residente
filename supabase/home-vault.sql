-- ============================================================
-- Residente — Home Vault (private home documents + payment logging)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- A homeowner's personal space: store documents about THEIR home (deed,
-- insurance, warranties, permits, manuals) and log dues payments with proof.
-- Home documents are PRIVATE to the owner; the ones flagged `conveys` are the
-- ones meant to transfer to the next buyer (handled by the home-transfer fn).

-- 1. Home documents -------------------------------------------------
create table if not exists public.home_documents (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid references public.communities(id) on delete set null,
  resident_id   uuid references public.residents(id)  on delete set null,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  category      text,
  storage_path  text not null,
  file_size     bigint,
  conveys       boolean not null default false,
  uploaded_at   timestamptz not null default now()
);
alter table public.home_documents enable row level security;
grant select, insert, update, delete on public.home_documents to authenticated;
create index if not exists home_documents_profile_idx on public.home_documents (profile_id);

-- Owner-only: a homeowner fully controls their own home documents; nobody
-- else (not even the board) can read them. Privacy by default.
drop policy if exists "owner manages own home docs" on public.home_documents;
create policy "owner manages own home docs"
  on public.home_documents for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- 2. Private storage bucket, scoped per owner --------------------------
-- Path convention: {profile_id}/{uuid}.{ext} — first segment is the owner.
insert into storage.buckets (id, name, public)
values ('home-vault', 'home-vault', false)
on conflict (id) do nothing;

drop policy if exists "owner uploads own home files" on storage.objects;
create policy "owner uploads own home files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'home-vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owner reads own home files" on storage.objects;
create policy "owner reads own home files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'home-vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owner deletes own home files" on storage.objects;
create policy "owner deletes own home files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'home-vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. Resident-logged payments (proof of dues paid elsewhere) -----------
-- v1 has no money movement for self-managers; they record what they paid and
-- attach a receipt. Existing Stripe inserts (service role) are unaffected.
alter table public.payments
  add column if not exists method     text,
  add column if not exists note       text,
  add column if not exists proof_path text;

grant select, insert on public.payments to authenticated;

-- A resident can read and log payments only against their own roster row.
drop policy if exists "resident reads own payments" on public.payments;
create policy "resident reads own payments"
  on public.payments for select to authenticated
  using ( resident_id in (select id from public.residents where profile_id = auth.uid()) );

drop policy if exists "resident logs own payment" on public.payments;
create policy "resident logs own payment"
  on public.payments for insert to authenticated
  with check ( resident_id in (select id from public.residents where profile_id = auth.uid()) );
