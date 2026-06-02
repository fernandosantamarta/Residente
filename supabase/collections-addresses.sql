-- ============================================================
-- Residente — Collections two-address model + per-notice address evidence
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Depends on: collections.sql (ev_collection_notices, residents alters).
-- ============================================================
--
-- WHY: Florida's statutory COLLECTION notices carry a dual-address rule the
-- routine meeting notices do NOT. The Notice of Late Assessment (condo
-- FS 718.121(5) / HOA FS 720.3085(3)(d)) and the Notice of Intent to Record a
-- Claim of Lien (condo FS 718.121(6) / HOA FS 720.3085(4)(b)) must be mailed to
-- the owner "at his or her last address as reflected in the association's records
-- AND, if such address is not the unit/parcel address, ... also ... to the
-- unit/parcel address." (HOA's Notice of Intent to Foreclose, FS 720.3085(5),
-- incorporates the same manner.) "Notice is deemed ... delivered upon mailing" —
-- so the compliance evidence is the pair of addresses actually mailed to, not a
-- delivery confirmation. We persist that pair per notice.
--
-- THE TWO ADDRESSES (no new residents column needed — both already exist):
--   * residents.address             = the physical UNIT / PARCEL address
--                                     (entered on the roster, e.g. "1247 Oak St").
--   * residents.last_known_address  = the OWNER'S MAILING ADDRESS OF RECORD
--                                     (added by collections.sql; the off-site
--                                     address an absentee owner furnished). When
--                                     empty it defaults to the unit/parcel address.
-- The dual-address rule fires when last_known_address is present AND differs from
-- address — then the statutory notice goes to BOTH. lib/compliance/collections.ts
-- resolveNoticeAddresses() is the single source of truth for that comparison.

-- ---------- ev_collection_notices: record the address(es) actually mailed to ----------
alter table public.ev_collection_notices
  -- the owner's last address as reflected in the association's records (mailing)
  add column if not exists mailed_to_record_address text,
  -- the unit/parcel address — populated only when it DIFFERS from the record
  -- address (i.e. the statutory "second copy"); null when the two are the same
  add column if not exists mailed_to_unit_address   text,
  -- true when the statute required the second copy because the addresses differed
  add column if not exists dual_address_required     boolean;

comment on column public.ev_collection_notices.mailed_to_record_address is
  'Owner''s last address as reflected in the association''s records (the mailing address the statutory notice was sent to).';
comment on column public.ev_collection_notices.mailed_to_unit_address is
  'Unit/parcel address; set only when it differs from the record address — the statutory "second copy" under FS 718.121(5)/(6) / 720.3085(3)(d)/(4)(b).';
comment on column public.ev_collection_notices.dual_address_required is
  'True when the record and unit/parcel addresses differed, so the notice had to be mailed to both.';
