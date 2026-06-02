-- ============================================================
-- Residente — Violation notices route to Easy Documents
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- A fine/warning notice used to be inserted as kind='custom_broadcast', so the
-- bell sent the resident to /app/voice. We now give it its own kind, 'violation',
-- which lib/voice.noticeHref() routes to /app/documents (their "Your violations"
-- panel). This file (1) widens the ev_notices kind CHECK to permit 'violation'
-- (re-stated with the full current set so it stays a superset of every kind the
-- app inserts), and (2) updates the ev_violation_notify trigger to use it.

alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due',
                  'violation','compliance_alert','estoppel_update',
                  'collections_deadline','collections_update'));

-- Backfill: existing violation notices were inserted as 'custom_broadcast'
-- with channels=['personal'] (that personal-only channel is unique to the
-- violation trigger — real broadcasts use in_app/email). Re-tag them so the
-- bell routes already-sent fine/warning notices to /app/documents too.
update public.ev_notices
   set kind = 'violation'
 where kind = 'custom_broadcast'
   and channels = array['personal'];

-- Re-create the violation -> personal notice trigger with kind='violation'.
-- (Body is unchanged from easy-violations.sql except the inserted kind.)
create or replace function public.ev_violation_notify()
returns trigger language plpgsql security definer as $$
declare nid uuid;
begin
  if new.profile_id is not null then
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (
      new.community_id,
      'violation',
      array['personal'],   -- NOT 'in_app' → broadcast fanout skips this notice
      case when new.kind = 'fine'
           then 'New fine: ' || coalesce(new.rule_title, 'rule violation')
           else 'Notice: '   || coalesce(new.rule_title, 'rule reminder') end,
      coalesce(nullif(new.notes, ''), 'See the Contact tab for details.')
        || case when new.amount is not null then '  ($' || new.amount || ')' else '' end,
      new.created_by
    )
    returning id into nid;

    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    values (nid, new.community_id, new.profile_id, 'in_app')
    on conflict (notice_id, profile_id, channel) do nothing;
  end if;
  return new;
end $$;
