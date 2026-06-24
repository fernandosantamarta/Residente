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
