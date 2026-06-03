-- ============================================================
-- Residente — community subscription billing columns
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- The platform subscription (the association paying Residente, priced per home)
-- lives on the communities row. Pricing bands (mirrors lib/plan.ts + the landing
-- Pricing section): ≤25 homes Free, 26–100 Pro $2/home, 101–500 Premium $5/home,
-- 500+ Enterprise $10/home — all monthly.
--
-- subscription_status lifecycle (column already exists):
--   free     — ≤25 homes, no card, fully active forever
--   pending  — paid band, community created but awaiting first payment
--   active   — paid + current
--   past_due — a renewal invoice failed
--   canceled — subscription ended
-- (legacy rows may still read 'trial'; the app treats trial like pending.)

alter table public.communities
  add column if not exists plan                   text not null default 'free',
  add column if not exists home_count             int,
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

-- Widen the subscription_status CHECK to permit the new lifecycle values.
-- The original (easy-voice.sql) only allowed trial/active/past_due/cancelled,
-- so inserting 'free' (≤25 homes) or 'pending' (paid, awaiting payment) was
-- rejected and every create-community signup failed. Keep the British
-- 'cancelled' spelling the rest of the schema uses.
alter table public.communities
  drop constraint if exists communities_subscription_status_check;
alter table public.communities
  add constraint communities_subscription_status_check
  check (subscription_status in ('trial','active','past_due','cancelled','free','pending'));

create index if not exists communities_stripe_subscription_idx
  on public.communities (stripe_subscription_id);

-- Reads are already covered (members read their own community). Writes to these
-- billing columns happen ONLY via service-role (signup-provision + stripe-webhook),
-- so no new grant/policy is needed — and authenticated deliberately can't set
-- subscription_status/plan itself.
