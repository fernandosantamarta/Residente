-- ============================================================
-- Residente — Records-request room: response documents + PII-gated auto-post
-- (FS 718.111(12) condo / FS 720.303(4)-(5) HOA records inspection)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: rules-and-documents.sql (documents), resident-requests.sql
--             (resident_requests), official-records.sql (documents.redaction_status,
--             posted_to_portal; resident_requests.responded_at + notify trigger).
-- ============================================================
--
-- Links a records-inspection request to the specific document(s) the board
-- produces in response, so "what did we provide, and is it redaction-cleared?"
-- is auditable. The respond RPC enforces the one rule that protects the
-- association: a document still flagged redaction_status='pending' (PII not yet
-- reviewed) CANNOT be auto-posted to the owner — the board must resolve it first.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the protected-information (PII) redaction list and
--   the production SLA exposure must be confirmed by Florida CA counsel. This is
--   workflow tracking, not legal advice; nothing here decides what is protected.

-- ---------- junction: a request <-> its response documents ----------
create table if not exists public.ev_records_request_docs (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  request_id    uuid not null references public.resident_requests(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  attached_by   uuid references public.profiles(id) on delete set null,
  attached_at   timestamptz not null default now(),
  unique (request_id, document_id)
);

create index if not exists ev_records_request_docs_req_idx
  on public.ev_records_request_docs (request_id);
create index if not exists ev_records_request_docs_comm_idx
  on public.ev_records_request_docs (community_id);

alter table public.ev_records_request_docs enable row level security;

grant references, trigger, truncate on public.ev_records_request_docs to anon;
grant select, insert, update, delete on public.ev_records_request_docs to authenticated;
grant select, insert, update, delete on public.ev_records_request_docs to service_role;

-- ---------- RLS ----------
-- The board reads/writes its community's links (same gate as documents).
drop policy if exists "board manages records request docs" on public.ev_records_request_docs;
create policy "board manages records request docs"
  on public.ev_records_request_docs for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- The requesting resident may SEE which documents answered their own request
-- (so Easy Documents can show "provided in response to your request").
drop policy if exists "resident reads own request docs" on public.ev_records_request_docs;
create policy "resident reads own request docs"
  on public.ev_records_request_docs for select to authenticated
  using (
    exists (
      select 1 from public.resident_requests rr
      where rr.id = ev_records_request_docs.request_id
        and rr.profile_id = auth.uid()
    )
  );

-- ---------- RPC: respond to a records request (PII-gated auto-post) ----------
-- One atomic, board-only action that (1) refuses if any attached document is
-- still redaction_status='pending', (2) posts every attached document to the
-- owner portal (posted_to_portal + posted_at, default access_level 'members'),
-- and (3) stamps responded_at — which fires ev_records_request_notify() to
-- notify the resident. Returns the number of documents posted.
create or replace function public.respond_to_records_request(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community uuid;
  v_role text;
  v_pending int;
  v_posted int;
begin
  -- Resolve the request's community and confirm the caller is its board.
  select community_id into v_community
    from public.resident_requests where id = p_request_id;
  if v_community is null then
    raise exception 'request_not_found';
  end if;

  select role into v_role from public.profiles
    where id = auth.uid() and community_id = v_community;
  if v_role is null or v_role not in ('board_member','admin') then
    raise exception 'forbidden';
  end if;

  -- Block while any attached document still needs PII review.
  select count(*) into v_pending
    from public.ev_records_request_docs l
    join public.documents d on d.id = l.document_id
   where l.request_id = p_request_id
     and d.redaction_status is not distinct from 'pending';
  if v_pending > 0 then
    raise exception 'pending_redaction:%', v_pending;
  end if;

  -- Auto-post the response documents to the owner portal.
  update public.documents d
     set posted_to_portal = true,
         posted_at = coalesce(d.posted_at, now()),
         access_level = coalesce(d.access_level, 'members')
   where d.id in (
     select l.document_id from public.ev_records_request_docs l
      where l.request_id = p_request_id
   )
     and d.posted_to_portal is distinct from true;
  get diagnostics v_posted = row_count;

  -- Stamp the request answered (fires the personal notice trigger) + resolve it.
  update public.resident_requests
     set responded_at = now(),
         status = 'resolved'
   where id = p_request_id;

  return v_posted;
end $$;

grant execute on function public.respond_to_records_request(uuid) to authenticated;
