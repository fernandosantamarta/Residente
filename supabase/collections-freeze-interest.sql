-- collections-freeze-interest.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Independent manual freeze overrides on a collection case, read by the payoff
-- ledger via casePayoff({ freezeInterest, freezeLateFees }). For each:
--   NULL  → follow the payment plan automatically (frozen while a plan is current)
--   TRUE  → force-frozen (that charge stops accruing)
--   FALSE → force it to keep accruing, even on a plan
alter table public.ev_collection_cases
  add column if not exists freeze_interest boolean;
alter table public.ev_collection_cases
  add column if not exists freeze_late_fees boolean;
