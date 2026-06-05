-- ============================================================
-- Residente — Amenity refunds (windowed auto-refund)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Today cancelling a paid amenity reservation only sets status='cancelled'
-- (lib/amenities.ts cancel()); the card is never refunded. This adds the
-- refund state + a board-configurable cancellation window:
--   - resident self-cancels BEFORE the cutoff (default 24h before the slot)
--     → the refund-amenity edge function issues a FULL Stripe refund;
--   - after the cutoff → no auto-refund, but the board can override and refund.
-- The refund itself is issued by supabase/functions/refund-amenity, which
-- writes the refund_* columns below under the service-role key.

-- ---------- reservation: refund state ----------
alter table public.ev_amenity_reservations
  add column if not exists refund_status text not null default 'none';
do $$ begin
  alter table public.ev_amenity_reservations
    add constraint ev_amenity_res_refund_chk
    check (refund_status in ('none','pending','refunded','failed','denied'));
exception when duplicate_object then null; end $$;

alter table public.ev_amenity_reservations
  add column if not exists stripe_refund_id text;
alter table public.ev_amenity_reservations
  add column if not exists refunded_at timestamptz;
alter table public.ev_amenity_reservations
  add column if not exists refund_amount_cents int;
-- When the booking was cancelled (drives the cutoff-window math). The unique
-- slot index already frees a 'cancelled' slot; this records when it happened.
alter table public.ev_amenity_reservations
  add column if not exists cancelled_at timestamptz;

-- One refund per reservation: a Stripe refund id can be recorded only once.
-- Pairs with the function's idempotency key for belt-and-braces double-refund
-- protection.
create unique index if not exists ev_amenity_res_refund_unique
  on public.ev_amenity_reservations (stripe_refund_id)
  where stripe_refund_id is not null;

-- ---------- community: the cancellation window ----------
-- Hours before the reserved slot within which a self-cancellation still earns
-- a full automatic refund. Board-configurable; 24h is the default.
alter table public.communities
  add column if not exists amenity_refund_cutoff_hours int not null default 24;

-- No new RLS: residents already set status/cancelled_at via the existing
-- "owner or board updates reservation" policy (easy-amenities.sql); the
-- refund_* columns are written only by the refund-amenity function under the
-- service-role key (which bypasses RLS). The board sets the cutoff via the
-- existing community-settings update path.
