-- ============================================================
-- Residente — allow the 'rule_published' notice kind
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- The board's "Add rule" action (app/admin/documents/page.tsx) now inserts an
-- ev_notices row of kind 'rule_published' (channels = in_app+email) so the
-- ev_notice_fanout broadcast trigger notifies every resident a new rule was
-- added to the rule book. The bell routes it to /app/documents#rules
-- (lib/voice.ts noticeHref). This widens the kind CHECK to permit it — restated
-- as the full current superset so it stays a superset of every kind the app
-- inserts (latest file run wins).

alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due',
                  'violation','compliance_alert','estoppel_update',
                  'collections_deadline','collections_update',
                  'request_new','request_update','payment_received',
                  'rule_published'));
