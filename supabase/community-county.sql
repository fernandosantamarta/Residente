-- community-county.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- The Florida county where the association records liens. Drives the "Record with
-- the county clerk" link on a collection case (lib/compliance/fl-recorders.ts).
-- Free text, e.g. "Miami-Dade". Nullable — the link falls back to a county-scoped
-- search until it's set.
alter table public.communities
  add column if not exists county text;
