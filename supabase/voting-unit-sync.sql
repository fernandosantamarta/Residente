-- voting-unit-sync.sql — run once in the Supabase SQL editor. Idempotent.
--
-- Fixes a live voting bug. Ballot/attendance/participation casting all key on
-- profiles.unit_number (ev_ballots.unit_number is NOT NULL and the cast RLS
-- compares the ballot's unit to profiles.unit_number), but NOTHING ever populated
-- profiles.unit_number for a resident — it was NULL for 0/4 residents in prod, so
-- a resident who signs up through the app could not cast a ballot at all (the
-- insert fails the NOT NULL, and the RLS check becomes NULL = NULL → reject).
--
-- The roster table (residents.unit_number) is the real source of truth. This:
--   1. adds a canonical unit normalizer,
--   2. syncs residents.unit_number → profiles.unit_number via a trigger,
--   3. backfills existing profiles from their roster row,
--   4. dedups ballots on the NORMALIZED unit so "4B" / "4-B" / "4 B" / "Apt 4B"
--      all count as ONE home → one vote (closes the spelling-divergence gap),
--   5. applies the same ballot dedup to e2e ev_participation if that table is live.
--
-- profiles.unit_number stores the RAW unit (e.g. "4B") so the UI keeps its nicely
-- formatted "Unit 4B" label; normalization is used only for the dedup key.

-- 1. Canonical unit key: lower-case, strip everything but a–z0–9. NULL when empty.
create or replace function public.normalize_unit(u text)
returns text language sql immutable as $$
  select nullif(regexp_replace(lower(trim(coalesce(u, ''))), '[^a-z0-9]+', '', 'g'), '')
$$;

-- 2. Keep profiles.unit_number in lockstep with the resident's roster row. Copies
--    the RAW unit (display value). Definer so it can write profiles regardless of
--    who triggered it (admin editing the roster, a resident self-registering, the
--    service-role provision call, or a home transfer).
create or replace function public.sync_profile_unit()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.profile_id is not null and new.unit_number is not null then
    update public.profiles
       set unit_number = new.unit_number
     where id = new.profile_id
       and coalesce(unit_number, '') <> coalesce(new.unit_number, '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_profile_unit on public.residents;
create trigger trg_sync_profile_unit
  after insert or update of profile_id, unit_number on public.residents
  for each row execute function public.sync_profile_unit();

-- 3. Backfill existing profiles from their linked roster row (only fills the
--    blanks — never clobbers a unit that's already set).
update public.profiles p
   set unit_number = r.unit_number
  from public.residents r
 where r.profile_id = p.id
   and r.unit_number is not null
   and coalesce(p.unit_number, '') = '';

-- 4. Dedup ballots on the normalized unit. Keep raw unit_number for display in
--    tallies; the unique index moves to the normalized value.
alter table public.ev_ballots
  add column if not exists unit_norm text
  generated always as (public.normalize_unit(unit_number)) stored;

alter table public.ev_ballots
  drop constraint if exists ev_ballots_vote_id_unit_number_key;
create unique index if not exists ev_ballots_vote_unit_norm_key
  on public.ev_ballots (vote_id, unit_norm);

-- 5. Same dedup for e2e verifiable-voting participation, if that table exists.
do $$
begin
  if to_regclass('public.ev_participation') is not null then
    alter table public.ev_participation
      add column if not exists unit_norm text
      generated always as (public.normalize_unit(unit_number)) stored;
    alter table public.ev_participation
      drop constraint if exists ev_participation_vote_id_unit_number_key;
    create unique index if not exists ev_participation_vote_unit_norm_key
      on public.ev_participation (vote_id, unit_norm);
  end if;
end $$;
