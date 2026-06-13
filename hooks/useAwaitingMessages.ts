'use client'

// Live count of Contact conversations awaiting the board's reply — the resident
// sent the most recent message and it isn't resolved. Drives the notification
// badges on the Easy Voice nav item (admin layout) and the Contact sub-tab so
// the board can tell, from anywhere, that messages need attention.

import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

// Count community items that need the board's attention AND that THIS board
// member hasn't seen since their last activity. `build` narrows to the open rows
// (awaiting reply / awaiting a decision); `activityField` is the column whose
// value must be newer than the member's read receipt for the item to still count.
//
// "Seen" state lives server-side in board_read_receipts (per profile), so it
// syncs across a member's devices — opening an item on your phone clears the
// badge on your laptop too. Refreshed via realtime, on tab focus, and on the
// 'board-read' window event the admin pages fire the moment they mark an item
// seen. Fails open: if the receipts table doesn't exist yet (SQL not run), every
// open item counts — the old always-on behavior — instead of erroring.
function useUnreadCount(
  table: string,
  itemType: 'request' | 'arc',
  activityField: string,
  build: (q: any, communityId: string) => any,
): number {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const profileId = profile?.id
  const [count, setCount] = useState(0)
  const [chId] = useState(() => Math.random().toString(36).slice(2))

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId || !profileId) { setCount(0); return }
    let cancelled = false
    const load = async () => {
      try {
        const base = supabase!.from(table).select(`id, ${activityField}`)
        const { data: rows } = await build(base, communityId)
        const readAt: Record<string, string> = {}
        try {
          const { data: rec } = await supabase!
            .from('board_read_receipts')
            .select('item_id, read_at')
            .eq('profile_id', profileId)
            .eq('item_type', itemType)
          for (const r of (rec || []) as any[]) readAt[r.item_id] = r.read_at
        } catch { /* receipts table not created yet — treat all as unseen */ }
        const unseen = ((rows || []) as any[]).filter((r) => {
          const ts = r[activityField]
          const seen = readAt[r.id]
          return !seen || !ts || seen < ts
        }).length
        if (!cancelled) setCount(unseen)
      } catch { /* table may not exist yet — leave at 0 */ }
    }
    load()
    const ch = supabase!
      .channel(`unread:${table}:${communityId}:${chId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table,
        filter: `community_id=eq.${communityId}`,
      }, () => load())
      .subscribe()
    const onRefresh = () => load()
    window.addEventListener('focus', onRefresh)
    // The admin Contact + ARC pages fire this the moment they mark an item seen.
    window.addEventListener('board-read', onRefresh)
    return () => {
      cancelled = true
      supabase!.removeChannel(ch)
      window.removeEventListener('focus', onRefresh)
      window.removeEventListener('board-read', onRefresh)
    }
  }, [communityId, profileId, chId])

  return count
}

// Contact conversations needing the board's attention: resident messaged last,
// not resolved, and unseen since that message. The /admin/requests "Needs reply"
// folder still flags every unanswered thread (read or not), so nothing a
// resident is waiting on gets dropped — only the nagging badge clears on read.
export function useAwaitingMessages(): number {
  return useUnreadCount('resident_requests', 'request', 'last_message_at', (q, cid) =>
    q.eq('community_id', cid).eq('last_message_role', 'resident').neq('status', 'resolved'))
}

// Architectural (ARC) requests still open and unseen since they were submitted.
// The ARC worklist still lists every open request until it's decided.
export function useArcPending(): number {
  return useUnreadCount('ev_arc_requests', 'arc', 'created_at', (q, cid) =>
    q.eq('community_id', cid).in('status', ['submitted', 'under_review']))
}

// Resident side: how many of MY conversations have an unread board reply (the
// board's message is the latest and I haven't opened it). Drives the resident's
// home banner and the Contact tab badge.
//
// "Read" state is server-side in board_read_receipts (item_type
// 'request_resident', per profile), so opening a reply on the web also clears
// the badge on the phone — the old per-device localStorage map didn't, which is
// why the notification kept "resetting" across devices. We still merge the
// localStorage map as a fallback so this keeps working before the SQL migration
// (resident-read-receipts.sql) runs. A 'contact-read' window event lets the
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
        // Server receipts first (cross-device), then merge the local map so the
        // newer of the two wins — and so it still works pre-migration.
        const readAt: Record<string, string> = {}
        try {
          const { data: rec } = await supabase!
            .from('board_read_receipts')
            .select('item_id, read_at')
            .eq('profile_id', profileId)
            .eq('item_type', 'request_resident')
          for (const r of (rec || []) as any[]) readAt[r.item_id] = r.read_at
        } catch { /* receipts table/type not migrated yet — fall back to local */ }
        try {
          const local = JSON.parse(window.localStorage.getItem('contact_thread_read') || '{}')
          for (const id of Object.keys(local)) {
            if (!readAt[id] || readAt[id] < local[id]) readAt[id] = local[id]
          }
        } catch { /* ignore */ }
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
