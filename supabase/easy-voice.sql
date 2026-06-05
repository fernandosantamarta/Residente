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

drop policy if exists "members read meetings" on public.ev_meetings;
create policy "members read meetings"
  on public.ev_meetings for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "board writes meetings" on public.ev_meetings;
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

drop policy if exists "members read meeting docs" on public.ev_meeting_docs;
create policy "members read meeting docs"
  on public.ev_meeting_docs for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "board writes meeting docs" on public.ev_meeting_docs;
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

drop policy if exists "members read votes" on public.ev_votes;
create policy "members read votes"
  on public.ev_votes for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "board writes votes" on public.ev_votes;
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
drop policy if exists "members read own ballot" on public.ev_ballots;
create policy "members read own ballot"
  on public.ev_ballots for select to authenticated
  using (profile_id = auth.uid());

-- Board can read all ballots in their community (for open votes / tallying)
drop policy if exists "board reads community ballots" on public.ev_ballots;
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
drop policy if exists "members cast ballot" on public.ev_ballots;
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

drop policy if exists "members read ev docs" on storage.objects;
create policy "members read ev docs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ev-documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
  );

drop policy if exists "board uploads ev docs" on storage.objects;
create policy "board uploads ev docs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ev-documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board deletes ev docs" on storage.objects;
create policy "board deletes ev docs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ev-documents'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ============================================================
-- Easy Voice — Phase 2 schema additions
-- Units, owner roster extensions, consent, proxies, notices,
-- attendance, candidates, ballot encryption, audit log, indexes.
-- Safe to re-run.
-- ============================================================

-- ---------- ASSOCIATION CONFIG (extend communities) ----------
alter table public.communities
  add column if not exists association_type text
    check (association_type in ('condo','hoa')),
  add column if not exists state text default 'FL',
  add column if not exists county text,
  add column if not exists electronic_voting_resolution_adopted boolean not null default false,
  add column if not exists electronic_voting_adopted_at timestamptz,
  add column if not exists quorum_board_pct numeric default 30,
  add column if not exists quorum_member_pct numeric default 30,
  add column if not exists subscription_status text not null default 'trial'
    check (subscription_status in ('trial','active','past_due','cancelled'));

-- ---------- UNITS ----------
create table if not exists public.ev_units (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  unit_number   text not null,
  building      text,
  created_at    timestamptz not null default now(),
  unique (community_id, unit_number)
);
alter table public.ev_units enable row level security;
grant select, insert, update, delete on public.ev_units to authenticated;

drop policy if exists "members read units" on public.ev_units;
create policy "members read units"
  on public.ev_units for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "board writes units" on public.ev_units;
create policy "board writes units"
  on public.ev_units for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- OWNER ROSTER (extend residents) ----------
-- Owners are tracked in `residents` (no auth account required). When an owner
-- accepts their invitation, profile_id is populated to link the auth account.
alter table public.residents
  add column if not exists unit_id uuid references public.ev_units(id) on delete set null,
  add column if not exists profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists voting_eligible boolean not null default true,
  add column if not exists invited_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists deactivated_at timestamptz;

create index if not exists residents_profile_idx on public.residents (profile_id);
create index if not exists residents_unit_idx    on public.residents (unit_id);

-- ---------- ELECTRONIC VOTING CONSENT (immutable) ----------
-- One row per (owner, association). Insert-only: never updated or deleted.
create table if not exists public.ev_consents (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  resident_id   uuid references public.residents(id) on delete set null,
  consented_at  timestamptz not null default now(),
  ip_address    inet,
  user_agent    text,
  unique (community_id, profile_id)
);
alter table public.ev_consents enable row level security;
-- intentionally no update/delete grants — consent records are immutable
grant select, insert on public.ev_consents to authenticated;

drop policy if exists "owner reads own consent" on public.ev_consents;
create policy "owner reads own consent"
  on public.ev_consents for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "board reads community consents" on public.ev_consents;
create policy "board reads community consents"
  on public.ev_consents for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "owner records own consent" on public.ev_consents;
create policy "owner records own consent"
  on public.ev_consents for insert to authenticated
  with check (
    profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
  );

-- ---------- PROXIES ----------
create table if not exists public.ev_proxies (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities(id) on delete cascade,
  meeting_id          uuid not null references public.ev_meetings(id) on delete cascade,
  grantor_profile_id  uuid not null references public.profiles(id) on delete cascade,
  unit_id             uuid references public.ev_units(id) on delete set null,
  unit_number         text not null,
  holder_name         text not null,
  holder_email        text,
  holder_profile_id   uuid references public.profiles(id) on delete set null,
  type                text not null check (type in ('limited','general')),
  specific_vote_ids   uuid[] default '{}',                -- limited proxies only
  instructions        jsonb default '{}'::jsonb,          -- {vote_id: 'yes'|'no'|'abstain'|'holder_discretion'}
  status              text not null default 'submitted'
                        check (status in ('submitted','verified','used','revoked')),
  submitted_at        timestamptz not null default now(),
  verified_at         timestamptz,
  used_at             timestamptz,
  revoked_at          timestamptz,
  unique (meeting_id, unit_number)                        -- one proxy per unit per meeting
);
alter table public.ev_proxies enable row level security;
grant select, insert, update on public.ev_proxies to authenticated;

drop policy if exists "grantor reads own proxy" on public.ev_proxies;
create policy "grantor reads own proxy"
  on public.ev_proxies for select to authenticated
  using (grantor_profile_id = auth.uid() or holder_profile_id = auth.uid());

drop policy if exists "board reads community proxies" on public.ev_proxies;
create policy "board reads community proxies"
  on public.ev_proxies for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "grantor submits own proxy" on public.ev_proxies;
create policy "grantor submits own proxy"
  on public.ev_proxies for insert to authenticated
  with check (
    grantor_profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
  );

drop policy if exists "grantor revokes own proxy" on public.ev_proxies;
create policy "grantor revokes own proxy"
  on public.ev_proxies for update to authenticated
  using (grantor_profile_id = auth.uid())
  with check (grantor_profile_id = auth.uid());

drop policy if exists "board updates proxy status" on public.ev_proxies;
create policy "board updates proxy status"
  on public.ev_proxies for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Hard block: a general proxy cannot apply to a meeting that contains
-- an election vote. Enforced via trigger because we cross-reference
-- ev_votes by meeting_id at write time.
create or replace function public.ev_proxy_election_guard()
returns trigger language plpgsql as $$
declare has_election boolean;
begin
  if new.type = 'general' then
    select exists (
      select 1 from public.ev_votes
      where meeting_id = new.meeting_id and type = 'election'
    ) into has_election;
    if has_election then
      raise exception 'A general proxy cannot apply to a meeting that contains an election vote (FL 718.112(2)(d)(3) / 720.306(8)(b)). Submit a limited proxy that names the election candidate instead.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ev_proxy_election_guard on public.ev_proxies;
create trigger ev_proxy_election_guard
  before insert or update on public.ev_proxies
  for each row execute function public.ev_proxy_election_guard();

-- ---------- NOTICES ----------
create table if not exists public.ev_notices (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.communities(id) on delete cascade,
  meeting_id      uuid references public.ev_meetings(id) on delete cascade,
  vote_id         uuid references public.ev_votes(id) on delete cascade,
  kind            text not null
                    check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                                    'vote_opened','vote_reminder','vote_results','minutes_published',
                                    'proxy_submitted','custom_broadcast')),
  channels        text[] not null default array['email','in_app'],
  subject         text,
  body            text,
  sent_by         uuid references auth.users(id),
  sent_at         timestamptz not null default now(),
  delivery_report jsonb default '{}'::jsonb     -- {profile_id: 'delivered'|'bounced'|...}
);
alter table public.ev_notices enable row level security;
grant select, insert on public.ev_notices to authenticated;
-- notice-email-fanout edge function runs as service_role and updates
-- delivery_report; without this grant it hits "permission denied".
grant select, update on public.ev_notices to service_role;

drop policy if exists "board reads notices" on public.ev_notices;
create policy "board reads notices"
  on public.ev_notices for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board writes notices" on public.ev_notices;
create policy "board writes notices"
  on public.ev_notices for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- ATTENDANCE ----------
create table if not exists public.ev_attendance (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  meeting_id    uuid not null references public.ev_meetings(id) on delete cascade,
  unit_id       uuid references public.ev_units(id) on delete set null,
  unit_number   text not null,
  profile_id    uuid references public.profiles(id) on delete set null,
  proxy_id      uuid references public.ev_proxies(id) on delete set null,
  method        text not null check (method in ('admin_marked','qr_self_checkin','virtual','proxy')),
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users(id),
  unique (meeting_id, unit_number)
);
alter table public.ev_attendance enable row level security;
grant select, insert, update, delete on public.ev_attendance to authenticated;

drop policy if exists "members read attendance" on public.ev_attendance;
create policy "members read attendance"
  on public.ev_attendance for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "board writes attendance" on public.ev_attendance;
create policy "board writes attendance"
  on public.ev_attendance for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "members self check-in" on public.ev_attendance;
create policy "members self check-in"
  on public.ev_attendance for insert to authenticated
  with check (
    profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
    and unit_number = (select unit_number from public.profiles where id = auth.uid())
    and method = 'qr_self_checkin'
  );

-- ---------- CANDIDATES (board elections) ----------
create table if not exists public.ev_candidates (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  vote_id       uuid not null references public.ev_votes(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete set null,
  full_name     text not null,
  bio           text,
  photo_path    text,
  submitted_by  uuid references auth.users(id),
  submitted_at  timestamptz not null default now(),
  withdrawn     boolean not null default false,
  vote_count    int not null default 0,
  elected       boolean not null default false
);
alter table public.ev_candidates enable row level security;
grant select, insert, update, delete on public.ev_candidates to authenticated;

drop policy if exists "members read candidates" on public.ev_candidates;
create policy "members read candidates"
  on public.ev_candidates for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "owners submit own candidacy" on public.ev_candidates;
create policy "owners submit own candidacy"
  on public.ev_candidates for insert to authenticated
  with check (
    profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
  );

drop policy if exists "board writes candidates" on public.ev_candidates;
create policy "board writes candidates"
  on public.ev_candidates for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- BALLOT EXTENSIONS ----------
-- Add unit/proxy linkage, election selections, and secret-ballot encryption.
alter table public.ev_ballots
  add column if not exists unit_id          uuid references public.ev_units(id) on delete set null,
  add column if not exists proxy_id         uuid references public.ev_proxies(id) on delete set null,
  add column if not exists candidate_ids    uuid[],
  add column if not exists encrypted_answer bytea,
  add column if not exists encryption_key_id text;

-- Proxy holders (when the holder is themselves an account-holding owner)
-- can cast ballots tied to their proxy. Non-account holders must go through
-- a server-side function with the service role.
drop policy if exists "proxy holders cast proxied ballots" on public.ev_ballots;
create policy "proxy holders cast proxied ballots"
  on public.ev_ballots for insert to authenticated
  with check (
    proxy_id is not null
    and exists (
      select 1 from public.ev_proxies p
      where p.id = proxy_id
        and p.holder_profile_id = auth.uid()
        and p.status in ('submitted','verified')
    )
    and vote_id in (
      select id from public.ev_votes where status = 'open'
    )
  );

-- ---------- AUDIT LOG (append-only) ----------
create table if not exists public.ev_audit_log (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  event_type    text not null,
  actor_id      uuid references auth.users(id),
  target_type   text,            -- 'meeting' | 'vote' | 'ballot' | 'proxy' | 'document' | ...
  target_id     uuid,
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
alter table public.ev_audit_log enable row level security;
-- Append-only: select + insert only. Never grant update or delete, even to board.
grant select, insert on public.ev_audit_log to authenticated;

drop policy if exists "board reads audit log" on public.ev_audit_log;
create policy "board reads audit log"
  on public.ev_audit_log for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "any member writes audit" on public.ev_audit_log;
create policy "any member writes audit"
  on public.ev_audit_log for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
  );

-- ---------- BALLOT TALLY TRIGGER ----------
-- Keeps ev_votes.{yes,no,abstain}_count in sync as ballots are inserted.
-- ev_ballots is insert-only at the grant level, so we only need AFTER INSERT.
-- When secret-ballot encryption lands, this trigger will need to move to
-- the decryption/tally step (answer will be null at insert time).
create or replace function public.ev_ballot_tally()
returns trigger language plpgsql as $$
begin
  if new.answer = 'yes' then
    update public.ev_votes set yes_count = yes_count + 1 where id = new.vote_id;
  elsif new.answer = 'no' then
    update public.ev_votes set no_count = no_count + 1 where id = new.vote_id;
  elsif new.answer = 'abstain' then
    update public.ev_votes set abstain_count = abstain_count + 1 where id = new.vote_id;
  end if;
  return new;
end $$;

drop trigger if exists ev_ballot_tally_trg on public.ev_ballots;
create trigger ev_ballot_tally_trg
  after insert on public.ev_ballots
  for each row execute function public.ev_ballot_tally();

-- One-time backfill: recompute counts from existing ballots. Idempotent —
-- safe to re-run alongside the trigger (it sets counts to the true total).
update public.ev_votes v set
  yes_count     = coalesce(c.yes, 0),
  no_count      = coalesce(c.no,  0),
  abstain_count = coalesce(c.abs, 0)
from (
  select vote_id,
    count(*) filter (where answer = 'yes')     as yes,
    count(*) filter (where answer = 'no')      as no,
    count(*) filter (where answer = 'abstain') as abs
  from public.ev_ballots
  group by vote_id
) c
where c.vote_id = v.id;

-- ---------- INDEXES ----------
create index if not exists ev_meetings_community_scheduled_idx
  on public.ev_meetings (community_id, scheduled_at desc);
create index if not exists ev_meeting_docs_meeting_idx
  on public.ev_meeting_docs (meeting_id);
create index if not exists ev_votes_meeting_idx
  on public.ev_votes (meeting_id);
create index if not exists ev_votes_community_status_idx
  on public.ev_votes (community_id, status);
create index if not exists ev_ballots_vote_idx
  on public.ev_ballots (vote_id);
create index if not exists ev_proxies_meeting_idx
  on public.ev_proxies (meeting_id);
create index if not exists ev_proxies_grantor_idx
  on public.ev_proxies (grantor_profile_id);
create index if not exists ev_notices_meeting_idx
  on public.ev_notices (meeting_id);
create index if not exists ev_notices_community_sent_idx
  on public.ev_notices (community_id, sent_at desc);
create index if not exists ev_attendance_meeting_idx
  on public.ev_attendance (meeting_id);
create index if not exists ev_candidates_vote_idx
  on public.ev_candidates (vote_id);
create index if not exists ev_units_community_idx
  on public.ev_units (community_id);
create index if not exists ev_audit_community_time_idx
  on public.ev_audit_log (community_id, created_at desc);

-- ============================================================
-- Easy Voice — Phase 2: In-app notifications
-- Per-recipient mailbox rows + auto-notice triggers for the
-- audit-grade events (vote_opened, vote_results). Other notices
-- are composed from the admin UI. Safe to re-run.
-- ============================================================

-- ---------- EXTEND ev_notices ----------
alter table public.ev_notices
  add column if not exists status            text not null default 'sent'
    check (status in ('draft','sent','failed')),
  add column if not exists recipient_count   int  not null default 0,
  add column if not exists in_app_read_count int  not null default 0;

-- ---------- NOTICE RECIPIENTS (per-resident mailbox row) ----------
-- One row per (notice, profile, channel). Read state lives here so
-- residents can mark-as-read without touching the broadcast row.
create table if not exists public.ev_notice_recipients (
  id            uuid primary key default gen_random_uuid(),
  notice_id     uuid not null references public.ev_notices(id) on delete cascade,
  community_id  uuid not null references public.communities(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id)    on delete cascade,
  channel       text not null default 'in_app'
                  check (channel in ('in_app','email','sms')),
  delivered_at  timestamptz not null default now(),
  read_at       timestamptz,
  email_status  text check (email_status in ('queued','sent','delivered','bounced','complained')),
  unique (notice_id, profile_id, channel)
);
alter table public.ev_notice_recipients enable row level security;
-- no delete grant: mark-as-read only
grant select, insert, update on public.ev_notice_recipients to authenticated;
-- notice-email-fanout edge function runs as service_role: it reads the
-- queued rows and flips email_status. Without this grant it hits
-- "permission denied for table ev_notice_recipients".
grant select, insert, update on public.ev_notice_recipients to service_role;

create index if not exists ev_notice_recipients_profile_unread_idx
  on public.ev_notice_recipients (profile_id) where read_at is null;
create index if not exists ev_notice_recipients_notice_idx
  on public.ev_notice_recipients (notice_id);

drop policy if exists "owner reads own notice recipients" on public.ev_notice_recipients;
create policy "owner reads own notice recipients"
  on public.ev_notice_recipients for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "board reads community notice recipients" on public.ev_notice_recipients;
create policy "board reads community notice recipients"
  on public.ev_notice_recipients for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board fans out recipients" on public.ev_notice_recipients;
create policy "board fans out recipients"
  on public.ev_notice_recipients for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "owner marks own recipient read" on public.ev_notice_recipients;
create policy "owner marks own recipient read"
  on public.ev_notice_recipients for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------- FAN-OUT TRIGGER ----------
-- After a notice insert, materialise one ev_notice_recipients row
-- per profile in the community for each in_app channel. security
-- definer so the board admin's session can write rows for users
-- other than themselves regardless of profiles RLS.
create or replace function public.ev_notice_fanout()
returns trigger language plpgsql security definer as $$
declare inserted int;
begin
  if 'in_app' = any (new.channels) then
    insert into public.ev_notice_recipients
      (notice_id, community_id, profile_id, channel)
    select new.id, new.community_id, p.id, 'in_app'
      from public.profiles p
     where p.community_id = new.community_id
    on conflict (notice_id, profile_id, channel) do nothing;
    get diagnostics inserted = row_count;
    update public.ev_notices set recipient_count = inserted where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists ev_notice_fanout_trg on public.ev_notices;
create trigger ev_notice_fanout_trg
  after insert on public.ev_notices
  for each row execute function public.ev_notice_fanout();

-- ---------- READ-COUNT TRIGGER ----------
-- Keep ev_notices.in_app_read_count in sync as recipients mark read.
-- security definer: ev_notices grants are select+insert only, so an
-- update from the residents' role would be rejected. Run as table owner.
create or replace function public.ev_notice_read_count()
returns trigger language plpgsql security definer as $$
begin
  if new.read_at is not null and old.read_at is null and new.channel = 'in_app' then
    update public.ev_notices
       set in_app_read_count = in_app_read_count + 1
     where id = new.notice_id;
  end if;
  return new;
end $$;

drop trigger if exists ev_notice_read_count_trg on public.ev_notice_recipients;
create trigger ev_notice_read_count_trg
  after update on public.ev_notice_recipients
  for each row execute function public.ev_notice_read_count();

-- ---------- AUTO-NOTICE: vote opened ----------
-- Fires when a vote transitions status → 'open'. Idempotent: skips
-- if a vote_opened notice for this vote already exists.
create or replace function public.ev_vote_opened_notice()
returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status and new.status = 'open' then
    if not exists (
      select 1 from public.ev_notices
       where vote_id = new.id and kind = 'vote_opened'
    ) then
      insert into public.ev_notices
        (community_id, meeting_id, vote_id, kind, channels,
         subject, body, sent_by)
      values
        (new.community_id, new.meeting_id, new.id, 'vote_opened',
         array['in_app'],
         'Vote now open: ' || new.title,
         'A vote is now open for your community. Tap to cast your ballot.',
         auth.uid());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ev_vote_opened_notice_trg on public.ev_votes;
create trigger ev_vote_opened_notice_trg
  after update on public.ev_votes
  for each row execute function public.ev_vote_opened_notice();

-- ---------- AUTO-NOTICE: vote results published ----------
-- Fires when a vote transitions status → 'published'. Body
-- interpolates the final tally and pass/fail result.
create or replace function public.ev_vote_results_notice()
returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status and new.status = 'published' then
    if not exists (
      select 1 from public.ev_notices
       where vote_id = new.id and kind = 'vote_results'
    ) then
      insert into public.ev_notices
        (community_id, meeting_id, vote_id, kind, channels,
         subject, body, sent_by)
      values
        (new.community_id, new.meeting_id, new.id, 'vote_results',
         array['in_app'],
         'Results: ' || new.title,
         'Final result: ' || coalesce(upper(new.result), 'no quorum') ||
           '. Yes ' || new.yes_count ||
           ' · No ' || new.no_count ||
           ' · Abstain ' || new.abstain_count || '.',
         auth.uid());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ev_vote_results_notice_trg on public.ev_votes;
create trigger ev_vote_results_notice_trg
  after update on public.ev_votes
  for each row execute function public.ev_vote_results_notice();

-- ---------- REALTIME PUBLICATION ----------
-- Bell badge subscribes to ev_notice_recipients via Supabase realtime;
-- the table must be in the supabase_realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'ev_notice_recipients'
  ) then
    alter publication supabase_realtime add table public.ev_notice_recipients;
  end if;
end $$;

-- ============================================================
-- Phase 4 — Pilot launch readiness
-- ============================================================

-- ---------- Phase 4 / Commit 1: Owner roster import ----------
-- The Voice roster needs first/last separately (the dues system stores
-- only full_name). Keep both populated: full_name = first || ' ' || last
-- is written from the import UI, so existing dues/right-rail keeps working.
alter table public.residents
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- Guard against importing the same email twice into one community.
create unique index if not exists residents_community_email_idx
  on public.residents (community_id, lower(email))
  where email is not null;

-- ---------- Phase 4 / Commit 3: Electronic voting consent guard ----------
-- FL 718.128 / 720.317 require explicit electronic voting consent per owner
-- before any electronic ballot is valid. This is enforced in two places:
--   1. The /onboard flow collects consent and writes ev_consents.
--   2. This trigger hard-blocks any ev_ballots insert from a profile that
--      has not consented in the ballot's community. Bypasses the app entirely.

create or replace function public.ev_has_consented(p_profile uuid, p_community uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.ev_consents
    where profile_id = p_profile and community_id = p_community
  );
$$;
grant execute on function public.ev_has_consented(uuid, uuid) to authenticated;

create or replace function public.ev_ballot_consent_guard()
returns trigger language plpgsql as $$
declare v_community uuid;
begin
  select community_id into v_community
    from public.ev_votes where id = new.vote_id;
  if v_community is null then
    raise exception 'Vote % not found', new.vote_id;
  end if;
  if not public.ev_has_consented(new.profile_id, v_community) then
    raise exception 'Electronic voting consent required (FL 718.128 / 720.317)'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists ev_ballot_consent_guard_trg on public.ev_ballots;
create trigger ev_ballot_consent_guard_trg
  before insert on public.ev_ballots
  for each row execute function public.ev_ballot_consent_guard();

-- ---------- Phase 4 / Commit 4: Email notice delivery ----------
-- Extend ev_notice_fanout() to materialise email-channel recipients in
-- addition to the existing in_app rows. The notice-email-fanout edge
-- function (DB webhook on ev_notices INSERT) then picks them up,
-- batches sends to Resend, and writes email_status back.

create or replace function public.ev_notice_fanout()
returns trigger language plpgsql security definer as $$
declare in_app_inserted int := 0;
        email_inserted  int := 0;
begin
  if 'in_app' = any (new.channels) then
    insert into public.ev_notice_recipients
      (notice_id, community_id, profile_id, channel)
    select new.id, new.community_id, p.id, 'in_app'
      from public.profiles p
     where p.community_id = new.community_id
    on conflict (notice_id, profile_id, channel) do nothing;
    get diagnostics in_app_inserted = row_count;
  end if;

  if 'email' = any (new.channels) then
    insert into public.ev_notice_recipients
      (notice_id, community_id, profile_id, channel, email_status)
    select new.id, new.community_id, p.id, 'email', 'queued'
      from public.profiles p
     where p.community_id = new.community_id
       and p.email is not null
    on conflict (notice_id, profile_id, channel) do nothing;
    get diagnostics email_inserted = row_count;
  end if;

  -- recipient_count tracks the broader audience (max of channels, since
  -- it represents "how many distinct people will see this notice").
  update public.ev_notices
     set recipient_count = greatest(in_app_inserted, email_inserted)
   where id = new.id;
  return new;
end $$;

-- Update the two auto-notice triggers so vote-opened / vote-results
-- also fan out by email, not just in-app.
create or replace function public.ev_vote_opened_notice()
returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status and new.status = 'open' then
    if not exists (
      select 1 from public.ev_notices
       where vote_id = new.id and kind = 'vote_opened'
    ) then
      insert into public.ev_notices
        (community_id, meeting_id, vote_id, kind, channels,
         subject, body, sent_by)
      values
        (new.community_id, new.meeting_id, new.id, 'vote_opened',
         array['in_app','email'],
         'Vote now open: ' || new.title,
         'A vote is now open for your community. Tap to cast your ballot.',
         auth.uid());
    end if;
  end if;
  return new;
end $$;

create or replace function public.ev_vote_results_notice()
returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status and new.status = 'published' then
    if not exists (
      select 1 from public.ev_notices
       where vote_id = new.id and kind = 'vote_results'
    ) then
      insert into public.ev_notices
        (community_id, meeting_id, vote_id, kind, channels,
         subject, body, sent_by)
      values
        (new.community_id, new.meeting_id, new.id, 'vote_results',
         array['in_app','email'],
         'Results: ' || new.title,
         'Final result: ' || coalesce(upper(new.result), 'no quorum') ||
           '. Yes ' || new.yes_count ||
           ' · No ' || new.no_count ||
           ' · Abstain ' || new.abstain_count || '.',
         auth.uid());
    end if;
  end if;
  return new;
end $$;

-- ---------- Phase 4 / Commit 5: Ballot encryption ----------
-- Secret ballots are encrypted client-side with a per-vote NaCl keypair
-- whose secret key is password-wrapped by the admin and stored in the
-- DB. The platform operator never holds the unwrapped key, which is the
-- legal point of a secret ballot.
--
-- Storage:
--   ev_votes.public_key          — base64-encoded 32-byte nacl box public key
--   ev_votes.wrapped_secret_key  — base64-encoded password-wrapped secret key
--   ev_votes.key_created_by      — auth.users(id) of the admin who set the password
--   ev_ballots.encrypted_answer  — base64-encoded sealed ciphertext per ballot
--   ev_ballots.encryption_key_id — denormalised vote_id for fast lookup
--
-- The existing bytea columns were never populated; we convert them to
-- text so the JS client can write base64 strings directly without
-- wrestling with PostgREST's bytea encoding rules.
alter table public.ev_votes
  add column if not exists public_key         text,
  add column if not exists wrapped_secret_key text,
  add column if not exists key_created_by     uuid references auth.users(id);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ev_ballots'
      and column_name = 'encrypted_answer' and data_type = 'bytea'
  ) then
    alter table public.ev_ballots drop column encrypted_answer;
  end if;
end $$;
alter table public.ev_ballots
  add column if not exists encrypted_answer text;

-- The tally trigger originally fired only on INSERT with a non-null
-- answer. Secret ballots insert with answer=null + encrypted_answer set,
-- then the admin's decrypt-and-write path runs UPDATEs that flip answer
-- from null to plaintext. Extend the trigger to handle both cases.
create or replace function public.ev_ballot_tally()
returns trigger language plpgsql as $$
declare bumped boolean := false;
        v_answer text;
begin
  if (tg_op = 'INSERT' and new.answer is not null) then
    v_answer := new.answer;
    bumped := true;
  elsif (tg_op = 'UPDATE' and old.answer is null and new.answer is not null) then
    v_answer := new.answer;
    bumped := true;
  end if;

  if bumped then
    if v_answer = 'yes' then
      update public.ev_votes set yes_count = yes_count + 1 where id = new.vote_id;
    elsif v_answer = 'no' then
      update public.ev_votes set no_count = no_count + 1 where id = new.vote_id;
    elsif v_answer = 'abstain' then
      update public.ev_votes set abstain_count = abstain_count + 1 where id = new.vote_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ev_ballot_tally_trg on public.ev_ballots;
create trigger ev_ballot_tally_trg
  after insert or update on public.ev_ballots
  for each row execute function public.ev_ballot_tally();

-- The board's tally path needs UPDATE permission on the answer column.
-- Allowed only on votes in their own community whose status is closed
-- or tallied (never open — would let admins front-run live results).
grant update (answer) on public.ev_ballots to authenticated;

drop policy if exists "board writes tally answer" on public.ev_ballots;
create policy "board writes tally answer"
  on public.ev_ballots for update to authenticated
  using (
    vote_id in (
      select id from public.ev_votes
      where community_id = (select community_id from public.profiles where id = auth.uid())
        and status in ('closed','tallied')
    )
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (answer in ('yes','no','abstain'));

-- ---------- Phase 4 / Commit 6: Multi-association workspace switcher ----------
-- A profile can belong to more than one community (an owner with units in
-- two HOAs, a property-manager admin spread across associations). The
-- *active* community lives on profiles.community_id — that's still the
-- single source of truth for every ev_* RLS policy.
--
-- ev_membership is a thin join recording the *full* list of communities
-- a profile is a member of. The switcher UI reads from here and, on
-- pick, writes profiles.community_id so RLS picks up the change.
create table if not exists public.ev_membership (
  profile_id     uuid not null references public.profiles(id)    on delete cascade,
  community_id   uuid not null references public.communities(id) on delete cascade,
  role           text not null default 'resident',
  last_active_at timestamptz not null default now(),
  primary key (profile_id, community_id)
);
alter table public.ev_membership enable row level security;
-- owners can SELECT their own memberships and UPDATE last_active_at;
-- writes for new rows happen via the trigger below, not direct insert.
grant select, update on public.ev_membership to authenticated;

drop policy if exists "owner reads own memberships" on public.ev_membership;
create policy "owner reads own memberships"
  on public.ev_membership for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "owner updates own last_active" on public.ev_membership;
create policy "owner updates own last_active"
  on public.ev_membership for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- One-time backfill from residents joined to profiles by lower(email).
-- Safe to re-run; on conflict do nothing.
insert into public.ev_membership (profile_id, community_id, role)
select p.id, r.community_id, coalesce(p.role, 'resident')
  from public.profiles p
  join public.residents r on lower(r.email) = lower(p.email)
on conflict (profile_id, community_id) do nothing;

-- Keep ev_membership in sync as residents are activated: whenever
-- residents.profile_id is set (during /onboard), upsert the join row.
-- security definer because residents.profile_id can be written by the
-- voice-invite-owner service role; the trigger then writes to a table
-- that the calling auth.uid wouldn't have direct insert grant on.
create or replace function public.ev_membership_upsert()
returns trigger language plpgsql security definer as $$
begin
  if new.profile_id is not null
     and (tg_op = 'INSERT' or old.profile_id is distinct from new.profile_id)
  then
    insert into public.ev_membership (profile_id, community_id, role)
    values (
      new.profile_id, new.community_id,
      coalesce((select role from public.profiles where id = new.profile_id), 'resident')
    )
    on conflict (profile_id, community_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists ev_membership_upsert_trg on public.residents;
create trigger ev_membership_upsert_trg
  after insert or update of profile_id on public.residents
  for each row execute function public.ev_membership_upsert();

