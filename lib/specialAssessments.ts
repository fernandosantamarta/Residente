// Special assessments — board-levied one-off / installment charges on every
// affected unit, backed by ev_special_assessments (the campaign) +
// ev_special_assessment_charges (one row per unit per installment).
//   - app/admin/assessments — the board levies + tracks (community)
//   - app/app/track (Pay)    — a resident sees + pays their OWN charges
// Each charge settles on its own row when paid (stripe-webhook), NEVER in
// public.payments, so it can't move the formula-based dues balance.

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

export type SaStatus = 'draft' | 'active' | 'cancelled' | 'completed'
export type SaChargeStatus = 'pending' | 'paid' | 'waived' | 'reversed'

export interface SpecialAssessment {
  id: string
  community_id: string
  title: string
  description: string | null
  per_unit_amount: number
  installments: number
  effective_date: string | null
  status: SaStatus
  authorized_vote_id: string | null
  authorized_note: string | null
  created_at: string
}

export interface SaCharge {
  id: string
  community_id: string
  assessment_id: string
  resident_id: string
  installment_no: number
  amount: number
  due_date: string | null
  status: SaChargeStatus
  paid_at: string | null
  // joined from the campaign for display
  title?: string
  description?: string | null
}

// ---------- resident: my open special-assessment charges ----------
export function useMySpecialAssessments(): { charges: SaCharge[]; loading: boolean; reload: () => void } {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [charges, setCharges] = useState<SaCharge[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    try {
      // RLS scopes rows to the caller's own resident row; we just ask for pending.
      const { data, error } = await supabase
        .from('ev_special_assessment_charges')
        .select('id, community_id, assessment_id, resident_id, installment_no, amount, due_date, status, paid_at, ev_special_assessments(title, description, status)')
        .eq('status', 'pending')
        .order('due_date', { ascending: true })
      if (error) throw error
      setCharges((data || [])
        // Only surface charges from an active (levied) campaign.
        .filter((r: any) => (r.ev_special_assessments?.status ?? 'active') === 'active')
        .map((r: any): SaCharge => ({
          id: r.id, community_id: r.community_id, assessment_id: r.assessment_id,
          resident_id: r.resident_id, installment_no: r.installment_no, amount: Number(r.amount) || 0,
          due_date: r.due_date ?? null, status: r.status, paid_at: r.paid_at ?? null,
          title: r.ev_special_assessments?.title, description: r.ev_special_assessments?.description ?? null,
        })))
    } catch { /* table not provisioned yet — show nothing */ setCharges([]) }
    finally { setLoading(false) }
  }, [communityId])

  useEffect(() => { load() }, [load])
  return { charges, loading, reload: load }
}

// Resident pays one of their special-assessment charges via Stripe Checkout.
// On return the stripe-webhook flips the charge to 'paid'. Mirrors payFine.
export async function paySpecialAssessment(chargeId: string): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Payments are not configured.'
  try {
    const { data, error } = await supabase.functions.invoke('create-special-assessment-checkout', {
      body: { charge_id: chargeId },
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

// ---------- board: levy + track ----------
// Months between two dates for installment due-date spreading.
function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export interface NewAssessment {
  title: string
  description?: string | null
  per_unit_amount: number
  installments?: number
  effective_date?: string | null
  authorized_note?: string | null
}

export function useSpecialAssessmentsAdmin() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const myId = profile?.id
  const [assessments, setAssessments] = useState<SpecialAssessment[]>([])
  const [charges, setCharges] = useState<SaCharge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const [aR, cR] = await Promise.all([
        supabase.from('ev_special_assessments').select('*').eq('community_id', communityId).order('created_at', { ascending: false }),
        supabase.from('ev_special_assessment_charges').select('*').eq('community_id', communityId),
      ])
      if (aR.error) throw aR.error
      setAssessments((aR.data || []) as SpecialAssessment[])
      setCharges((cR.data || []) as SaCharge[])
    } catch (e: any) {
      setError(e?.message || 'Could not load special assessments (run supabase/special-assessments.sql?)')
    } finally { setLoading(false) }
  }, [communityId])

  useEffect(() => { load() }, [load])

  // Create a draft campaign.
  const createDraft = useCallback(async (a: NewAssessment): Promise<string | null> => {
    if (!communityId) return null
    const { data, error } = await supabase!
      .from('ev_special_assessments')
      .insert({
        community_id: communityId,
        title: a.title.trim(),
        description: a.description?.trim() || null,
        per_unit_amount: a.per_unit_amount,
        installments: Math.max(1, Math.min(60, a.installments || 1)),
        effective_date: a.effective_date || null,
        authorized_note: a.authorized_note?.trim() || null,
        status: 'draft',
        created_by: myId ?? null,
      })
      .select('id').single()
    if (error) throw error
    await load()
    return (data as any)?.id ?? null
  }, [communityId, myId, load])

  // Levy a draft: create one pending charge per active resident per installment,
  // then flip the campaign to 'active'. Requires an authorization note (the board
  // confirms the assessment was properly noticed/voted).
  const levy = useCallback(async (assessmentId: string): Promise<string | null> => {
    if (!communityId) return 'No community'
    const a = assessments.find(x => x.id === assessmentId)
    if (!a) return 'Assessment not found'
    if (!a.authorized_note) return 'Record the board authorization (meeting/vote) before levying.'
    if (a.status !== 'draft') return 'Only a draft can be levied'

    // Active residents = roster rows for this community (one charge per unit).
    const { data: residents, error: rErr } = await supabase!
      .from('residents').select('id').eq('community_id', communityId)
    if (rErr) return rErr.message
    const list = residents || []
    if (list.length === 0) return 'No residents on the roster to assess.'

    const n = Math.max(1, Math.min(60, a.installments || 1))
    const per = Math.round((Number(a.per_unit_amount) / n) * 100) / 100
    const rows: any[] = []
    for (const r of list) {
      for (let i = 1; i <= n; i++) {
        rows.push({
          community_id: communityId,
          assessment_id: a.id,
          resident_id: (r as any).id,
          installment_no: i,
          amount: per,
          due_date: a.effective_date ? addMonths(a.effective_date, i - 1) : null,
        })
      }
    }
    // Idempotent on (assessment, resident, installment) — re-levy is a no-op.
    const { error: cErr } = await supabase!
      .from('ev_special_assessment_charges')
      .upsert(rows, { onConflict: 'assessment_id,resident_id,installment_no', ignoreDuplicates: true })
    if (cErr) return cErr.message
    const { error: uErr } = await supabase!
      .from('ev_special_assessments').update({ status: 'active' }).eq('id', a.id)
    if (uErr) return uErr.message
    await load()
    return null
  }, [communityId, assessments, load])

  const cancel = useCallback(async (assessmentId: string): Promise<string | null> => {
    const { error } = await supabase!.from('ev_special_assessments').update({ status: 'cancelled' }).eq('id', assessmentId)
    if (error) return error.message
    await load()
    return null
  }, [load])

  // Board marks a charge paid offline (check/cash) — settles its own row.
  const markChargePaidOffline = useCallback(async (chargeId: string): Promise<string | null> => {
    const { error } = await supabase!
      .from('ev_special_assessment_charges')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', chargeId).eq('status', 'pending')
    if (error) return error.message
    await load()
    return null
  }, [load])

  // Roll-up per campaign: charged total, collected total, paid/total counts.
  const rollup = useCallback((assessmentId: string) => {
    const cs = charges.filter(c => c.assessment_id === assessmentId)
    const charged = cs.reduce((s, c) => s + (Number(c.amount) || 0), 0)
    const collected = cs.filter(c => c.status === 'paid').reduce((s, c) => s + (Number(c.amount) || 0), 0)
    const paidCount = cs.filter(c => c.status === 'paid').length
    return { charged, collected, paidCount, total: cs.length }
  }, [charges])

  return { assessments, charges, loading, error, reload: load, createDraft, levy, cancel, markChargePaidOffline, rollup }
}
