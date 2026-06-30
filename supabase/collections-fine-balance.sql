-- ============================================================
-- Residente — Collections: dedicated FINE balance on a case
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- A violation fine escalated into collections (or a manually-opened fine-only
-- case) is tracked in its OWN bucket, separate from dues/assessments and from
-- collection costs. The app surfaces it as a distinct "Fines" line on the payoff
-- ledger (admin) and the resident Collection Balance breakdown, and feeds it
-- into casePayoff() as extraFines. When a fine is sent to collections the source
-- ev_violations row is closed, so the same money never shows in BOTH the
-- resident's "Fines due" band AND the collection balance.
--
-- Depends on: collections.sql (ev_collection_cases).

alter table public.ev_collection_cases
  add column if not exists fine_balance numeric;

comment on column public.ev_collection_cases.fine_balance is
  'Escalated violation fines collected through this case (dollars). Surfaced as a separate "Fines" line; fed to casePayoff as extraFines. Separate from principal (assessments) and cost_balance (collection/attorney costs).';
