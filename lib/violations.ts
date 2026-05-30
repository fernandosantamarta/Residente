// Violations & Enforcement, backed by the Supabase `ev_violations` table.
//   - app/admin/violations/page.tsx — the board issues + manages (community)
//   - app/app/voice (Contact) + /app/documents strip — a resident sees their OWN
// Each violation is owned by a resident (profile_id); RLS shows residents
// only their own and the board the whole community. Issuing one fires a
// personal in-app notice to that resident (DB trigger).

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

export type ViolationKind = 'warning' | 'fine'
export type ViolationStatus = 'open' | 'appealed' | 'closed'
export type ViolationResolution = 'stripe-paid' | 'manual-paid' | 'waived' | 'dismissed'

export type Violation = {
  id: string
  profile_id: string | null
  kind: ViolationKind
  rule_id: string | null
  rule_title: string | null
  resident: string            // resident_label (denormalized "Name · Unit")
  amount: number | null
  status: ViolationStatus
  resolution: ViolationResolution | null
  stripe_invoice_id: string | null
  notes: string | null
  opened_at: string
  closed_at: string | null
}

const SELECT = 'id, profile_id, kind, rule_id, rule_title, resident_label, amount, status, resolution, stripe_invoice_id, notes, opened_at, closed_at'

const rowTo = (r: any): Violation => ({
  id: r.id,
  profile_id: r.profile_id ?? null,
  kind: r.kind,
  rule_id: r.rule_id ?? null,
  rule_title: r.rule_title ?? null,
  resident: r.resident_label ?? '—',
  amount: r.amount ?? null,
  status: r.status,
  resolution: r.resolution ?? null,
  stripe_invoice_id: r.stripe_invoice_id ?? null,
  notes: r.notes ?? null,
  opened_at: r.opened_at,
  closed_at: r.closed_at ?? null,
})

const today = () => new Date().toISOString().slice(0, 10)

// Derived headline stats for the resident strip (unchanged contract).
export function computeStats(list: Violation[]) {
  let warnings = 0, fines_collected = 0, resolved = 0, appeals = 0
  for (const v of list) {
    if (v.kind === 'warning') warnings++
    if (v.kind === 'fine' && (v.resolution === 'stripe-paid' || v.resolution === 'manual-paid')) {
      fines_collected += Number(v.amount) || 0
    }
    if (v.status === 'closed') resolved++
    if (v.status === 'appealed') appeals++
  }
  return { warnings, fines: fines_collected, resolved, appeals }
}

// ---------- core fetch (realtime) ----------
function useViolations(scope: 'community' | 'mine') {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const myId = profile?.id
  const [list, setList] = useState<Violation[]>([])
  const [loading, setLoading] = useState(true)
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    try {
      let q = supabase.from('ev_violations').select(SELECT).order('opened_at', { ascending: false })
      q = scope === 'mine' ? q.eq('profile_id', myId) : q.eq('community_id', communityId)
      const { data, error } = await q
      if (error) throw error
      setList((data ?? []).map(rowTo))
    } finally {
      setLoading(false)
    }
  }, [communityId, myId, scope])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const channel = supabase
      .channel(`violations:${scope}:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_violations',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [communityId, channelId, scope, load])

  return { list, loading, reload: load, communityId, myId }
}

// Community list (board sees all; a resident viewing this still sees only
// their own via RLS). Used by admin + the /app/documents strip.
export function useViolationsData(): Violation[] {
  return useViolations('community').list
}

// The signed-in resident's own violations, regardless of role. For Contact.
export function useMyViolations(): { violations: Violation[]; loading: boolean } {
  const { list, loading } = useViolations('mine')
  return { violations: list, loading }
}

// Community residents for the "issue against" picker.
export function useCommunityResidents(): { id: string; profile_id: string | null; label: string }[] {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<{ id: string; profile_id: string | null; label: string }[]>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!hasSupabase || !supabase || !communityId) return
      const { data } = await supabase
        .from('residents')
        .select('id, profile_id, full_name, unit_number, address')
        .eq('community_id', communityId)
      if (cancelled || !data) return
      setRows(data.map((r: any) => {
        const name = r.full_name || 'Resident'
        const unit = r.unit_number || r.address
        return { id: r.id, profile_id: r.profile_id ?? null, label: unit ? `${name} · ${unit}` : name }
      }).sort((a, b) => a.label.localeCompare(b.label)))
    }
    run()
    return () => { cancelled = true }
  }, [communityId])

  return rows
}

// ---------- status workflow (update by id; RLS enforces; realtime refreshes) ----------
async function setStatus(id: string, patch: Partial<{ status: ViolationStatus; resolution: ViolationResolution | null; closed_at: string | null }>) {
  if (!hasSupabase || !supabase) return
  await supabase.from('ev_violations').update(patch).eq('id', id)
}
export const markStripePaid = (id: string) => setStatus(id, { status: 'closed', resolution: 'stripe-paid', closed_at: today() })
export const markManualPaid = (id: string) => setStatus(id, { status: 'closed', resolution: 'manual-paid', closed_at: today() })
export const waive          = (id: string) => setStatus(id, { status: 'closed', resolution: 'waived', closed_at: today() })
export const dismiss        = (id: string) => setStatus(id, { status: 'closed', resolution: 'dismissed', closed_at: today() })
export const appeal         = (id: string) => setStatus(id, { status: 'appealed', resolution: null, closed_at: null })
export const reopen         = (id: string) => setStatus(id, { status: 'open', resolution: null, closed_at: null })
export async function removeStoredViolation(id: string) {
  if (!hasSupabase || !supabase) return
  await supabase.from('ev_violations').delete().eq('id', id)
}

// ---------- admin management ----------
export type NewViolation = {
  profile_id: string | null
  resident_label: string
  kind: ViolationKind
  rule_id: string | null
  rule_title: string | null
  amount: number | null
  notes: string | null
}

export function useViolationsAdmin() {
  const { list, loading, reload, communityId } = useViolations('community')

  const addViolation = useCallback(async (v: NewViolation): Promise<string | null> => {
    if (!hasSupabase || !supabase || !communityId) return null
    const { data, error } = await supabase
      .from('ev_violations')
      .insert({
        community_id: communityId,
        profile_id: v.profile_id,
        resident_label: v.resident_label,
        kind: v.kind,
        rule_id: v.rule_id,
        rule_title: v.rule_title,
        amount: v.amount,
        notes: v.notes,
      })
      .select('id')
      .single()
    if (error) throw error
    await reload()
    return data?.id ?? null
  }, [communityId, reload])

  const deleteAll = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) return
    const { error } = await supabase.from('ev_violations').delete().eq('community_id', communityId)
    if (error) throw error
    await reload()
  }, [communityId, reload])

  return { violations: list, loading, reload, addViolation, deleteAll }
}
