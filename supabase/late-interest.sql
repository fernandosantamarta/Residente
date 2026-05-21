-- ============================================================
-- Residente — late-payment interest
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
-- Adds the board-set monthly interest rate (percent). The Pay page uses it
-- to accrue interest on dues that are more than one month overdue. Set the
-- actual rate in the app: Admin → Community → "Late-payment interest".

alter table public.communities
  add column if not exists late_interest_rate numeric default 0;
