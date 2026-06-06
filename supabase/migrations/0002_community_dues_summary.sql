-- ============================================================
-- Residente — community_dues_summary(): aggregate dues, no row exposure
-- Run once in the Supabase SQL editor. Safe to re-run (create or replace).
-- ============================================================
--
-- After Finding 3 (0001_payments_board_only_read.sql) residents can no longer
-- read other households' payment rows. The resident Reports page still shows a
-- "% collected" tile, so it needs the community aggregate WITHOUT the rows.
--
-- This SECURITY DEFINER function reproduces the canonical dues model in
-- lib/dues.ts EXACTLY:
--   balance = opening_balance
--           + months_owed * monthly_dues          (accrual)
--           − Σ payments                           (paid)
--           + SIMPLE late interest                 (lateInterest)
--           + administrative late fee              (adminLateFees)
-- where late interest uses the ANNUAL rate as a monthly factor apr/12/100 per
-- delinquent installment (FS 718.116(3)/720.3085(3), simple — HB 1203), and the
-- admin fee is the greater of a flat $ or % of the installment, per delinquent
-- installment. Both interest and fees are OPT-IN (zero unless the board set them).
-- It returns ONLY totals + status counts; it never returns a single payer's
-- amount, so "who paid" stays private.
--
-- PARITY CONTRACT: these figures MUST equal residentBalance()/duesStatus() in
-- lib/dues.ts summed over the roster. `npm run verify:dues` fuzz/golden-checks
-- that contract — re-run it if you touch either side.
--
-- Config resolution mirrors communityDuesConfig(): prefer the annual
-- `interest_apr`; else fall back to the legacy monthly `late_interest_rate` × 12
-- (1.5%/month ⇒ 18%/year ⇒ identical monthly factor).
--
-- NOTE (pre-existing, unchanged): months_owed is a coarse calendar-month count
-- using now() vs created_at; it matches monthsOwed() in lib/dues.ts.
--
-- This corrected definition is MIRRORED in supabase/compliance-foundation.sql
-- (which also adds the columns below + backfills interest_apr). The two MUST stay
-- in sync; `npm run verify:dues` is the parity guard — re-run it if you edit either.

-- Make this migration self-contained: ensure the statutory columns the function
-- reads exist, so a fresh run (0000→0001→0002) before compliance-foundation.sql
-- still succeeds. Idempotent; a no-op once compliance-foundation.sql has run.
alter table public.communities
  add column if not exists interest_apr  numeric,
  add column if not exists late_fee_flat numeric,
  add column if not exists late_fee_pct  numeric;

create or replace function public.community_dues_summary(p_community uuid)
returns table (
  collected   numeric,
  outstanding numeric,
  paid        int,
  due         int,
  late        int,
  households  int,
  rate        int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_monthly        numeric;
  v_interest_apr   numeric;   -- annual %, may be null on pre-migration communities
  v_late_rate      numeric;   -- legacy monthly %, fallback only
  v_apr            numeric;   -- resolved annual % (mirrors communityDuesConfig)
  v_flat           numeric;
  v_pct            numeric;
  v_collected      numeric := 0;
  v_outstanding    numeric := 0;
  v_paid           int := 0;
  v_due            int := 0;
  v_late           int := 0;
  v_households     int := 0;
  r                record;
  v_months_owed    int;
  v_after_opening  numeric;
  v_months_covered int;
  v_months_late    int;
  v_triangular     numeric;
  v_interest       numeric;
  v_per_install    numeric;
  v_fee            numeric;
  v_accrued        numeric;
  v_balance        numeric;
begin
  -- Authz: caller must be a member of this community. Aggregates only — no
  -- per-resident rows are ever returned, so this is safe for any member.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and community_id = p_community
  ) then
    raise exception 'not a member of this community';
  end if;

  select coalesce(monthly_dues, 0), interest_apr, late_interest_rate,
         coalesce(late_fee_flat, 0), coalesce(late_fee_pct, 0)
    into v_monthly, v_interest_apr, v_late_rate, v_flat, v_pct
    from public.communities where id = p_community;

  -- communityDuesConfig(): prefer annual interest_apr; else legacy monthly × 12.
  v_apr := coalesce(v_interest_apr, coalesce(v_late_rate, 0) * 12);

  for r in
    select res.id,
           res.created_at,
           coalesce(res.opening_balance, 0) as opening,
           coalesce((select sum(p.amount) from public.payments p where p.resident_id = res.id), 0) as paid_sum
      from public.residents res
     where res.community_id = p_community
  loop
    v_households := v_households + 1;
    v_collected  := v_collected + r.paid_sum;

    -- monthsOwed = whole calendar months since created_at, + the current month.
    v_months_owed := greatest(0,
        (extract(year from now())::int  - extract(year from r.created_at)::int) * 12
      + (extract(month from now())::int - extract(month from r.created_at)::int)
    ) + 1;

    if v_monthly > 0 then
      v_after_opening  := greatest(0, r.paid_sum - r.opening);
      v_months_covered := least(v_months_owed, floor(v_after_opening / v_monthly));
    else
      v_months_covered := 0;
    end if;

    v_months_late := greatest(0, v_months_owed - v_months_covered - 1);

    -- SIMPLE late interest: monthly factor apr/12/100 × triangular(months_late).
    if v_apr > 0 and v_monthly > 0 and v_months_late > 0 then
      v_triangular := (v_months_late * (v_months_late + 1)) / 2.0;
      v_interest   := round(v_monthly * (v_apr / 12.0 / 100.0) * v_triangular, 2);
    else
      v_interest := 0;
    end if;

    -- Administrative late fee: greater of flat $ or % of the installment, per
    -- delinquent installment. Opt-in (zero unless the board configured one).
    if v_monthly > 0 and v_months_late > 0 and (v_flat > 0 or v_pct > 0) then
      v_per_install := greatest(v_flat, v_monthly * v_pct / 100.0);
      v_fee         := round(v_per_install * v_months_late, 2);
    else
      v_fee := 0;
    end if;

    v_accrued := v_months_owed * v_monthly;
    v_balance := round(r.opening + v_accrued - r.paid_sum + v_interest + v_fee, 2);

    if v_balance > 0 then
      v_outstanding := v_outstanding + v_balance;
    end if;

    if v_balance <= 0.005 then
      v_paid := v_paid + 1;
    elsif v_balance <= v_monthly + 0.005 then
      v_due := v_due + 1;
    else
      v_late := v_late + 1;
    end if;
  end loop;

  collected   := round(v_collected, 2);
  outstanding := round(v_outstanding, 2);
  paid        := v_paid;
  due         := v_due;
  late        := v_late;
  households  := v_households;
  rate        := case when (v_collected + v_outstanding) > 0
                      then round((v_collected / (v_collected + v_outstanding)) * 100)::int
                      else 100 end;
  return next;
end $$;

grant execute on function public.community_dues_summary(uuid) to authenticated;
