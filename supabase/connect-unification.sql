-- ============================================================
-- Residente — Connect unification: track which Stripe account holds the money
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- "Link, don't hold" routes fines / amenities / autopay / refunds onto each
-- HOA's OWN connected account (community-connect.sql). A charge or a saved card
-- lives on exactly ONE Stripe account, and a refund / off-session charge MUST
-- target that same account — not whatever the community's connect status happens
-- to be later. So we record the account at the moment the money object is made:
--
--   ev_amenity_reservations.payment_account_id — the connected account the
--       reservation was CHARGED on (set by stripe-webhook from event.account when
--       it flips the reservation to paid). NULL = legacy platform charge, so an
--       old reservation refunds on the platform and a new one on the HOA account.
--
--   residents.stripe_customer_account — the connected account the resident's saved
--       Stripe customer + card live on (set by create-setup-checkout at enrollment).
--       NULL = legacy platform customer. charge-autopay / charge-plan-installment
--       read it to charge the card on the SAME account it was saved on. (A card
--       saved on account A cannot be charged on account B — see #12b re-enroll.)

alter table public.ev_amenity_reservations
  add column if not exists payment_account_id text;

alter table public.residents
  add column if not exists stripe_customer_account text;

-- No RLS change: payment_account_id is written by the service-role webhook;
-- stripe_customer_account by the edge fns under the resident's own JWT alongside the
-- existing stripe_customer_id write (resident-self-service.sql already covers it).
