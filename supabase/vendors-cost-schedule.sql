-- Vendors: track what the community pays each vendor and when they come.
-- Idempotent — safe to run more than once. Run in the Supabase SQL editor.
alter table public.vendors
  add column if not exists cost     numeric(12,2),   -- monthly cost the community pays
  add column if not exists schedule text;            -- when they come, e.g. "Mondays 8–10am"
