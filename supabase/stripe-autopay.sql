-- ============================================================
-- Residente — Stripe saved cards + autopay
-- Run once in the Supabase SQL editor. Additive only — safe to re-run.
-- Pairs with the edge functions: create-setup-checkout, list-payment-methods,
-- set-autopay, charge-autopay, and the stripe-webhook payment recorder.
-- ============================================================

-- Each resident maps to one Stripe Customer (created lazily by
-- create-setup-checkout the first time they save a card). autopay_* hold the
-- resident's recurring-payment preference; the actual charge is made
-- off-session against the customer's default card.
alter table public.residents add column if not exists stripe_customer_id text;
alter table public.residents add column if not exists autopay_enabled boolean not null default false;
alter table public.residents add column if not exists autopay_pm_id text;

-- The webhook records autopay charges as payment_intent.succeeded events. Dedup
-- on the PaymentIntent id the same way checkout sessions dedup on session id.
alter table public.payments add column if not exists stripe_payment_intent_id text;
create unique index if not exists payments_stripe_payment_intent_id_key
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- NOTE on RLS: residents already update their own roster row (by profile_id) per
-- supabase/resident-self-service.sql, which covers autopay_enabled / autopay_pm_id
-- / stripe_customer_id writes made by the edge functions under the caller's JWT.
-- No new policy is required.
