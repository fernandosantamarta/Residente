-- ============================================================
-- Residente — Architectural review / ARC (Domain J)
-- (FS 720.3035 HOA architectural authority / FS 718.113(2) condo alterations)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: communities, profiles, residents, easy-voice notices
--             (ev_notices / ev_notice_recipients).
-- ============================================================
--
-- Owners submit ARC applications; the board/committee must decide within the
-- governing-document response window. The statutory math in lib/compliance/arc.ts
-- reads these rows + the communities ARC config to raise ADVISORY signals at
-- /admin/arc + the dashboard: an open request whose response window is closing/
-- closed (DEEMED APPROVAL where the governing docs so provide), a denial lacking
-- written reasons, and a condo material alteration that needs the 75% vote.
--
-- Posture: Enable + Monitor — ADVISORY ONLY. Nothing here approves or denies a
-- request.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the response window, whether the governing
--   documents create a deemed-approval, the specific-reasons-for-denial rule,
--   and the condo 75% material-alteration threshold.

-- ---------- 0) ARC CONFIG COLUMNS on communities (ensure they exist) ----------
-- These were added by compliance-foundation.sql; this idempotent ALTER documents
-- the dependency and makes this migration self-sufficient on a fresh database.
alter table public.communities
  add column if not exists arc_response_days               int default 30,
  add column if not exists arc_deemed_approval             boolean default false,
  add column if not exists material_alteration_threshold_pct numeric;

-- ---------- 1) ARC REQUESTS ----------
create table if not exists public.ev_arc_requests (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid not null references public.communities(id) on delete cascade,
  resident_id            uuid references public.residents(id) on delete set null,
  profile_id             uuid references public.profiles(id) on delete set null,  -- owner who submitted
  unit_label             text,
  request_type           text not null default 'exterior_alteration'
                           check (request_type in ('exterior_alteration','new_construction','landscaping','other')),
  description            text,
  submitted_at           date not null default current_date,
  response_due_at        date,                     -- submitted + governing-doc response window
  status                 text not null default 'submitted'
                           check (status in ('submitted','under_review','approved','approved_with_conditions','denied','withdrawn')),
  decided_at             date,
  decision_reason        text,                     -- required for a denial
  is_material_alteration boolean not null default false,  -- condo 75%-vote flag
  notes                  text,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index if not exists ev_arc_requests_community_idx on public.ev_arc_requests (community_id, submitted_at desc);
create index if not exists ev_arc_requests_profile_idx   on public.ev_arc_requests (profile_id);

alter table public.ev_arc_requests enable row level security;
grant select, insert, update, delete on public.ev_arc_requests to authenticated;
grant select, insert, update, delete on public.ev_arc_requests to service_role;

-- The submitting owner reads + creates their own; the board reads + manages all.
drop policy if exists "owner reads own arc" on public.ev_arc_requests;
create policy "owner reads own arc"
  on public.ev_arc_requests for select to authenticated
  using ( profile_id = auth.uid() );
drop policy if exists "owner submits arc" on public.ev_arc_requests;
create policy "owner submits arc"
  on public.ev_arc_requests for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and profile_id = auth.uid()
  );
drop policy if exists "board reads arc" on public.ev_arc_requests;
create policy "board reads arc"
  on public.ev_arc_requests for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
drop policy if exists "board writes arc" on public.ev_arc_requests;
create policy "board writes arc"
  on public.ev_arc_requests for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- INTERCONNECT: ARC decision -> PERSONAL notice ----------
-- When the board records a terminal decision (status leaves submitted/under_review),
-- fire a PERSONAL in-app notice to the owner who submitted it — mirroring
-- ev_violation_notify / ev_hearing_notify (channels=['personal'] so the broadcast
-- fanout skips it, then a single recipient row). security definer.
create or replace function public.ev_arc_notify()
returns trigger language plpgsql security definer as $$
declare nid uuid;
begin
  if new.profile_id is null then return new; end if;
  if new.status not in ('approved','approved_with_conditions','denied') then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    new.community_id,
    'custom_broadcast',
    array['personal'],
    'Architectural review decision',
    'Your architectural review request has been '
      || replace(new.status, '_', ' ')
      || coalesce('. Reason: ' || nullif(new.decision_reason, ''), '')
      || '. See the Contact tab for details.',
    new.created_by
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, new.community_id, new.profile_id, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists ev_arc_notify_trg on public.ev_arc_requests;
create trigger ev_arc_notify_trg
  after update of status on public.ev_arc_requests
  for each row execute function public.ev_arc_notify();
