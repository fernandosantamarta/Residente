-- collections-legal-hold.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- A per-case LEGAL HOLD that pauses escalation when advancing a lien/foreclosure
-- could itself break the law:
--   • bankruptcy        — the automatic stay (11 U.S.C. § 362) freezes collection
--   • scra              — Servicemembers Civil Relief Act protections for an
--                         active-duty servicemember (50 U.S.C. § 3953)
--   • qualifying_offer  — a qualifying offer may stay a foreclosure up to 60 days
--                         (FS 720.3085 / FS 702.10)
--   • other             — any other counsel-directed hold
-- The case page shows a red banner while a hold is set and requires an explicit,
-- counsel-reviewed acknowledgment before the statutory ladder can advance.
-- NULL legal_hold_reason = no hold (the default). Nullable + IF NOT EXISTS, so the
-- app reads it defensively and this is safe to run more than once.
alter table public.ev_collection_cases
  add column if not exists legal_hold_reason text
    check (legal_hold_reason in ('bankruptcy', 'scra', 'qualifying_offer', 'other'));
alter table public.ev_collection_cases
  add column if not exists legal_hold_at date;
alter table public.ev_collection_cases
  add column if not exists legal_hold_note text;
