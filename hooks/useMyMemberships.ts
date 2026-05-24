import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p as Promise<T>,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

export interface MembershipRow {
  community_id: string
  role: string
  community_name: string
}

// Lists every community the signed-in profile belongs to. Returns
// empty for the local-dev (no Supabase) case so the switcher renders
// nothing. The active community lives on `profiles.community_id`; the
// switcher writes there to flip context.
export function useMyMemberships() {
  const { session } = useAuth() || {}
  const [memberships, setMemberships] = useState<MembershipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !session?.user) {
      setMemberships([]); setLoading(false); return
    }
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('ev_membership')
          .select('community_id, role, communities:community_id(name)')
          .eq('profile_id', session.user.id)
      )
      if (err) throw err
      const rows: MembershipRow[] = (data || []).map((r: any) => ({
        community_id:   r.community_id,
        role:           r.role,
        community_name: r.communities?.name || '—',
      }))
      // Sort alphabetically by community name for a stable picker.
      rows.sort((a, b) => a.community_name.localeCompare(b.community_name))
      setMemberships(rows)
    } catch (e: any) {
      setError(e?.message || 'Could not load memberships')
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])
  useEffect(() => { load() }, [load])

  return { memberships, loading, error, reload: load }
}
