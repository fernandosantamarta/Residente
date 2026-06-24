-- ============================================================
-- Residente — Work-order → Budget expense link
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- When a work order is completed with an actual cost, the board records that
-- spend straight into the ev_expenses ledger — Budget actuals, Reports, and the
-- resident Home "Financial Overview" chart all read it, so one entry updates
-- every view (no double data entry). This column ties each such expense back to
-- its source work order, which gives traceability AND keeps the write
-- idempotent: the app never posts a second expense for the same work order.

alter table public.ev_expenses
  add column if not exists work_order_id uuid references public.work_orders(id) on delete set null;

create index if not exists ev_expenses_work_order_idx
  on public.ev_expenses (work_order_id);
