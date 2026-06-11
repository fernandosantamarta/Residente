-- ============================================================
-- Residente — attachments on architectural (ARC) requests
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Requires: arc.sql + resident-request-attachments.sql first.
-- ============================================================
--
-- Lets a resident attach a photo, sketch, or rendering/model of the change they
-- want to make so the board can see exactly what's proposed. Files reuse the
-- existing private request-attachments bucket under
-- <community_id>/<profile_id>/<uuid>.<ext> — the resident's own folder — so the
-- "residents upload/read own request files" and "board reads community request
-- files" storage policies already cover them. No new RLS is needed: the resident
-- reads their own ARC rows and the board reads its community's (arc.sql).

alter table public.ev_arc_requests add column if not exists attachment_path text;
alter table public.ev_arc_requests add column if not exists attachment_name text;
