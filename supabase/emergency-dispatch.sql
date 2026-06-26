-- ============================================================
-- Residente — Emergency dispatch: on-call roster + escalation
-- Run once in the Supabase SQL editor AFTER supabase/easy-voice.sql,
-- supabase/resident-notification-prefs.sql and supabase/custom-roles.sql.
-- Idempotent; safe to re-run.
-- ============================================================
-- Wave 1 item 2 of "eliminate the management company" — promote the displayed
-- emergency number (emergency-phone.sql) into a REAL on-call path: an ordered
-- on-call roster, an emergency-event record, and an ack-or-escalate ladder that
-- pages the on-call board member by in-app bell + push + email.
--
-- POSTURE (locked 2026-06-25): push + email NOW on the rails that already reach
-- phones; SMS/Twilio is the fast-follow (the 'sms' channel is already reserved in
-- lib/voice.ts). So paging here reuses the existing ev_notices delivery pipeline.
--
-- DELIVERY REUSE: an emergency page is a TARGETED notice — exactly the pattern the
-- violation trigger uses (supabase/violation-notices.sql): insert an ev_notices row
-- with channels=['personal'] (so the broadcast fan-out skips it) and then insert
-- ev_notice_recipients rows DIRECTLY for the one on-call profile. The web/APNs push
-- fan-outs mirror in_app recipients automatically, so the page lands as bell + push,
-- and a queued 'email' recipient sends the email. We reuse kind='custom_broadcast'
-- (always permitted + already an "important" kind) so this never has to touch the
-- shared ev_notices.kind CHECK, which several other files extend.
--
-- CADENCE: the FIRST page fires immediately on report (no cron needed). Timed
-- laddering to the next contact runs via emergency_escalate_due(), invoked by
-- /api/cron/emergency-escalation. Add that cron at your chosen cadence (every
-- 5-15 min needs a Vercel plan that allows sub-daily crons — confirm before
-- enabling). Without the cron, the event still pages the first contact and shows
-- in the console for manual escalation; it just won't auto-ladder on a timer.

-- ---------- shared updated_at touch ----------
create or replace function public.emergency_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- 1) ON-CALL ROSTER (ordered escalation ladder)
-- ============================================================
-- profile_id = a board member with a login → reachable by in-app bell + push +
-- email. name/email/phone capture EXTERNAL contacts (a 24/7 line, a super) for
-- display + the SMS fast-follow; external contacts are logged but not auto-paged
-- yet (no profile = no push/in-app/queued-email recipient).
create table if not exists public.on_call_contacts (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete cascade,
  name          text,
  email         text,
  phone         text,
  order_index   int  not null default 0,    -- escalation order (0 = paged first)
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists on_call_community_idx on public.on_call_contacts (community_id, order_index);

alter table public.on_call_contacts enable row level security;
grant references, trigger, truncate on public.on_call_contacts to anon;
grant select, insert, update, delete on public.on_call_contacts to authenticated;
grant all on public.on_call_contacts to service_role;

-- Managing the on-call roster is board operations (voice.manage).
drop policy if exists "voice reads on-call" on public.on_call_contacts;
create policy "voice reads on-call"
  on public.on_call_contacts for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      public.has_permission('voice.manage')
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );

drop policy if exists "voice writes on-call" on public.on_call_contacts;
create policy "voice writes on-call"
  on public.on_call_contacts for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('voice.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('voice.manage')
  );

drop trigger if exists on_call_touch on public.on_call_contacts;
create trigger on_call_touch
  before update on public.on_call_contacts
  for each row execute function public.emergency_touch_updated_at();

-- ============================================================
-- 2) EMERGENCY EVENTS + PAGE LOG
-- ============================================================
create table if not exists public.emergency_events (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references public.communities(id) on delete cascade,
  reported_by      uuid references public.profiles(id) on delete set null,
  reporter_name    text,
  category         text not null default 'other'
                     check (category in ('water','fire','electrical','security','structural','medical','other')),
  severity         text not null default 'urgent' check (severity in ('urgent','critical')),
  description      text not null,
  location         text,
  status           text not null default 'open'
                     check (status in ('open','acknowledged','dispatched','resolved')),
  escalation_index int  not null default 0,    -- which on-call contact is currently paged
  ack_minutes      int  not null default 15,   -- minutes to ack before escalating to the next
  last_paged_at    timestamptz,
  acknowledged_by  uuid references public.profiles(id) on delete set null,
  acknowledged_at  timestamptz,
  work_order_id    uuid references public.work_orders(id) on delete set null,  -- set in slice 2C
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz,
  resolution_notes text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists emergency_events_open_idx on public.emergency_events (community_id, status);
-- Partial index for the escalation sweep (open + previously paged).
create index if not exists emergency_events_escalation_idx on public.emergency_events (last_paged_at)
  where status = 'open';

create table if not exists public.emergency_pages (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.emergency_events(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  contact_id   uuid references public.on_call_contacts(id) on delete set null,
  profile_id   uuid references public.profiles(id) on delete set null,
  channel      text,
  paged_at     timestamptz not null default now()
);
create index if not exists emergency_pages_event_idx on public.emergency_pages (event_id);

alter table public.emergency_events enable row level security;
alter table public.emergency_pages  enable row level security;
grant select on public.emergency_events to authenticated;  -- writes via the RPCs below
grant select on public.emergency_pages  to authenticated;
grant all on public.emergency_events to service_role;
grant all on public.emergency_pages  to service_role;

-- A board member or an on-call person can see the emergency console.
drop policy if exists "board reads emergencies" on public.emergency_events;
create policy "board reads emergencies"
  on public.emergency_events for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      public.has_permission('voice.manage')
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or exists (select 1 from public.on_call_contacts oc
                  where oc.profile_id = auth.uid() and oc.community_id = emergency_events.community_id)
    )
  );

drop policy if exists "board reads emergency pages" on public.emergency_pages;
create policy "board reads emergency pages"
  on public.emergency_pages for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      public.has_permission('voice.manage')
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );

drop trigger if exists emergency_events_touch on public.emergency_events;
create trigger emergency_events_touch
  before update on public.emergency_events
  for each row execute function public.emergency_touch_updated_at();

-- ============================================================
-- 3) PAGING + RPCs
-- ============================================================
-- Internal: page one on-call contact via the targeted-notice pattern. Reachable
-- only from the definer RPCs below (they run as the function owner). Revoked from
-- every client role so it can't be called to page arbitrary people.
create or replace function public.emergency_page(p_event uuid, p_contact uuid, p_subject text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid       uuid;
  v_profile uuid;
  v_notice  uuid;
begin
  select community_id into cid from public.emergency_events where id = p_event;
  select profile_id  into v_profile from public.on_call_contacts where id = p_contact;

  if v_profile is not null then
    insert into public.ev_notices (community_id, kind, channels, subject, body)
    values (cid, 'custom_broadcast', array['personal'], p_subject, p_body)
    returning id into v_notice;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    values (v_notice, cid, v_profile, 'in_app') on conflict do nothing;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel, email_status)
    values (v_notice, cid, v_profile, 'email', 'queued') on conflict do nothing;
  end if;

  insert into public.emergency_pages (event_id, community_id, contact_id, profile_id, channel)
  values (p_event, cid, p_contact, v_profile,
          case when v_profile is not null then 'in_app,email,push' else 'logged_only' end);

  update public.emergency_events set last_paged_at = now() where id = p_event;
end $$;
revoke all on function public.emergency_page(uuid, uuid, text, text) from public, anon, authenticated;

-- 3a) REPORT — a board officer logs an emergency; the first on-call contact is
-- paged immediately. (A resident-facing report path lands in slice 2B.)
create or replace function public.emergency_report(
  p_category    text,
  p_severity    text,
  p_description text,
  p_location    text default null,
  p_ack_minutes int  default 15
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid      uuid;
  v_event  uuid;
  v_first  uuid;
  v_subj   text;
begin
  if not (public.has_permission('voice.manage')
          or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')) then
    raise exception 'not allowed to report emergencies';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'not a member of any community'; end if;
  if coalesce(btrim(p_description), '') = '' then raise exception 'a description is required'; end if;

  insert into public.emergency_events
    (community_id, reported_by, category, severity, description, location, ack_minutes, escalation_index)
  values
    (cid, auth.uid(),
     coalesce(nullif(p_category, ''), 'other'),
     case when p_severity = 'critical' then 'critical' else 'urgent' end,
     btrim(p_description), nullif(btrim(p_location), ''),
     greatest(1, coalesce(p_ack_minutes, 15)), 0)
  returning id into v_event;

  v_subj := '🚨 ' || upper(coalesce(nullif(p_category, ''), 'emergency')) || ' emergency reported';

  select id into v_first from public.on_call_contacts
   where community_id = cid and active order by order_index, created_at limit 1;
  if v_first is not null then
    perform public.emergency_page(v_event, v_first, v_subj, btrim(p_description));
  end if;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'emergency.reported', 'emergency_event', v_event,
            jsonb_build_object('category', p_category, 'severity', p_severity, 'paged', v_first is not null));
  exception when others then null;
  end;

  return v_event;
end $$;
revoke all on function public.emergency_report(text, text, text, text, int) from public, anon;
grant execute on function public.emergency_report(text, text, text, text, int) to authenticated;

-- 3b) ACKNOWLEDGE — whoever is on call (or any voice.manage officer) stops the
-- escalation by acknowledging.
create or replace function public.emergency_acknowledge(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare cid uuid; v_evcid uuid;
begin
  select community_id into cid from public.profiles where id = auth.uid();
  select community_id into v_evcid from public.emergency_events where id = p_event;
  if v_evcid is null then raise exception 'emergency not found'; end if;
  if v_evcid <> cid then raise exception 'emergency is not in your community'; end if;
  if not (public.has_permission('voice.manage')
          or exists (select 1 from public.on_call_contacts where profile_id = auth.uid() and community_id = cid)) then
    raise exception 'not allowed';
  end if;

  update public.emergency_events
     set status          = case when status in ('open', 'dispatched') then 'acknowledged' else status end,
         acknowledged_by = coalesce(acknowledged_by, auth.uid()),
         acknowledged_at = coalesce(acknowledged_at, now())
   where id = p_event;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id)
    values (cid, 'emergency.acknowledged', 'emergency_event', p_event);
  exception when others then null;
  end;
end $$;
revoke all on function public.emergency_acknowledge(uuid) from public, anon;
grant execute on function public.emergency_acknowledge(uuid) to authenticated;

-- 3c) RESOLVE — close out the emergency.
create or replace function public.emergency_resolve(p_event uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare cid uuid; v_evcid uuid;
begin
  select community_id into cid from public.profiles where id = auth.uid();
  select community_id into v_evcid from public.emergency_events where id = p_event;
  if v_evcid is null then raise exception 'emergency not found'; end if;
  if v_evcid <> cid then raise exception 'emergency is not in your community'; end if;
  if not (public.has_permission('voice.manage')
          or exists (select 1 from public.on_call_contacts where profile_id = auth.uid() and community_id = cid)) then
    raise exception 'not allowed';
  end if;

  update public.emergency_events
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         resolution_notes = nullif(btrim(p_notes), '')
   where id = p_event;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id)
    values (cid, 'emergency.resolved', 'emergency_event', p_event);
  exception when others then null;
  end;
end $$;
revoke all on function public.emergency_resolve(uuid, text) from public, anon;
grant execute on function public.emergency_resolve(uuid, text) to authenticated;

-- 3d) ESCALATION SWEEP — service-role only; invoked by /api/cron/emergency-escalation.
-- For every still-open event whose ack window has lapsed, page the NEXT active
-- on-call contact (if any). emergency_page() resets last_paged_at, so each rung
-- gets its own ack window. An acknowledged/resolved event is never escalated.
create or replace function public.emergency_escalate_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e        record;
  v_next   uuid;
  v_count  int := 0;
  v_subj   text;
begin
  for e in
    select ev.id, ev.community_id, ev.category, ev.description, ev.escalation_index
      from public.emergency_events ev
     where ev.status = 'open'
       and ev.last_paged_at is not null
       and ev.last_paged_at + make_interval(mins => ev.ack_minutes) < now()
  loop
    select id into v_next from (
      select id, (row_number() over (order by order_index, created_at) - 1) as idx
        from public.on_call_contacts
       where community_id = e.community_id and active
    ) ranked
    where ranked.idx = e.escalation_index + 1;

    if v_next is not null then
      update public.emergency_events set escalation_index = escalation_index + 1 where id = e.id;
      v_subj := '🚨 ESCALATED: ' || upper(coalesce(e.category, 'emergency')) || ' emergency unacknowledged';
      perform public.emergency_page(e.id, v_next, v_subj, e.description);
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('escalated', v_count);
end $$;
revoke all on function public.emergency_escalate_due() from public, anon, authenticated;
grant execute on function public.emergency_escalate_due() to service_role;
