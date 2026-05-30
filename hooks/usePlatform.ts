import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

export type PlatformCommunity = {
  id: string; name: string; location: string | null
  subscription_status: string | null; join_code: string | null
  created_at: string; resident_count: number; board_count: number
}
export type PlatformRequest = {
  id: string; from_name: string | null; from_email: string | null
  from_community_id: string | null; subject: string; body: string | null
  status: 'open' | 'in_progress' | 'resolved'; created_at: string
}

// Lightweight boolean — is the signed-in user a Residente platform operator?
// Used to conditionally show the Platform Console link. Returns null while loading.
export function usePlatformAdmin(): boolean | null {
  const { profile } = useAuth() || {}
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!hasSupabase || !supabase || !profile?.id) { setIsAdmin(false); return }
    supabase.rpc('is_platform_admin', { uid: profile.id }).then(({ data, error }) => {
      if (!cancelled) setIsAdmin(!error && data === true)
    })
    return () => { cancelled = true }
  }, [profile?.id])

  return isAdmin
}

// Full console data — all communities + the support inbox. The
// platform_overview RPC raises for non-admins, so an error means "not authorized".
export function usePlatformConsole() {
  const { profile } = useAuth() || {}
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [communities, setCommunities] = useState<PlatformCommunity[]>([])
  const [requests, setRequests] = useState<PlatformRequest[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('platform_overview')
      if (error) { setIsAdmin(false); setCommunities([]); setRequests([]); return }
      setIsAdmin(true)
      setCommunities((data ?? []) as PlatformCommunity[])
      const { data: reqs } = await supabase
        .from('platform_requests')
        .select('id, from_name, from_email, from_community_id, subject, body, status, created_at')
        .order('created_at', { ascending: false })
      setRequests((reqs ?? []) as PlatformRequest[])
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { load() }, [load])

  const setRequestStatus = useCallback(async (id: string, status: PlatformRequest['status']) => {
    if (!hasSupabase || !supabase) return
    setRequests(rs => rs.map(r => r.id === id ? { ...r, status } : r))
    await supabase.from('platform_requests').update({ status }).eq('id', id)
  }, [])

  return { isAdmin, communities, requests, loading, reload: load, setRequestStatus }
}
