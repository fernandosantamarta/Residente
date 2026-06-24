-- ============================================================
-- Residente — Auto-generated monthly dues charges (audit / GL ledger)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: communities (monthly_dues, assessment_due_day),
--             residents (community_id, profile_id, approval_state),
--             custom-roles.sql (has_permission()).
-- ============================================================
--
-- A monthly snapshot of the assessment minted for each active household, written
-- once per (community, resident, billing period) by the charge-monthly-dues cron
-- (app/api/cron/charge-monthly-dues). This is an AUDIT / general-ledger record
-- only — it documents WHEN each month's assessment was raised and at what amount.
--
-- ⚠ NOT a balance source. The resident balance shown across the app stays
-- FORMULA-based in lib/dues.ts (opening + monthsOwed·monthlyDues − payments +
-- interest + fees). This table is deliberately NOT wired into residentBalance(),
-- so it can never double-count what that formula already accrues. status here is
-- informational; payments remain receipts in public.payments.

create table if not exists public.ev_monthly_charges (
  id                   uuid primary key default gen_random_uuid(),
  community_id         uuid not null references public.communities(id) on delete cascade,
  resident_id          uuid not null references public.residents(id) on delete cascade,
  billing_period_start date not null,   -- first day of the billed month
  billing_period_end   date not null,   -- last day of the billed month
  due_date             date not null,   -- billing_period_start + (assessment_due_day - 1)
  amount               numeric not null,
  status               text not null default 'pending'
                         check (status in ('pending','paid-in-full','partial','reversed')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  notes                text
);

-- Idempotency backstop: one charge per household per billing period. The cron's
-- INSERT ... ON CONFLICT DO NOTHING leans on this exact unique key.
create unique index if not exists ev_monthly_charges_idem
  on public.ev_monthly_charges (community_id, resident_id, billing_period_start);

-- The board ledger view (newest assessments first) and per-resident lookups.
create index if not exists ev_monthly_charges_community_due_idx
  on public.ev_monthly_charges (community_id, due_date desc);
create index if not exists ev_monthly_charges_resident_period_idx
  on public.ev_monthly_charges (resident_id, billing_period_start desc);

alter table public.ev_monthly_charges enable row level security;

grant references, trigger, truncate on public.ev_monthly_charges to anon;
grant select, insert, update, delete on public.ev_monthly_charges to authenticated;
grant select, insert, update, delete on public.ev_monthly_charges to service_role;

-- ---------- keep updated_at honest ----------
create or replace function public.ev_monthly_charges_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ev_monthly_charges_touch_trg on public.ev_monthly_charges;
create trigger ev_monthly_charges_touch_trg
  before update on public.ev_monthly_charges
  for each row execute function public.ev_monthly_charges_touch();

-- ---------- RLS ----------
-- A resident reads their OWN charges (their residents row links via profile_id).
drop policy if exists "resident reads own monthly charges" on public.ev_monthly_charges;
create policy "resident reads own monthly charges"
  on public.ev_monthly_charges for select to authenticated
  using (
    exists (
      select 1 from public.residents r
      where r.id = ev_monthly_charges.resident_id
        and r.profile_id = auth.uid()
    )
  );

-- The board reads its community's full ledger. board_member/admin always; other
-- roles only with the payments.view (or .manage) permission.
drop policy if exists "board reads community monthly charges" on public.ev_monthly_charges;
create policy "board reads community monthly charges"
  on public.ev_monthly_charges for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('payments.view')
      or public.has_permission('payments.manage')
    )
  );

-- The board writes its community's ledger (corrections / status). Same gate as reads.
drop policy if exists "board writes community monthly charges" on public.ev_monthly_charges;
create policy "board writes community monthly charges"
  on public.ev_monthly_charges for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('payments.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('payments.manage')
    )
  );

-- Refresh the PostgREST schema cache so the new table is queryable.
notify pgrst, 'reload schema';
