import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// All votes for the community, independent of meetings. Votes are standalone
// now (ev_votes.meeting_id is nullable and unused by the UI), so they're read
// directly by community_id instead of through ev_meetings.
export function useCommunityVotes() {
  const { profile } = useAuth() || {}
  const [votes, setVotes]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !profile?.community_id) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('ev_votes')
          .select('*')
          .eq('community_id', profile.community_id)
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      setVotes(data ?? [])
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load votes')
    } finally {
      setLoading(false)
    }
  }, [profile?.community_id])

  useEffect(() => { load() }, [load])

  return { votes, loading, error, reload: load }
}
