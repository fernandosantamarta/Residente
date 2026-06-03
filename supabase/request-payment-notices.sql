-- ============================================================
-- Residente — notification coverage for resident requests + payments
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- Closes two gaps where the app changed state but the bell stayed silent:
--
--   1. A resident submits a request  -> the BOARD gets a notice (request_new).
--   2. The board changes a request's status or leaves a reply
--                                     -> the RESIDENT gets a notice (request_update).
--   3. A payment lands on an account  -> the paying RESIDENT gets a receipt
--                                        notice (payment_received).
--
-- All three follow the established targeted-notice convention (violations,
-- amenities, dues): insert into ev_notices with EMPTY channels so the generic
-- ev_notice_fanout() broadcast trigger skips the row, then hand-insert exactly
-- the recipient rows we want. security definer so the trigger can write
-- recipient rows for users other than the actor regardless of RLS.
--
-- Routing (kind -> href) lives in lib/voice.ts noticeHref():
--   request_new      -> /admin/requests
--   request_update   -> /app/voice#contact   (the resident's Contact tab)
--   payment_received -> /app/track#pay

-- ---------- 1. Widen the ev_notices kind CHECK ----------
-- Re-stated with the full current set so it stays a superset of every kind the
-- app inserts (this file is the latest, so its list wins on a fresh run).
alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due',
                  'violation','compliance_alert','estoppel_update',
                  'collections_deadline','collections_update',
                  'request_new','request_update','payment_received'));

-- ---------- 2. New resident request -> notify the board ----------
create or replace function public.resident_request_notify_new()
returns trigger language plpgsql security definer as $$
declare nid uuid;
begin
  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    new.community_id,
    'request_new',
    array[]::text[],                       -- empty -> generic broadcast fanout skips it
    'New request: ' || coalesce(nullif(new.subject, ''), 'no subject'),
    coalesce(nullif(new.submitter_name, ''), 'A resident')
      || coalesce(' · Unit ' || nullif(new.submitter_unit, ''), '')
      || ' submitted a ' || coalesce(new.category, 'general') || ' request.',
    new.profile_id
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  select nid, new.community_id, p.id, 'in_app'
    from public.profiles p
   where p.community_id = new.community_id
     and p.role in ('board_member','admin')
     and p.id is distinct from new.profile_id   -- don't ping a board member's own submission
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists resident_request_notify_new_trg on public.resident_requests;
create trigger resident_request_notify_new_trg
  after insert on public.resident_requests
  for each row execute function public.resident_request_notify_new();

-- ---------- 3. Status change / board reply -> notify the resident ----------
-- Fires when the status moves (new -> in_progress -> resolved) OR the board
-- leaves/updates a note (board_note_at changes). Both in one update collapse to
-- a single notice; the reply copy takes precedence since it's the richer event.
create or replace function public.resident_request_notify_update()
returns trigger language plpgsql security definer as $$
declare nid uuid;
        changed_status boolean := new.status is distinct from old.status;
        added_reply    boolean := new.board_note_at is distinct from old.board_note_at
                                   and new.board_note_at is not null;
begin
  if not (changed_status or added_reply) then return new; end if;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    new.community_id,
    'request_update',
    array[]::text[],
    case when added_reply
         then 'Reply on your request: ' || coalesce(nullif(new.subject, ''), '')
         else 'Request update: '         || coalesce(nullif(new.subject, ''), '') end,
    case
      when added_reply              then 'The board replied to your request. Tap to read it.'
      when new.status = 'in_progress' then 'Your request is now in progress.'
      when new.status = 'resolved'    then 'Your request has been marked resolved.'
      else 'Your request status changed to ' || new.status || '.'
    end,
    auth.uid()
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, new.community_id, new.profile_id, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists resident_request_notify_update_trg on public.resident_requests;
create trigger resident_request_notify_update_trg
  after update on public.resident_requests
  for each row execute function public.resident_request_notify_update();

-- ---------- 4. Payment received -> notify the paying resident ----------
-- payments.resident_id references residents(id); the app account is
-- residents.profile_id (nullable — a roster row may have no claimed account
-- yet). When it's null we skip: there's no one to deliver to. Fires for BOTH
-- the stripe-webhook insert (service_role) and a manual board-entered payment,
-- so this single trigger is the whole coverage point.
create or replace function public.payment_notify_received()
returns trigger language plpgsql security definer as $$
declare nid uuid;
        pid uuid;
        amt text := trim(to_char(new.amount, 'FM999G999G990D00'));
begin
  select profile_id into pid from public.residents where id = new.resident_id;
  if pid is null then return new; end if;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    new.community_id,
    'payment_received',
    array[]::text[],
    'Payment received: $' || amt,
    'We received your payment of $' || amt
      || ' on ' || to_char(new.paid_on, 'FMMon FMDD, YYYY') || '. Thank you!',
    null
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, new.community_id, pid, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists payment_notify_received_trg on public.payments;
create trigger payment_notify_received_trg
  after insert on public.payments
  for each row execute function public.payment_notify_received();
