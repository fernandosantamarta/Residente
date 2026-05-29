-- ============================================================
-- Residente — let a resident save their own display name
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Symptom: editing your name in Settings briefly showed the new name in the
-- home greeting, then reverted to the old run-together "fernandosantamarta".
--
-- Cause: the Settings name edit PATCHes public.profiles, but the
-- `authenticated` role had NO update privilege on that table. Postgres
-- rejected the write with 42501 "permission denied for table profiles" (HTTP
-- 403), so 0 rows changed. The next auth refresh (onAuthStateChange ->
-- getProfile) then reloaded the unchanged DB row and the greeting reverted.
--
-- Fix: grant UPDATE — but only on full_name — plus an RLS policy scoping the
-- write to the caller's own row. The column-level grant is deliberate: it
-- keeps `role` and `community_id` OFF-LIMITS, so this can't be used to
-- self-promote to admin or jump into another community's data.

-- 1. Column-scoped privilege. `authenticated` may write full_name and nothing
--    else on profiles. (SELECT is unaffected; reads already worked.)
grant update (full_name) on public.profiles to authenticated;

-- 2. Row scope. A user may update only their own profile row. The WITH CHECK
--    blocks reassigning the row to someone else's id.
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- NOTE: community switching (CommunitySwitcher writes profiles.community_id)
-- hits the same 403 and is therefore also broken. It is intentionally NOT
-- fixed here: granting update on community_id needs a membership check first
-- (otherwise a resident could PATCH any community_id and read another
-- community's data through RLS). Track that as its own change.
