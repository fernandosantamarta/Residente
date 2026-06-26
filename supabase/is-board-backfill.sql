-- is-board-backfill.sql — run-once, idempotent. Paste into the Supabase SQL editor.
--
-- Bug: signup-provision set residents.board_position for the founding board
-- member but never flipped residents.is_board. Compliance, governance, the
-- requests "assign to" picker, the cron compliance scan, and the platform/
-- operator board counts all filter on is_board — so the founding board member
-- was invisible to them (e.g. the "Add your board members" compliance to-do
-- never cleared). This backfills the flag for any roster row that carries a
-- board_position but isn't flagged on the board. Safe to re-run.
update public.residents
   set is_board = true
 where board_position is not null
   and is_board is distinct from true;
