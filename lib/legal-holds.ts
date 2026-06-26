// Legal holds — a resident-reported / board-verified pause on collection
// escalation (bankruptcy, SCRA, qualifying offer). Mirrors lib/payment-plans.ts.
//   - app/app/track/_sections/LegalHoldCard.tsx — owner reports / responds
//   - app/admin/collections/[id]/page.tsx — board requests / verifies / releases
// Backed by ev_legal_holds (legal-holds.sql). RLS lets an owner report on their
// OWN open case and read their own holds. One row IS the request.

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { isOpenStage, type CollectionCaseRow } from '@/lib/compliance/collections'

export type LegalHoldStatus = 'requested' | 'pending_resident' | 'active' | 'released' | 'denied'

export interface LegalHoldRow {
  id: string
  community_id?: string
  case_id?: string
  profile_id?: string | null
  reason?: string | null
  note?: string | null
  status?: LegalHoldStatus | string | null
  initiated_by?: 'resident' | 'board' | string | null
  requested_at?: string | null
  decided_by?: string | null
  decided_at?: string | null
  decision_reason?: string | null
  created_at?: string | null
}

export const LEGAL_HOLD_REASONS = ['bankruptcy', 'scra', 'qualifying_offer', 'other'] as const

const HOLD_SELECT =
  'id, community_id, case_id, profile_id, reason, note, status, initiated_by, requested_at, decided_by, decided_at, decision_reason, created_at'

const today = () => new Date().toISOString().slice(0, 10)

/** A hold that's still live in the resident's view (awaiting them, awaiting the
 *  board, or active). released/denied are terminal. */
export function isOpenHold(h: LegalHoldRow | null | undefined): boolean {
  return !!h && ['requested', 'pending_resident', 'active'].includes(String(h.status))
}

// The signed-in owner's open collection case + current legal hold (if any), with
// the actions to report a protection, respond to a board request, or withdraw.
// Realtime so a board decision / request appears immediately.
export function useMyLegalHold() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const myId = profile?.id
  const [openCase, setOpenCase] = useState<CollectionCaseRow | null>(null)
  const [hold, setHold] = useState<LegalHoldRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !myId || !communityId) { setLoading(false); return }
    try {
      const [caseRes, holdRes] = await Promise.all([
        supabase.from('ev_collection_cases').select('*')
          .eq('profile_id', myId).order('opened_at', { ascending: false }),
        // RLS returns only the caller's own holds.
        supabase.from('ev_legal_holds').select(HOLD_SELECT)
          .eq('profile_id', myId).order('created_at', { ascending: false }),
      ])
      const cases = (caseRes.data as CollectionCaseRow[]) || []
      const oc = cases.find(c => isOpenStage(c.stage)) || null
      setOpenCase(oc)
      const holds = (holdRes.data as LegalHoldRow[]) || []
      const live = holds.find(h => (!oc || h.case_id === oc.id) && isOpenHold(h))
      const recent = holds.find(h => !oc || h.case_id === oc.id) || null
      setHold(live || recent)
    } catch { /* leave nulls */ } finally {
      setLoading(false)
    }
  }, [myId, communityId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hasSupabase || !supabase || !myId) return
    const channel = supabase
      .channel(`myhold:${myId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_legal_holds',
        filter: `profile_id=eq.${myId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase!.removeChannel(channel) }
  }, [myId, channelId, load])

  // Owner self-reports a protection on their open case.
  const reportHold = useCallback(async (input: { caseId: string; reason: string; note: string }): Promise<string | null> => {
    if (!hasSupabase || !supabase || !myId || !communityId) return 'Not signed in.'
    const { error } = await supabase.from('ev_legal_holds').insert({
      community_id: communityId,
      case_id: input.caseId,
      profile_id: myId,
      reason: input.reason,
      note: input.note.trim() || null,
      status: 'requested',
      initiated_by: 'resident',
      requested_at: today(),
      created_by: myId,
    })
    if (error) return error.message || 'Could not submit.'
    await load()
    return null
  }, [myId, communityId, load])

  // Owner responds to a board "confirm" request (pending_resident -> requested).
  const respondToRequest = useCallback(async (id: string, input: { reason?: string; note: string }): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not configured.'
    const patch: any = { note: input.note.trim() || null, status: 'requested' }
    if (input.reason) patch.reason = input.reason
    const { error } = await supabase.from('ev_legal_holds').update(patch).eq('id', id)
    if (error) return error.message || 'Could not submit.'
    await load()
    return null
  }, [load])

  // Owner withdraws their own pending request.
  const withdrawHold = useCallback(async (id: string): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not configured.'
    const { error } = await supabase.from('ev_legal_holds').update({ status: 'released' }).eq('id', id)
    if (error) return error.message || 'Could not withdraw.'
    await load()
    return null
  }, [load])

  return { openCase, hold, loading, reload: load, reportHold, respondToRequest, withdrawHold }
}
