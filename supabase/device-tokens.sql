-- Native APNs device tokens — one row per iOS device a resident has opted into
-- push on. The native shell (lib/nativePush.ts, running inside the Capacitor
-- WebView) writes here after iOS grants notification permission; the
-- apns-push-fanout edge function reads them to deliver.
--
-- This is the native-app twin of push_subscriptions (web push). Same owner
-- RLS, same resident_preferences.push_pref gate, same fan-out trigger source
-- (ev_notices INSERT). Requires supabase/resident-notification-prefs.sql.
-- Safe to re-run.

create table if not exists public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  token        text not null unique,            -- APNs device token (hex)
  platform     text not null default 'ios' check (platform in ('ios','android')),
  app_version  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.device_tokens enable row level security;
-- Residents manage their own device tokens. The push fan-out runs as
-- service_role and needs to read every token + delete the dead ones
-- (APNs 410 Unregistered / 400 BadDeviceToken).
grant select, insert, update, delete on public.device_tokens to authenticated;
grant select, delete on public.device_tokens to service_role;

create index if not exists device_tokens_profile_idx
  on public.device_tokens (profile_id);
create index if not exists device_tokens_community_idx
  on public.device_tokens (community_id);

drop policy if exists "owner reads own tokens" on public.device_tokens;
create policy "owner reads own tokens"
  on public.device_tokens for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "owner inserts own tokens" on public.device_tokens;
create policy "owner inserts own tokens"
  on public.device_tokens for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "owner updates own tokens" on public.device_tokens;
create policy "owner updates own tokens"
  on public.device_tokens for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists "owner deletes own tokens" on public.device_tokens;
create policy "owner deletes own tokens"
  on public.device_tokens for delete to authenticated
  using (profile_id = auth.uid());
