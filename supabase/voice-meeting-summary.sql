-- Easy Voice — meeting recap.
-- A short written "what was said" summary the board can add to a meeting,
-- shown to residents in the meeting detail alongside the uploaded minutes.
-- Run in the Supabase SQL editor (schema lives in the dashboard, not migrations).

alter table public.ev_meetings
  add column if not exists summary text;
