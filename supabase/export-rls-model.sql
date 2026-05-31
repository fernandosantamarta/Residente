-- ============================================================
-- Residente — RLS model export (READ-ONLY)
-- ============================================================
-- Reconstructs the live tenant-isolation model as committable SQL:
--   1. ALTER TABLE ... ENABLE ROW LEVEL SECURITY   (which tables are protected)
--   2. GRANT ... TO anon/authenticated/service_role (table-level privileges)
--   3. CREATE POLICY ...                            (the actual row rules)
--
-- Reads only system catalogs (pg_policies, pg_class, information_schema). Changes
-- nothing. Run in the Supabase SQL editor, then copy the whole `ddl` column and
-- paste it back to Claude — it gets saved to supabase/migrations/ as the baseline.
--
-- Caveat: column-scoped grants (e.g. grant update (full_name) on profiles) are
-- NOT emitted here; that one is already documented in supabase/profile-self-update.sql.

with rls_enable as (
  select format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', n.nspname, c.relname) as ddl,
         1 as ord, c.relname as tbl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
),
grants as (
  select format('GRANT %s ON %I.%I TO %I;',
                string_agg(distinct privilege_type, ', '),
                table_schema, table_name, grantee) as ddl,
         2 as ord, table_name as tbl
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated', 'service_role')
  group by table_schema, table_name, grantee
),
policies as (
  select
    'CREATE POLICY "' || policyname || '" ON ' || schemaname || '.' || tablename ||
    ' AS ' || permissive ||
    ' FOR ' || cmd ||
    ' TO ' || array_to_string(roles::text[], ', ') ||
    coalesce(' USING (' || qual || ')', '') ||
    coalesce(' WITH CHECK (' || with_check || ')', '') || ';' as ddl,
    3 as ord, tablename as tbl
  from pg_policies
  where schemaname = 'public'
)
select ddl
from (
  select * from rls_enable
  union all select * from grants
  union all select * from policies
) x
order by ord, tbl, ddl;
