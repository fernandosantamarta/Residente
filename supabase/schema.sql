-- ============================================================
-- Residente — base schema
-- Run once in the Supabase SQL editor.
-- Safe to re-run: all statements use IF NOT EXISTS / DO NOTHING.
-- ============================================================

-- ---------- COMMUNITIES ----------
create table if not exists public.communities (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  location            text,
  unit_count          int,
  fiscal_year         int,
  annual_budget       numeric,
  monthly_dues        numeric,
  late_interest_rate  numeric default 0,
  created_at          timestamptz not null default now()
);
alter table public.communities enable row level security;
grant select, insert, update, delete on public.communities to authenticated;

create policy "members read community"
  on public.communities for select to authenticated
  using (id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes community"
  on public.communities for all to authenticated
  using (
    id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  unit_number  text,
  email        text,
  phone        text,
  role         text not null default 'resident'
                 check (role in ('resident','board_member','admin')),
  community_id uuid references public.communities(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
grant select, insert, update, delete on public.profiles to authenticated;

create policy "users read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "users insert own profile"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- ---------- BUDGET CATEGORIES ----------
create table if not exists public.budget_categories (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name         text not null,
  budget       numeric not null default 0,
  spent        numeric not null default 0,
  sort_order   int not null default 0
);
alter table public.budget_categories enable row level security;
grant select, insert, update, delete on public.budget_categories to authenticated;

create policy "members read budget categories"
  on public.budget_categories for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes budget categories"
  on public.budget_categories for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- BOARD DECISIONS ----------
create table if not exists public.board_decisions (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title        text not null,
  vendor       text,
  amount       numeric,
  status       text,
  decided_on   date not null default current_date,
  created_at   timestamptz not null default now()
);
alter table public.board_decisions enable row level security;
grant select, insert, update, delete on public.board_decisions to authenticated;

create policy "members read board decisions"
  on public.board_decisions for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes board decisions"
  on public.board_decisions for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- RESIDENTS ----------
create table if not exists public.residents (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references public.communities(id) on delete cascade,
  full_name        text not null,
  unit_number      text,
  email            text,
  phone            text,
  subdivision      text,
  address          text,
  is_board         boolean not null default false,
  board_position   text,
  opening_balance  numeric default 0,
  created_at       timestamptz not null default now()
);
alter table public.residents enable row level security;
grant select, insert, update, delete on public.residents to authenticated;

create policy "members read residents"
  on public.residents for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes residents"
  on public.residents for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- PAYMENTS ----------
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  resident_id       uuid not null references public.residents(id) on delete cascade,
  amount            numeric not null,
  paid_on           date not null default current_date,
  stripe_session_id text,
  created_at        timestamptz not null default now()
);
alter table public.payments enable row level security;
grant select, insert, update, delete on public.payments to authenticated;

create policy "members read payments"
  on public.payments for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes payments"
  on public.payments for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

create unique index if not exists payments_stripe_session_id_key
  on public.payments (stripe_session_id)
  where stripe_session_id is not null;
