-- ============================================================
-- Residente — Plaid bank feed (read-only budget tracking)
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- "Link, don't hold": we READ the HOA's bank to track budget actuals and show
-- where dues go. We never move money. See MONEY_FLOW_PLAN.md.
--
--   plaid_items          — one row per linked bank Item. Holds ONLY a Vault
--                          secret-id reference; the raw Plaid access token lives
--                          encrypted in Supabase Vault (see below), never here.
--   bank_transactions    — synced bank activity, mapped to a budget category.
--   plaid_category_map    — per-community: Plaid category -> budget line. Learned
--                          on sync; editable so re-syncs auto-apply the mapping.

-- ---- Supabase Vault (encrypted at-rest store for the Plaid access token) ---
-- The Plaid access token is a bank-reading credential. We keep it in Vault
-- (encrypted), and store only its secret-id reference in plaid_items — so a table
-- read, backup dump, or leaked service-role key never exposes the raw token.
create extension if not exists supabase_vault with schema vault;

-- ---- plaid_items (one row per linked bank Item) ----------------------------
create table if not exists public.plaid_items (
  id                      uuid primary key default gen_random_uuid(),
  community_id            uuid not null references public.communities(id) on delete cascade,
  plaid_item_id           text unique not null,
  access_token_secret_id  uuid,            -- Vault secret id; NEVER the raw token
  institution_name        text,
  sync_cursor             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
-- Migrate any earlier (plaintext) shape: add the Vault reference, drop the raw column.
alter table public.plaid_items add column if not exists access_token_secret_id uuid;
alter table public.plaid_items drop column if exists access_token;
create index if not exists plaid_items_community_idx on public.plaid_items (community_id);
alter table public.plaid_items enable row level security;
-- Intentionally NO policies: clients get nothing. Only the service role touches
-- this table, and the token itself is in Vault, not in any column here.

-- ---- token store/read wrappers (service-role only) -------------------------
-- The vault schema isn't exposed to PostgREST, so the edge functions go through
-- these SECURITY DEFINER wrappers. EXECUTE is granted ONLY to service_role.
create or replace function public.plaid_token_upsert(p_secret_id uuid, p_token text, p_name text)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_secret_id is not null then
    perform vault.update_secret(p_secret_id, p_token);
    return p_secret_id;
  end if;
  select vault.create_secret(p_token, p_name, 'Plaid access token (read-only bank feed)') into v_id;
  return v_id;
end $$;

create or replace function public.plaid_token_read(p_secret_id uuid)
  returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret_id
$$;

revoke all on function public.plaid_token_upsert(uuid, text, text) from public, anon, authenticated;
revoke all on function public.plaid_token_read(uuid) from public, anon, authenticated;
grant execute on function public.plaid_token_upsert(uuid, text, text) to service_role;
grant execute on function public.plaid_token_read(uuid) to service_role;

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

-- Members read; a board officer with financials.manage may set/override the mapping.
-- (Permission via has_permission, NOT profiles.role — the seeded Treasurer custom
-- role isn't a built-in role, so a profiles.role check would lock it out. Mirrors
-- the convention in roles-rls-financials.sql / gl-spine.sql.)
drop policy if exists plaid_catmap_read on public.plaid_category_map;
create policy plaid_catmap_read on public.plaid_category_map
  for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists plaid_catmap_write on public.plaid_category_map;
create policy plaid_catmap_write on public.plaid_category_map
  for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );
