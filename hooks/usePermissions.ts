'use client'

import { useEffect, useState } from 'react'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useAuth } from '@/app/providers'
import { canDo, canDoAny, type Permission } from '@/lib/permissions'

// Loads the signed-in user's permission set from the my_permissions() RPC.
//
// Resilient by design: if the function isn't there yet (custom-roles.sql not
// run) or the call errors, it falls back to the LEGACY rule — board_member/admin
// get full access (['*']), everyone else gets none. So shipping the app gating
// before the SQL is applied can't lock a board out or break the admin area.
export function usePermissions() {
  const { profile } = useAuth() || {}
  const legacyFull = ['board_member', 'admin'].includes(profile?.role || '')
  const [perms, setPerms] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const fallback = legacyFull ? ['*'] : []
      if (!hasSupabase || !supabase) { setPerms(fallback); setLoading(false); return }
      try {
        const { data, error } = await supabase.rpc('my_permissions')
        if (cancelled) return
        const resolved = error ? fallback : ((data as string[] | null) ?? fallback)
        // An owner/board account (legacyFull) must never end up with zero perms.
        // If the RPC returns an empty set for them — e.g. a freshly provisioned
        // admin who has a resident row but no assigned role — use full access.
        // Plain residents legitimately resolve to [].
        setPerms(resolved.length === 0 && legacyFull ? ['*'] : resolved)
      } catch {
        if (!cancelled) setPerms(fallback)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [profile?.id, legacyFull])

  return {
    perms,
    loading,
    isAdmin: !!perms?.includes('*'),
    can: (perm: Permission) => canDo(perms, perm),
    canAny: (wanted: Permission[]) => canDoAny(perms, wanted),
  }
}
