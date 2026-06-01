-- Resident notification preferences — persisted to the DB so the server can
-- honor them. Until now these toggles lived only in the browser's localStorage,
-- which the email fan-out (running server-side) could never read.
--
-- The Settings page upserts here; ev_notice_fanout() reads email_pref to skip
-- queuing email for residents who opted out. in_app is always delivered; sms /
-- push channels aren't wired yet, so those prefs are stored but not yet gated.
--
-- Safe to re-run.

create table if not exists public.resident_preferences (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  email_pref        text not null default 'all'       check (email_pref in ('all','important','none')),
  sms_pref          text not null default 'emergency' check (sms_pref in ('all','emergency','none')),
  push_pref         text not null default 'all'       check (push_pref in ('all','important','none')),
  quiet_hours_start text not null default '22:00',
  quiet_hours_end   text not null default '07:00',
  updated_at        timestamptz not null default now()
);

alter table public.resident_preferences enable row level security;
-- Residents read/write their own row. The fan-out trigger runs security definer
-- (table owner), so it bypasses RLS; service_role select is granted for any
-- future server reads.
grant select, insert, update on public.resident_preferences to authenticated;
grant select on public.resident_preferences to service_role;

drop policy if exists "owner reads own prefs" on public.resident_preferences;
create policy "owner reads own prefs"
  on public.resident_preferences for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "owner inserts own prefs" on public.resident_preferences;
create policy "owner inserts own prefs"
  on public.resident_preferences for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "owner updates own prefs" on public.resident_preferences;
create policy "owner updates own prefs"
  on public.resident_preferences for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------- Gate email fan-out on the resident's email preference ----------
-- Redefines ev_notice_fanout() (originally in easy-voice.sql) so the email
-- branch skips residents whose email_pref = 'none'. Residents with no prefs
-- row default to 'all' (receive). in_app branch is unchanged.
create or replace function public.ev_notice_fanout()
returns trigger language plpgsql security definer as $$
declare in_app_inserted int := 0;
        email_inserted  int := 0;
begin
  if 'in_app' = any (new.channels) then
    insert into public.ev_notice_recipients
      (notice_id, community_id, profile_id, channel)
    select new.id, new.community_id, p.id, 'in_app'
      from public.profiles p
     where p.community_id = new.community_id
    on conflict (notice_id, profile_id, channel) do nothing;
    get diagnostics in_app_inserted = row_count;
  end if;

  if 'email' = any (new.channels) then
    -- email_pref gate: 'none' = never; 'important' = only billing / votes /
    -- emergencies (matches the Settings copy); 'all' (or no prefs row) = every
    -- emailed notice. "Important" kinds: dues_due (billing), vote_* (votes),
    -- custom_broadcast (the kind a board uses for an emergency announcement).
    insert into public.ev_notice_recipients
      (notice_id, community_id, profile_id, channel, email_status)
    select new.id, new.community_id, p.id, 'email', 'queued'
      from public.profiles p
      left join public.resident_preferences rp on rp.profile_id = p.id
     where p.community_id = new.community_id
       and p.email is not null
       and case coalesce(rp.email_pref, 'all')
             when 'none'      then false
             when 'important' then new.kind in
               ('dues_due','vote_opened','vote_reminder','vote_results','custom_broadcast')
             else true
           end
    on conflict (notice_id, profile_id, channel) do nothing;
    get diagnostics email_inserted = row_count;
  end if;

  update public.ev_notices
     set recipient_count = greatest(in_app_inserted, email_inserted)
   where id = new.id;
  return new;
end $$;
