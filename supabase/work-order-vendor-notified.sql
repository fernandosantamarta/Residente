-- ============================================================
-- Residente — Work-order vendor-notified timestamp
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Records when the assigned vendor was last emailed the work order, so the board
-- panel can show "Vendor emailed ✓ <date>" and a Re-send button. The
-- work-order-notify-vendor edge function stamps this on a successful send
-- (best-effort, so it works even before this column exists).

alter table public.work_orders
  add column if not exists vendor_notified_at timestamptz;
