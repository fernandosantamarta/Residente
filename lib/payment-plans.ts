// Payment plans — resident-requested installment plans on a collection case.
//   - app/app/track/_sections/PaySection.tsx — resident requests + pays installments
//   - app/admin/collections/[id]/page.tsx — board approves / modifies / denies
// The plan row IS the request (mirrors ARC). A resident proposes terms
// (request_status='requested'); the board reviews. Backed by ev_payment_plans
// with the request/review columns from payment-plan-requests.sql. RLS lets a
// resident insert a request on their OWN open case and read their own plans.

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import {
  isOpenStage,
  type CollectionCaseRow,
  type PaymentPlanRow,
} from '@/lib/compliance/collections'

export type { PaymentPlanRow } from '@/lib/compliance/collections'

const PLAN_SELECT =
  'id, community_id, case_id, status, start_date, installment_amount, installment_count, frequency_days, next_due_at, paid_count, requested_by_owner, request_status, requested_amount, requested_count, requested_frequency_days, decision_reason, decided_at, profile_id, autopay_opt_in, created_at'

const today = () => new Date().toISOString().slice(0, 10)

// Is this plan still "live" for the resident view (pending review or active)?
export function isLivePlan(p: PaymentPlanRow): boolean {
  const rs = p.request_status ?? 'approved'
  if (rs === 'withdrawn' || rs === 'denied') return false
  return String(p.status ?? 'active') === 'active'
}

export type RequestPlanInput = {
  caseId: string
  amount: number
  count: number
  frequencyDays: number
  autopayOptIn: boolean
}

// The signed-in resident's open collection case + current plan (if any), with
// the actions to request/withdraw a plan and pay an installment. Realtime so a
// board decision shows up immediately.
export function useMyPaymentPlan() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const myId = profile?.id
  const [openCase, setOpenCase] = useState<CollectionCaseRow | null>(null)
  const [plan, setPlan] = useState<PaymentPlanRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !myId || !communityId) { setLoading(false); return }
    try {
      const [caseRes, planRes] = await Promise.all([
        supabase.from('ev_collection_cases').select('*')
          .eq('profile_id', myId).order('opened_at', { ascending: false }),
        // RLS returns only the caller's own plans (via the case owner check).
        supabase.from('ev_payment_plans').select(PLAN_SELECT)
          .eq('community_id', communityId).order('created_at', { ascending: false }),
      ])
      const cases = (caseRes.data as CollectionCaseRow[]) || []
      const oc = cases.find(c => isOpenStage(c.stage)) || null
      setOpenCase(oc)
      const plans = (planRes.data as PaymentPlanRow[]) || []
      // Prefer a live plan on the open case; else surface the most recent
      // decision (e.g. a denial) so the resident sees the outcome.
      const live = plans.find(p => (!oc || p.case_id === oc.id) && isLivePlan(p))
      const recent = plans.find(p => !oc || p.case_id === oc.id) || null
      setPlan(live || recent)
    } catch { /* leave nulls */ } finally {
      setLoading(false)
    }
  }, [myId, communityId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const channel = supabase
      .channel(`myplan:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_payment_plans',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase!.removeChannel(channel) }
  }, [communityId, channelId, load])

  // Propose a plan on the open case. The working terms mirror the proposal so
  // the board can approve in one click; requested_* preserves the original ask.
  const requestPlan = useCallback(async (input: RequestPlanInput): Promise<string | null> => {
    if (!hasSupabase || !supabase || !myId || !communityId) return 'Not signed in.'
    const { error } = await supabase.from('ev_payment_plans').insert({
      community_id: communityId,
      case_id: input.caseId,
      profile_id: myId,
      requested_by_owner: true,
      request_status: 'requested',
      status: 'active',
      start_date: today(),
      installment_amount: input.amount,
      installment_count: input.count,
      frequency_days: input.frequencyDays,
      requested_amount: input.amount,
      requested_count: input.count,
      requested_frequency_days: input.frequencyDays,
      autopay_opt_in: input.autopayOptIn,
    })
    if (error) return error.message || 'Could not submit the request.'
    await load()
    return null
  }, [myId, communityId, load])

  const withdrawPlan = useCallback(async (id: string): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not configured.'
    const { error } = await supabase.from('ev_payment_plans')
      .update({ request_status: 'withdrawn', status: 'cancelled' })
      .eq('id', id)
    if (error) return error.message || 'Could not withdraw the request.'
    await load()
    return null
  }, [load])

  return { openCase, plan, loading, reload: load, requestPlan, withdrawPlan }
}

// Resident pays one plan installment. Starts a Stripe Checkout session via
// create-checkout (tagged with plan_id/installment_no) and redirects. On return
// the stripe-webhook records the payment and advances the plan. Mirrors payFine.
// Returns an error message on failure, or null on a successful redirect.
export async function payInstallment(
  residentId: string,
  planId: string,
  installmentNo: number,
  amount: number,
): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Payments are not configured.'
  try {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: {
        resident_id: residentId,
        amount,
        plan_id: planId,
        installment_no: installmentNo,
        charge_type: 'assessment',
      },
    })
    if (error) return error.message || 'Could not start checkout.'
    const url = (data as { url?: string })?.url
    if (!url) return 'Could not start checkout.'
    window.location.href = url
    return null
  } catch (err) {
    return (err as Error)?.message || 'Could not start checkout.'
  }
}
