-- ============================================================
-- Residente — Committees (Easy Voice → Board)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- The board manages committees at /admin/board; residents see them in the
-- Easy Voice → Board section. Community-scoped, board writes / members read.

create table if not exists public.committees (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name         text not null,
  chair        text,                                   -- chair name (free text)
  member_count int  not null default 0,
  member_ids   uuid[] not null default '{}',            -- residents assigned to the committee
  icon         text not null default 'home'
                 check (icon in ('finance','leaf','home','shield','megaphone')),
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);

-- Additive for communities created before member assignment existed.
alter table public.committees add column if not exists member_ids uuid[] not null default '{}';

create index if not exists committees_community_idx on public.committees (community_id, sort_order);

alter table public.committees enable row level security;
grant select, insert, update, delete on public.committees to authenticated;
grant select, insert, update, delete on public.committees to service_role;

drop policy if exists "members read committees" on public.committees;
create policy "members read committees"
  on public.committees for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

drop policy if exists "board writes committees" on public.committees;
create policy "board writes committees"
  on public.committees for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
