-- ============================================================
-- Residente — community_dues_summary(): aggregate dues, no row exposure
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- After Finding 3 (0001_payments_board_only_read.sql) residents can no longer
-- read other households' payment rows. The resident Reports page still shows a
-- "% collected" tile, so it needs the community aggregate WITHOUT the rows.
--
-- This SECURITY DEFINER function computes the same dues model as lib/dues.ts
-- (opening balance + monthly accrual - payments + triangular late interest) and
-- returns ONLY totals + status counts. Any member of the community may call it;
-- it never returns a single payer's amount, so "who paid" stays private.

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
  v_monthly     numeric;
  v_rate        numeric;
  v_collected   numeric := 0;
  v_outstanding numeric := 0;
  v_paid        int := 0;
  v_due         int := 0;
  v_late        int := 0;
  v_households  int := 0;
  r             record;
  v_months_owed   int;
  v_after_opening numeric;
  v_months_covered int;
  v_months_late   int;
  v_triangular    numeric;
  v_interest      numeric;
  v_accrued       numeric;
  v_balance       numeric;
begin
  -- Authz: caller must be a member of this community. Aggregates only — no
  -- per-resident rows are ever returned, so this is safe for any member.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and community_id = p_community
  ) then
    raise exception 'not a member of this community';
  end if;

  select coalesce(monthly_dues, 0), coalesce(late_interest_rate, 0)
    into v_monthly, v_rate
    from public.communities where id = p_community;

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

    -- monthsOwed = whole months since created_at, + the current month.
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

    if v_rate > 0 and v_monthly > 0 and v_months_late > 0 then
      v_triangular := (v_months_late * (v_months_late + 1)) / 2.0;
      v_interest   := round(v_monthly * (v_rate / 100.0) * v_triangular, 2);
    else
      v_interest := 0;
    end if;

    v_accrued := v_months_owed * v_monthly;
    v_balance := round(r.opening + v_accrued - r.paid_sum + v_interest, 2);

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
