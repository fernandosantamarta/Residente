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
