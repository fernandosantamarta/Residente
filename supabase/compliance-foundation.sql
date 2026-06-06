-- ============================================================
-- Residente — FL Statutory Compliance: foundation
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- ============================================================
--
-- 1) Extends `communities` with the statutory "compliance profile" every
--    domain reads (interest/late-fee config, counts, fiscal, association
--    identity, website/DBPR/estoppel/ARC/reserve settings).
-- 2) Backfills the new annual `interest_apr` from the legacy MONTHLY
--    `late_interest_rate` (× 12) so EVERY community's computed balance is
--    byte-identical before and after this migration (a board that set
--    1.5%/month now reads 18%/year ⇒ same monthly factor). Communities that
--    never set a rate stay at NULL ⇒ the platform charges no interest.
-- 3) Redefines community_dues_summary() to match the corrected lib/dues.ts:
--    SIMPLE interest at an ANNUAL apr (monthly factor = apr/12/100) plus an
--    optional per-installment admin late fee. (Supersedes the apr-as-monthly
--    semantics in migrations/0002.)
--
-- FL refs: FS 718.116(3) / 720.3085(3); HB 1203 simple-interest-only eff
-- 2024-07-01; statutory interest cap 18%/yr; admin late fee ≤ greater of
-- $25 or 5% of the delinquent installment.
-- ⚠ The exact interest method, late-fee cap, and any governing-document
--   override MUST be confirmed by Florida community-association counsel.

-- ---------- 1) COMMUNITY COMPLIANCE PROFILE ----------
alter table public.communities
  -- assessments / interest / late fees
  add column if not exists interest_apr numeric,                       -- annual %, NULL = none/legacy
  add column if not exists interest_simple boolean not null default true,
  add column if not exists late_fee_flat numeric,                      -- $ per delinquent installment
  add column if not exists late_fee_pct numeric,                       -- % per delinquent installment
  add column if not exists assessment_due_day int,                     -- day of month assessments are due
  -- association identity (lien execution, notices, estoppel)
  add column if not exists association_address text,
  add column if not exists association_officer_name text,
  -- counts + fiscal (thresholds: condo 25-unit website, HOA 100-parcel + audit tiers)
  add column if not exists parcel_count int,
  add column if not exists building_stories int,
  add column if not exists fiscal_year_start_month int not null default 1,
  -- structural / DBPR (condo)
  add column if not exists dbpr_account_created_at timestamptz,
  -- official-records website posting
  add column if not exists website_url text,
  add column if not exists website_posting_enabled boolean not null default false,
  -- estoppel
  add column if not exists estoppel_designated_recipient text,
  add column if not exists estoppel_designated_address text,
  -- architectural review (HOA) + condo material alteration
  add column if not exists arc_response_days int not null default 30,
  add column if not exists arc_deemed_approval boolean not null default false,
  add column if not exists material_alteration_threshold_pct numeric,
  -- reserves
  add column if not exists reserves_established boolean not null default false,
  add column if not exists reserve_study_last_completed date,
  add column if not exists reserve_study_type text
    check (reserve_study_type is null or reserve_study_type in ('sirs','general'));

-- ---------- 2) NO-SURPRISE BACKFILL ----------
-- Convert any previously-configured MONTHLY rate to the new ANNUAL field.
-- Communities at 0/NULL are left NULL on purpose (no interest charged).
update public.communities
   set interest_apr = late_interest_rate * 12
 where interest_apr is null
   and late_interest_rate is not null
   and late_interest_rate > 0;

-- ---------- 3) DUES SUMMARY (statutory simple interest + admin late fee) ----------
-- Same authz + shape as migrations/0002; only the interest/fee math changes.
-- MIRRORED in supabase/migrations/0002_community_dues_summary.sql. The two MUST
-- stay in sync with lib/dues.ts; `npm run verify:dues` is the parity guard.
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
  v_apr         numeric;   -- ANNUAL interest %
  v_fee_flat    numeric;
  v_fee_pct     numeric;
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
  v_fees          numeric;
  v_accrued       numeric;
  v_balance       numeric;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and community_id = p_community
  ) then
    raise exception 'not a member of this community';
  end if;

  select coalesce(monthly_dues, 0),
         -- prefer the new annual field; else legacy monthly × 12; else 0
         coalesce(interest_apr, late_interest_rate * 12, 0),
         coalesce(late_fee_flat, 0),
         coalesce(late_fee_pct, 0)
    into v_monthly, v_apr, v_fee_flat, v_fee_pct
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

    -- SIMPLE interest: installment late j months accrues j months of interest
    -- at the monthly factor apr/12/100; sum_{j=1..late} j = late·(late+1)/2.
    if v_apr > 0 and v_monthly > 0 and v_months_late > 0 then
      v_triangular := (v_months_late * (v_months_late + 1)) / 2.0;
      v_interest   := round(v_monthly * (v_apr / 12.0 / 100.0) * v_triangular, 2);
    else
      v_interest := 0;
    end if;

    -- Admin late fee: greater of flat or % of the installment, per late installment.
    if v_monthly > 0 and v_months_late > 0 and (v_fee_flat > 0 or v_fee_pct > 0) then
      v_fees := round(greatest(v_fee_flat, v_monthly * v_fee_pct / 100.0) * v_months_late, 2);
    else
      v_fees := 0;
    end if;

    v_accrued := v_months_owed * v_monthly;
    v_balance := round(r.opening + v_accrued - r.paid_sum + v_interest + v_fees, 2);

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

-- ---------- 4) NOTICE KINDS (compliance alerts + estoppel updates) ----------
-- Widen ev_notices.kind to permit the compliance layer's notice kinds, mirroring
-- the dues-reminders widening. (Append-only list — keep all prior kinds.)
alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due',
                  'compliance_alert','estoppel_update'));
