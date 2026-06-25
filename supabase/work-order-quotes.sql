-- ============================================================
-- Residente — Work-order vendor quotes
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Lets the assigned vendor submit their price for a work order via a secure,
-- no-login link (the quote_token), then the board approves or rejects it. On
-- approval the quoted cost becomes the work order's estimated_cost (which flows
-- to the budget on completion). The public quote page never touches work_orders
-- directly — it goes through the work-order-quote edge function (service role),
-- so no anon RLS is opened here.

alter table public.work_orders
  add column if not exists quote_token text,
  add column if not exists quoted_cost numeric(12,2),
  add column if not exists quote_note text,
  add column if not exists quote_submitted_at timestamptz,
  add column if not exists quote_status text not null default 'none'
    check (quote_status in ('none','submitted','approved','rejected'));

-- Every work order gets a stable, unguessable token for its quote link.
update public.work_orders
  set quote_token = encode(gen_random_bytes(16), 'hex')
  where quote_token is null;

-- New rows get one automatically.
alter table public.work_orders
  alter column quote_token set default encode(gen_random_bytes(16), 'hex');

create unique index if not exists work_orders_quote_token_idx
  on public.work_orders (quote_token);
