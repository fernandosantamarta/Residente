-- ============================================================
-- Residente — board-initiated messages to a resident
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Lets the board START a thread with a resident from /admin/requests
-- ("Message a resident"), instead of only replying to requests the resident
-- submitted. A board message is stored as a resident_requests row owned by the
-- target resident (profile_id = resident) so it shows up on their Contact page
-- and in the board's queue — with the board's text in board_note (rendered as
-- "From the board") and origin = 'board' so both sides can tell who started it.
--
-- Two changes:
--   1. origin column — 'resident' (default, they submitted) | 'board' (we did).
--   2. a board INSERT policy — the existing "residents insert own requests"
--      policy requires profile_id = auth.uid(), which blocks the board from
--      creating a row owned by someone else. This adds the board's right to
--      insert a request for any profile in its own community.

alter table public.resident_requests
  add column if not exists origin text not null default 'resident';

drop policy if exists "board inserts community requests" on public.resident_requests;
create policy "board inserts community requests"
  on public.resident_requests for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
