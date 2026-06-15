-- ============================================================
-- Residente — Bank reconciliation (Phase 3 / Workstream D)
-- Run once in the Supabase SQL editor AFTER supabase/community-plaid.sql
-- and supabase/gl-spine.sql. Idempotent; safe to re-run.
-- ============================================================
-- "Link, don't hold": Plaid imports the HOA's real bank activity into
-- public.bank_transactions; the general-ledger spine (gl-spine.sql) is the
-- regenerable double-entry projection of what the app recorded. Reconciliation
-- proves the two agree: each bank row is matched to the GL journal entry that
-- moved the same cash, so the books are bank-verified — not just self-consistent.
--
-- DECISION (locked, see [[eliminate-back-office-plan]] #2): EXTEND the EXISTING
-- bank_transactions table — do NOT fork a separate plaid_transactions. One Plaid
-- sync feeds BOTH budget-vs-actual (mapped_budget_category_id, already there) AND
-- GL reconciliation (the columns added here). The matcher is lib/gl/reconcile.ts
-- (pure, proven by scripts/verify-reconcile.mjs); the service-role writer is
-- app/api/admin/reconcile; the board confirm path is reconcile_set_status() below.
--
-- POSTURE: auto-match only high-confidence singletons; everything else is an
-- exception a board officer (financials.manage) confirms. Reserve-fund transfers
-- are NEVER auto-matched (Rule 61B-22.005(2) — a transfer that may not have
-- physically happened must not be silently posted). The matcher enforces that.

-- ---------- 1) EXTEND bank_transactions WITH RECONCILIATION STATE ----------
-- matched_entry_id → the GL journal entry this bank row is linked (auto/confirmed)
--   or suggested (exception) against. on delete set null: a GL rebuild keeps entry
--   ids stable (upsert on (community_id, source_key) in gl-writer.sql), so a routine
--   rebuild won't orphan these links; a genuinely removed entry just clears the link.
-- match_status:
--   'unmatched'  — no GL counterpart proposed (initial state, or matcher found none)
--   'auto'       — matcher auto-linked a high-confidence singleton (machine)
--   'confirmed'  — a financials.manage officer confirmed the link (sticky; the
--                  matcher never overwrites it)
--   'exception'  — matcher found candidate(s) but couldn't auto-confirm (ambiguous,
--                  only a tolerance match, reserve fund, or pending) → board reviews
alter table public.bank_transactions
  add column if not exists matched_entry_id uuid
    references public.gl_journal_entries(id) on delete set null;
alter table public.bank_transactions
  add column if not exists match_status text not null default 'unmatched';
alter table public.bank_transactions
  add column if not exists match_confidence numeric;
alter table public.bank_transactions
  add column if not exists matched_at timestamptz;
alter table public.bank_transactions
  add column if not exists matched_by uuid
    references public.profiles(id) on delete set null;

-- Constrain the status set (drop-then-add so the file stays re-runnable).
alter table public.bank_transactions drop constraint if exists bank_tx_match_status_check;
alter table public.bank_transactions
  add constraint bank_tx_match_status_check
  check (match_status in ('unmatched','auto','confirmed','exception'));

create index if not exists bank_tx_match_status_idx
  on public.bank_transactions (community_id, match_status);
create index if not exists bank_tx_matched_entry_idx
  on public.bank_transactions (matched_entry_id);

-- RLS is UNCHANGED. community-plaid.sql already grants members read of their own
-- community's bank feed (bank_tx_read) and grants NO write DML to authenticated —
-- writes happen via the service-role reconcile route (auto-match) and the
-- SECURITY DEFINER reconcile_set_status() below (board confirm). We deliberately
-- add no INSERT/UPDATE/DELETE policy here.

-- ---------- 2) BOARD CONFIRM PATH: reconcile_set_status ----------
-- The one human write path for reconciliation. A financials.manage officer
-- Confirms a suggested match, marks it an Exception, or clears it (unmatched).
-- SECURITY DEFINER + search_path='' (everything schema-qualified) so it can write
-- the RLS-locked table while still enforcing, in-function, that the caller may only
-- touch their OWN community and holds financials.manage (NOT profiles.role — the
-- seeded Treasurer custom role isn't a built-in role; mirrors gl-spine.sql).
--
-- Status set the human may set: 'confirmed' | 'exception' | 'unmatched' (never
-- 'auto' — that is machine-only). Confirming with an entry RELEASES that entry from
-- any other auto/confirmed bank row in the community first, so a GL entry is never
-- matched to two bank transactions (the core reconciliation invariant, enforced at
-- the write boundary as well as in the matcher).
create or replace function public.reconcile_set_status(
  p_bank_tx uuid,
  p_entry   uuid,
  p_status  text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid       uuid;
  tx_cid    uuid;
  entry_cid uuid;
begin
  if not public.has_permission('financials.manage') then
    raise exception 'not allowed';
  end if;
  if p_status not in ('confirmed','exception','unmatched') then
    raise exception 'invalid status % (confirmed|exception|unmatched)', p_status;
  end if;

  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then
    raise exception 'not a member of any community';
  end if;

  -- The bank transaction must belong to the caller's community.
  select community_id into tx_cid from public.bank_transactions where id = p_bank_tx;
  if tx_cid is null or tx_cid <> cid then
    raise exception 'bank transaction is not in your community';
  end if;

  -- If we are linking/suggesting an entry, it must be in the same community.
  if p_entry is not null then
    select community_id into entry_cid from public.gl_journal_entries where id = p_entry;
    if entry_cid is null or entry_cid <> cid then
      raise exception 'GL entry is not in your community';
    end if;
  end if;

  -- Confirming a link is exclusive: release the entry from any OTHER bank row that
  -- currently holds it as an auto/confirmed match, so it can only be matched once.
  if p_status = 'confirmed' and p_entry is not null then
    update public.bank_transactions
       set match_status = 'unmatched', matched_entry_id = null,
           match_confidence = null, matched_at = now(), matched_by = auth.uid()
     where community_id = cid
       and id <> p_bank_tx
       and matched_entry_id = p_entry
       and match_status in ('auto','confirmed');
  end if;

  update public.bank_transactions
     set match_status     = p_status,
         matched_entry_id = case when p_status = 'unmatched' then null else p_entry end,
         match_confidence = case when p_status = 'confirmed' then 1 else match_confidence end,
         matched_at       = now(),
         matched_by       = auth.uid()
   where id = p_bank_tx and community_id = cid;
end $$;

revoke all on function public.reconcile_set_status(uuid, uuid, text) from public, anon;
grant execute on function public.reconcile_set_status(uuid, uuid, text) to authenticated;
