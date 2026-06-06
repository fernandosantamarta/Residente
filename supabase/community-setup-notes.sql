-- ============================================================
-- Residente — community setup notes (signup document wizard)
-- Run once in the Supabase SQL editor (SQL editor → new query → paste → run).
-- Safe to re-run: table uses IF NOT EXISTS, policies are dropped first.
-- ============================================================
--
-- Free-text notes the board/management types per category in the /signup
-- document-collection wizard ("missing items, context, or questions"). Stored
-- one row per non-empty section so a later AI step can read them by community
-- and pre-fill settings / flag missing docs / seed compliance signals — that
-- extraction is a follow-up slice and runs via service-role, so RLS here only
-- needs to gate the human board UI.
--
-- `processed_at` is reserved for that future extraction pass: NULL = not yet
-- consumed, stamped once an edge function has read the note. Nothing writes it
-- today.

create table if not exists public.community_setup_notes (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  section      text not null,
  note         text not null,
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists community_setup_notes_community_idx
  on public.community_setup_notes (community_id);

alter table public.community_setup_notes enable row level security;
grant select, insert, update, delete on public.community_setup_notes to authenticated;

-- Board-only, both directions: these are internal onboarding notes, not resident
-- content. Same membership + role gate as "board writes documents".
drop policy if exists "board reads setup notes" on public.community_setup_notes;
create policy "board reads setup notes"
  on public.community_setup_notes for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board writes setup notes" on public.community_setup_notes;
create policy "board writes setup notes"
  on public.community_setup_notes for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
