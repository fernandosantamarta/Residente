-- ============================================================
-- Residente — deliver the ARC decision letter to the owner
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Requires: arc.sql + arc-attachments.sql + resident-request-attachments.sql.
-- ============================================================
--
-- The board generates the architectural-review decision letter as a PDF and
-- delivers it to the owner who submitted the request. The arc-decision-letter
-- edge function renders the PDF (same content as /admin/arc/[id]/document,
-- shared via lib/compliance/arc-letter.ts), uploads it with the service role
-- into the existing private request-attachments bucket under
-- <community_id>/<resident_profile_id>/<uuid>.pdf — the owner's own folder — and
-- records the result here.
--
-- No new RLS: the file lands in the resident's folder, so the existing
-- "residents read own request files" storage policy (resident-request-
-- attachments.sql) covers the owner's download and "board reads community
-- request files" covers the board; the owner reads their own ev_arc_requests
-- row (arc.sql), which now carries the letter pointer below. The edge function
-- writes with the service role, so it needs no board storage-INSERT policy.

alter table public.ev_arc_requests
  add column if not exists decision_letter_path    text,
  add column if not exists decision_letter_name    text,
  add column if not exists decision_letter_sent_at timestamptz;
