-- ============================================================
-- Residente — RLS: gate ALL remaining admin write policies on permissions
-- Run AFTER custom-roles.sql (needs has_permission()). Idempotent. Safe to re-run.
-- ============================================================
--
-- Replaces every "board …" WRITE policy in place (same name → no orphan
-- permissive policy left to bypass the check), swapping the coarse
-- profiles.role in ('board_member','admin') check for has_permission('<perm>').
-- has_permission already covers platform admins + the Admin role + per-role grants.
--
-- Financials/payments (budget_categories, ev_expenses, ev_financial_filings,
-- ev_reserve_components, payments, ev_collection_cases) were already done in
-- supabase/roles-rls-financials.sql — not repeated here.
--
-- LEFT UNTOUCHED on purpose (kept on the board-level check):
--   • ev_notices / ev_notice_recipients — the notice fan-out is written by many
--     features across permissions; gating it would break notice creation.
--   • platform_requests — "Contact Residente" support; any board member may use it.
--   • reports — legacy table of uncertain use; not worth the risk to gate blindly.

-- ---------- STANDARD "FOR ALL" POLICIES ----------
-- (table, exact policy name, required permission). Each becomes:
--   using/with check = community match AND has_permission(perm)
do $$
declare rec record;
begin
  for rec in
    select * from (values
      -- Easy Track (roster)
      ('residents',                   'board writes residents',                 'residents.manage'),
      ('ev_units',                    'board writes units',                     'residents.manage'),
      ('vendors',                     'board writes vendors',                   'residents.manage'),
      -- Easy Documents
      ('documents',                   'board writes documents',                 'documents.manage'),
      ('rules',                       'board writes rules',                     'documents.manage'),
      -- Violations / enforcement
      ('ev_violations',               'board writes community violations',      'violations.manage'),
      ('ev_violation_hearings',       'board writes hearings',                  'violations.manage'),
      ('ev_fining_committee_members', 'board writes fining committee',          'violations.manage'),
      ('ev_suspensions',              'board writes suspensions',               'violations.manage'),
      -- Easy Voice (meetings / governance votes)
      ('ev_meetings',                 'board writes meetings',                  'voice.manage'),
      ('ev_meeting_docs',             'board writes meeting docs',              'voice.manage'),
      ('ev_votes',                    'board writes votes',                     'voice.manage'),
      ('ev_attendance',               'board writes attendance',                'voice.manage'),
      ('committees',                  'board writes committees',                'voice.manage'),
      ('board_decisions',             'board writes board decisions',           'voice.manage'),
      -- Compliance cluster
      ('ev_arc_requests',             'board writes arc',                       'compliance.manage'),
      ('ev_estoppel_requests',        'board writes community estoppel',        'compliance.manage'),
      ('ev_board_terms',              'board writes board terms',               'compliance.manage'),
      ('ev_director_certifications',  'board writes director certs',            'compliance.manage'),
      ('ev_director_eligibility',     'board writes director eligibility',      'compliance.manage'),
      ('ev_conflict_disclosures',     'board writes conflict disclosures',      'compliance.manage'),
      ('ev_managers',                 'board writes managers',                  'compliance.manage'),
      ('ev_elections',                'board writes elections',                 'compliance.manage'),
      ('ev_candidates',               'board writes candidates',                'compliance.manage'),
      ('ev_recalls',                  'board writes recalls',                   'compliance.manage'),
      ('ev_buildings',                'board writes buildings',                 'compliance.manage'),
      ('ev_sirs_components',          'board writes sirs components',           'compliance.manage'),
      ('ev_structural_assessments',   'board writes assessments',               'compliance.manage'),
      -- Collections (payments cluster)
      ('ev_collection_notices',       'board writes community collection notices', 'payments.manage'),
      ('ev_payment_plans',            'board writes community payment plans',    'payments.manage')
    ) as t(tbl, pol, perm)
  loop
    execute format('drop policy if exists %I on public.%I', rec.pol, rec.tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission(%L)) '
      || 'with check (community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission(%L))',
      rec.pol, rec.tbl, rec.perm, rec.perm
    );
  end loop;
end $$;

-- ---------- UPDATE-only standard policies ----------
drop policy if exists "board updates proxy status" on public.ev_proxies;
create policy "board updates proxy status"
  on public.ev_proxies for update to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('voice.manage') )
  with check ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('voice.manage') );

drop policy if exists "board updates community requests" on public.resident_requests;
create policy "board updates community requests"
  on public.resident_requests for update to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('voice.manage') )
  with check ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('voice.manage') );

-- ---------- communities: community.manage (UPDATE) ----------
drop policy if exists "board updates their community" on public.communities;
create policy "board updates their community"
  on public.communities for update to authenticated
  using ( id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('community.manage') )
  with check ( id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('community.manage') );

-- ---------- Easy Schedule: split insert/update/delete → schedule.manage ----------
drop policy if exists "board inserts amenities" on public.ev_amenities;
create policy "board inserts amenities"
  on public.ev_amenities for insert to authenticated
  with check ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') );
drop policy if exists "board updates amenities" on public.ev_amenities;
create policy "board updates amenities"
  on public.ev_amenities for update to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') )
  with check ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') );
drop policy if exists "board deletes amenities" on public.ev_amenities;
create policy "board deletes amenities"
  on public.ev_amenities for delete to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') );

drop policy if exists "board inserts schedule" on public.ev_schedule_events;
create policy "board inserts schedule"
  on public.ev_schedule_events for insert to authenticated
  with check ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') );
drop policy if exists "board updates schedule" on public.ev_schedule_events;
create policy "board updates schedule"
  on public.ev_schedule_events for update to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') )
  with check ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') );
drop policy if exists "board deletes schedule" on public.ev_schedule_events;
create policy "board deletes schedule"
  on public.ev_schedule_events for delete to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) and public.has_permission('schedule.manage') );

-- board books a reservation for a resident — preserve the extra "target is in my
-- community" guard, swap the role check for schedule.manage.
drop policy if exists "board books for residents" on public.ev_amenity_reservations;
create policy "board books for residents"
  on public.ev_amenity_reservations for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('schedule.manage')
    and profile_id in (
      select id from public.profiles
      where community_id = (select community_id from public.profiles where id = auth.uid())
    )
  );

-- ---------- ev_ballots: board records the tally — preserve the vote-state guard
-- and the answer CHECK; swap the role check for voice.manage. ----------
drop policy if exists "board writes tally answer" on public.ev_ballots;
create policy "board writes tally answer"
  on public.ev_ballots for update to authenticated
  using (
    vote_id in (
      select id from public.ev_votes
      where community_id = (select community_id from public.profiles where id = auth.uid())
        and status = any(array['closed','tallied'])
    )
    and public.has_permission('voice.manage')
  )
  with check ( answer = any(array['yes','no','abstain']) );
