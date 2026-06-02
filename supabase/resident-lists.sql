-- Resident-owned lists: emergency contacts, vehicles, pets. Persisted to the DB
-- so they reach the board and sync across devices, instead of dying in the
-- browser's localStorage. RLS: a resident has full access to their own rows; the
-- board reads its community's rows (for the roster / emergency view).
--
-- Safe to re-run.

create table if not exists public.resident_emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  name         text not null,
  relation     text,
  phone        text,
  created_at   timestamptz not null default now()
);

create table if not exists public.resident_vehicles (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  make         text,
  model        text,
  plate        text,
  color        text,
  created_at   timestamptz not null default now()
);

create table if not exists public.resident_pets (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  name         text not null,
  species      text,
  breed        text,
  created_at   timestamptz not null default now()
);

-- RLS + grants + policies. Same shape for all three: owner full access to own
-- rows; board (board_member/admin in the same community) reads.
do $$
declare t text;
begin
  foreach t in array array[
    'resident_emergency_contacts','resident_vehicles','resident_pets'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant select on public.%I to service_role;', t);
    execute format('create index if not exists %I on public.%I (profile_id);', t||'_profile_idx', t);
    execute format('create index if not exists %I on public.%I (community_id);', t||'_community_idx', t);

    execute format('drop policy if exists "owner all own rows" on public.%I;', t);
    execute format($f$create policy "owner all own rows" on public.%I
        for all to authenticated
        using (profile_id = auth.uid())
        with check (profile_id = auth.uid());$f$, t);

    execute format('drop policy if exists "board reads community rows" on public.%I;', t);
    execute format($f$create policy "board reads community rows" on public.%I
        for select to authenticated
        using (
          community_id = (select community_id from public.profiles where id = auth.uid())
          and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
        );$f$, t);
  end loop;
end $$;
