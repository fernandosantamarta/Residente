-- ============================================================
-- Residente — Meeting agenda builder (FS 718.112(2)(c) condo / 720.303(2) HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: easy-voice.sql (ev_meetings).
-- ============================================================
--
-- Stores the real agenda for a meeting so the statutory notice prints the actual
-- items instead of the "[Insert agenda items]" placeholder, and so the one-click
-- board packet can assemble notice + agenda + minutes. agenda_data is a JSON
-- array of agenda-item strings, board-curated (seeded from a standard template +
-- carried-forward unfinished action items from the prior meeting's minutes).
--
-- ⚠ The board is responsible for the agenda's accuracy; the law generally bars
--   acting on business not on the noticed agenda. Educational, not legal advice.

alter table public.ev_meetings
  add column if not exists agenda_data jsonb not null default '[]'::jsonb;
