import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// Bell-badge count. Subscribes to realtime inserts/updates on the
// user's recipient rows; falls back to a 60s poll if the channel drops.
export function useUnreadNoticeCount() {
  const { profile } = useAuth() || {}
  const [count, setCount]     = useState(0)
  const [loading, setLoading] = useState(true)
  // Unique per hook instance — this hook is now mounted in more than one
  // place (the bell AND the Home nav dot), and supabase-js throws if two
  // channels share a topic name. Same fix as lib/schedule + lib/amenities.
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!hasSupabase || !profile?.id) { setLoading(false); return }
    try {
      const { count: c, error } = await withTimeout(
        supabase
          .from('ev_notice_recipients')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .is('read_at', null)
      )
      if (!error) setCount(c ?? 0)
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hasSupabase || !profile?.id) return
    const channel = supabase
      .channel(`notice-recipients:${profile.id}:${channelId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ev_notice_recipients',
        filter: `profile_id=eq.${profile.id}`,
      }, () => { load() })
      .subscribe()
    const interval = setInterval(load, 60_000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [profile?.id, channelId, load])

  return { count, loading, reload: load }
}

// Resident notifications panel.
export function useMyNotices() {
  const { profile } = useAuth() || {}
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('ev_notice_recipients')
          .select('id, read_at, delivered_at, notice:ev_notices(id, kind, subject, body, meeting_id, vote_id, sent_at)')
          .eq('profile_id', profile.id)
          .order('delivered_at', { ascending: false })
          .limit(50)
      )
      if (error) throw error
      setNotices(data ?? [])
    } catch (err) {
      setError(err?.message ?? 'Failed to load notifications.')
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { load() }, [load])

  const markRead = useCallback(async (recipientId) => {
    if (!hasSupabase) return
    // Optimistic local update so the row visually clears immediately.
    setNotices(rs => rs.map(r => r.id === recipientId ? { ...r, read_at: new Date().toISOString() } : r))
    try {
      await withTimeout(
        supabase
          .from('ev_notice_recipients')
          .update({ read_at: new Date().toISOString() })
          .eq('id', recipientId)
      )
    } catch {
      /* keep — realtime/poll will reconcile */
    }
  }, [])

  // Clear the whole unread batch in one query — used when the bell panel
  // closes, so checking the dropdown drops the badge to zero. The unread
  // count hook reconciles via its realtime subscription / poll.
  const markAllRead = useCallback(async () => {
    if (!hasSupabase || !profile?.id) return
    const now = new Date().toISOString()
    setNotices(rs => rs.map(r => r.read_at ? r : { ...r, read_at: now }))
    try {
      await withTimeout(
        supabase
          .from('ev_notice_recipients')
          .update({ read_at: now })
          .eq('profile_id', profile.id)
          .is('read_at', null)
      )
    } catch { /* keep — local optimistic update reconciles via realtime */ }
  }, [profile?.id])

  return { notices, loading, error, reload: load, markRead, markAllRead }
}

// Full-page inbox at /app/notifications. Paginated via .range(); supports
// kind filter and "mark all read" in a single update. Independent of
// useMyNotices (the bell dropdown) so the two can coexist with different
// page sizes / filters without fighting over the same state.
export function useMyNoticesPaged({ kind, pageSize = 50 }: { kind?: string; pageSize?: number } = {}) {
  const { profile } = useAuth() || {}
  const [notices, setNotices]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadingMore, setMore]  = useState(false)
  const [error, setError]       = useState(null)
  const [hasMore, setHasMore]   = useState(false)

  const fetchPage = useCallback(async (from: number) => {
    let q = supabase
      .from('ev_notice_recipients')
      .select('id, read_at, delivered_at, notice:ev_notices!inner(id, kind, subject, body, meeting_id, vote_id, sent_at)')
      .eq('profile_id', profile.id)
      .order('delivered_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (kind) q = q.eq('notice.kind', kind)
    const { data, error } = await withTimeout(q)
    if (error) throw error
    return data ?? []
  }, [profile?.id, kind, pageSize])

  const load = useCallback(async () => {
    if (!hasSupabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const page = await fetchPage(0)
      setNotices(page)
      setHasMore(page.length === pageSize)
    } catch (err) {
      setError(err?.message ?? 'Failed to load notifications.')
    } finally {
      setLoading(false)
    }
  }, [profile?.id, fetchPage, pageSize])

  useEffect(() => { load() }, [load])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setMore(true)
    try {
      const page = await fetchPage(notices.length)
      setNotices(prev => [...prev, ...page])
      setHasMore(page.length === pageSize)
    } catch (err) {
      setError(err?.message ?? 'Failed to load more.')
    } finally {
      setMore(false)
    }
  }, [loadingMore, hasMore, notices.length, fetchPage, pageSize])

  const markRead = useCallback(async (recipientId) => {
    if (!hasSupabase) return
    setNotices(rs => rs.map(r => r.id === recipientId ? { ...r, read_at: new Date().toISOString() } : r))
    try {
      await withTimeout(
        supabase
          .from('ev_notice_recipients')
          .update({ read_at: new Date().toISOString() })
          .eq('id', recipientId)
      )
    } catch { /* realtime/poll will reconcile */ }
  }, [])

  // Single-query bulk update; RLS "owner marks own recipient read" covers it.
  const markAllRead = useCallback(async () => {
    if (!hasSupabase || !profile?.id) return
    const now = new Date().toISOString()
    setNotices(rs => rs.map(r => r.read_at ? r : { ...r, read_at: now }))
    try {
      await withTimeout(
        supabase
          .from('ev_notice_recipients')
          .update({ read_at: now })
          .eq('profile_id', profile.id)
          .is('read_at', null)
      )
    } catch { /* keep — local optimistic update reconciles via realtime */ }
  }, [profile?.id])

  return { notices, loading, loadingMore, hasMore, error, reload: load, loadMore, markRead, markAllRead }
}

// Board-side history list. Filter by meeting for the per-meeting tab.
export function useCommunityNotices(opts: { meetingId?: string } = {}) {
  const { profile } = useAuth() || {}
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const meetingId = opts.meetingId

  const load = useCallback(async () => {
    if (!hasSupabase || !profile?.community_id) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('ev_notices')
        .select('*, meeting:ev_meetings(title), vote:ev_votes(title)')
        .eq('community_id', profile.community_id)
        .order('sent_at', { ascending: false })
        .limit(100)
      if (meetingId) q = q.eq('meeting_id', meetingId)
      const { data, error } = await withTimeout(q)
      if (error) throw error
      setNotices(data ?? [])
    } catch (err) {
      setError(err?.message ?? 'Failed to load notice history.')
    } finally {
      setLoading(false)
    }
  }, [profile?.community_id, meetingId])

  useEffect(() => { load() }, [load])

  return { notices, loading, error, reload: load }
}
