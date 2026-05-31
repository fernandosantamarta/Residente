-- ============================================================
-- Residente — payments: drop community-wide read, board-only instead
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Security review 2026-05-30 (Finding 3): payments had two SELECT policies.
-- RLS OR-combines them, so "members read payments" (community-wide) overrode
-- "resident reads own payments", letting any resident read every household's
-- payment amounts + Stripe session/intent ids in their community.
--
-- Fix: drop the community-wide read; residents keep the own-row policy
-- ("resident reads own payments"), and the board gets an explicit read scoped
-- to its own community + role — matching residents / ev_violations / ev_consents.

DROP POLICY IF EXISTS "members read payments" ON public.payments;

DROP POLICY IF EXISTS "board reads community payments" ON public.payments;
CREATE POLICY "board reads community payments" ON public.payments
  FOR SELECT TO authenticated
  USING (
    community_id = (SELECT community_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) = ANY (ARRAY['board_member', 'admin'])
  );
