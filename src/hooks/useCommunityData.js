import { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { supabase, hasSupabase } from '../lib/supabase'

// Hardening (carried from Genie): wrap network promises, never .catch on Supabase.
const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// Loads the signed-in user's community + budget categories from Supabase.
// Returns real data only — community is null when the user has no community
// linked (or local dev without Supabase), and callers fall back to a demo.
export function useCommunityData() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [state, setState] = useState({
    community: null, categories: [], loading: true, error: null,
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !communityId) {
        if (!cancelled) setState({ community: null, categories: [], loading: false, error: null })
        return
      }
      setState(s => ({ ...s, loading: true, error: null }))
      try {
        const [cRes, catRes] = await Promise.all([
          withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
          withTimeout(
            supabase.from('budget_categories').select('*')
              .eq('community_id', communityId).order('sort_order')
          ),
        ])
        if (cancelled) return
        if (cRes.error) throw cRes.error
        if (catRes.error) throw catRes.error
        setState({
          community: cRes.data, categories: catRes.data || [], loading: false, error: null,
        })
      } catch (err) {
        if (!cancelled) {
          setState({
            community: null, categories: [], loading: false,
            error: err?.message || 'Could not load your community',
          })
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId])

  return state
}
