-- ============================================================
-- Residente — close a Contact thread (board ends the conversation)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Requires: request-messages.sql (two-way threads) first.
-- ============================================================
--
-- When the board marks a request resolved, the conversation is CLOSED: the
-- resident can no longer reply to it and must start a new message instead. The
-- full message history is kept — closing only flips status/closed_at, it never
-- deletes anything, and request_messages has no update/delete grant so the
-- record is permanent.

alter table public.resident_requests add column if not exists closed_at timestamptz;

-- A resident may post only to an OPEN thread of their own. The added
-- `r.status <> 'resolved'` is what makes "closed" stick: once the board closes
-- it, this insert check fails, so a stale tab or a hand-rolled request can't
-- sneak a reply onto a finished conversation.
drop policy if exists "resident inserts own request messages" on public.request_messages;
create policy "resident inserts own request messages"
  on public.request_messages for insert to authenticated
  with check (
    author_role = 'resident'
    and author_id = auth.uid()
    and exists (
      select 1 from public.resident_requests r
      where r.id = request_id
        and r.profile_id = auth.uid()
        and r.status <> 'resolved'
    )
  );

-- Closing is final from the resident's side, so the auto-reopen-on-resident-reply
-- trigger from request-messages.sql is retired (a resident can't reply to a
-- closed thread to trigger it anyway).
drop trigger if exists trg_reopen_request_on_resident_reply on public.request_messages;
drop function if exists public.reopen_request_on_resident_reply();

-- Keep every conversation on the record: remove the resident's ability to
-- hard-delete (which would cascade-delete the whole thread). Threads are ended
-- by closing, not erased. (No resident delete UI exists today, so this drops an
-- unused grant; re-add the policy if you ever want a true "withdraw".)
drop policy if exists "residents delete own requests" on public.resident_requests;
