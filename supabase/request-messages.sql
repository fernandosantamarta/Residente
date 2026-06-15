-- ============================================================
-- Residente — two-way Contact threads (request_messages)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Upgrades Contact from a single resident message + single board note into a
-- real back-and-forth thread. Each request_messages row is one message in a
-- request's conversation, by a resident or by the board.
--
-- The legacy columns on resident_requests (body, board_note, board_note_at,
-- attachments) stay as-is — a trigger seeds the FIRST message from them on
-- insert, and the one-time backfill at the bottom moves existing history in,
-- so nothing is lost and old requests render as threads immediately.

-- ── Prerequisites ───────────────────────────────────────────────────────────
-- Included here so this file is self-contained (also live in
-- resident-request-reply-email.sql + resident-request-board-message.sql). All
-- idempotent — safe to re-run.
alter table public.resident_requests add column if not exists emailed_at timestamptz;
alter table public.resident_requests add column if not exists origin     text not null default 'resident';

-- The board may create a request for any resident in its community (the
-- "Message a resident" composer). The base policy only lets a resident insert
-- their own (profile_id = auth.uid()), which blocks board-initiated threads.
drop policy if exists "board inserts community requests" on public.resident_requests;
create policy "board inserts community requests"
  on public.resident_requests for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.request_messages (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.resident_requests(id) on delete cascade,
  community_id    uuid not null references public.communities(id) on delete cascade,
  author_id       uuid references public.profiles(id) on delete set null,
  author_role     text not null,                 -- 'resident' | 'board'
  author_name     text,                          -- denormalized for display
  body            text not null,
  attachment_path text,
  attachment_name text,
  created_at      timestamptz not null default now()
);
create index if not exists request_messages_request_idx on public.request_messages (request_id, created_at);
create index if not exists request_messages_community_idx on public.request_messages (community_id);

alter table public.request_messages enable row level security;
grant select, insert on public.request_messages to authenticated;

-- A resident reads + writes messages on their OWN requests.
drop policy if exists "resident reads own request messages" on public.request_messages;
create policy "resident reads own request messages"
  on public.request_messages for select to authenticated
  using (exists (
    select 1 from public.resident_requests r
    where r.id = request_id and r.profile_id = auth.uid()
  ));

drop policy if exists "resident inserts own request messages" on public.request_messages;
create policy "resident inserts own request messages"
  on public.request_messages for insert to authenticated
  with check (
    author_role = 'resident'
    and author_id = auth.uid()
    and exists (
      select 1 from public.resident_requests r
      where r.id = request_id and r.profile_id = auth.uid()
    )
  );

-- The board reads + writes messages on every request in its community.
drop policy if exists "board reads community request messages" on public.request_messages;
create policy "board reads community request messages"
  on public.request_messages for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board inserts community request messages" on public.request_messages;
create policy "board inserts community request messages"
  on public.request_messages for insert to authenticated
  with check (
    author_role = 'board'
    and community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Seed the first message from the legacy columns whenever a request is created
-- (resident submission via the Contact form, or a board-initiated message).
-- security definer so it can write the message row regardless of the inserter's
-- RLS context.
create or replace function public.seed_request_first_message()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(new.origin, 'resident') = 'board' then
    if coalesce(new.board_note, '') <> '' then
      insert into public.request_messages
        (request_id, community_id, author_id, author_role, author_name, body, created_at)
      values
        (new.id, new.community_id, null, 'board', 'Board', new.board_note,
         coalesce(new.board_note_at, new.created_at));
    end if;
  else
    if coalesce(new.body, '') <> '' then
      insert into public.request_messages
        (request_id, community_id, author_id, author_role, author_name, body,
         attachment_path, attachment_name, created_at)
      values
        (new.id, new.community_id, new.profile_id, 'resident', new.submitter_name, new.body,
         new.attachment_path, new.attachment_name, new.created_at);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_seed_request_first_message on public.resident_requests;
create trigger trg_seed_request_first_message
  after insert on public.resident_requests
  for each row execute function public.seed_request_first_message();

-- When a resident replies on a thread that was already resolved, reopen it so
-- the board sees it again in the queue.
create or replace function public.reopen_request_on_resident_reply()
returns trigger language plpgsql security definer as $$
begin
  if new.author_role = 'resident' then
    update public.resident_requests set status = 'new'
    where id = new.request_id and status = 'resolved';
  end if;
  return new;
end $$;

drop trigger if exists trg_reopen_request_on_resident_reply on public.request_messages;
create trigger trg_reopen_request_on_resident_reply
  after insert on public.request_messages
  for each row execute function public.reopen_request_on_resident_reply();

-- One-time backfill of existing requests into the message log. Guarded so it's
-- safe to re-run and won't duplicate what the trigger already seeded.
insert into public.request_messages
  (request_id, community_id, author_id, author_role, author_name, body, attachment_path, attachment_name, created_at)
select r.id, r.community_id, r.profile_id, 'resident', r.submitter_name, r.body, r.attachment_path, r.attachment_name, r.created_at
from public.resident_requests r
where coalesce(r.body, '') <> ''
  and coalesce(r.origin, 'resident') <> 'board'
  and not exists (select 1 from public.request_messages m where m.request_id = r.id and m.author_role = 'resident');

insert into public.request_messages
  (request_id, community_id, author_id, author_role, author_name, body, attachment_path, attachment_name, created_at)
select r.id, r.community_id, null, 'board', 'Board', r.board_note, r.board_note_attachment_path, r.board_note_attachment_name, coalesce(r.board_note_at, r.created_at)
from public.resident_requests r
where coalesce(r.board_note, '') <> ''
  and not exists (select 1 from public.request_messages m where m.request_id = r.id and m.author_role = 'board');

-- Realtime: push new messages live to whoever has the thread open. Idempotent —
-- skipped if already a member, or if the publication isn't present on this project.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'request_messages'
  ) then
    alter publication supabase_realtime add table public.request_messages;
  end if;
exception when undefined_object then
  null;
end $$;
