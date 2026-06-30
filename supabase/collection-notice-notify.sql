-- collection-notice-notify.sql — run-once, idempotent. Paste into the Supabase
-- SQL editor. Fires a bell notice to the OWNER whenever a statutory collection
-- notice is logged on their case (the 30-day, intent-to-lien, intent-to-
-- foreclose, or tenant-rent-demand). Mirrors the targeting convention used by
-- request-payment-notices.sql: insert ev_notices with EMPTY channels so the
-- broadcast ev_notice_fanout skips it, then hand-insert the single owner
-- recipient. Kind 'collections_update' routes the bell to /app/track#pay
-- (lib/voice.ts noticeHref), where the resident sees the status + notices list.

create or replace function public.ev_collection_notice_notify()
returns trigger language plpgsql security definer as $$
declare
  v_profile uuid;
  v_body    text;
  v_notice  uuid;
begin
  -- The owner's app profile, from the case (direct profile_id, else the resident).
  select coalesce(cc.profile_id, r.profile_id)
    into v_profile
  from public.ev_collection_cases cc
  left join public.residents r on r.id = cc.resident_id
  where cc.id = new.case_id;

  if v_profile is null then
    return new; -- no app account to notify
  end if;

  v_body := case new.kind
    when 'late_assessment_30'     then 'A 30-day late-payment notice has been added to your account.'
    when 'intent_to_lien_45'      then 'A notice of intent to record a lien has been added to your account.'
    when 'intent_to_foreclose_45' then 'A notice of intent to foreclose has been added to your account.'
    when 'tenant_rent_demand'     then 'A demand for rent has been issued on your unit.'
    else 'A collection notice has been added to your account.'
  end;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (new.community_id, 'collections_update', array[]::text[], 'Collection notice', v_body, null)
  returning id into v_notice;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (v_notice, new.community_id, v_profile, 'in_app');

  return new;
end $$;

drop trigger if exists ev_collection_notice_notify_trg on public.ev_collection_notices;
create trigger ev_collection_notice_notify_trg
  after insert on public.ev_collection_notices
  for each row execute function public.ev_collection_notice_notify();
