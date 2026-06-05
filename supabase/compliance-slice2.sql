-- ============================================================
-- Residente — FL compliance Slice 2: cheap date-clock wins
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: compliance-foundation.sql (communities profile cols),
--             easy-violations.sql + enforcement.sql (ev_violations),
--             rules-and-documents.sql (documents).
-- ============================================================
--
-- Adds the small columns five new advisory date-clocks read. The statutory math
-- lives in lib/compliance/{structural,enforcement,official-records,financials}.ts;
-- the /admin/compliance dashboard + the weekly compliance-scan cron raise the
-- signals. Nothing here blocks a board action. No new tables / RLS / triggers —
-- every table already has its policies. All ALTERs are add-if-not-exists.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the $4/unit DBPR fee + Jan 1 / Mar 1 / 10%
--   penalty (FS 718.501(2)(a)), the 3+-story building report (FS 718.501(3)),
--   the HOA 7-day findings + 30-day payment clocks (FS 720.305(2)(d)/(f)), the
--   HOA 30-day recorded-amendment distribution (FS 720.306(1)(b)), and the HOA
--   one-year reserve-waiver expiry (FS 720.303(6)(f)) must be confirmed by
--   Florida community-association counsel.

-- ---------- 1) CONDO DBPR fee + 3-story building report (FS 718.501(2)/(3)) ----------
alter table public.communities
  add column if not exists dbpr_fee_paid_year          int,    -- last calendar year the $4/unit annual fee was paid
  add column if not exists dbpr_building_report_filed_at date;  -- date the SB 4-D 3+-story building report was filed with DBPR

-- ---------- 2) HOA post-hearing fining clock (FS 720.305(2)(d)/(f)) ----------
alter table public.ev_violations
  add column if not exists findings_sent_at date,   -- written notice of the committee's findings (7-day clock)
  add column if not exists fine_due_on      date;   -- the fine payment deadline set for the owner (>= findings + 30 days)

-- ---------- 3) HOA recorded-amendment distribution (FS 720.306(1)(b)) ----------
alter table public.documents
  add column if not exists is_amendment           boolean not null default false, -- this document is a recorded governing-document amendment
  add column if not exists amendment_recorded_at  date,    -- date recorded in the public records (starts the 30-day clock)
  add column if not exists members_distributed_at date;    -- date a copy / notice was provided to members

-- PostgREST caches the schema; reload so the new columns are immediately visible
-- to the API (avoids a transient "column does not exist" right after this runs).
notify pgrst, 'reload schema';
