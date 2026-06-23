-- residents-reorg.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Part of the Easy Track / Reports reorg (2026-06-23): Residents becomes
-- people-only, all dues/payments move to Reports, and the board can send a
-- payment reminder to ONE owner (not a community broadcast).
--
-- Safe to re-run: every statement is guarded (add column if not exists / drop +
-- re-add constraint / create or replace function).

-- ============================================================================
-- TARGETED NOTICES — aim a notice at a single owner (payment reminders).
-- The existing fan-out trigger materialises one ev_notice_recipients row per
-- profile in the community (a broadcast). We add an optional target so a
-- reminder reaches exactly one owner; the email + push webhooks already read
-- the materialised in_app rows, so they automatically deliver to just that one.
-- ============================================================================

alter table public.ev_notices
  add column if not exists target_profile_id uuid
    references public.profiles(id) on delete cascade;

-- NOTE: the notice "kind" is NOT touched here. The Notify-to-pay button reuses
-- the existing 'dues_due' kind (already permitted by the live kind CHECK and
-- already labelled "Dues due" + deep-linked to the pay screen), so no constraint
-- change is needed — and re-narrowing it would reject rows using kinds added by
-- later migrations (dues_due / amenity_booked / compliance_alert / …).

-- Fan-out: when target_profile_id is set, materialise ONE recipient row for that
-- owner; otherwise broadcast to the whole community exactly as before.
create or replace function public.ev_notice_fanout()
returns trigger language plpgsql security definer as $$
declare inserted int;
begin
  if 'in_app' = any (new.channels) then
    if new.target_profile_id is not null then
      insert into public.ev_notice_recipients
        (notice_id, community_id, profile_id, channel)
      select new.id, new.community_id, new.target_profile_id, 'in_app'
       where exists (
         select 1 from public.profiles p
          where p.id = new.target_profile_id
            and p.community_id = new.community_id)
      on conflict (notice_id, profile_id, channel) do nothing;
    else
      insert into public.ev_notice_recipients
        (notice_id, community_id, profile_id, channel)
      select new.id, new.community_id, p.id, 'in_app'
        from public.profiles p
       where p.community_id = new.community_id
      on conflict (notice_id, profile_id, channel) do nothing;
    end if;
    get diagnostics inserted = row_count;
    update public.ev_notices set recipient_count = inserted where id = new.id;
  end if;
  return new;
end $$;
