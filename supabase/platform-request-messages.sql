-- ============================================================
-- Residente — two-way platform support threads (platform_request_messages)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Upgrades the platform support inbox from a single inbound message into a real
-- back-and-forth thread between a community's board and a Residente operator.
-- Each row is one message in a platform_requests ticket's conversation.
--
-- Mirrors public.request_messages (resident-side Contact threads). The original
-- subject/body on platform_requests stays as-is; a trigger seeds the FIRST
-- message from it on insert, and a one-time backfill moves existing tickets in.

create table if not exists public.platform_request_messages (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.platform_requests(id) on delete cascade,
  author_profile_id uuid references public.profiles(id) on delete set null,
  author_role       text not null,                 -- 'operator' | 'board'
  author_name       text,                          -- denormalized for display
  body              text not null,
  attachment_path   text,
  attachment_name   text,
  created_at        timestamptz not null default now()
);
create index if not exists platform_request_messages_request_idx
  on public.platform_request_messages (request_id, created_at);

alter table public.platform_request_messages enable row level security;
grant select, insert on public.platform_request_messages to authenticated;

-- Platform operators read + write on every ticket.
drop policy if exists "platform admins read request messages" on public.platform_request_messages;
create policy "platform admins read request messages"
  on public.platform_request_messages for select to authenticated
  using ( public.is_platform_admin(auth.uid()) );

drop policy if exists "platform admins insert request messages" on public.platform_request_messages;
create policy "platform admins insert request messages"
  on public.platform_request_messages for insert to authenticated
  with check (
    author_role = 'operator'
    and public.is_platform_admin(auth.uid())
  );

-- The board member who opened the ticket reads + writes on their own ticket.
drop policy if exists "submitter reads own request messages" on public.platform_request_messages;
create policy "submitter reads own request messages"
  on public.platform_request_messages for select to authenticated
  using (exists (
    select 1 from public.platform_requests r
    where r.id = request_id and r.from_profile_id = auth.uid()
  ));

drop policy if exists "submitter inserts own request messages" on public.platform_request_messages;
create policy "submitter inserts own request messages"
  on public.platform_request_messages for insert to authenticated
  with check (
    author_role = 'board'
    and author_profile_id = auth.uid()
    and exists (
      select 1 from public.platform_requests r
      where r.id = request_id and r.from_profile_id = auth.uid()
    )
  );

-- Seed the first message from the ticket's subject/body on insert (the board's
-- opening message). security definer so it writes regardless of RLS context.
create or replace function public.seed_platform_request_first_message()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(new.body, '') <> '' then
    insert into public.platform_request_messages
      (request_id, author_profile_id, author_role, author_name, body, created_at)
    values
      (new.id, new.from_profile_id, 'board', coalesce(new.from_name, 'Board'), new.body, new.created_at);
  end if;
  return new;
end $$;

drop trigger if exists trg_seed_platform_request_first_message on public.platform_requests;
create trigger trg_seed_platform_request_first_message
  after insert on public.platform_requests
  for each row execute function public.seed_platform_request_first_message();

-- When the board replies on a resolved ticket, reopen it so operators see it.
create or replace function public.reopen_platform_request_on_board_reply()
returns trigger language plpgsql security definer as $$
begin
  if new.author_role = 'board' then
    update public.platform_requests set status = 'open'
    where id = new.request_id and status = 'resolved';
  end if;
  return new;
end $$;

drop trigger if exists trg_reopen_platform_request_on_board_reply on public.platform_request_messages;
create trigger trg_reopen_platform_request_on_board_reply
  after insert on public.platform_request_messages
  for each row execute function public.reopen_platform_request_on_board_reply();

-- One-time backfill: seed existing tickets' opening message. Guarded so re-runs
-- and the insert trigger never duplicate it.
insert into public.platform_request_messages
  (request_id, author_profile_id, author_role, author_name, body, created_at)
select r.id, r.from_profile_id, 'board', coalesce(r.from_name, 'Board'), r.body, r.created_at
from public.platform_requests r
where coalesce(r.body, '') <> ''
  and not exists (select 1 from public.platform_request_messages m where m.request_id = r.id);

-- ── Photo attachments ───────────────────────────────────────────────────────
-- Private bucket; the platform-reply edge function uploads via the service role
-- (so no client insert policy is needed). Files live under <request_id>/<uuid>.
insert into storage.buckets (id, name, public)
values ('platform-attachments', 'platform-attachments', false)
on conflict (id) do nothing;

-- Operators read every file; the submitting board member reads files on their
-- own ticket (folder name = request_id).
drop policy if exists "platform admins read platform attachments" on storage.objects;
create policy "platform admins read platform attachments"
  on storage.objects for select to authenticated
  using ( bucket_id = 'platform-attachments' and public.is_platform_admin(auth.uid()) );

drop policy if exists "submitter reads own platform attachments" on storage.objects;
create policy "submitter reads own platform attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'platform-attachments'
    and exists (
      select 1 from public.platform_requests r
      where r.id::text = (storage.foldername(name))[1] and r.from_profile_id = auth.uid()
    )
  );

-- Realtime: push new messages live to whoever has the thread open. Idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'platform_request_messages'
  ) then
    alter publication supabase_realtime add table public.platform_request_messages;
  end if;
exception when undefined_object then
  null;
end $$;
