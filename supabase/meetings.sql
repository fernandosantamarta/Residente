-- ============================================================
-- Residente — Meetings & statutory notice (Domain H)
-- (FS 718.112(2)(c)-(e) condo / FS 720.303(2) & 720.306(5) HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: easy-voice.sql (ev_meetings).
-- ============================================================
--
-- The operational meeting feature already lives in ev_meetings + /admin/voice.
-- This migration adds the NOTICE-COMPLIANCE columns the statutory math in
-- lib/compliance/meetings.ts reads to raise ADVISORY signals at /admin/meetings
-- and on the /admin/compliance dashboard: when each notice was posted/mailed,
-- when the agenda + minutes were made available, and which subjects (budget,
-- special assessment, rules on use) trigger the 14-day mailed-notice rule.
--
-- Posture: Enable + Monitor — ADVISORY ONLY. Nothing here blocks scheduling or
-- holding a meeting; ev_meetings RLS (community-read / board-write) is unchanged.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the 48-hour vs 14-day lead times, which subjects
--   trigger the 14-day mailed notice, and the minutes-availability period.

alter table public.ev_meetings
  add column if not exists notice_posted_at     timestamptz,   -- conspicuously posted on the property
  add column if not exists notice_mailed_at     timestamptz,   -- mailed/delivered/e-transmitted to owners
  add column if not exists agenda_posted_at      timestamptz,
  add column if not exists minutes_published_at  timestamptz,
  add column if not exists affects_assessments   boolean not null default false, -- a special/regular assessment will be considered
  add column if not exists affects_use_rules     boolean not null default false, -- rules regarding unit/parcel use will be considered
  add column if not exists is_budget_meeting     boolean not null default false,
  add column if not exists emergency             boolean not null default false;
