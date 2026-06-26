-- ============================================================
-- Residente — surface silent off-session charge failures
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- An off-session autopay / installment charge that DECLINES throws synchronously
-- inside charge-autopay / charge-plan-installment (it never reaches the webhook),
-- so nothing was ever recorded and neither the resident nor the board was told.
-- These columns let those functions stamp the last failure on the resident's
-- roster row; the resident's Pay screen shows a banner and the board can flag it.
-- A later SUCCESSFUL payment (manual or autopay) clears them via stripe-webhook.
--
-- No new RLS needed: residents already read their own row + the board reads its
-- community's roster.

alter table public.residents
  add column if not exists last_charge_failed_at  timestamptz,
  add column if not exists last_charge_fail_reason text,
  add column if not exists last_charge_fail_kind   text;   -- 'autopay' | 'installment' | 'autopay_paused'

-- Dunning retry/pause loop for off-session autopay (charge-autopay runs daily):
--   • autopay_fail_count          — consecutive off-session declines; charge-autopay
--                                    increments it on each decline and PAUSES autopay
--                                    (autopay_enabled=false, kind='autopay_paused') once
--                                    it reaches the retry cap. Reset to 0 by stripe-webhook
--                                    on any successful payment and by set-autopay on re-enable.
--   • autopay_last_charged_period — 'YYYY-MM' of the last month a charge was ACCEPTED
--                                    (succeeded or async ACH 'processing'). The once-a-month
--                                    idempotency guard: charge-autopay skips a resident whose
--                                    marker equals the current month, so a daily run (or an
--                                    in-flight multi-day ACH settlement) never re-charges.
alter table public.residents
  add column if not exists autopay_fail_count          int not null default 0,
  add column if not exists autopay_last_charged_period text;
