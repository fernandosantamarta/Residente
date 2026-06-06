-- ============================================================
-- Residente — Niche / event-driven compliance advisories
-- (condo + HOA — FS 718.301 / 720.307 / 718.1124 / 720.3053 / 718.121(4) /
--  720.303(7) / 720.306(8) / 718.113(8) / 718.1255 / 720.311)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: compliance-foundation.sql; ev_proxies (easy-voice.sql) for the
--             proxy-expiry advisory (read-only; not altered here).
-- ============================================================
--
-- A board logs the triggering DATE of an event at /admin/advisories; the clock
-- math (condo 75-day turnover-election call, HOA 90-day turnover document
-- delivery, the 30-day receivership cure window, the condo 30-day invoice-
-- delivery-change notice, the HOA 30-day tiered-report petition meeting) lives in
-- lib/compliance/advisories.ts. The /admin/compliance dashboard + the weekly
-- compliance-scan cron read this table to raise advisory signals. Standing rights
-- (receivership, the condo EV/natural-gas charging right, presuit mediation) are
-- surfaced as reference + document artifacts, not recurring signals. Nothing here
-- blocks a board action.
--
-- REQUIRES ATTORNEY REVIEW — the day-counts, the turnover triggers, the
--   720.307 document list, and the standing-right language must be confirmed by
--   Florida community-association counsel.

create table if not exists public.ev_compliance_events (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  kind          text not null
                  check (kind in ('turnover_trigger','receivership_notice','invoice_delivery_change','tiered_report_petition')),
  event_date    date not null,                 -- the date the clock runs from
  resolved_at   date,                          -- when the duty was satisfied (clears the clock)
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ev_compliance_events_community_idx
  on public.ev_compliance_events (community_id, created_at desc);

alter table public.ev_compliance_events enable row level security;
grant select, insert, update, delete on public.ev_compliance_events to authenticated;
grant select, insert, update, delete on public.ev_compliance_events to service_role;

-- Every member may read their community's compliance events (transparency).
drop policy if exists "community reads compliance events" on public.ev_compliance_events;
create policy "community reads compliance events"
  on public.ev_compliance_events for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes compliance events" on public.ev_compliance_events;
create policy "board writes compliance events"
  on public.ev_compliance_events for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Refresh the PostgREST schema cache so the new table is queryable.
notify pgrst, 'reload schema';
