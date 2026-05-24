import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// Loads the community's most recent board decisions for the Home feed.
// decisions is null when there's nothing to show (no community / load failed)
// so callers fall back to the demo feed; [] means loaded-but-empty.
export function useBoardDecisions(limit = 5) {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [state, setState] = useState({ decisions: null, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !communityId) {
        if (!cancelled) setState({ decisions: null, loading: false })
        return
      }
      setState(s => ({ ...s, loading: true }))
      try {
        const { data, error } = await withTimeout(
          supabase.from('board_decisions').select('*')
            .eq('community_id', communityId)
            .order('decided_on', { ascending: false })
            .limit(limit)
        )
        if (cancelled) return
        if (error) throw error
        setState({ decisions: data || [], loading: false })
      } catch (err) {
        if (!cancelled) setState({ decisions: null, loading: false })
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId, limit])

  return state
}
