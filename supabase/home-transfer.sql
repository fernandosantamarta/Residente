-- ============================================================
-- Residente — Home transfer (sell your home to the next buyer)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- When a unit changes hands, the selling owner (or the board) hands the home
-- off to the next buyer: the roster row's profile_id moves to the buyer, the
-- home documents flagged `conveys = true` follow them (DB row + the underlying
-- private storage object), and the buyer gets an invite email. All of that is
-- done with the service role inside the `home-transfer` edge function; this
-- file only adds the audit trail it writes to.
--
-- Depends on: easy-voice.sql (residents, profiles), home-vault.sql (home_documents).

create table if not exists public.home_transfers (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid references public.communities(id) on delete set null,
  resident_id     uuid references public.residents(id)   on delete set null,
  from_profile_id uuid references public.profiles(id)    on delete set null,
  to_email        text not null,
  to_profile_id   uuid references public.profiles(id)    on delete set null,
  docs_conveyed   int  not null default 0,
  initiated_by    uuid references public.profiles(id)    on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.home_transfers enable row level security;
grant select on public.home_transfers to authenticated;
create index if not exists home_transfers_community_idx on public.home_transfers (community_id);
create index if not exists home_transfers_resident_idx  on public.home_transfers (resident_id);

-- Visible to the board (community oversight) and to either party of the
-- transfer (the seller who initiated it or the buyer who received it). Writes
-- happen only via the service-role edge function, so there is no INSERT policy.
drop policy if exists "transfer parties and board read" on public.home_transfers;
create policy "transfer parties and board read"
  on public.home_transfers for select to authenticated
  using (
    from_profile_id = auth.uid()
    or to_profile_id = auth.uid()
    or initiated_by  = auth.uid()
    or (
      community_id = (select community_id from public.profiles where id = auth.uid())
      and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );
