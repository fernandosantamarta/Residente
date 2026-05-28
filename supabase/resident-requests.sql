-- ============================================================
-- Residente — resident requests (maintenance issues, appeals, questions)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Residents submit requests from /app/contact; the board triages them at
-- /admin/requests. Linked to the account by profile_id. submitter_name/unit
-- are denormalized at submit time so the board sees who sent it without a
-- cross-profile read.

create table if not exists public.resident_requests (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references public.communities(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  submitter_name text,
  submitter_unit text,
  category       text not null default 'maintenance', -- maintenance|appeal|account|other
  subject        text not null,
  body           text,
  status         text not null default 'new',         -- new|in_progress|resolved
  created_at     timestamptz not null default now()
);
alter table public.resident_requests enable row level security;
grant select, insert, update, delete on public.resident_requests to authenticated;

-- A resident may submit a request for their own account, in their community.
drop policy if exists "residents insert own requests" on public.resident_requests;
create policy "residents insert own requests"
  on public.resident_requests for insert to authenticated
  with check (
    profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
  );

-- A resident sees only their own requests.
drop policy if exists "residents read own requests" on public.resident_requests;
create policy "residents read own requests"
  on public.resident_requests for select to authenticated
  using ( profile_id = auth.uid() );

-- A resident may withdraw (delete) their own request.
drop policy if exists "residents delete own requests" on public.resident_requests;
create policy "residents delete own requests"
  on public.resident_requests for delete to authenticated
  using ( profile_id = auth.uid() );

-- The board sees + triages every request in their community.
drop policy if exists "board reads community requests" on public.resident_requests;
create policy "board reads community requests"
  on public.resident_requests for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board updates community requests" on public.resident_requests;
create policy "board updates community requests"
  on public.resident_requests for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
