import { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { supabase, hasSupabase } from '../lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// Finds the roster row for the signed-in user (matched by email) so Home can
// show what they personally owe. resident is null when there's no match.
export function useMyResident() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const email = profile?.email
  const [state, setState] = useState({ resident: null, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !communityId || !email) {
        if (!cancelled) setState({ resident: null, loading: false })
        return
      }
      try {
        const { data, error } = await withTimeout(
          supabase.from('residents').select('*')
            .eq('community_id', communityId).ilike('email', email).limit(1)
        )
        if (cancelled) return
        if (error) throw error
        setState({ resident: (data && data[0]) || null, loading: false })
      } catch (err) {
        if (!cancelled) setState({ resident: null, loading: false })
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId, email])

  return state
}
