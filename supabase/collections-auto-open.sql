-- ============================================================
-- Residente — Collections auto-open settings (community profile)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Depends on: collections.sql (ev_collection_cases).
-- ============================================================
--
-- Board-configurable thresholds for the delinquency scan. Detection + prompting
-- is automated (the Collections worklist suggests delinquent owners with no open
-- case; the /api/cron/collections-deadlines sweep can auto-open a PRE-NOTICE case
-- when collections_auto_open is on). The statutory steps (notices, lien,
-- foreclosure) always remain a manual board action — nothing here auto-sends a
-- notice or records a lien. Defaults preserve current behaviour: no auto-open,
-- no $ / days floor (every owner who is behind more than the current installment
-- is suggested).

alter table public.communities
  add column if not exists collections_auto_open  boolean not null default false, -- cron auto-opens pre-notice cases
  add column if not exists collections_min_balance numeric,                        -- $ floor before suggesting (NULL = none)
  add column if not exists collections_min_days    int;                            -- days-past-due floor (NULL = none)

-- At most ONE open case per owner per community. Excludes terminal stages so a
-- new case can be opened after a prior one resolves, and null-resident (manual,
-- free-text) cases. Guarantees the auto-open sweep + one-click can't create a
-- duplicate open case even under a concurrent run / mid-sweep manual open.
create unique index if not exists ev_collection_cases_open_unique
  on public.ev_collection_cases (community_id, resident_id)
  where resident_id is not null
    and stage in ('delinquent','notice_30','intent_to_lien','lien_recorded','intent_to_foreclose','foreclosure');
