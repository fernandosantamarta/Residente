-- ============================================================
-- Residente — GL-sourced statements support (Phase 3 / Workstream E)
-- Run once in the Supabase SQL editor AFTER supabase/gl-spine.sql.
-- Idempotent; safe to re-run.
-- ============================================================
-- gl_trial_balance (in gl-spine.sql) is CUMULATIVE since inception — the right
-- basis for a Balance Sheet (a point-in-time position). An accrual Statement of
-- Revenue & Expenses, and the live "annual revenue" that drives the CPA audit
-- tier, both need revenue/expense scoped to ONE fiscal year. This view adds the
-- fiscal_year dimension so callers can filter to the current FY.
--
-- SECURITY: security_invoker = true (exactly like gl_trial_balance) so per-caller
-- RLS applies — a board member (financials.view) sees their community's full
-- aggregates; the service-role compliance cron bypasses RLS and reads all; a
-- resident would see only their OWN attributed lines (their assessments/AR — never
-- another owner's, so no leak), but no consumer of this view is resident-facing
-- (all are board /admin surfaces + the cron). A plain (owner) view would re-create
-- the leak that 0001_payments_board_only_read.sql fixed.

create or replace view public.gl_trial_balance_fy with (security_invoker = true) as
  select l.community_id,
         e.fiscal_year,
         l.fund,
         a.code,
         a.name,
         a.type,
         round(sum(l.debit), 2)  as debit,
         round(sum(l.credit), 2) as credit,
         round(sum(l.debit) - sum(l.credit), 2) as balance
    from public.gl_entry_lines l
    join public.gl_journal_entries e on e.id = l.entry_id
    join public.gl_accounts a on a.id = l.account_id
   group by l.community_id, e.fiscal_year, l.fund, a.code, a.name, a.type;

grant select on public.gl_trial_balance_fy to authenticated;
