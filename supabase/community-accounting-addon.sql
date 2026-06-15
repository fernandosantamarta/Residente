-- ============================================================
-- Residente — Accounting add-on entitlement (cached on the community row)
-- Run once in the Supabase SQL editor. Idempotent; safe to re-run.
-- ============================================================
-- The paid "Accounting" add-on lives as a Stripe subscription item
-- (metadata.addon='accounting'); there's no cheap way to gate a page load on
-- that. So manage-subscription mirrors it onto this cached boolean whenever the
-- plan changes or billing is viewed, and the app reads it to unlock the
-- /admin/accounting workspace per community (see lib/accounting.ts +
-- hooks/useAccountingAccess.ts). Members may read it; only the service role
-- (manage-subscription) writes it.
alter table public.communities
  add column if not exists accounting_addon boolean not null default false;
