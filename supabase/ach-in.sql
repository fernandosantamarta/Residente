-- ============================================================
-- Residente — ACH-in (re-scoped Step 3): let the payments ledger hold
-- ACH return / chargeback CONTRA rows.
--
-- "Link, don't hold": residents can now pay dues by bank debit (us_bank_account)
-- on the community's OWN connected account (see create-checkout). ACH is async —
-- the stripe-webhook records the payment only when it SETTLES
-- (checkout.session.async_payment_succeeded), never at authorization. If a settled
-- debit later RETURNS (charge.refunded) or is charged back (charge.dispute.created),
-- the webhook posts a NEGATIVE "contra" payments row (amount = -original) so
-- lib/dues.ts — which sums payments.amount — nets the resident's balance back up.
--
-- The only schema requirement is therefore that payments.amount accept a negative
-- value. The base `payments` table was created in the dashboard (not in repo SQL),
-- so we can't see its constraints here — this block defensively removes any CHECK
-- that forbids a negative amount, and is otherwise a no-op. Idempotent + additive;
-- safe to re-run. Run once in the Supabase SQL editor.
--
-- Dedup is handled in code + by the existing partial unique index on
-- stripe_payment_intent_id (supabase/stripe-autopay.sql): each contra row is keyed
-- `<original_pi>:reversal`, so a refund + dispute (or a Stripe retry) reverses once.
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class     c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'payments'
      and con.contype = 'c'                                  -- CHECK constraints only
      and pg_get_constraintdef(con.oid) ilike '%amount%'
      and (
        pg_get_constraintdef(con.oid) ilike '%amount > 0%'  or
        pg_get_constraintdef(con.oid) ilike '%amount >= 0%' or
        pg_get_constraintdef(con.oid) ilike '%amount > (0)%'  or
        pg_get_constraintdef(con.oid) ilike '%amount >= (0)%'
      )
  loop
    execute format('alter table public.payments drop constraint %I', r.conname);
    raise notice 'ach-in: dropped positive-amount CHECK % (%) so contra rows can post', r.conname, r.def;
  end loop;
end $$;

comment on column public.payments.amount is
  'Dollars. Normally positive (a payment received). A NEGATIVE value is a contra '
  'row that reverses a settled charge — an ACH return or chargeback — recorded by '
  'stripe-webhook and netted by lib/dues.ts. Do not add a CHECK (amount > 0).';

-- ---------- Autopay on the connected account (incl. saved bank accounts) ----------
-- Under "link, don't hold" a resident's saved card / bank account and every
-- off-session autopay charge live on the COMMUNITY'S connected account, not the
-- platform. Stripe Customers are per-account, so we track which account the saved
-- customer (residents.stripe_customer_id / autopay_pm_id) belongs to. NULL = the
-- platform account (legacy / pre-Connect). The autopay edge functions create a
-- fresh customer when this no longer matches the community's current account.
alter table public.residents
  add column if not exists stripe_customer_account text;

comment on column public.residents.stripe_customer_account is
  'The Stripe account residents.stripe_customer_id / autopay_pm_id live on: the '
  'community connected account id, or NULL = the platform account. ACH/card autopay '
  'targets this account so dues land with the HOA (see _shared/connect.ts).';
