-- ============================================================
-- Residente — email the board's reply to the resident
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- The board already leaves an in-app note on a request (board_note) that the
-- submitting resident sees on their Contact page. This adds an OPTIONAL email
-- copy of that reply, sent through the request-reply-email edge function.
--
-- emailed_at records when the resident was last emailed a reply, so the admin
-- queue can show "Emailed Jun 11" next to the in-app "Sent" stamp. The edge
-- function (service role) writes it after a successful Resend send; no new RLS
-- is needed — the board already reads requests via "residents read own / board
-- reads community" and the resident reads the column back through select *.

alter table public.resident_requests add column if not exists emailed_at timestamptz;
