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
  add column if not exists last_charge_fail_kind   text;   -- 'autopay' | 'installment'
