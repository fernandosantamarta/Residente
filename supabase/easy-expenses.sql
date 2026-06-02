-- ============================================================
-- Residente — Expense ledger (dated community spend)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- A dated record of what the association actually spent and when. The board
-- logs expenses at /admin/community (below Budget categories); the resident
-- Home "Financial Overview" chart aggregates them into a real month-by-month
-- spending curve instead of the old synthesized ramp. Every member of the
-- community can read them (financial transparency); only the board writes.

create table if not exists public.ev_expenses (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  category_id   uuid references public.budget_categories(id) on delete set null, -- optional link
  amount        numeric not null check (amount >= 0),
  spent_on      date not null default current_date,
  description   text,
  vendor        text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ev_expenses_community_idx on public.ev_expenses (community_id, spent_on desc);
create index if not exists ev_expenses_category_idx  on public.ev_expenses (category_id);

alter table public.ev_expenses enable row level security;
grant select, insert, update, delete on public.ev_expenses to authenticated;
grant select, insert, update, delete on public.ev_expenses to service_role;

-- Every member of the community can read the ledger (the Home chart needs it).
drop policy if exists "members read community expenses" on public.ev_expenses;
create policy "members read community expenses"
  on public.ev_expenses for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

-- Only the board issues / edits / removes expenses in their own community.
drop policy if exists "board writes community expenses" on public.ev_expenses;
create policy "board writes community expenses"
  on public.ev_expenses for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
