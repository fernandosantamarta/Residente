-- ============================================================
-- Residente — RLS: gate financial & payment WRITES on custom-role permissions
-- Run AFTER supabase/custom-roles.sql (needs has_permission()). Idempotent.
-- ============================================================
--
-- Replaces each "board writes …" policy IN PLACE (same name, so no old
-- permissive policy is left behind to bypass the check). The coarse
-- profiles.role in ('board_member','admin') check is swapped for
-- has_permission('<area>.manage'), which already accounts for:
--   • platform admins  → full access in the community they've entered
--   • the Admin role    → full access
--   • a board member    → only if their assigned role grants the permission
--
-- READS are intentionally left alone (still community-wide). The resident
-- self-service payment insert ("resident logs own payment") is also untouched,
-- so residents can still pay their own dues. Only board-side writes get gated.
--
-- financials.manage → budget_categories, ev_expenses, ev_financial_filings,
--                     ev_reserve_components
-- payments.manage   → payments (board writes), ev_collection_cases

-- ---------- financials.manage ----------
drop policy if exists "board writes budget categories" on public.budget_categories;
create policy "board writes budget categories"
  on public.budget_categories for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );

drop policy if exists "board writes community expenses" on public.ev_expenses;
create policy "board writes community expenses"
  on public.ev_expenses for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );

drop policy if exists "board writes financial filings" on public.ev_financial_filings;
create policy "board writes financial filings"
  on public.ev_financial_filings for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );

drop policy if exists "board writes reserve components" on public.ev_reserve_components;
create policy "board writes reserve components"
  on public.ev_reserve_components for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );

-- ---------- payments.manage ----------
-- Board-side payment writes (recording/adjusting dues). Residents keep their
-- own "resident logs own payment" insert policy, which is left in place.
drop policy if exists "board writes payments" on public.payments;
create policy "board writes payments"
  on public.payments for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('payments.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('payments.manage')
  );

drop policy if exists "board writes community collection cases" on public.ev_collection_cases;
create policy "board writes community collection cases"
  on public.ev_collection_cases for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('payments.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('payments.manage')
  );
