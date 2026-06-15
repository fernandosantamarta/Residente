-- ============================================================
-- Residente — resident-side Contact read receipts
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- The resident's "I've seen the board's reply" state used to live ONLY in a
-- per-device localStorage key (contact_thread_read). That meant reading a reply
-- on the web never cleared the badge on the phone (and vice-versa), so the
-- Contact / Easy Voice notification kept "resetting" — reappearing as unread
-- even though the resident had already checked it on another device.
--
-- We reuse the existing board_read_receipts table (per-profile, server-side, so
-- it syncs across a member's devices) with a NEW item_type 'request_resident':
--   board side  → item_type 'request'           (board saw the resident's msg)
--   resident    → item_type 'request_resident'  (resident saw the board's reply)
-- Both key on resident_requests.id and compare read_at vs. last_message_at.
-- Distinct profile_id + item_type means the two sides never collide.
--
-- This only widens the allowed item_type set; the table, grants, and RLS
-- policies from board-read-receipts.sql are unchanged and still apply (a row is
-- readable/writable only by its own profile_id = auth.uid()).

alter table public.board_read_receipts
  drop constraint if exists board_read_receipts_item_type_check;

alter table public.board_read_receipts
  add constraint board_read_receipts_item_type_check
  check (item_type in ('request', 'arc', 'request_resident'));
