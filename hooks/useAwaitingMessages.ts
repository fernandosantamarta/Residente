'use client'

// Live count of Contact conversations awaiting the board's reply — the resident
// sent the most recent message and it isn't resolved. Drives the notification
// badges on the Easy Voice nav item (admin layout) and the Contact sub-tab so
// the board can tell, from anywhere, that messages need attention.

import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

// Generic live count over a community-scoped table, refreshed via realtime + on
// tab focus. `build` applies the table-specific filters (status, etc.).
function useCommunityCount(
  table: string,
  build: (q: any, communityId: string) => any,
): number {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [count, setCount] = useState(0)
  const [chId] = useState(() => Math.random().toString(36).slice(2))

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) { setCount(0); return }
    let cancelled = false
    const load = async () => {
      try {
        const base = supabase!.from(table).select('id', { count: 'exact', head: true })
        const { count: c } = await build(base, communityId)
        if (!cancelled) setCount(c || 0)
      } catch { /* table may not exist yet — leave at 0 */ }
    }
    load()
    const ch = supabase!
      .channel(`count:${table}:${communityId}:${chId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table,
        filter: `community_id=eq.${communityId}`,
      }, () => load())
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; supabase!.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, [communityId, chId])

  return count
}

// Contact conversations awaiting the board's reply (resident messaged last, open).
export function useAwaitingMessages(): number {
  return useCommunityCount('resident_requests', (q, cid) =>
    q.eq('community_id', cid).eq('last_message_role', 'resident').neq('status', 'resolved'))
}

// Architectural (ARC) requests still open and awaiting a board decision.
export function useArcPending(): number {
  return useCommunityCount('ev_arc_requests', (q, cid) =>
    q.eq('community_id', cid).in('status', ['submitted', 'under_review']))
}

// Resident side: how many of MY conversations have an unread board reply (the
// board's message is the latest and I haven't opened it). Drives the resident's
// home banner and the Contact tab badge. "Read" state is the per-device
// contact_thread_read localStorage map; a 'contact-read' window event lets the
// Contact page tell this hook to refresh the moment a thread is opened.
export function useMyPendingReplies(): number {
  const { profile } = useAuth() || {}
  const profileId = profile?.id
  const [count, setCount] = useState(0)
  const [chId] = useState(() => Math.random().toString(36).slice(2))

  useEffect(() => {
    if (!hasSupabase || !supabase || !profileId) { setCount(0); return }
    let cancelled = false
    const load = async () => {
      try {
        // No status filter: a board reply that also closes the thread is still
        // unread until the resident opens it, so it keeps notifying.
        const { data } = await supabase!
          .from('resident_requests')
          .select('id, last_message_at, last_message_role, status')
          .eq('profile_id', profileId)
          .eq('last_message_role', 'board')
        let readAt: Record<string, string> = {}
        try { readAt = JSON.parse(window.localStorage.getItem('contact_thread_read') || '{}') } catch { /* ignore */ }
        const unread = (data || []).filter((r: any) =>
          r.last_message_at && (!readAt[r.id] || readAt[r.id] < r.last_message_at)).length
        if (!cancelled) setCount(unread)
      } catch { /* ignore */ }
    }
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener('contact-read', onFocus)
    const ch = supabase!
      .channel(`my-pending:${profileId}:${chId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resident_requests', filter: `profile_id=eq.${profileId}` }, () => load())
      .subscribe()
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('contact-read', onFocus)
      supabase!.removeChannel(ch)
    }
  }, [profileId, chId])

  return count
}
