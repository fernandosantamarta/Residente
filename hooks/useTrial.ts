'use client'

import { useEffect, useState } from 'react'
import { hasSupabase, supabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'
import { trialState, type TrialState } from '@/lib/trial'

// Loads the caller's community billing fields and derives its trial state.
// Used by the admin shell to show the countdown banner + the expiry gate.
export function useTrial(): { state: TrialState; communityName: string; loading: boolean } {
  const { profile } = useAuth()
  const communityId = profile?.community_id
  const [row, setRow] = useState<{ created_at: string | null; subscription_status: string | null; name: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    let cancelled = false
    supabase
      .from('communities')
      .select('created_at, subscription_status, name')
      .eq('id', communityId)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        setRow(data as { created_at: string | null; subscription_status: string | null; name: string | null } | null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [communityId])

  return {
    state: trialState(row || {}),
    communityName: row?.name || 'your community',
    loading,
  }
}
