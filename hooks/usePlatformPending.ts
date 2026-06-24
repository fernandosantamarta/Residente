import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

// One row of the cross-community pending queue (platform_pending_items RPC).
// Statutory items (collections / arc / minutes / elections / fines) are
// SURFACED only — their action is a deep-link the operator follows into the
// community. Ministerial items (resident_approval, support_ticket) can be
// actioned from the queue itself.
export type PlatformPendingItem = {
  id: string
  item_type:
    | 'support_ticket' | 'resident_approval' | 'collections'
    | 'arc_request' | 'meeting_minutes_due' | 'election_milestone' | 'violation_fine'
  community_id: string | null
  community_name: string | null
  created_at: string
  due_at: string | null
  severity: 'overdue' | 'soon' | 'info'
  title: string
  subtitle: string | null
  status: string | null
  action_kind:
    | 'ack_ticket' | 'approve_resident' | 'review_collections'
    | 'review_arc' | 'review_minutes' | 'review_election' | 'review_enforcement'
  deep_link_href: string
  actor_name: string | null
}

// The unified queue across every community, with the two batch-actionable
// helpers and an "enter then go" helper for the deep-link "Go →" buttons. The
// RPC raises for non-admins, so an error here means "not authorized" (the
// PendingQueue treats that as an empty/closed state). Reloads silently after
// the first load and on realtime ticket/resident changes.
export function usePlatformPending() {
  const { profile } = useAuth() || {}
  const [items, setItems] = useState<PlatformPendingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadedOnce = useRef(false)
  const reload = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) { setItems([]); setLoading(false); return }
    const first = !loadedOnce.current
    if (first) setLoading(true)
    try {
      const { data, error } = await supabase.rpc('platform_pending_items')
      if (error) { setError(error.message); setItems([]); return }
      setError(null)
      setItems((data ?? []) as PlatformPendingItem[])
    } finally {
      loadedOnce.current = true
      if (first) setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { reload() }, [reload])

  // Live refresh: a new ticket / board reply (platform_requests) or a fresh
  // pending signup (residents) should pop into the queue without a manual reload.
  useEffect(() => {
    if (!hasSupabase || !supabase || !profile?.id) return
    const ch = supabase
      .channel('platform-pending')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_requests' }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residents' }, () => reload())
      .subscribe()
    return () => { supabase!.removeChannel(ch) }
  }, [profile?.id, reload])

  // Ministerial: approve a pending resident from the queue (owner/operator only,
  // enforced in the DB function; audited), then refresh.
  const approveResident = useCallback(async (id: string): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_approve_resident', { p_resident: id })
    if (error) return error.message
    await reload()
    return null
  }, [reload])

  // Drop into a community before following a statutory deep-link, so the admin
  // area renders that community. The caller navigates to href after this resolves
  // true. 'none' marks an operator with no home community, mirroring usePlatform.
  const enterAndGo = useCallback(async (communityId: string | null, _href: string): Promise<boolean> => {
    if (!hasSupabase || !supabase || !communityId) return false
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('platform_return_to', profile?.community_id ?? 'none')
      }
      const { error } = await supabase.rpc('platform_enter_community', { target: communityId })
      return !error
    } catch { return false }
  }, [profile?.community_id])

  return { items, loading, error, reload, approveResident, enterAndGo }
}
