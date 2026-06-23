import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

// The logged-in tenant's ACTIVE rent demand, if any (FS 720.3085(8) /
// 718.116(11)). When present, the tenant has been directed to pay rent to the
// association until the owner's balance clears — the one case where a tenant
// sees a payment screen. The board reads/releases the demand admin-side; the
// tenant only reads their own active row (RLS in rent-demand.sql).
export function useMyRentDemand() {
  const { profile } = useAuth() || {}
  const profileId = profile?.id
  const [state, setState] = useState<{ demand: any | null; loading: boolean }>({ demand: null, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !profileId) { if (!cancelled) setState({ demand: null, loading: false }); return }
      try {
        const { data } = await supabase!
          .from('ev_rent_demands')
          .select('*')
          .eq('tenant_profile_id', profileId)
          .eq('status', 'active')
          .maybeSingle()
        if (!cancelled) setState({ demand: data || null, loading: false })
      } catch {
        if (!cancelled) setState({ demand: null, loading: false }) // table may not exist yet
      }
    }
    load()
    return () => { cancelled = true }
  }, [profileId])

  return state
}
