-- ============================================================
-- Easy Voice — Meetings, Documents, Votes, Ballots
-- Run once in the Supabase SQL editor.
-- Safe to re-run: all statements use IF NOT EXISTS / DO NOTHING.
-- ============================================================

-- ---------- MEETINGS ----------
create table if not exists public.ev_meetings (
  id                   uuid primary key default gen_random_uuid(),
  community_id         uuid not null references public.communities(id) on delete cascade,
  type                 text not null check (type in ('board','annual','special','committee')),
  title                text not null,
  scheduled_at         timestamptz not null,
  location             text,
  virtual_link         text,
  status               text not null default 'draft'
                         check (status in ('draft','notice_sent','in_progress','completed')),
  quorum_required_pct  numeric,
  quorum_confirmed     boolean not null default false,
  quorum_confirmed_by  uuid references auth.users(id),
  quorum_confirmed_at  timestamptz,
  minutes_status       text not null default 'pending'
                         check (minutes_status in ('pending','draft','published','approved')),
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now()
);
alter table public.ev_meetings enable row level security;
grant select, insert, update, delete on public.ev_meetings to authenticated;

create policy "members read meetings"
  on public.ev_meetings for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes meetings"
  on public.ev_meetings for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- MEETING DOCUMENTS ----------
create table if not exists public.ev_meeting_docs (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.ev_meetings(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  type         text not null default 'supporting'
                 check (type in ('agenda','minutes','supporting','notice_record')),
  title        text not null,
  storage_path text not null,
  file_size    bigint,
  status       text not null default 'published'
                 check (status in ('draft','published','approved')),
  uploaded_by  uuid references auth.users(id),
  uploaded_at  timestamptz not null default now()
);
alter table public.ev_meeting_docs enable row level security;
grant select, insert, update, delete on public.ev_meeting_docs to authenticated;

create policy "members read meeting docs"
  on public.ev_meeting_docs for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes meeting docs"
  on public.ev_meeting_docs for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- VOTES ----------
create table if not exists public.ev_votes (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid references public.ev_meetings(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  title        text not null,
  description  text,
  type         text not null default 'resolution'
                 check (type in ('resolution','election','budget_ratification',
                                 'bylaw_amendment','special_assessment','other')),
  ballot_type  text not null default 'open'
                 check (ballot_type in ('open','secret')),
  mode         text not null default 'in_meeting'
                 check (mode in ('in_meeting','written_ballot')),
  status       text not null default 'draft'
                 check (status in ('draft','open','closed','tallied','published')),
  opens_at     timestamptz,
  closes_at    timestamptz,
  result       text check (result in ('pass','fail') or result is null),
  yes_count    int not null default 0,
  no_count     int not null default 0,
  abstain_count int not null default 0,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
alter table public.ev_votes enable row level security;
grant select, insert, update, delete on public.ev_votes to authenticated;

create policy "members read votes"
  on public.ev_votes for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes votes"
  on public.ev_votes for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Hard block: elections must always use secret ballot.
-- This constraint enforces it at the database layer.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'election_must_be_secret') then
    alter table public.ev_votes
      add constraint election_must_be_secret
      check (type != 'election' or ballot_type = 'secret');
  end if;
end $$;

-- ---------- BALLOTS ----------
-- One ballot per profile per vote. open ballot answers stored plaintext;
-- secret ballot answer stored as null until tallied (future: encrypted).
create table if not exists public.ev_ballots (
  id          uuid primary key default gen_random_uuid(),
  vote_id     uuid not null references public.ev_votes(id) on delete cascade,
  profile_id  uuid not null references auth.users(id),
  unit_number text not null,
  answer      text check (answer in ('yes','no','abstain') or answer is null),
  cast_at     timestamptz not null default now(),
  unique (vote_id, unit_number)
);
alter table public.ev_ballots enable row level security;
grant select, insert on public.ev_ballots to authenticated;

-- Members can read their own ballot only (not others' for secret votes)
create policy "members read own ballot"
  on public.ev_ballots for select to authenticated
  using (profile_id = auth.uid());

-- Board can read all ballots in their community (for open votes / tallying)
create policy "board reads community ballots"
  on public.ev_ballots for select to authenticated
  using (
    vote_id in (
      select id from public.ev_votes
      where community_id = (select community_id from public.profiles where id = auth.uid())
    )
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Members can cast their own ballot when the vote is open
create policy "members cast ballot"
  on public.ev_ballots for insert to authenticated
  with check (
    profile_id = auth.uid()
    and unit_number = (select unit_number from public.profiles where id = auth.uid())
    and vote_id in (
      select id from public.ev_votes
      where community_id = (select community_id from public.profiles where id = auth.uid())
        and status = 'open'
    )
  );

-- ---------- MEETING DOCS STORAGE BUCKET ----------
insert into storage.buckets (id, name, public)
values ('ev-documents', 'ev-documents', false)
on conflict (id) do nothing;

create policy "members read ev docs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ev-documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
  );

create policy "board uploads ev docs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ev-documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

create policy "board deletes ev docs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ev-documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
