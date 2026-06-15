'use client'

import { useEffect, useState } from 'react'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'
import { accountingEnabled } from '@/lib/accounting'

// Whether this community may use the paid Accounting workspace.
//
// Two gates, OR'd: the global rollout flag (NEXT_PUBLIC_ACCOUNTING_ENABLED —
// "launched to everyone") OR the community having purchased the 'accounting'
// add-on (cached on communities.accounting_addon by manage-subscription).
//
// Resilient: if the column isn't there yet (SQL not run) the read just yields
// false, so the workspace shows its upsell rather than erroring. The global flag
// short-circuits the query entirely.
export function useAccountingAccess() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [addon, setAddon] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (accountingEnabled) { setAddon(true); setLoading(false); return }
      if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
      try {
        const { data } = await supabase.from('communities').select('accounting_addon').eq('id', communityId).single()
        if (!cancelled) setAddon(!!(data as any)?.accounting_addon)
      } catch { /* column may not exist yet → treat as not entitled */ }
      finally { if (!cancelled) setLoading(false) }
    }
    run()
    return () => { cancelled = true }
  }, [communityId])

  return { enabled: accountingEnabled || addon, loading }
}
