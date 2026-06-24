-- ============================================================================
-- Residente — Operator Console (A) + Automation plumbing (B)
-- Combined migration. Run ONCE in the Supabase SQL editor. Idempotent / safe to re-run.
-- Order is dependency-safe (all reference only pre-existing tables).
-- ============================================================================


-- ====================== platform-pending.sql ======================

-- ============================================================
-- Residente — Cross-community operator "pending queue".
-- Run once in the Supabase SQL editor, AFTER operator-multi-role.sql
-- (it relies on platform_roles / platform_log / platform_enter_community).
-- Safe to re-run.
-- ============================================================
--
-- ONE cross-community queue of everything awaiting a human, so an operator can
-- clear many communities fast. Read-only, gated by team:
--   • support sees ONLY support tickets (their inbox).
--   • operator/owner/billing see resident approvals + tickets.
--   • operator/owner see the statutory items too (collections / ARC / minutes /
--     elections / fines).
--
-- LEGAL DESIGN: statutory items are SURFACED with a deep-link to act in-context
-- (deep_link_href → /admin/<area>), NEVER auto-fired from the console. Only the
-- two clearly-ministerial items can be batch-actioned from here:
--   • pending resident approvals (platform_approve_resident)
--   • support ticket acknowledgement (already on platform_requests.status)

-- ---------- THE UNIFIED QUEUE ----------
-- Every row is one thing an operator can look at. action_kind tells the UI how
-- to render the row's action; deep_link_href is where "Go →" lands (after the
-- console enters that community). severity drives the colored dot + sort.
create or replace function public.platform_pending_items()
returns table (
  id uuid, item_type text, community_id uuid, community_name text,
  created_at timestamptz, due_at timestamptz, severity text,
  title text, subtitle text, status text, action_kind text,
  deep_link_href text, actor_name text
) language plpgsql stable security definer as $$
declare rs text[]; ops boolean;
begin
  rs := public.platform_roles(auth.uid());
  if array_length(rs, 1) is null then raise exception 'not a platform admin'; end if;
  -- "ops" = anyone who can see operational work beyond the support inbox. Support
  -- operators only get their tickets; everyone else gets resident approvals, and
  -- operator/owner additionally get the statutory items (gated again per-source).
  ops := rs && array['owner','operator','billing'];

  return query
  with q as (
    -- ---- Support tickets (visible to ALL teams — it's the shared inbox) ----
    select
      pr.id,
      'support_ticket'::text                        as item_type,
      pr.from_community_id                           as community_id,
      c.name                                         as community_name,
      pr.created_at,
      null::timestamptz                              as due_at,
      (case when pr.status = 'open' then 'soon' else 'info' end)::text as severity,
      pr.subject                                     as title,
      pr.body                                        as subtitle,
      pr.status                                      as status,
      'ack_ticket'::text                             as action_kind,
      ('/platform?tab=support&id=' || pr.id::text)   as deep_link_href,
      pr.from_name                                   as actor_name
    from public.platform_requests pr
    join public.communities c on c.id = pr.from_community_id
    where pr.status in ('open','in_progress')

    union all
    -- ---- Pending resident approvals (operator/owner/billing) ----
    select
      res.id,
      'resident_approval'::text,
      res.community_id,
      c.name,
      res.created_at,
      null::timestamptz,
      'soon'::text,
      'Pending resident: ' || coalesce(res.full_name, res.email, '(no name)'),
      res.email,
      'pending'::text,
      'approve_resident'::text,
      '/admin/residents'::text,
      coalesce(res.full_name, res.email)
    from public.residents res
    join public.communities c on c.id = res.community_id
    where ops and res.approval_state = 'pending'

    union all
    -- ---- Collections cases needing the next statutory step (operator/owner) ----
    -- due_at = the statutory deadline derived from the last notice's date.
    select
      cc.id,
      'collections'::text,
      cc.community_id,
      c.name,
      cc.created_at,
      (case cc.stage
        when 'notice_30'           then (cc.notice_30_sent_at + interval '30 days')
        when 'intent_to_lien'      then (cc.intent_to_lien_sent_at + interval '45 days')
        when 'intent_to_foreclose' then (cc.intent_to_foreclose_sent_at + interval '45 days')
        else null end)::timestamptz,
      'info'::text,
      'Collections ' || coalesce(cc.unit_label, 'case') || ': ' || (case cc.stage
        when 'delinquent'          then 'log 30-day notice'
        when 'notice_30'           then 'log 45-day intent-to-lien'
        when 'intent_to_lien'      then 'mark lien recorded'
        when 'lien_recorded'       then 'log 45-day intent-to-foreclose'
        when 'intent_to_foreclose' then 'mark foreclosure filed'
        end),
      cc.unit_label,
      cc.stage,
      'review_collections'::text,
      '/admin/collections'::text,
      cc.unit_label
    from public.ev_collection_cases cc
    join public.communities c on c.id = cc.community_id
    where (rs && array['owner','operator'])
      and cc.stage in ('delinquent','notice_30','intent_to_lien','lien_recorded','intent_to_foreclose')

    union all
    -- ---- ARC requests awaiting a decision (operator/owner) ----
    select
      ar.id,
      'arc_request'::text,
      ar.community_id,
      c.name,
      ar.created_at,
      ar.response_due_at::timestamptz,
      (case
        when ar.response_due_at < now() then 'overdue'
        when ar.response_due_at < now() + interval '7 days' then 'soon'
        else 'info' end)::text,
      'ARC review: ' || coalesce(ar.unit_label, ar.request_type),
      ar.unit_label,
      ar.status,
      'review_arc'::text,
      '/admin/arc'::text,
      ar.unit_label
    from public.ev_arc_requests ar
    join public.communities c on c.id = ar.community_id
    where (rs && array['owner','operator'])
      and ar.status in ('submitted','under_review')

    union all
    -- ---- Meeting minutes still due after a completed meeting (operator/owner) ----
    select
      m.id,
      'meeting_minutes_due'::text,
      m.community_id,
      c.name,
      m.created_at,
      (m.scheduled_at + interval '30 days'),
      (case when (m.scheduled_at + interval '30 days') < now() then 'overdue' else 'info' end)::text,
      'Minutes due: ' || m.title,
      m.title,
      m.minutes_status,
      'review_minutes'::text,
      '/admin/meetings'::text,
      null::text
    from public.ev_meetings m
    join public.communities c on c.id = m.community_id
    where (rs && array['owner','operator'])
      and m.status = 'completed'
      and m.minutes_status not in ('published','approved')

    union all
    -- ---- Election milestones in flight (operator/owner) ----
    select
      e.id,
      'election_milestone'::text,
      e.community_id,
      c.name,
      e.created_at,
      e.election_date::timestamptz,
      'info'::text,
      'Election ' || coalesce(e.election_date::text, '') || ': ' || e.status,
      null::text,
      e.status,
      'review_election'::text,
      '/admin/elections'::text,
      null::text
    from public.ev_elections e
    join public.communities c on c.id = e.community_id
    where (rs && array['owner','operator'])
      and e.status in ('proposed','first_notice_sent','candidates_closed','ballots_sent')

    union all
    -- ---- Open fines awaiting enforcement (operator/owner) ----
    select
      v.id,
      'violation_fine'::text,
      v.community_id,
      c.name,
      v.created_at,
      null::timestamptz,
      'info'::text,
      'Open fine: ' || coalesce(v.rule_title, 'violation'),
      v.resident_label,
      v.status,
      'review_enforcement'::text,
      '/admin/enforcement'::text,
      v.resident_label
    from public.ev_violations v
    join public.communities c on c.id = v.community_id
    where (rs && array['owner','operator'])
      and v.kind = 'fine' and v.status = 'open'
  )
  select q.id, q.item_type, q.community_id, q.community_name, q.created_at,
         q.due_at, q.severity, q.title, q.subtitle, q.status, q.action_kind,
         q.deep_link_href, q.actor_name
  from q
  -- overdue first, then soon, then info; then nearest deadline; then newest.
  order by
    case q.severity when 'overdue' then 0 when 'soon' then 1 else 2 end,
    q.due_at asc nulls last,
    q.created_at desc;
end $$;
grant execute on function public.platform_pending_items() to authenticated;

-- ---------- BATCH-ACTIONABLE: approve a pending resident ----------
-- Ministerial only. Mirrors the board's own approve flow (admin/residents):
-- approval_state → 'active' (the check constraint's "approved" value),
-- verified_via → 'board'. owner/operator teams only; audited.
create or replace function public.platform_approve_resident(p_resident uuid)
returns void language plpgsql security definer as $$
declare rs text[]; v_name text; v_comm text;
begin
  rs := public.platform_roles(auth.uid());
  if not (rs && array['owner','operator']) then
    raise exception 'not allowed for this role';
  end if;
  select res.full_name, c.name into v_name, v_comm
  from public.residents res
  left join public.communities c on c.id = res.community_id
  where res.id = p_resident;
  update public.residents
    set approval_state = 'active', verified_via = 'board'
  where id = p_resident and approval_state = 'pending';
  perform public.platform_log('resident_approved', 'resident', p_resident::text,
    jsonb_build_object('name', v_name, 'community', v_comm));
end $$;
grant execute on function public.platform_approve_resident(uuid) to authenticated;


-- ====================== monthly-charges.sql ======================

-- ============================================================
-- Residente — Auto-generated monthly dues charges (audit / GL ledger)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: communities (monthly_dues, assessment_due_day),
--             residents (community_id, profile_id, approval_state),
--             custom-roles.sql (has_permission()).
-- ============================================================
--
-- A monthly snapshot of the assessment minted for each active household, written
-- once per (community, resident, billing period) by the charge-monthly-dues cron
-- (app/api/cron/charge-monthly-dues). This is an AUDIT / general-ledger record
-- only — it documents WHEN each month's assessment was raised and at what amount.
--
-- ⚠ NOT a balance source. The resident balance shown across the app stays
-- FORMULA-based in lib/dues.ts (opening + monthsOwed·monthlyDues − payments +
-- interest + fees). This table is deliberately NOT wired into residentBalance(),
-- so it can never double-count what that formula already accrues. status here is
-- informational; payments remain receipts in public.payments.

create table if not exists public.ev_monthly_charges (
  id                   uuid primary key default gen_random_uuid(),
  community_id         uuid not null references public.communities(id) on delete cascade,
  resident_id          uuid not null references public.residents(id) on delete cascade,
  billing_period_start date not null,   -- first day of the billed month
  billing_period_end   date not null,   -- last day of the billed month
  due_date             date not null,   -- billing_period_start + (assessment_due_day - 1)
  amount               numeric not null,
  status               text not null default 'pending'
                         check (status in ('pending','paid-in-full','partial','reversed')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  notes                text
);

-- Idempotency backstop: one charge per household per billing period. The cron's
-- INSERT ... ON CONFLICT DO NOTHING leans on this exact unique key.
create unique index if not exists ev_monthly_charges_idem
  on public.ev_monthly_charges (community_id, resident_id, billing_period_start);

-- The board ledger view (newest assessments first) and per-resident lookups.
create index if not exists ev_monthly_charges_community_due_idx
  on public.ev_monthly_charges (community_id, due_date desc);
create index if not exists ev_monthly_charges_resident_period_idx
  on public.ev_monthly_charges (resident_id, billing_period_start desc);

alter table public.ev_monthly_charges enable row level security;

grant references, trigger, truncate on public.ev_monthly_charges to anon;
grant select, insert, update, delete on public.ev_monthly_charges to authenticated;
grant select, insert, update, delete on public.ev_monthly_charges to service_role;

-- ---------- keep updated_at honest ----------
create or replace function public.ev_monthly_charges_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ev_monthly_charges_touch_trg on public.ev_monthly_charges;
create trigger ev_monthly_charges_touch_trg
  before update on public.ev_monthly_charges
  for each row execute function public.ev_monthly_charges_touch();

-- ---------- RLS ----------
-- A resident reads their OWN charges (their residents row links via profile_id).
drop policy if exists "resident reads own monthly charges" on public.ev_monthly_charges;
create policy "resident reads own monthly charges"
  on public.ev_monthly_charges for select to authenticated
  using (
    exists (
      select 1 from public.residents r
      where r.id = ev_monthly_charges.resident_id
        and r.profile_id = auth.uid()
    )
  );

-- The board reads its community's full ledger. board_member/admin always; other
-- roles only with the payments.view (or .manage) permission.
drop policy if exists "board reads community monthly charges" on public.ev_monthly_charges;
create policy "board reads community monthly charges"
  on public.ev_monthly_charges for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('payments.view')
      or public.has_permission('payments.manage')
    )
  );

-- The board writes its community's ledger (corrections / status). Same gate as reads.
drop policy if exists "board writes community monthly charges" on public.ev_monthly_charges;
create policy "board writes community monthly charges"
  on public.ev_monthly_charges for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('payments.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('payments.manage')
    )
  );

-- Refresh the PostgREST schema cache so the new table is queryable.
notify pgrst, 'reload schema';


-- ====================== work-orders.sql ======================

-- ============================================================
-- Residente — work orders (vendor assignment + lifecycle + completion)
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- The board turns a maintenance issue (a resident_request) — or a standalone
-- task — into a work order, assigns a vendor, sets a priority + SLA, and then
-- advances it through assigned → in_progress → completed (or cancelled). On
-- completion the board records actual cost + notes (and optionally a photo).
--
-- A work order may be linked back to the resident_request it came from so the
-- submitting resident can see that their issue is being worked. The reverse
-- pointer resident_requests.active_work_order_id flags the request as "has an
-- open work order" without a join.

create table if not exists public.work_orders (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid not null references public.communities(id) on delete cascade,
  request_id             uuid references public.resident_requests(id) on delete set null,
  vendor_id              uuid references public.vendors(id) on delete set null,
  assigned_by            uuid references public.profiles(id) on delete set null,
  assigned_at            timestamptz not null default now(),
  title                  text not null,
  description            text,
  priority               text not null default 'normal'
                           check (priority in ('low','normal','urgent','emergency')),
  status                 text not null default 'assigned'
                           check (status in ('assigned','in_progress','completed','cancelled')),
  started_at             timestamptz,
  completed_at           timestamptz,
  sla_due_at             timestamptz,
  estimated_cost         numeric(12,2),
  actual_cost            numeric(12,2),
  completion_notes       text,
  completion_photo_path  text,
  completion_photo_name  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists work_orders_community_status_idx on public.work_orders (community_id, status);
create index if not exists work_orders_vendor_status_idx    on public.work_orders (vendor_id, status);
create index if not exists work_orders_request_idx          on public.work_orders (request_id);

-- Reverse pointer so a request row can flag "has an open work order" cheaply.
alter table public.resident_requests
  add column if not exists active_work_order_id uuid
    references public.work_orders(id) on delete set null;

alter table public.work_orders enable row level security;
grant references, trigger, truncate on public.work_orders to anon;
grant select, insert, update, delete on public.work_orders to authenticated;
grant all on public.work_orders to service_role;

-- ---------- RLS ----------
-- The board manages every work order in their community. Role-based so this
-- ships without needing a brand-new permission; admins/board members already
-- run the maintenance queue.

drop policy if exists "board reads community work orders" on public.work_orders;
create policy "board reads community work orders"
  on public.work_orders for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

drop policy if exists "board inserts community work orders" on public.work_orders;
create policy "board inserts community work orders"
  on public.work_orders for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

drop policy if exists "board updates community work orders" on public.work_orders;
create policy "board updates community work orders"
  on public.work_orders for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

drop policy if exists "board deletes community work orders" on public.work_orders;
create policy "board deletes community work orders"
  on public.work_orders for delete to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

-- A resident may read the work orders tied to their own request so they can see
-- their maintenance issue is being handled.
drop policy if exists "residents read own request work orders" on public.work_orders;
create policy "residents read own request work orders"
  on public.work_orders for select to authenticated
  using (
    exists (
      select 1 from public.resident_requests r
      where r.id = work_orders.request_id
        and r.profile_id = auth.uid()
    )
  );

-- Keep updated_at fresh on every write.
create or replace function public.work_orders_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists work_orders_touch on public.work_orders;
create trigger work_orders_touch
  before update on public.work_orders
  for each row execute function public.work_orders_touch_updated_at();


-- ====================== request-triage.sql ======================

-- ============================================================
-- Residente — Request triage queue enhancement (resident_requests)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Adds three triage fields to the board's Contact queue so urgent threads can
-- rise to the top, work can be assigned to a specific board member, and an SLA
-- target can be tracked:
--   * priority    — low | normal | urgent (default 'normal'); drives sort.
--   * sla_due_at  — optional target-by timestamp (reserved for SLA badges).
--   * assigned_to — the board member who owns this thread (profiles.id).
--
-- No RLS change is needed. The board UPDATE policy on resident_requests is
-- row-level (community + role/permission), not column-restricted — see
-- supabase/resident-requests.sql and supabase/roles-rls-all.sql — so it already
-- authorizes writes to these new columns.

alter table public.resident_requests
  add column if not exists priority   text not null default 'normal'
    check (priority in ('low', 'normal', 'urgent')),
  add column if not exists sla_due_at  timestamptz,
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

-- Triage-queue read path: filter/sort by community → priority → status.
create index if not exists resident_requests_triage_idx
  on public.resident_requests (community_id, priority, status);


-- ====================== minutes-templates.sql ======================

-- ============================================================
-- Residente — Structured minutes templates + capture
-- (FS 718.111(12) / 720.303(4) — minutes are official records owners may inspect)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: easy-voice.sql (ev_meetings), compliance-foundation.sql, custom-roles.sql
--             (for public.has_permission).
-- ============================================================
--
-- Board meetings already track NOTICE compliance in ev_meetings + /admin/meetings.
-- Minutes were previously captured only as uploaded files (ev_meeting_docs).
-- This migration adds STRUCTURED minutes: a per-community section template per
-- meeting type, and the captured minutes (sections_data) for each meeting. The
-- default section schema lives in lib/compliance/minutes-templates.ts (not seeded
-- here); a board may override it by inserting a minutes_templates row.
--
-- Posture: Enable — the capture helper at /admin/meetings/[id]/minutes drafts and
-- publishes structured minutes. Publishing sets ev_meetings.minutes_status +
-- minutes_published_at so the existing notice-compliance math sees them.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the default minutes sections and the secretary
--   certification language are aids; confirm against the governing documents.

-- ---------- minutes_templates ----------
create table if not exists public.minutes_templates (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  meeting_type  text not null check (meeting_type in ('board','annual','special','committee')),
  name          text not null default 'Default',
  sections      jsonb not null default '[]'::jsonb,   -- section schema (see lib/compliance/minutes-templates.ts)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (community_id, meeting_type, name)
);

create index if not exists minutes_templates_community_idx
  on public.minutes_templates (community_id, meeting_type);

-- ---------- meeting_minutes ----------
create table if not exists public.meeting_minutes (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references public.ev_meetings(id) on delete cascade,
  community_id   uuid not null references public.communities(id) on delete cascade,
  template_id    uuid references public.minutes_templates(id) on delete set null,
  sections_data  jsonb not null default '{}'::jsonb,   -- captured values keyed by section/field id
  status         text not null default 'draft' check (status in ('draft','approved','published')),
  draft_at       timestamptz,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles(id),
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (meeting_id)
);

create index if not exists meeting_minutes_community_idx
  on public.meeting_minutes (community_id, status);

-- ---------- link column on ev_meetings ----------
alter table public.ev_meetings
  add column if not exists minutes_template_id uuid references public.minutes_templates(id) on delete set null;

-- ---------- RLS + grants ----------
alter table public.minutes_templates enable row level security;
alter table public.meeting_minutes   enable row level security;

grant references, trigger, truncate on public.minutes_templates to anon;
grant references, trigger, truncate on public.meeting_minutes   to anon;
grant select, insert, update, delete on public.minutes_templates to authenticated;
grant select, insert, update, delete on public.meeting_minutes   to authenticated;
grant select, insert, update, delete on public.minutes_templates to service_role;
grant select, insert, update, delete on public.meeting_minutes   to service_role;

-- minutes_templates: the board manages templates in their community.
drop policy if exists "board manages minutes templates" on public.minutes_templates;
create policy "board manages minutes templates"
  on public.minutes_templates for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  );

-- meeting_minutes: the board manages all minutes in their community.
drop policy if exists "board manages meeting minutes" on public.meeting_minutes;
create policy "board manages meeting minutes"
  on public.meeting_minutes for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  );

-- meeting_minutes: every member may READ PUBLISHED minutes in their community
-- (minutes are official records owners may inspect).
drop policy if exists "community reads published minutes" on public.meeting_minutes;
create policy "community reads published minutes"
  on public.meeting_minutes for select to authenticated
  using (
    status = 'published'
    and community_id = (select community_id from public.profiles where id = auth.uid())
  );

-- ---------- optional seeding (commented) ----------
-- Templates are NOT seeded here; lib/compliance/minutes-templates.ts provides the
-- per-type defaults the capture page falls back to. To override the default for
-- one community/type, insert a row, e.g.:
--   insert into public.minutes_templates (community_id, meeting_type, name, sections)
--   values ('<community-uuid>', 'board', 'Default', '<sections-json>'::jsonb)
--   on conflict (community_id, meeting_type, name) do update set sections = excluded.sections, updated_at = now();

-- Refresh the PostgREST schema cache so the new tables/column are queryable.
notify pgrst, 'reload schema';

