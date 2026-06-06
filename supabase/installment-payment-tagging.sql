-- ============================================================
-- Residente — Tag a Stripe payment to a payment-plan installment
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- payments.charge_type + payments.applied_to_case already exist (collections.sql).
-- This links a payment to a specific plan + installment so the webhook can
-- advance ev_payment_plans.paid_count / next_due_at when an installment is paid.

alter table public.payments
  add column if not exists applied_to_plan uuid references public.ev_payment_plans(id) on delete set null,
  add column if not exists installment_no  int;

create index if not exists payments_applied_to_plan_idx
  on public.payments (applied_to_plan);

-- No RLS change: payments are inserted only by the stripe-webhook under the
-- service-role key.
