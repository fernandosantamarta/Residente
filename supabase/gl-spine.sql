-- ============================================================
-- Residente — General-ledger spine (Phase 3 / Workstream B)
-- Run once in the Supabase SQL editor. Idempotent; safe to re-run.
-- ============================================================
-- A double-entry general ledger built as a REGENERABLE PROJECTION of data the
-- app already holds (payments, ev_expenses, ev_violations, and the accrual rules
-- in lib/dues.ts). It is never hand-kept: lib/gl/project.ts produces balanced
-- journal entries; this schema stores them, keyed by a stable source_key, so a
-- rebuild is idempotent (upsert on (community_id, source_key)).
--
-- SCOPE (Workstream B): every entry is SINGLE-FUND ('operating' | 'reserve').
-- All dues/fines/expenses post to the operating fund; the reserve fund is seeded
-- only from ev_reserve_components (board-stated balances). True inter-fund reserve
-- transfers + reserve-expense classification arrive with the bank feed (Plaid,
-- Workstream C/D) — see [[eliminate-back-office-plan]].
--
-- TIE-OUT CONTRACT: operating "Assessments receivable" (1100) net balance equals
-- Σ residentBalance() over the roster (lib/dues.ts). scripts/verify-gl.mjs
-- (npm run verify:gl) proves it; re-run if you touch the builder or this file.
--
-- SECURITY (mirrors the dues fix + custom-roles.sql definer model):
--   • GL detail is board-only read via has_permission('financials.view').
--   • Residents read ONLY their own entries/lines.
--   • NO insert/update/delete grants to `authenticated` — writes are service-role
--     only; the one human path is gl_post_manual_adjustment() (definer, gated).

-- ---------- 1) CHART OF ACCOUNTS ----------
create table if not exists public.gl_accounts (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,  -- null = global system template
  code         text not null,
  name         text not null,
  type         text not null check (type in ('asset','liability','equity','revenue','expense')),
  fund_hint    text check (fund_hint is null or fund_hint in ('operating','reserve')),
  is_system    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
-- Unique per (community, code), treating the global template (null community) as one namespace.
create unique index if not exists gl_accounts_code_uniq
  on public.gl_accounts (coalesce(community_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

-- Seed the global system chart (community_id = null). idempotent.
insert into public.gl_accounts (community_id, code, name, type, fund_hint, sort_order) values
  (null, '1000', 'Operating cash',                         'asset',     'operating',  10),
  (null, '1010', 'Reserve cash',                           'asset',     'reserve',    20),
  (null, '1100', 'Assessments receivable',                 'asset',     'operating',  30),
  (null, '1500', 'Collection & attorney costs receivable', 'asset',     'operating',  40),
  (null, '2000', 'Prepaid assessments',                    'liability', 'operating',  50),
  (null, '3000', 'Fund balance — operating',               'equity',    'operating',  60),
  (null, '3010', 'Fund balance — reserve',                 'equity',    'reserve',    70),
  (null, '4000', 'Assessment revenue',                     'revenue',   'operating',  80),
  (null, '4100', 'Fine revenue',                           'revenue',   'operating',  90),
  (null, '4200', 'Amenity revenue',                        'revenue',   'operating', 100),
  (null, '4300', 'Interest income',                        'revenue',   'operating', 110),
  (null, '4310', 'Late-fee income',                        'revenue',   'operating', 120),
  (null, '4900', 'Bank interest',                          'revenue',   'operating', 130),
  (null, '5000', 'Operating expenses',                     'expense',   'operating', 140),
  (null, '5010', 'Reserve expenses',                       'expense',   'reserve',   150)
on conflict (coalesce(community_id, '00000000-0000-0000-0000-000000000000'::uuid), code) do nothing;
-- Accounts 1500/2000/4200/4900/5010 and source_types amenity/reserve_transfer/
-- bank_interest/ach_return are seeded ahead for Workstream C/D (Plaid + reconciliation);
-- the Workstream-B builder emits only the dues/fine/expense/reserve-seed/unapplied set.

-- ---------- 2) JOURNAL ENTRIES + LINES ----------
create table if not exists public.gl_journal_entries (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  entry_date   date not null,
  fiscal_year  int  not null,
  fund         text not null check (fund in ('operating','reserve')),
  source_type  text not null check (source_type in (
                 'accrual','opening_balance','interest','late_fee','payment','fine',
                 'amenity','expense','reserve_open','reserve_transfer','bank_interest',
                 'ach_return','manual_adjustment')),
  source_id    uuid,                                  -- payments.id / ev_expenses.id / etc. (informational)
  source_key   text not null,                         -- stable dedup key, e.g. 'accrual:<resident>:2026-03'
  resident_id  uuid references public.residents(id) on delete set null,
  memo         text,
  posted_by    uuid references public.profiles(id) on delete set null,  -- null = machine projection
  created_at   timestamptz not null default now(),
  unique (community_id, source_key)
);
create index if not exists gl_entries_community_idx on public.gl_journal_entries (community_id, fiscal_year, entry_date);

create table if not exists public.gl_entry_lines (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.gl_journal_entries(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,  -- denormalized for RLS scoping
  account_id   uuid not null references public.gl_accounts(id),
  fund         text not null check (fund in ('operating','reserve')),
  resident_id  uuid references public.residents(id) on delete set null,
  category_id  uuid references public.budget_categories(id) on delete set null,    -- expense category detail
  debit        numeric(14,2) not null default 0,
  credit       numeric(14,2) not null default 0,
  check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
);
create index if not exists gl_lines_entry_idx     on public.gl_entry_lines (entry_id);
create index if not exists gl_lines_community_idx  on public.gl_entry_lines (community_id, account_id);

-- ---------- 3) BALANCED-ENTRY INVARIANT (per fund, deferred) ----------
-- Reject any entry whose lines do not net to zero within EACH fund. Because
-- entries are single-fund here, this also guarantees Σdebit = Σcredit. Deferred
-- so a multi-line entry validates at COMMIT, not after the first line.
create or replace function public.gl_assert_entry_balanced() returns trigger
language plpgsql as $$
declare
  v_entry uuid;
  v_bad   int;
begin
  v_entry := coalesce(new.entry_id, old.entry_id);
  -- (If the parent entry was deleted via cascade, no lines remain → v_bad = 0 → ok.)
  select count(*) into v_bad from (
    select l.fund, round(sum(l.debit) - sum(l.credit), 2) as net
      from public.gl_entry_lines l
     where l.entry_id = v_entry
     group by l.fund
  ) s
  where s.net <> 0;
  if v_bad > 0 then
    raise exception 'GL entry % is unbalanced (debits <> credits within a fund)', v_entry;
  end if;
  return null;
end $$;

drop trigger if exists gl_lines_balance_check on public.gl_entry_lines;
create constraint trigger gl_lines_balance_check
  after insert or update or delete on public.gl_entry_lines
  deferrable initially deferred
  for each row execute function public.gl_assert_entry_balanced();

-- WRITER CONTRACT (for the future service-role backfill/rebuild): the check fires
-- per row but is evaluated at COMMIT (initially deferred), so intermediate
-- per-statement states within a transaction are fine — but every entry MUST net to
-- zero per fund by COMMIT. Insert all of an entry's lines in the same transaction;
-- to replace an entry's lines, do it atomically (delete-then-insert all lines, or
-- upsert on (community_id, source_key)). A partial rebuild that leaves an entry with
-- a non-zero net at COMMIT will (correctly) raise.

-- ---------- 4) TRIAL BALANCE VIEW (security_invoker → RLS applies to caller) ----------
-- A plain (owner-defined) view would BYPASS RLS and re-create the leak that
-- 0001_payments_board_only_read.sql fixed; security_invoker keeps per-caller RLS.
create or replace view public.gl_trial_balance with (security_invoker = true) as
  select l.community_id,
         l.fund,
         a.code,
         a.name,
         a.type,
         round(sum(l.debit), 2)  as debit,
         round(sum(l.credit), 2) as credit,
         round(sum(l.debit) - sum(l.credit), 2) as balance
    from public.gl_entry_lines l
    join public.gl_accounts a on a.id = l.account_id
   group by l.community_id, l.fund, a.code, a.name, a.type;

-- ---------- 5) RLS ----------
alter table public.gl_accounts        enable row level security;
alter table public.gl_journal_entries enable row level security;
alter table public.gl_entry_lines     enable row level security;

-- Read-only to authenticated; NO write DML (service-role writes bypass RLS).
grant select on public.gl_accounts        to authenticated;
grant select on public.gl_journal_entries to authenticated;
grant select on public.gl_entry_lines     to authenticated;
grant select on public.gl_trial_balance   to authenticated;

-- Accounts carry no amounts → any member may read the global + their community's chart.
drop policy if exists "members read gl accounts" on public.gl_accounts;
create policy "members read gl accounts" on public.gl_accounts for select to authenticated
  using (community_id is null
         or community_id = (select community_id from public.profiles where id = auth.uid()));

-- Entries: board reads all in their community; residents read only their own.
drop policy if exists "board reads gl entries" on public.gl_journal_entries;
create policy "board reads gl entries" on public.gl_journal_entries for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid())
         and public.has_permission('financials.view'));

drop policy if exists "residents read own gl entries" on public.gl_journal_entries;
create policy "residents read own gl entries" on public.gl_journal_entries for select to authenticated
  using (resident_id in (select id from public.residents where profile_id = auth.uid()));

-- Lines: visible iff the PARENT entry is visible (board or own) — residents see a
-- coherent whole entry, never orphaned lines.
drop policy if exists "read gl lines via entry" on public.gl_entry_lines;
create policy "read gl lines via entry" on public.gl_entry_lines for select to authenticated
  using (exists (
    select 1 from public.gl_journal_entries e
     where e.id = entry_id
       and (
         (e.community_id = (select community_id from public.profiles where id = auth.uid())
          and public.has_permission('financials.view'))
         or e.resident_id in (select id from public.residents where profile_id = auth.uid())
       )
  ));

-- ---------- 6) THE ONE HUMAN WRITE PATH: manual adjustment ----------
-- Service-role rebuilds write machine entries directly. A human correction goes
-- through here: financials.manage-gated (Treasurer and above, per custom-roles.sql),
-- balanced + single-fund enforced, audited.
-- p_lines: jsonb array of { account_code, debit, credit, resident_id?, category_id? }.
create or replace function public.gl_post_manual_adjustment(
  p_community  uuid,
  p_entry_date date,
  p_fund       text,
  p_memo       text,
  p_lines      jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid         uuid;
  v_entry     uuid;
  v_start_mon int;
  v_fy        int;
  v_debit     numeric := 0;
  v_credit    numeric := 0;
  ln          jsonb;
  v_acct      uuid;
  v_d         numeric;
  v_c         numeric;
begin
  if not public.has_permission('financials.manage') then
    raise exception 'not allowed';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null or cid <> p_community then
    raise exception 'not a member of this community';
  end if;
  if p_fund not in ('operating','reserve') then
    raise exception 'fund must be operating or reserve';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'a balanced adjustment needs at least two lines';
  end if;

  select coalesce(fiscal_year_start_month, 1) into v_start_mon from public.communities where id = p_community;
  v_fy := case when extract(month from p_entry_date)::int >= v_start_mon
               then extract(year from p_entry_date)::int
               else extract(year from p_entry_date)::int - 1 end;

  insert into public.gl_journal_entries
    (community_id, entry_date, fiscal_year, fund, source_type, source_key, memo, posted_by)
  values
    (p_community, p_entry_date, v_fy, p_fund, 'manual_adjustment',
     'manual:' || gen_random_uuid()::text, p_memo, auth.uid())
  returning id into v_entry;

  for ln in select * from jsonb_array_elements(p_lines)
  loop
    select id into v_acct from public.gl_accounts
      where code = (ln->>'account_code')
        and (community_id = p_community or community_id is null)
      order by (community_id is not null) desc   -- prefer the community-specific account over the global fallback
      limit 1;
    if v_acct is null then
      raise exception 'unknown account code %', (ln->>'account_code');
    end if;
    v_d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    v_c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if (v_d > 0 and v_c > 0) or v_d < 0 or v_c < 0 then
      raise exception 'each line must be a non-negative debit OR credit, not both positive';
    end if;
    -- A referenced resident must belong to this community (audit-trail hygiene).
    if nullif(ln->>'resident_id','') is not null
       and not exists (select 1 from public.residents
                       where id = (ln->>'resident_id')::uuid and community_id = p_community) then
      raise exception 'resident % is not in this community', (ln->>'resident_id');
    end if;
    insert into public.gl_entry_lines
      (entry_id, community_id, account_id, fund, resident_id, category_id, debit, credit)
    values
      (v_entry, p_community, v_acct, p_fund,
       nullif(ln->>'resident_id','')::uuid, nullif(ln->>'category_id','')::uuid, v_d, v_c);
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;

  if round(v_debit - v_credit, 2) <> 0 then
    raise exception 'adjustment is unbalanced: debits % <> credits %', v_debit, v_credit;
  end if;

  -- Best-effort audit (never block the adjustment on the audit insert).
  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id)
    values (p_community, 'financial.gl_manual_adjustment', 'gl_entry', v_entry);
  exception when others then null;
  end;

  return v_entry;
end $$;

grant execute on function public.gl_post_manual_adjustment(uuid, date, text, text, jsonb) to authenticated;
