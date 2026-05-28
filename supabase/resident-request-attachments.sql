-- ============================================================
-- Residente — attachments for resident requests
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Adds an optional file attachment to a resident request. Files live in a
-- private bucket under <community_id>/<profile_id>/<uuid>.<ext>, so a
-- resident only ever touches their own folder and the board can read every
-- file in its community.

alter table public.resident_requests add column if not exists attachment_path text;
alter table public.resident_requests add column if not exists attachment_name text;

insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

drop policy if exists "residents upload own request files" on storage.objects;
create policy "residents upload own request files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and (storage.foldername(name))[1] = (select community_id from public.profiles where id = auth.uid())::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "residents read own request files" on storage.objects;
create policy "residents read own request files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "residents delete own request files" on storage.objects;
create policy "residents delete own request files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "board reads community request files" on storage.objects;
create policy "board reads community request files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and (storage.foldername(name))[1] = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
