-- ============================================================
-- Residente — let notice recipients read their own notices.
-- Paste into the Supabase SQL editor and Run. Idempotent.
--
-- Bug: the bell badge counts unread ev_notice_recipients rows (which the
-- owner can read), but /app/notifications joins ev_notices!inner — and the
-- only SELECT policy on ev_notices is "board reads notices" (board/admin in
-- their current community only). So a resident, or a board member whose
-- recipient rows belong to a community other than their current
-- profile.community_id, sees a non-zero badge with an empty inbox.
--
-- Fix: an additive (permissive, ORs with the board policy) SELECT policy —
-- you can read a notice you were sent. ev_notice_recipients cascade-deletes
-- from ev_notices, so there are no orphan recipients to worry about.
-- ============================================================

drop policy if exists "recipient reads own notices" on public.ev_notices;
create policy "recipient reads own notices"
  on public.ev_notices for select to authenticated
  using (
    exists (
      select 1 from public.ev_notice_recipients r
      where r.notice_id = ev_notices.id
        and r.profile_id = auth.uid()
    )
  );
