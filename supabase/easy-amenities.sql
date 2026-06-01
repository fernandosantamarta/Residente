-- ============================================================
-- Residente — Easy Schedule · Amenities (catalog + reservations)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Adds the Amenities tab to /app/schedule. The board defines the
-- community's bookable amenities (pool, clubhouse, gym, courts, ...);
-- residents reserve a date/time slot and see their bookings under
-- "My Reservations". Free to book in v1, but ev_amenities.price_cents
-- is here from day one so a Stripe checkout can bolt on later with no
-- migration (see [[feedback_stripe_first_for_money_flows]]).

-- ---------- catalog: the amenities a community offers ----------
create table if not exists public.ev_amenities (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  name          text not null,
  kind          text not null default 'other',   -- pool|clubhouse|gym|court|marina|other
  description   text,
  location      text,
  capacity      int,                              -- max party size per reservation
  hours         text,                             -- free-text, e.g. "Mon–Fri 6am–10pm"
  rules         text[] not null default '{}',     -- bullet list shown in the detail popup
  image_url     text,
  price_cents   int not null default 0,           -- 0 = free; fee-ready for Stripe later
  bookable      boolean not null default true,    -- false = display-only (info card, no Reserve)
  slot_minutes  int not null default 60,          -- default reservation block length
  sort          int not null default 0,           -- board-controlled display order
  active        boolean not null default true,    -- soft-delete / hide without losing history
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ev_amenities_community_idx
  on public.ev_amenities (community_id, sort, name);

alter table public.ev_amenities enable row level security;
grant select, insert, update, delete on public.ev_amenities to authenticated;
grant select, insert, update, delete on public.ev_amenities to service_role;

-- Every member of the community sees their community's amenities.
drop policy if exists "community reads amenities" on public.ev_amenities;
create policy "community reads amenities"
  on public.ev_amenities for select to authenticated
  using ( community_id = (select community_id from public.profiles where id = auth.uid()) );

-- Only the board/admin defines or edits amenities, in their own community.
drop policy if exists "board inserts amenities" on public.ev_amenities;
create policy "board inserts amenities"
  on public.ev_amenities for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board updates amenities" on public.ev_amenities;
create policy "board updates amenities"
  on public.ev_amenities for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board deletes amenities" on public.ev_amenities;
create policy "board deletes amenities"
  on public.ev_amenities for delete to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- reservations: a resident booking a slot ----------
create table if not exists public.ev_amenity_reservations (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references public.communities(id) on delete cascade,
  amenity_id     uuid not null references public.ev_amenities(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  reserved_date  date not null,
  start_time     text not null,                   -- "18:00" (24h, stored as text like ev_schedule_events.time)
  end_time       text,
  party_size     int not null default 1,
  status         text not null default 'confirmed', -- confirmed|cancelled
  note           text,
  price_cents    int not null default 0,          -- snapshot of the amenity price at booking time
  created_at     timestamptz not null default now()
);

create index if not exists ev_amenity_res_amenity_date_idx
  on public.ev_amenity_reservations (amenity_id, reserved_date);
create index if not exists ev_amenity_res_profile_idx
  on public.ev_amenity_reservations (profile_id, reserved_date);

-- No two active reservations on the same amenity / date / start slot.
-- A cancelled reservation frees the slot back up.
create unique index if not exists ev_amenity_res_slot_unique
  on public.ev_amenity_reservations (amenity_id, reserved_date, start_time)
  where status <> 'cancelled';

alter table public.ev_amenity_reservations enable row level security;
grant select, insert, update, delete on public.ev_amenity_reservations to authenticated;
grant select, insert, update, delete on public.ev_amenity_reservations to service_role;

-- A resident sees their OWN reservations; the board sees every reservation
-- in their community (oversight + the calendar tab can surface them).
-- Owner check is in the policy (not just code) because residents' broad
-- community SELECT would otherwise leak neighbours' bookings — see
-- [[project_residente_rls_payment_idor]].
drop policy if exists "owner or board reads reservations" on public.ev_amenity_reservations;
create policy "owner or board reads reservations"
  on public.ev_amenity_reservations for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      profile_id = auth.uid()
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );

-- A resident books only for themselves, in their own community.
drop policy if exists "resident inserts own reservation" on public.ev_amenity_reservations;
create policy "resident inserts own reservation"
  on public.ev_amenity_reservations for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and profile_id = auth.uid()
  );

-- The board can book on a resident's behalf (phone request, front desk).
-- Distinct from the resident self-insert above: here profile_id is some OTHER
-- community member, allowed only because the caller is board.
drop policy if exists "board books for residents" on public.ev_amenity_reservations;
create policy "board books for residents"
  on public.ev_amenity_reservations for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    and profile_id in (
      select id from public.profiles
      where community_id = (select community_id from public.profiles where id = auth.uid())
    )
  );

-- A resident cancels/edits their own reservation; the board can manage any
-- reservation in their community.
drop policy if exists "owner or board updates reservation" on public.ev_amenity_reservations;
create policy "owner or board updates reservation"
  on public.ev_amenity_reservations for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      profile_id = auth.uid()
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );

drop policy if exists "owner or board deletes reservation" on public.ev_amenity_reservations;
create policy "owner or board deletes reservation"
  on public.ev_amenity_reservations for delete to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      profile_id = auth.uid()
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );

-- ---------- INTERCONNECT: new reservation -> board bell notice ----------
-- When a reservation is created, alert the BOARD (not the whole community).
-- The notice is inserted with empty channels so the generic ev_notice_fanout
-- (one recipient per community member) skips it; then we add in_app recipient
-- rows for board/admin only, minus whoever made the booking. Mirrors the
-- schedule notify trigger, but board-scoped.
alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked'));

create or replace function public.ev_amenity_booking_notice()
returns trigger language plpgsql security definer as $$
declare
  nid uuid;
  amenity_name text;
  resident_name text;
begin
  if new.status <> 'confirmed' then return new; end if;

  select name into amenity_name from public.ev_amenities where id = new.amenity_id;
  select coalesce(full_name, 'A resident') into resident_name
    from public.profiles where id = new.profile_id;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    new.community_id,
    'amenity_booked',
    array[]::text[],                      -- empty → generic fanout skips it
    'New reservation: ' || coalesce(amenity_name, 'amenity'),
    resident_name || ' reserved ' || coalesce(amenity_name, 'an amenity')
      || ' · ' || to_char(new.reserved_date, 'Mon FMDD')
      || coalesce(' at ' || new.start_time, ''),
    null
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  select nid, new.community_id, p.id, 'in_app'
    from public.profiles p
   where p.community_id = new.community_id
     and p.role in ('board_member','admin')
     and p.id is distinct from auth.uid()  -- don't ping whoever booked it
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists ev_amenity_booking_notice_trg on public.ev_amenity_reservations;
create trigger ev_amenity_booking_notice_trg
  after insert on public.ev_amenity_reservations
  for each row execute function public.ev_amenity_booking_notice();

-- ---------- OPTIONAL seed: a starter set of amenities ----------
-- Uncomment and set :community to a real communities.id to give a community
-- a default amenity catalog. The resident UI also ships a demo catalog in
-- code (lib/amenities.ts) so the tab renders before any rows exist.
--
-- insert into public.ev_amenities (community_id, name, kind, description, location, capacity, hours, rules, price_cents)
-- values
--   ('00000000-0000-0000-0000-000000000000', 'Clubhouse',     'clubhouse', 'Event space with kitchen and lounge.',      'Main building',     40, 'Daily 8am–10pm',  array['Reserve at least 48 hours ahead','Clean up after your event','No glassware near the pool'], 0),
--   ('00000000-0000-0000-0000-000000000000', 'Resort Pool',   'pool',      'Heated pool and sun deck.',                  'Center courtyard',  30, 'Daily 6am–9pm',   array['Children under 14 with an adult','No glass containers','Shower before entering'], 0),
--   ('00000000-0000-0000-0000-000000000000', 'Fitness Center','gym',       '24/7 gym with cardio and free weights.',     'East wing',          8, 'Open 24 hours',   array['Wipe down equipment','Re-rack your weights','Members only'], 0),
--   ('00000000-0000-0000-0000-000000000000', 'Tennis Courts', 'court',     'Two lit hard courts.',                       'North lot',          4, 'Daily 7am–10pm',  array['90-minute limit when others wait','Non-marking shoes only'], 0);
