-- Web push subscriptions — one row per browser/device a resident has opted into
-- push on. The client (lib/webPush.ts) writes here after the resident enables
-- Browser Notifications in Settings; notice-push-fanout reads them to deliver.
--
-- Push respects the same resident_preferences.push_pref gate as email
-- (all / important / none). Requires supabase/resident-notification-prefs.sql.
-- Safe to re-run.

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
-- Residents manage their own subscriptions. The push fan-out runs as
-- service_role and needs to read every sub + delete expired ones (410/404).
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, delete on public.push_subscriptions to service_role;

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);
create index if not exists push_subscriptions_community_idx
  on public.push_subscriptions (community_id);

drop policy if exists "owner reads own subs" on public.push_subscriptions;
create policy "owner reads own subs"
  on public.push_subscriptions for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "owner inserts own subs" on public.push_subscriptions;
create policy "owner inserts own subs"
  on public.push_subscriptions for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "owner updates own subs" on public.push_subscriptions;
create policy "owner updates own subs"
  on public.push_subscriptions for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists "owner deletes own subs" on public.push_subscriptions;
create policy "owner deletes own subs"
  on public.push_subscriptions for delete to authenticated
  using (profile_id = auth.uid());
