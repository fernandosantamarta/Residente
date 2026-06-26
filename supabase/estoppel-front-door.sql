-- ============================================================
-- Residente — Estoppel public front door (title-company intake + fee checkout)
-- (FS 718.116(8) condo / FS 720.30851 HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: estoppel.sql (ev_estoppel_requests), communities (stripe_account_id).
-- ============================================================
--
-- A title/closing company needs an estoppel certificate but has no Residente
-- login. This adds a per-community PUBLIC link (estoppel_public_token) the board
-- can hand out: the title co fills a short form, pays the statutory fee via
-- Stripe (on the community's connected account), and the paid request lands in
-- the board's estoppel worklist (created by the stripe-webhook, service role).
--
-- No anon RLS is opened: the public page + checkout go through the
-- create-estoppel-checkout edge function (service role), which validates the
-- token. The board generates/enables the token from /admin/estoppel.

-- ---------- communities: the public token + on/off switch ----------
alter table public.communities
  add column if not exists estoppel_public_token   text,
  add column if not exists estoppel_public_enabled boolean not null default false;

create unique index if not exists communities_estoppel_token_idx
  on public.communities (estoppel_public_token)
  where estoppel_public_token is not null;

-- ---------- ev_estoppel_requests: Stripe payment provenance ----------
alter table public.ev_estoppel_requests
  add column if not exists stripe_session_id text,
  add column if not exists paid_via_stripe   boolean not null default false;

-- Dedup key so a Stripe webhook retry can't create a second request for the
-- same paid session.
create unique index if not exists ev_estoppel_session_idx
  on public.ev_estoppel_requests (stripe_session_id)
  where stripe_session_id is not null;
