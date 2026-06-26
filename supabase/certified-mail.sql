-- ============================================================
-- Residente — Certified-mail rail (Lob) for statutory collection notices
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Depends on: collections.sql + collections-addresses.sql (ev_collection_notices).
-- ============================================================
--
-- The statutory collection ladder (collections.sql) already LOGS each notice with
-- a hand-typed tracking number after a board member walks it to the post office.
-- This rail lets the board press one button to GENERATE + MAIL the certified
-- letter through Lob (https://lob.com) — Lob renders the letter to PDF, mails it
-- USPS certified (return-receipt for the intent-to-lien notice), and posts
-- delivery events back to lob-webhook-receiver, which stamps return_receipt_at.
--
-- POSTURE — "dark until configured": nothing here turns on until LOB_API_KEY is
-- set on the collection-notice-mail edge function. Until then the Generate & Mail
-- button fails soft (503 not_configured) and the board keeps printing + mailing +
-- logging by hand exactly as before. These columns are all additive + nullable;
-- the existing manual-log flow never touches them.

alter table public.ev_collection_notices
  -- 'lob' once a notice was mailed through the certified-mail rail (null = manual).
  add column if not exists mail_provider        text,
  -- Lob's letter id (ltr_...) for the PRIMARY (address-of-record) certified piece.
  -- The webhook matches on this to write delivery status back.
  add column if not exists lob_letter_id         text,
  -- The latest Lob tracking event (e.g. 'letter.processed_for_delivery',
  -- 'letter.delivered', 'letter.certified.delivered', 'letter.returned_to_sender').
  add column if not exists lob_status            text,
  -- Total price Lob charged across every piece sent for this notice (USD).
  add column if not exists lob_cost              numeric,
  -- Lob's expected delivery date for the primary piece.
  add column if not exists lob_expected_delivery date,
  -- Lob-hosted rendered-letter PDF/thumbnail URL (board-only evidence).
  add column if not exists lob_url               text;

comment on column public.ev_collection_notices.mail_provider is
  'Set to ''lob'' when the notice was generated + mailed through the certified-mail rail; null for a manually-logged notice.';
comment on column public.ev_collection_notices.lob_letter_id is
  'Lob letter id (ltr_...) of the primary (address-of-record) piece; lob-webhook-receiver matches on this to stamp delivery status.';

-- The webhook updates by lob_letter_id (service role) — index + guard duplicates.
create unique index if not exists ev_collection_notices_lob_letter_idx
  on public.ev_collection_notices (lob_letter_id)
  where lob_letter_id is not null;
