-- ============================================================
-- Residente — Plaid bank feed (read-only budget tracking)
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- "Link, don't hold": we READ the HOA's bank to track budget actuals and show
-- where dues go. We never move money. See MONEY_FLOW_PLAN.md.
--
--   plaid_items          — one row per linked bank Item. Holds the Plaid
--                          access_token. SERVICE-ROLE ONLY (RLS on, no policies)
--                          so the token is never readable by any client.
--   bank_transactions    — synced bank activity, mapped to a budget category.
--   plaid_category_map    — per-community: Plaid category -> budget line. Learned
--                          on sync; editable so re-syncs auto-apply the mapping.

-- ---- plaid_items (token vault) ---------------------------------------------
create table if not exists public.plaid_items (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  plaid_item_id     text unique not null,
  access_token      text not null,
  institution_name  text,
  sync_cursor       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists plaid_items_community_idx on public.plaid_items (community_id);
alter table public.plaid_items enable row level security;
-- Intentionally NO policies: only the service role (edge functions) may read the
-- access token. authenticated/anon get nothing.

-- ---- bank_transactions -----------------------------------------------------
create table if not exists public.bank_transactions (
  id                       uuid primary key default gen_random_uuid(),
  community_id             uuid not null references public.communities(id) on delete cascade,
  plaid_transaction_id     text unique not null,
  plaid_account_id         text,
  posted_date              date,
  amount                   numeric,        -- Plaid sign: positive = money OUT of the account
  name                     text,
  merchant_name            text,
  plaid_category           text,           -- personal_finance_category.primary
  plaid_category_detailed  text,
  mapped_budget_category_id uuid references public.budget_categories(id) on delete set null,
  fund                     text not null default 'operating',
  pending                  boolean not null default false,
  raw                      jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists bank_tx_community_idx on public.bank_transactions (community_id);
create index if not exists bank_tx_date_idx on public.bank_transactions (community_id, posted_date desc);
create index if not exists bank_tx_budgetcat_idx on public.bank_transactions (mapped_budget_category_id);
alter table public.bank_transactions enable row level security;

alter table public.bank_transactions drop constraint if exists bank_transactions_fund_check;
alter table public.bank_transactions
  add constraint bank_transactions_fund_check check (fund in ('operating','reserve'));

-- Members read their own community's bank feed; writes happen via service role only.
drop policy if exists bank_tx_read on public.bank_transactions;
create policy bank_tx_read on public.bank_transactions
  for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

-- ---- plaid_category_map ----------------------------------------------------
create table if not exists public.plaid_category_map (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid not null references public.communities(id) on delete cascade,
  plaid_category     text not null,
  budget_category_id uuid references public.budget_categories(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (community_id, plaid_category)
);
create index if not exists plaid_catmap_community_idx on public.plaid_category_map (community_id);
alter table public.plaid_category_map enable row level security;

-- Members read; a board/admin (non-resident) may set/override the mapping.
drop policy if exists plaid_catmap_read on public.plaid_category_map;
create policy plaid_catmap_read on public.plaid_category_map
  for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists plaid_catmap_write on public.plaid_category_map;
create policy plaid_catmap_write on public.plaid_category_map
  for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) <> 'resident'
  );
