-- ============================================================
-- Residente — Easy Schedule (community calendar events)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Board adds events at /admin/schedule (one-off form or CSV bulk). They
-- show up on every resident's /app/schedule calendar and the dashboard
-- "Up next" rail, in realtime — replacing the old localStorage-only store.
-- A single-add also fans out an in-app notice so residents' bells light up
-- (interconnected with Easy Voice notifications). CSV bulk imports pass
-- notify=false to avoid spamming the bell with dozens of notices.

create table if not exists public.ev_schedule_events (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  kind         text not null default 'event',  -- meeting|vote|dues|maintenance|event|inspection
  title        text not null,
  event_date   date not null,
  time         text,
  vendor       text,
  location     text,
  href         text,
  notify       boolean not null default true,  -- false for bulk CSV rows
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists ev_schedule_events_community_date_idx
  on public.ev_schedule_events (community_id, event_date);

alter table public.ev_schedule_events enable row level security;
grant select, insert, update, delete on public.ev_schedule_events to authenticated;
grant select, insert, update, delete on public.ev_schedule_events to service_role;

-- Every member of the community sees their community's calendar.
drop policy if exists "community reads schedule" on public.ev_schedule_events;
create policy "community reads schedule"
  on public.ev_schedule_events for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

-- Only the board/admin adds, edits, or removes events, and only in their
-- own community.
drop policy if exists "board inserts schedule" on public.ev_schedule_events;
create policy "board inserts schedule"
  on public.ev_schedule_events for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board updates schedule" on public.ev_schedule_events;
create policy "board updates schedule"
  on public.ev_schedule_events for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board deletes schedule" on public.ev_schedule_events;
create policy "board deletes schedule"
  on public.ev_schedule_events for delete to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- INTERCONNECT: new event -> in-app notice ----------
-- When the board adds a single event (notify=true), drop a custom_broadcast
-- notice into Easy Voice. The existing ev_notice_fanout trigger then
-- materialises one recipient row per community member, so every resident's
-- bell updates live. security definer so the insert into ev_notices (which
-- residents can't write) runs as the table owner.
create or replace function public.ev_schedule_notify()
returns trigger language plpgsql security definer as $$
begin
  if new.notify then
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (
      new.community_id,
      'custom_broadcast',
      array['in_app'],
      'New on the calendar: ' || new.title,
      to_char(new.event_date, 'Mon FMDD, YYYY')
        || coalesce(' · ' || nullif(new.time, ''), ''),
      new.created_by
    );
  end if;
  return new;
end $$;

drop trigger if exists ev_schedule_notify_trg on public.ev_schedule_events;
create trigger ev_schedule_notify_trg
  after insert on public.ev_schedule_events
  for each row execute function public.ev_schedule_notify();
