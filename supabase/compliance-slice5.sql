-- ============================================================
-- Residente — FL compliance Slice 5: 2024–25 bill duties
-- (HB 1021 ch. 2024-244 condo / HB 1203 ch. 2024-221 HOA / HB 913 ch. 2025-175)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: governance.sql (ev_managers), easy-voice.sql (ev_meetings),
--             compliance-foundation.sql (communities website columns).
-- ============================================================
--
-- This slice FOLDS new advisory signals into the already-shipped producers
-- (governance.ts / arc.ts / meetings.ts / official-records.ts) — no new tables,
-- no new RLS. It only adds columns the statutory math reads to raise ADVISORY
-- signals on /admin/compliance + the weekly compliance-scan cron. Nothing here
-- blocks a board action.
--
-- Duties added:
--   • Director ANNUAL continuing education            (718.112(2)(d)4.b / 720.3033(1)(a)5)
--   • HOA director suspension + temp-fill (no cert)   (720.3033(1)(b))   — no schema change
--   • Mandatory hurricane-protection SPECIFICATIONS   (718.113(5) / 720.3035(6))
--   • Condo video-conference meeting notice + record  (718.112(2)(c)1, HB 913)
--   • CAM disclosure posting + 14-business-day update (468.4334(3)(b))
--   • Website-posting per-record COMPLETENESS + password (718.111(12)(g) / 720.303(4)(b))
--
-- ⚠ REQUIRES ATTORNEY REVIEW — every constant in the lib modules stays
--   validated:false until Florida community-association counsel confirms the
--   hour counts, the 90-day suspension mechanics, the hurricane-spec duty, the
--   video-conference notice content, the 14-business-day CAM update, and the
--   enumerated website record set.

-- ---------- 1) COMMUNITIES: hurricane specs + website password ----------
-- hurricane_specs_adopted_at — date the board adopted hurricane-protection
--   specifications (FS 718.113(5) / 720.3035(6)); null = not yet recorded.
-- website_password_protected — the records portal is restricted to owners +
--   employees with a username/password on request (FS 718.111(12)(g)1.b /
--   720.303(4)(b)2).
alter table public.communities
  add column if not exists hurricane_specs_adopted_at  date,
  add column if not exists website_password_protected  boolean not null default false;

-- ---------- 2) EV_MANAGERS: CAM transparency disclosure (468.4334(3)(b)) ----------
-- disclosure_posted_at  — when the manager's name/contact/hours/duties summary
--   was first posted for members.
-- disclosure_updated_at — when the posted disclosure was last refreshed.
-- info_changed_at       — when the underlying CAM information last changed; the
--   14-business-day update clock runs from here.
alter table public.ev_managers
  add column if not exists disclosure_posted_at   date,
  add column if not exists disclosure_updated_at  date,
  add column if not exists info_changed_at        date;

-- ---------- 3) EV_MEETINGS: condo video-conference notice content (HB 913) ----------
-- is_video_conference  — the meeting is held by video conference.
-- vc_join_url          — the hyperlink owners use to attend.
-- vc_phone             — the conference telephone number.
-- vc_physical_location — the address where owners can attend in person.
-- recording_retained   — the video-conference meeting was recorded and the
--   recording maintained as an official record (FS 718.112(2)(c)1 / (2)(d)2).
alter table public.ev_meetings
  add column if not exists is_video_conference  boolean not null default false,
  add column if not exists vc_join_url          text,
  add column if not exists vc_phone             text,
  add column if not exists vc_physical_location text,
  add column if not exists recording_retained   boolean not null default false;

-- ---------- 4) RELOAD POSTGREST SCHEMA CACHE ----------
-- After DDL, PostgREST may keep a stale column cache (a Save then 500s with
-- "column does not exist"). This forces a reload.
notify pgrst, 'reload schema';
