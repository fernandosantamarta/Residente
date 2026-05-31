# Supabase migrations — versioning the isolation model

For most of Residente's life the schema and **every RLS policy** lived only in the
Supabase dashboard. The loose `supabase/*.sql` files are change notes ("run once in
the SQL editor"), not a source of truth — they don't include the base tables
(`residents` has no `CREATE TABLE` anywhere in the repo) and there's no guarantee
prod matches them. That's the root cause of both findings in the 2026-05-30 security
audit: tenant isolation depends on dashboard state nobody can review or diff.

This directory fixes that. The goal: **the live schema + policies are dumped here and
committed, so RLS is reviewable in PRs and drift is visible in `git diff`.**

## One-time baseline (run these once)

Neither the Supabase CLI nor `pg_dump` is installed locally, so we run the CLI through
`npx` — nothing to install. The project ref `nozzfcxijdnllkiydhfi` comes from the public
Supabase URL (not a secret).

```bash
# 1. Authenticate the CLI (opens a browser once).
npx --yes supabase@latest login

# 2. Link this repo to the prod project. Prompts for the DB password once
#    (Supabase dashboard -> Project Settings -> Database -> Connection string).
npx --yes supabase@latest link --project-ref nozzfcxijdnllkiydhfi

# 3. Dump the public schema — tables, RLS enable flags, policies, grants, triggers,
#    functions — into a versioned baseline file.
npm run db:dump
```

Or in one step with the npm scripts (see `package.json`):

```bash
npm run db:login     # step 1 (opens a browser, once per machine)
npm run db:link      # step 2 (prompts for the DB password, once)
npm run db:dump      # step 3 -> supabase/migrations/0000_baseline_public.sql
```

Then **read the dump** and confirm:
- every tenant table has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, and
- `residents` has a SELECT policy scoped to the owner's own row (board roles may be
  wider). If it's community-wide, that's audit Finding 1 — fix it, then re-dump.

Commit the baseline:

```bash
git add supabase/migrations/0000_baseline_public.sql
git commit -m "chore(db): version live schema + RLS policies as baseline migration"
```

## Going forward

- Make schema/policy changes the normal way (SQL editor is fine), then re-run
  `npm run db:dump` and commit the diff. The PR now shows exactly which policy moved.
- `supabase/verify-rls.sql` is the read-only posture check — run it in the SQL editor
  anytime (especially before onboarding a new community) to confirm no table is
  exposed to `anon`/`authenticated` with RLS off.

## Notes

- `supabase db dump` for a linked remote project connects straight over Postgres; it
  does not need Docker. If it ever complains about Docker, that's only for local
  `supabase start`, which we don't use here.
- The `--schema` flag controls scope. `db:dump` targets `public`. Storage-object
  policies (Home Vault, ev-documents) live in the `storage` schema — dump those with
  `npm run db:dump:storage` if you change bucket RLS.
