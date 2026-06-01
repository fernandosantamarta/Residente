-- ============================================================
-- Residente — Dues reminders: allow the 'dues_due' notice kind
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- The /api/cron/dues-reminders Vercel Cron route scans each community's
-- balances monthly and inserts a 'dues_due' notice for residents who are
-- behind (channels=[] so the generic fanout skips it; the route inserts
-- recipient rows only for the owing residents who have an app account).
-- This migration just widens the ev_notices.kind CHECK to permit that kind.

alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due'));
