import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// Community rules, ordered for display. rules is null when there's no
// community or the load failed; [] means loaded-but-empty.
export function useRules() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [state, setState] = useState({ rules: null, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !communityId) {
        if (!cancelled) setState({ rules: null, loading: false })
        return
      }
      try {
        const { data, error } = await withTimeout(
          supabase.from('rules').select('*')
            .eq('community_id', communityId)
            .order('sort_order', { ascending: true })
        )
        if (cancelled) return
        if (error) throw error
        setState({ rules: data || [], loading: false })
      } catch {
        if (!cancelled) setState({ rules: null, loading: false })
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId])

  return state
}
