-- ============================================================
-- Residente — per-board-member read receipts (board_read_receipts)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Drives the Easy Voice notification badges (Contact "awaiting reply" + ARC
-- "awaiting a decision"). Each row records that one board member has SEEN one
-- item as of read_at. The badge counts only open items the member hasn't seen
-- since their last activity, so:
--   * reading a message clears the badge (even before you reply),
--   * a resident's later reply re-surfaces it (newer last_message_at), and
--   * the state is server-side + per member, so opening it on your phone also
--     clears it on your laptop (the old per-device localStorage didn't).
--
-- item_type 'request' → resident_requests.id (compared vs last_message_at)
-- item_type 'arc'     → ev_arc_requests.id  (compared vs created_at)
-- It's polymorphic on purpose (no FK on item_id) so one table serves both
-- queues; an orphaned receipt after a delete is harmless (matches nothing).

create table if not exists public.board_read_receipts (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_type  text not null check (item_type in ('request', 'arc')),
  item_id    uuid not null,
  read_at    timestamptz not null default now(),
  primary key (profile_id, item_type, item_id)
);

alter table public.board_read_receipts enable row level security;
grant select, insert, update, delete on public.board_read_receipts to authenticated;

-- A member reads and writes ONLY their own receipts. profile_id = auth.uid()
-- (profiles.id is the auth user id everywhere else in this schema), so no
-- community scoping is needed — you can only ever touch your own rows.
drop policy if exists "own read receipts - select" on public.board_read_receipts;
create policy "own read receipts - select"
  on public.board_read_receipts for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "own read receipts - insert" on public.board_read_receipts;
create policy "own read receipts - insert"
  on public.board_read_receipts for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "own read receipts - update" on public.board_read_receipts;
create policy "own read receipts - update"
  on public.board_read_receipts for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
