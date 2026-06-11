-- ============================================================
-- Residente — Contact thread extras
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Requires: request-messages.sql + request-thread-close.sql first.
-- ============================================================
--
-- Adds three things:
--   1. last_message_at / last_message_role — denormalized onto resident_requests
--      by a trigger, so the board queue can flag "awaiting your reply" (last
--      message is the resident's) and sort by latest activity without scanning
--      the whole message log.
--   2. replies_locked — the board can turn a thread into a one-way message the
--      resident can read but not reply to (distinct from closing it).
--   3. resident_requests added to the realtime publication so the admin queue
--      updates live when a resident replies.

alter table public.resident_requests add column if not exists last_message_at   timestamptz;
alter table public.resident_requests add column if not exists last_message_role text;
alter table public.resident_requests add column if not exists replies_locked    boolean not null default false;

-- Keep last_message_* current on every new message.
create or replace function public.touch_request_last_message()
returns trigger language plpgsql security definer as $$
begin
  update public.resident_requests
    set last_message_at = new.created_at, last_message_role = new.author_role
  where id = new.request_id;
  return new;
end $$;

drop trigger if exists trg_touch_request_last_message on public.request_messages;
create trigger trg_touch_request_last_message
  after insert on public.request_messages
  for each row execute function public.touch_request_last_message();

-- Backfill from the existing log.
update public.resident_requests r
  set last_message_at = m.created_at, last_message_role = m.author_role
from (
  select distinct on (request_id) request_id, created_at, author_role
  from public.request_messages
  order by request_id, created_at desc
) m
where m.request_id = r.id;

-- A resident may reply only to an OPEN, UNLOCKED thread of their own. This
-- supersedes the guard from request-thread-close.sql by also checking the lock.
drop policy if exists "resident inserts own request messages" on public.request_messages;
create policy "resident inserts own request messages"
  on public.request_messages for insert to authenticated
  with check (
    author_role = 'resident'
    and author_id = auth.uid()
    and exists (
      select 1 from public.resident_requests r
      where r.id = request_id
        and r.profile_id = auth.uid()
        and r.status <> 'resolved'
        and coalesce(r.replies_locked, false) = false
    )
  );

-- Realtime: the board queue reloads when a resident replies (the touch trigger
-- above stamps last_message_* → an UPDATE on resident_requests fires here).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resident_requests'
  ) then
    alter publication supabase_realtime add table public.resident_requests;
  end if;
exception when undefined_object then
  null;
end $$;
