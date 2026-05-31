-- ============================================================
-- Residente — RLS model baseline (exported from prod 2026-05-30)
-- ============================================================
-- The live tenant-isolation model, captured via supabase/export-rls-model.sql.
-- This is the source of truth for review and drift detection: change a policy
-- in the dashboard, re-export, and the diff shows exactly what moved.
--
-- Coverage: 33 public tables, all RLS-enabled. Subquery whitespace from the
-- catalog has been collapsed to one line per policy for readable diffs;
-- semantics are unchanged. Column-scoped grants (profiles.full_name) are NOT
-- here — see supabase/profile-self-update.sql.
--
-- Pattern shorthand used below:
--   OWN_COMMUNITY = (community_id = (SELECT community_id FROM profiles WHERE id = auth.uid()))
--   IS_BOARD      = ((SELECT role FROM profiles WHERE id = auth.uid()) = ANY(ARRAY['board_member','admin']))

-- ---------- 1. ROW LEVEL SECURITY ENABLED ----------
ALTER TABLE public.board_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_ballots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_meeting_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_notice_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_proxies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- ---------- 2. TABLE GRANTS ----------
-- anon gets only REFERENCES/TRIGGER/TRUNCATE on every table (no SELECT/DML),
-- so the anon key cannot read or write any row through the API.
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.board_decisions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.board_decisions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.board_decisions TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.budget_categories TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.budget_categories TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.budget_categories TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.committees TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.committees TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.committees TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.communities TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.communities TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.communities TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.documents TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.documents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.documents TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_attendance TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_attendance TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_attendance TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_audit_log TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.ev_audit_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_audit_log TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_ballots TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.ev_ballots TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_ballots TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_candidates TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_candidates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_candidates TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_consents TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.ev_consents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_consents TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_meeting_docs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_meeting_docs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_meeting_docs TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_meetings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_meetings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_meetings TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_membership TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_membership TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_membership TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_notice_recipients TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_notice_recipients TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_notice_recipients TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_notices TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.ev_notices TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_notices TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_proxies TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_proxies TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_proxies TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_schedule_events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_schedule_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_schedule_events TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_units TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_units TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_units TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_violations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_violations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_violations TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.ev_votes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_votes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ev_votes TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.home_documents TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.home_documents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.home_documents TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.home_transfers TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.home_transfers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.home_transfers TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.payments TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payments TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.platform_admins TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.platform_admins TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_admins TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.platform_audit_log TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.platform_audit_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_audit_log TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.platform_requests TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_requests TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_requests TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.profiles TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.reports TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.reports TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.reports TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.resident_requests TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.resident_requests TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.resident_requests TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.residents TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.residents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.residents TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.rules TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rules TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rules TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.vendor_ratings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vendor_ratings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vendor_ratings TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.vendors TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vendors TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vendors TO service_role;

-- ---------- 3. POLICIES ----------

-- board_decisions
CREATE POLICY "members read board decisions" ON public.board_decisions AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes board decisions" ON public.board_decisions AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- budget_categories
CREATE POLICY "members read budget categories" ON public.budget_categories AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS (SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.community_id = budget_categories.community_id)))));
CREATE POLICY "board writes budget categories" ON public.budget_categories AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS (SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.community_id = budget_categories.community_id) AND (p.role = ANY (ARRAY['board_member'::text, 'admin'::text])))))) WITH CHECK ((EXISTS (SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.community_id = budget_categories.community_id) AND (p.role = ANY (ARRAY['board_member'::text, 'admin'::text]))))));

-- committees
CREATE POLICY "members read committees" ON public.committees AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes committees" ON public.committees AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- communities
CREATE POLICY "members read their community" ON public.communities AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS (SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.community_id = communities.id)))));
CREATE POLICY "board updates their community" ON public.communities AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS (SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.community_id = communities.id) AND (p.role = ANY (ARRAY['board_member'::text, 'admin'::text]))))));

-- documents
CREATE POLICY "members read documents" ON public.documents AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes documents" ON public.documents AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_attendance
CREATE POLICY "members read attendance" ON public.ev_attendance AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "members self check-in" ON public.ev_attendance AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (unit_number = (SELECT profiles.unit_number FROM profiles WHERE (profiles.id = auth.uid()))) AND (method = 'qr_self_checkin'::text)));
CREATE POLICY "board writes attendance" ON public.ev_attendance AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_audit_log
CREATE POLICY "board reads audit log" ON public.ev_audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "any member writes audit" ON public.ev_audit_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));

-- ev_ballots
CREATE POLICY "members read own ballot" ON public.ev_ballots AS PERMISSIVE FOR SELECT TO authenticated USING ((profile_id = auth.uid()));
CREATE POLICY "members cast ballot" ON public.ev_ballots AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (unit_number = (SELECT profiles.unit_number FROM profiles WHERE (profiles.id = auth.uid()))) AND (vote_id IN (SELECT ev_votes.id FROM ev_votes WHERE ((ev_votes.community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (ev_votes.status = 'open'::text))))));
CREATE POLICY "proxy holders cast proxied ballots" ON public.ev_ballots AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((proxy_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM ev_proxies p WHERE ((p.id = ev_ballots.proxy_id) AND (p.holder_profile_id = auth.uid()) AND (p.status = ANY (ARRAY['submitted'::text, 'verified'::text]))))) AND (vote_id IN (SELECT ev_votes.id FROM ev_votes WHERE (ev_votes.status = 'open'::text)))));
CREATE POLICY "board reads community ballots" ON public.ev_ballots AS PERMISSIVE FOR SELECT TO authenticated USING (((vote_id IN (SELECT ev_votes.id FROM ev_votes WHERE (ev_votes.community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board writes tally answer" ON public.ev_ballots AS PERMISSIVE FOR UPDATE TO authenticated USING (((vote_id IN (SELECT ev_votes.id FROM ev_votes WHERE ((ev_votes.community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (ev_votes.status = ANY (ARRAY['closed'::text, 'tallied'::text]))))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK ((answer = ANY (ARRAY['yes'::text, 'no'::text, 'abstain'::text])));

-- ev_candidates
CREATE POLICY "members read candidates" ON public.ev_candidates AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "owners submit own candidacy" ON public.ev_candidates AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid())))));
CREATE POLICY "board writes candidates" ON public.ev_candidates AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_consents
CREATE POLICY "owner reads own consent" ON public.ev_consents AS PERMISSIVE FOR SELECT TO authenticated USING ((profile_id = auth.uid()));
CREATE POLICY "owner records own consent" ON public.ev_consents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid())))));
CREATE POLICY "board reads community consents" ON public.ev_consents AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_meeting_docs
CREATE POLICY "members read meeting docs" ON public.ev_meeting_docs AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes meeting docs" ON public.ev_meeting_docs AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_meetings
CREATE POLICY "members read meetings" ON public.ev_meetings AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes meetings" ON public.ev_meetings AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_membership
CREATE POLICY "owner reads own memberships" ON public.ev_membership AS PERMISSIVE FOR SELECT TO authenticated USING ((profile_id = auth.uid()));
CREATE POLICY "owner updates own last_active" ON public.ev_membership AS PERMISSIVE FOR UPDATE TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));

-- ev_notice_recipients
CREATE POLICY "owner reads own notice recipients" ON public.ev_notice_recipients AS PERMISSIVE FOR SELECT TO authenticated USING ((profile_id = auth.uid()));
CREATE POLICY "owner marks own recipient read" ON public.ev_notice_recipients AS PERMISSIVE FOR UPDATE TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));
CREATE POLICY "board reads community notice recipients" ON public.ev_notice_recipients AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board fans out recipients" ON public.ev_notice_recipients AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_notices
CREATE POLICY "board reads notices" ON public.ev_notices AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board writes notices" ON public.ev_notices AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_proxies
CREATE POLICY "grantor reads own proxy" ON public.ev_proxies AS PERMISSIVE FOR SELECT TO authenticated USING (((grantor_profile_id = auth.uid()) OR (holder_profile_id = auth.uid())));
CREATE POLICY "grantor submits own proxy" ON public.ev_proxies AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((grantor_profile_id = auth.uid()) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid())))));
CREATE POLICY "grantor revokes own proxy" ON public.ev_proxies AS PERMISSIVE FOR UPDATE TO authenticated USING ((grantor_profile_id = auth.uid())) WITH CHECK ((grantor_profile_id = auth.uid()));
CREATE POLICY "board reads community proxies" ON public.ev_proxies AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board updates proxy status" ON public.ev_proxies AS PERMISSIVE FOR UPDATE TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_schedule_events
CREATE POLICY "community reads schedule" ON public.ev_schedule_events AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board inserts schedule" ON public.ev_schedule_events AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board updates schedule" ON public.ev_schedule_events AS PERMISSIVE FOR UPDATE TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board deletes schedule" ON public.ev_schedule_events AS PERMISSIVE FOR DELETE TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_units
CREATE POLICY "members read units" ON public.ev_units AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes units" ON public.ev_units AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_violations
CREATE POLICY "residents read own violations" ON public.ev_violations AS PERMISSIVE FOR SELECT TO authenticated USING ((profile_id = auth.uid()));
CREATE POLICY "board reads community violations" ON public.ev_violations AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board writes community violations" ON public.ev_violations AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- ev_votes
CREATE POLICY "members read votes" ON public.ev_votes AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes votes" ON public.ev_votes AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- home_documents (private to the owning resident; home-transfer moves via service role)
CREATE POLICY "owner manages own home docs" ON public.home_documents AS PERMISSIVE FOR ALL TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));

-- home_transfers (parties + board read; writes via service role only)
CREATE POLICY "transfer parties and board read" ON public.home_transfers AS PERMISSIVE FOR SELECT TO authenticated USING (((from_profile_id = auth.uid()) OR (to_profile_id = auth.uid()) OR (initiated_by = auth.uid()) OR ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))));

-- payments
-- NOTE (security review 2026-05-30): "members read payments" is community-wide,
-- so it OR-overrides "resident reads own payments" — every member can read every
-- household's payment amounts + Stripe ids. Flagged as over-permissive; intended
-- fix is to drop it and add a board-only read alongside the own-row policy.
CREATE POLICY "resident reads own payments" ON public.payments AS PERMISSIVE FOR SELECT TO authenticated USING ((resident_id IN (SELECT residents.id FROM residents WHERE (residents.profile_id = auth.uid()))));
CREATE POLICY "members read payments" ON public.payments AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "resident logs own payment" ON public.payments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((resident_id IN (SELECT residents.id FROM residents WHERE (residents.profile_id = auth.uid()))));
CREATE POLICY "board writes payments" ON public.payments AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- platform_admins / platform_audit_log
CREATE POLICY "platform admins read admins" ON public.platform_admins AS PERMISSIVE FOR SELECT TO authenticated USING (is_platform_admin(auth.uid()));
CREATE POLICY "platform admins read audit" ON public.platform_audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (is_platform_admin(auth.uid()));

-- platform_requests
CREATE POLICY "submitter reads own platform request" ON public.platform_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((from_profile_id = auth.uid()));
CREATE POLICY "platform admins read requests" ON public.platform_requests AS PERMISSIVE FOR SELECT TO authenticated USING (is_platform_admin(auth.uid()));
CREATE POLICY "platform admins update requests" ON public.platform_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (is_platform_admin(auth.uid()));
CREATE POLICY "board submits platform request" ON public.platform_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((from_profile_id = auth.uid()) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- profiles (own-row only; note duplicate SELECT policy on roles authenticated + public)
CREATE POLICY "Users read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = id));
CREATE POLICY "users read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = id));
CREATE POLICY "users update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));

-- reports
CREATE POLICY "members read published reports" ON public.reports AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((status = ANY (ARRAY['published'::text, 'updated'::text])) OR ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))));
CREATE POLICY "board writes reports" ON public.reports AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- resident_requests
CREATE POLICY "residents read own requests" ON public.resident_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((profile_id = auth.uid()));
CREATE POLICY "residents insert own requests" ON public.resident_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid())))));
CREATE POLICY "residents delete own requests" ON public.resident_requests AS PERMISSIVE FOR DELETE TO authenticated USING ((profile_id = auth.uid()));
CREATE POLICY "board reads community requests" ON public.resident_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
CREATE POLICY "board updates community requests" ON public.resident_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- residents
-- NOTE (security review 2026-05-30): "members read residents" is community-wide and
-- SELECT is table-level, so stripe_customer_id is readable by any neighbor. The
-- payment edge functions now enforce caller ownership in code (commit on branch
-- security/payment-fn-owner-checks) instead of trusting this policy.
CREATE POLICY "members read residents" ON public.residents AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "residents claim own row by email" ON public.residents AS PERMISSIVE FOR UPDATE TO authenticated USING (((profile_id IS NULL) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (email IS NOT NULL) AND (lower(email) = lower((SELECT profiles.email FROM profiles WHERE (profiles.id = auth.uid())))))) WITH CHECK ((profile_id = auth.uid()));
CREATE POLICY "residents update own row" ON public.residents AS PERMISSIVE FOR UPDATE TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));
CREATE POLICY "board writes residents" ON public.residents AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- rules
CREATE POLICY "members read rules" ON public.rules AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes rules" ON public.rules AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));

-- vendor_ratings
CREATE POLICY "members read vendor ratings" ON public.vendor_ratings AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "residents write own rating" ON public.vendor_ratings AS PERMISSIVE FOR ALL TO authenticated USING (((profile_id = auth.uid()) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))))) WITH CHECK (((profile_id = auth.uid()) AND (community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid())))));

-- vendors
CREATE POLICY "members read vendors" ON public.vendors AS PERMISSIVE FOR SELECT TO authenticated USING ((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "board writes vendors" ON public.vendors AS PERMISSIVE FOR ALL TO authenticated USING (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text])))) WITH CHECK (((community_id = (SELECT profiles.community_id FROM profiles WHERE (profiles.id = auth.uid()))) AND ((SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['board_member'::text, 'admin'::text]))));
