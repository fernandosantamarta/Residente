-- ============================================================
-- Residente — let an OWNER request an estoppel on their own unit
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Depends on: estoppel.sql (creates ev_estoppel_requests + the board/owner policies).
-- ============================================================
--
-- Until now only the board could write ev_estoppel_requests ("board writes
-- community estoppel"); owners could only read their own. The Settings → Estoppel
-- popup lets a selling owner request a certificate in-app (for their buyer's
-- title/closing company), which the board then fulfills in /admin/estoppel.
--
-- This policy allows an owner to INSERT a request ONLY for their own profile, in
-- their own community, as a brand-new ('new') owner / owner-designee request.
-- All other columns (due_at, fees, status transitions, delivery) stay board-only
-- via the existing "board writes community estoppel" policy.

drop policy if exists "owner requests own estoppel" on public.ev_estoppel_requests;
create policy "owner requests own estoppel"
  on public.ev_estoppel_requests for insert to authenticated
  with check (
    profile_id   = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
    and status       = 'new'
    and requestor_type in ('owner', 'owner_designee')
  );
