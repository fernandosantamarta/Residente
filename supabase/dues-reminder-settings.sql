-- dues-reminder-settings.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Per-community config for the automatic dues-reminder cron (app/api/cron/
-- dues-reminders). Defaults preserve today's behavior (on, in-app only, remind
-- anyone behind, once per ~month).
--   dues_reminder_enabled       — master opt-in toggle
--   dues_reminder_email         — also send by email (rides the notice fanout,
--                                 same path as the Reports "Notify" button)
--   dues_reminder_min_days      — only remind owners at least this many days past
--                                 due (0 = anyone behind)
--   dues_reminder_cadence_days  — don't re-remind a community within this window
alter table public.communities
  add column if not exists dues_reminder_enabled       boolean not null default true,
  add column if not exists dues_reminder_email         boolean not null default false,
  add column if not exists dues_reminder_min_days      int     not null default 0,
  add column if not exists dues_reminder_cadence_days   int     not null default 25;
