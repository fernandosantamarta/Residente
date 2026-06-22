-- signup-verification.sql — run once in the Supabase SQL editor. Idempotent.
--
-- Self-serve resident verification. At signup a resident gives name, address,
-- email, password. The system auto-verifies against the board's roster:
--   email match (normalized) OR address match (normalized) -> instant ACCEPT
--   neither -> PENDING (board contacts them / can "Approve anyway").
--
-- Address matching needs real normalization so "SW" == "Southwest", "St" ==
-- "Street", "Apt" == "Unit #", etc. — handled by address_synonyms + normalize_address().

-- ---------- ADDRESS SYNONYMS ----------
create table if not exists public.address_synonyms (
  variant   text primary key,
  canonical text not null
);
-- Seed directionals, street types, and unit designators (USPS-style). Extend freely.
insert into public.address_synonyms (variant, canonical) values
  -- directionals
  ('north','n'),('n','n'),('south','s'),('s','s'),('east','e'),('e','e'),('west','w'),('w','w'),
  ('northeast','ne'),('ne','ne'),('northwest','nw'),('nw','nw'),
  ('southeast','se'),('se','se'),('southwest','sw'),('sw','sw'),
  -- street types
  ('street','st'),('st','st'),('avenue','ave'),('ave','ave'),('av','ave'),
  ('boulevard','blvd'),('blvd','blvd'),('drive','dr'),('dr','dr'),('road','rd'),('rd','rd'),
  ('lane','ln'),('ln','ln'),('court','ct'),('ct','ct'),('place','pl'),('pl','pl'),
  ('terrace','ter'),('ter','ter'),('circle','cir'),('cir','cir'),('way','way'),
  ('parkway','pkwy'),('pkwy','pkwy'),('highway','hwy'),('hwy','hwy'),
  ('trail','trl'),('trl','trl'),('square','sq'),('sq','sq'),('loop','loop'),
  -- unit designators (all collapse to "unit")
  ('apartment','unit'),('apt','unit'),('unit','unit'),('suite','unit'),('ste','unit'),
  ('number','unit'),('no','unit'),('bldg','bldg'),('building','bldg')
on conflict (variant) do update set canonical = excluded.canonical;

-- ---------- NORMALIZERS ----------
-- Canonical address key: lowercase, drop punctuation, map every word through the
-- synonym table, rejoin in order. "123 SW 4th St Apt 4B" and "123 Southwest 4th
-- Street #4-B" both reduce to "123 sw 4 st unit 4b". STABLE (reads a table), so
-- it's used for matching in queries — not in a generated column/index.
create or replace function public.normalize_address(a text)
returns text language sql stable as $$
  select nullif(
    string_agg(coalesce(s.canonical, t.word), ' ' order by t.ord),
  '')
  from unnest(
         regexp_split_to_array(
           regexp_replace(lower(coalesce(a, '')), '[^a-z0-9]+', ' ', 'g'),
           '\s+')
       ) with ordinality as t(word, ord)
  left join public.address_synonyms s on s.variant = t.word
  where t.word <> ''
$$;

-- Normalized email: lower + trim (matching key for the roster lookup).
create or replace function public.normalize_email(e text)
returns text language sql immutable as $$
  select nullif(lower(trim(coalesce(e, ''))), '')
$$;

-- ---------- RESIDENTS: APPROVAL STATE ----------
-- Existing rows default to 'active' (already-accepted residents). New self-serve
-- signups that don't match the roster land 'pending'. verified_via records HOW
-- they cleared (email / address / board-override) for audit + revoke.
alter table public.residents
  add column if not exists approval_state text not null default 'active',
  add column if not exists verified_via text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'residents_approval_state_chk'
  ) then
    alter table public.residents
      add constraint residents_approval_state_chk
      check (approval_state in ('active','pending','rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'residents_verified_via_chk'
  ) then
    alter table public.residents
      add constraint residents_verified_via_chk
      check (verified_via is null or verified_via in ('email','address','board'));
  end if;
end $$;

-- Fast lookup of a community's pending queue.
create index if not exists residents_pending_idx
  on public.residents (community_id) where approval_state = 'pending';

-- ---------- BOARD RLS: read + update the pending queue ----------
-- The board manages residents in their own community (Approve anyway / Reject /
-- Contact). Add policies only if an equivalent isn't already present.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'residents'
       and policyname = 'board manages residents'
  ) then
    execute $p$
      create policy "board manages residents"
        on public.residents for all to authenticated
        using (
          community_id = (select community_id from public.profiles where id = auth.uid())
          and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
        )
        with check (
          community_id = (select community_id from public.profiles where id = auth.uid())
          and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
        )
    $p$;
  end if;
end $$;

-- A resident can always read their OWN roster row (so the app can detect a
-- 'pending' approval state and show the waiting screen). Idempotent.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'residents'
       and policyname = 'residents read own row'
  ) then
    execute $p$
      create policy "residents read own row"
        on public.residents for select to authenticated
        using (profile_id = auth.uid())
    $p$;
  end if;
end $$;

-- ---------- ROSTER MATCH (used by signup-provision) ----------
-- Returns the single best unclaimed roster row for a self-serve resident:
-- prefers an email match, falls back to an address match (against either the
-- address or the unit_number column), both normalized. `via` says which matched
-- so the caller can record verified_via. SECURITY DEFINER: the brand-new user
-- has no community yet and RLS would hide the roster, so this runs as owner.
create or replace function public.match_roster_row(
  p_community uuid, p_email text, p_address text
)
returns table (resident_id uuid, via text)
language sql stable security definer set search_path = public as $$
  select id,
         case when public.normalize_email(email) = public.normalize_email(p_email)
              then 'email' else 'address' end as via
    from public.residents
   where community_id = p_community
     and profile_id is null
     and approval_state <> 'rejected'
     and (
       public.normalize_email(email) = public.normalize_email(p_email)
       or (public.normalize_address(p_address) is not null
           and public.normalize_address(address) = public.normalize_address(p_address))
       or (public.normalize_address(p_address) is not null
           and public.normalize_address(unit_number) = public.normalize_address(p_address))
     )
   order by (public.normalize_email(email) = public.normalize_email(p_email)) desc nulls last
   limit 1
$$;
