-- ============================================================
-- Residente — community Connect + Plaid linkage columns
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- These are the HOA's OWN linked accounts — distinct from the platform-billing
-- columns (stripe_customer_id / stripe_subscription_id), which are the HOA
-- paying Residente. See MONEY_FLOW_PLAN.md.
--
--   stripe_account_id   — the HOA's connected Stripe account (Connect Standard).
--                         Resident dues/fines/amenities are charged ON this
--                         account, so funds never touch Residente's balance.
--   stripe_connect_status — onboarding lifecycle:
--                         none      — not linked
--                         pending   — account created, Stripe onboarding incomplete
--                         active    — charges_enabled (ready to collect)
--   plaid_item_id       — the HOA's linked bank Item (read-only).
--   plaid_access_token_ref — pointer/name for the Plaid access token kept in a
--                         secret store; the raw token is NEVER stored in this table.
--   plaid_status        — none | active | error (re-auth needed)

alter table public.communities
  add column if not exists stripe_account_id        text,
  add column if not exists stripe_connect_status    text not null default 'none',
  add column if not exists plaid_item_id            text,
  add column if not exists plaid_access_token_ref    text,
  add column if not exists plaid_status             text not null default 'none';

alter table public.communities
  drop constraint if exists communities_stripe_connect_status_check;
alter table public.communities
  add constraint communities_stripe_connect_status_check
  check (stripe_connect_status in ('none','pending','active'));

alter table public.communities
  drop constraint if exists communities_plaid_status_check;
alter table public.communities
  add constraint communities_plaid_status_check
  check (plaid_status in ('none','active','error'));

create index if not exists communities_stripe_account_idx
  on public.communities (stripe_account_id);

-- Writes to these linkage columns happen ONLY via service-role (connect-onboard,
-- stripe-webhook account.updated, plaid-link-exchange). Authenticated members can
-- read their own community row (existing policy) but cannot set these themselves.
