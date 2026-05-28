-- ============================================================
-- Residente — board note on resident requests
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Lets the board leave a short note on a request (e.g. "Reviewed and checked,
-- fixing by Friday") that the submitting resident sees on their Contact page,
-- alongside the status. board_note_at marks when the note was last touched so
-- the resident knows the reply is recent.
--
-- The board can also attach a photo to its reply. The file lives in the
-- existing request-attachments bucket under the RESIDENT's folder
-- (<community_id>/<resident_profile_id>/<uuid>.<ext>) so the resident can read
-- it back via the existing "residents read own request files" policy. The one
-- thing missing is letting the BOARD upload into that folder — added below.
--
-- For the text columns no new RLS is needed: "board updates community requests"
-- already lets the board write them, and "residents read own requests" already
-- lets the resident read them.

alter table public.resident_requests add column if not exists board_note                 text;
alter table public.resident_requests add column if not exists board_note_at               timestamptz;
alter table public.resident_requests add column if not exists board_note_attachment_path  text;
alter table public.resident_requests add column if not exists board_note_attachment_name  text;

-- Board may upload a reply file anywhere in its own community's folder.
drop policy if exists "board uploads community request files" on storage.objects;
create policy "board uploads community request files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and (storage.foldername(name))[1] = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
