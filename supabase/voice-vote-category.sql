-- Easy Voice — vote category.
-- User-facing bucket a proposal is filed under, used to group votes on the
-- resident Proposals & Rules tab. Separate from the FL-statutory `type`.
-- Run in the Supabase SQL editor.

alter table public.ev_votes
  add column if not exists category text
  check (category in ('rules', 'expenses', 'events', 'other') or category is null);
