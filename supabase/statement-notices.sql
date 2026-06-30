-- statement-notices.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Adds the 'statement_ready' notice kind used by the monthly owner-statement
-- bell notice (cron: /api/cron/statement-notices). On the 1st of each month the
-- cron drops one in-app notice per resident pointing at their Statements list,
-- where the prior month's statement (community name + ledger) is ready to view.
--
-- Re-state the FULL current kind superset + 'statement_ready' so this file stays
-- a superset of every kind the app inserts (latest file wins on a fresh run).

alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due',
                  'violation','compliance_alert','estoppel_update',
                  'collections_deadline','collections_update',
                  'request_new','request_update','payment_received',
                  'statement_ready'));
