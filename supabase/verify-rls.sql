-- ============================================================
-- Residente — RLS posture verification (READ-ONLY)
-- Paste into the Supabase SQL editor and run. Changes nothing.
-- ============================================================
--
-- Why this exists: every tenant-isolation guarantee in Residente is an RLS
-- policy, and those policies live in the dashboard, not in versioned migrations.
-- This script answers the three questions a security review must answer before
-- onboarding real communities:
--   Q1. Is RLS actually enabled on every table that holds tenant data?
--   Q2. Is any table readable/writable by anon/authenticated WITHOUT RLS?
--       (that is the cross-tenant breach pattern — an open door)
--   Q3. What exactly can a plain resident SELECT on residents / payments?
--
-- Run all four queries. The PASS/FAIL notes tell you what good looks like.


-- ------------------------------------------------------------
-- Q1. RLS enabled per public table. rls_enabled=false on a tenant
--     table (residents, payments, communities, home_documents,
--     budget_categories, ev_*) is a FAIL.
-- ------------------------------------------------------------
select c.relname                as table_name,
       c.relrowsecurity         as rls_enabled,
       c.relforcerowsecurity    as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relrowsecurity asc, c.relname;   -- RLS-off tables float to the top


-- ------------------------------------------------------------
-- Q2. THE SMOKING GUN. Tables granted to anon/authenticated that
--     have RLS DISABLED. Every row returned here is reachable by any
--     signed-in user of ANY community with no row filter.
--     EXPECTED RESULT: zero rows. Any row = cross-tenant exposure.
-- ------------------------------------------------------------
select c.relname                       as exposed_table,
       c.relrowsecurity                as rls_enabled,
       array_agg(distinct g.grantee)   as granted_to
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join information_schema.role_table_grants g
  on g.table_schema = n.nspname and g.table_name = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
  and g.grantee in ('anon', 'authenticated')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ------------------------------------------------------------
-- Q3. The keystone for Finding 1. What can a plain resident SELECT on
--     the payment-bearing tables? For residents, the SELECT policy's
--     `qual` should pin to the caller's own row (profile_id = auth.uid())
--     for the resident role, and only widen to community for board roles.
--     A bare `community_id = (... profiles ...)` SELECT = neighbors can
--     read each other's stripe_customer_id via list-payment-methods.
-- ------------------------------------------------------------
select tablename,
       policyname,
       cmd,
       roles,
       qual         as using_expr,
       with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('residents', 'payments', 'communities',
                    'home_documents', 'budget_categories')
order by tablename, cmd, policyname;


-- ------------------------------------------------------------
-- Q4. Full policy inventory — the document you should be committing to
--     version control. Compare against supabase/*.sql to find drift.
-- ------------------------------------------------------------
select tablename,
       policyname,
       cmd,
       roles,
       qual         as using_expr,
       with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;
