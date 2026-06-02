-- ============================================================
-- Residente — Official records: retention, website posting & inspection SLA
-- (FS 718.111(12) condo / FS 720.303(4)-(5) HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: rules-and-documents.sql (documents), resident-requests.sql
--             (resident_requests), easy-voice.sql (ev_meeting_docs, ev_notices).
-- ============================================================
--
-- Extends existing tables only (no new tables). The statutory date math (30-day
-- posting clock, 10 working/business-day inspection SLA, retention tiers) lives
-- in lib/compliance/official-records.ts; the /admin/compliance dashboard + the
-- weekly compliance-scan cron read these columns to raise advisory signals.
-- Nothing here blocks a board action.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — retention tiers, the protected-information
--   redaction list, posting thresholds/dates, and the inspection-SLA fine
--   exposure must be confirmed by Florida community-association counsel.

-- ---------- 1) DOCUMENTS: posting / retention / redaction metadata ----------
alter table public.documents
  add column if not exists date_received   date,            -- when the record was received (posting clock basis)
  add column if not exists effective_date  date,            -- record's own effective/as-of date
  add column if not exists posted_to_portal boolean not null default false,
  add column if not exists posted_at       timestamptz,
  add column if not exists redaction_status text
    check (redaction_status is null or redaction_status in ('pending','redacted','not_required')),
  add column if not exists access_level    text
    check (access_level is null or access_level in ('members','public')),
  add column if not exists retention_until date;            -- null = permanent / not set

-- ---------- 2) RESIDENT_REQUESTS: records-inspection SLA fields ----------
-- category stays free-text (no CHECK exists today); the app uses category
-- 'records' for inspection requests. due_at = received + 10 working/business days.
alter table public.resident_requests
  add column if not exists due_at          timestamptz,     -- statutory production deadline
  add column if not exists responded_at    timestamptz,     -- when records were made available
  add column if not exists checklist_doc_id uuid references public.documents(id) on delete set null;

-- ---------- 3) EV_MEETING_DOCS: recordings + posting/retention ----------
-- Widen the type CHECK to allow a video-conference recording, and add the
-- posting + retention columns (condo 25+ must retain meeting recordings).
alter table public.ev_meeting_docs drop constraint if exists ev_meeting_docs_type_check;
alter table public.ev_meeting_docs add constraint ev_meeting_docs_type_check
  check (type in ('agenda','minutes','supporting','notice_record','video_recording'));
alter table public.ev_meeting_docs
  add column if not exists posted_at       timestamptz,
  add column if not exists retention_until date;

-- ---------- 4) NOTICE KIND (records-request update -> resident) ----------
-- Append-only widening, mirroring compliance-foundation.sql / collections.sql.
-- Keep every prior kind.
alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due',
                  'compliance_alert','estoppel_update',
                  'collections_deadline','collections_update',
                  'records_request_update'));

-- ---------- 5) RECORDS-REQUEST ACK -> PERSONAL notice to the resident ----------
-- When the board stamps responded_at on a records-inspection request, fire a
-- PERSONAL in-app notice to the requesting resident (same pattern as
-- ev_estoppel_notify): channels=['personal'] so the broadcast fanout skips it,
-- plus one recipient row. security definer so the insert into ev_notices (which
-- residents can't write) runs as the table owner.
create or replace function public.ev_records_request_notify()
returns trigger language plpgsql security definer as $$
declare
  nid uuid;
begin
  -- Only for records-inspection requests, and only when responded_at is newly set.
  if new.category is distinct from 'records' then
    return new;
  end if;
  if new.responded_at is null or new.responded_at is not distinct from old.responded_at then
    return new;
  end if;
  if new.profile_id is null then
    return new;
  end if;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    new.community_id,
    'records_request_update',
    array['personal'],
    'Your records request has been answered',
    'The association has responded to your request to inspect records ("'
      || coalesce(new.subject, 'records request') || '"). Open Easy Documents to review.',
    null
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, new.community_id, new.profile_id, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists ev_records_request_notify_trg on public.resident_requests;
create trigger ev_records_request_notify_trg
  after update on public.resident_requests
  for each row execute function public.ev_records_request_notify();
