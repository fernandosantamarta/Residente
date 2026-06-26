-- ============================================================
-- Residente — Legal holds on a collection case (request / verify layer)
-- Run once in the Supabase SQL editor. Safe to re-run. Run AFTER collections.sql.
-- ============================================================
--
-- A legal hold pauses escalation when advancing a lien/foreclosure could break
-- the law: a bankruptcy automatic stay, SCRA protections for an active-duty
-- servicemember, or a qualifying offer's statutory 60-day stay. The platform
-- can't verify these facts itself, so this models a request/verify workflow
-- (mirrors ev_payment_plans): either the OWNER self-reports a protection, or the
-- BOARD requests confirmation from the owner. Either way the board verifies
-- before the hold goes 'active'. Only an 'active' hold blocks the ladder.
--
-- One row IS the request. status flow:
--   requested        — owner self-reported; awaiting board verification
--   pending_resident — board asked the owner to confirm; awaiting their response
--   active           — board verified/placed the hold (blocks escalation)
--   released         — board lifted an active hold
--   denied           — board rejected the request
-- A case's "active hold" = a row on that case with status='active'.

create table if not exists public.ev_legal_holds (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references public.communities(id) on delete cascade,
  case_id          uuid not null references public.ev_collection_cases(id) on delete cascade,
  profile_id       uuid references public.profiles(id) on delete set null, -- the owner
  reason           text,                              -- bankruptcy | scra | qualifying_offer | other
  note             text,                              -- owner/board details or reference (case no., dates)
  status           text not null default 'requested',
  initiated_by     text not null default 'board',     -- resident | board
  requested_at     date default current_date,
  decided_by       uuid references public.profiles(id) on delete set null,
  decided_at       date,
  decision_reason  text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

do $$ begin
  alter table public.ev_legal_holds
    add constraint ev_legal_holds_reason_chk
    check (reason is null or reason in ('bankruptcy','scra','qualifying_offer','other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ev_legal_holds
    add constraint ev_legal_holds_status_chk
    check (status in ('requested','pending_resident','active','released','denied'));
exception when duplicate_object then null; end $$;

create index if not exists ev_legal_holds_case_idx on public.ev_legal_holds (case_id, created_at desc);

-- At most one OPEN hold (requested / pending / active) per case. Best-effort.
do $$ begin
  create unique index ev_legal_holds_one_open_per_case
    on public.ev_legal_holds (case_id)
    where status in ('requested','pending_resident','active');
exception when others then null; end $$;

alter table public.ev_legal_holds enable row level security;

-- ---------- RLS ----------
-- Board/admin: full access within their community.
drop policy if exists "board manages community legal holds" on public.ev_legal_holds;
create policy "board manages community legal holds"
  on public.ev_legal_holds for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Owner: self-report a hold on their OWN open case.
drop policy if exists "owner reports legal hold" on public.ev_legal_holds;
create policy "owner reports legal hold"
  on public.ev_legal_holds for insert to authenticated
  with check (
    initiated_by = 'resident'
    and status = 'requested'
    and profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.ev_collection_cases cc
       where cc.id = case_id and cc.profile_id = auth.uid()
    )
  );

-- Owner: respond to a board request (pending_resident -> requested) or withdraw
-- their own pending request (-> released). Never touch an active/denied hold.
drop policy if exists "owner updates own legal hold" on public.ev_legal_holds;
create policy "owner updates own legal hold"
  on public.ev_legal_holds for update to authenticated
  using (profile_id = auth.uid() and status in ('pending_resident','requested'))
  with check (profile_id = auth.uid() and status in ('requested','released'));

-- Owner: read their own holds.
drop policy if exists "owner reads own legal holds" on public.ev_legal_holds;
create policy "owner reads own legal holds"
  on public.ev_legal_holds for select to authenticated
  using (profile_id = auth.uid());

-- ---------- INTERCONNECT: request <-> board bell / owner notice ----------
create or replace function public.ev_legal_hold_notify()
returns trigger language plpgsql security definer as $$
declare
  nid uuid;
begin
  -- Owner self-report (new requested by resident) → alert the board.
  if tg_op = 'INSERT' and new.status = 'requested' and new.initiated_by = 'resident' then
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (new.community_id, 'collections_update', array[]::text[],
      'Legal hold reported',
      'An owner reported a legal protection (bankruptcy, military/SCRA, or a qualifying offer). Review and verify it on the collection case in Collections.',
      new.profile_id) returning id into nid;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    select nid, new.community_id, p.id, 'in_app'
      from public.profiles p
     where p.community_id = new.community_id and p.role in ('board_member','admin')
    on conflict (notice_id, profile_id, channel) do nothing;
    return new;
  end if;

  -- Board placed a hold directly (INSERT active) → notify the owner.
  if tg_op = 'INSERT' and new.status = 'active' and new.profile_id is not null then
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (new.community_id, 'collections_update', array['personal'],
      'Legal hold placed',
      'Your association placed a legal hold on your account; collection escalation is paused.',
      new.created_by) returning id into nid;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    values (nid, new.community_id, new.profile_id, 'in_app')
    on conflict (notice_id, profile_id, channel) do nothing;
    return new;
  end if;

  -- Board asks the owner to confirm (-> pending_resident) → notify the owner.
  if new.status = 'pending_resident'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending_resident')
     and new.profile_id is not null then
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (new.community_id, 'collections_update', array['personal'],
      'Legal protection confirmation requested',
      'Your association asked you to confirm a legal protection on your account. Open Easy Track to provide the details.',
      new.created_by) returning id into nid;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    values (nid, new.community_id, new.profile_id, 'in_app')
    on conflict (notice_id, profile_id, channel) do nothing;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Owner responded to a board request (pending_resident -> requested) → alert board.
    if new.status = 'requested' and old.status = 'pending_resident' then
      insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
      values (new.community_id, 'collections_update', array[]::text[],
        'Legal hold awaiting verification',
        'An owner provided their legal-protection details. Review and verify the hold on the collection case in Collections.',
        new.profile_id) returning id into nid;
      insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
      select nid, new.community_id, p.id, 'in_app'
        from public.profiles p
       where p.community_id = new.community_id and p.role in ('board_member','admin')
      on conflict (notice_id, profile_id, channel) do nothing;
      return new;
    end if;

    -- Board decision (-> active / denied) → personal notice to the owner.
    if new.status in ('active','denied') and new.status is distinct from old.status and new.profile_id is not null then
      insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
      values (new.community_id, 'collections_update', array['personal'],
        case new.status when 'active' then 'Legal hold placed' else 'Legal hold not approved' end,
        case new.status
          when 'active' then 'Your association placed a legal hold on your account; collection escalation is paused.'
          else 'Your association reviewed your reported legal protection and did not place a hold.'
               || coalesce(' Reason: ' || nullif(new.decision_reason, ''), '')
        end,
        new.decided_by) returning id into nid;
      insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
      values (nid, new.community_id, new.profile_id, 'in_app')
      on conflict (notice_id, profile_id, channel) do nothing;
      return new;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists ev_legal_hold_notify_trg on public.ev_legal_holds;
create trigger ev_legal_hold_notify_trg
  after insert or update of status on public.ev_legal_holds
  for each row execute function public.ev_legal_hold_notify();
