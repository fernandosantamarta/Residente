import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

export type PlatformCommunity = {
  id: string; name: string; location: string | null
  subscription_status: string | null; join_code: string | null
  created_at: string; resident_count: number; board_count: number
  plan: string | null; home_count: number | null; unit_count: number | null
  stripe_subscription_id: string | null
}
export type PlatformRequest = {
  id: string; from_name: string | null; from_email: string | null
  from_community_id: string | null; subject: string; body: string | null
  status: 'open' | 'in_progress' | 'resolved'; created_at: string
}
export type OperatorRole = 'owner' | 'operator' | 'support'
export type PlatformOperator = {
  profile_id: string; name: string; email: string | null
  role: OperatorRole; added_by_name: string | null; added_at: string
}
export type AuditEntry = {
  id: string; actor_name: string | null; actor_email: string | null
  action: string; target_type: string | null; target_id: string | null
  detail: Record<string, any> | null; created_at: string
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
  const [operators, setOperators] = useState<PlatformOperator[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [myRole, setMyRole] = useState<OperatorRole | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    // No session/profile → resolve to "not authorized" instead of hanging on
    // the loading state forever (isAdmin must leave null, or the page's
    // `loading || isAdmin === null` guard never clears).
    if (!hasSupabase || !supabase || !profile?.id) { setIsAdmin(false); setLoading(false); return }
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('platform_overview')
      if (error) { setIsAdmin(false); setCommunities([]); setRequests([]); setOperators([]); setAudit([]); setMyRole(null); return }
      setIsAdmin(true)
      setCommunities((data ?? []) as PlatformCommunity[])
      const { data: reqs } = await supabase
        .from('platform_requests')
        .select('id, from_name, from_email, from_community_id, subject, body, status, created_at')
        .order('created_at', { ascending: false })
      setRequests((reqs ?? []) as PlatformRequest[])
      // Operators (with role + who added them), via a guarded definer fn so
      // every operator's name/email resolves regardless of profiles RLS.
      const { data: ops } = await supabase.rpc('platform_operators')
      const mapped: PlatformOperator[] = (ops ?? []).map((o: any) => ({
        profile_id: o.profile_id, name: o.name || 'Operator', email: o.email || null,
        role: (o.role || 'operator') as OperatorRole,
        added_by_name: o.added_by_name || null, added_at: o.added_at,
      }))
      setOperators(mapped)
      setMyRole(mapped.find(o => o.profile_id === profile.id)?.role ?? null)
      // Recent activity (audit log).
      const { data: log } = await supabase.rpc('platform_audit', { p_limit: 100 })
      setAudit((log ?? []) as AuditEntry[])
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

  // Drop into a community to manage it: repoint the operator's active community
  // to the target (operator-only, enforced in the DB function), remembering
  // where to return. The admin area then renders that community.
  const enterCommunity = useCallback(async (communityId: string): Promise<boolean> => {
    if (!hasSupabase || !supabase) return false
    try {
      if (typeof window !== 'undefined' && profile?.community_id) {
        window.localStorage.setItem('platform_return_to', profile.community_id)
      }
      const { error } = await supabase.rpc('platform_enter_community', { target: communityId })
      return !error
    } catch { return false }
  }, [profile?.community_id])

  // ---- Owner-only operator management. The DB enforces owner + guardrails
  // (last-owner protection, valid roles); these just surface the error string.
  const addOperator = useCallback(async (email: string, role: OperatorRole): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_add_operator', { target_email: email, target_role: role })
    if (error) return error.message
    await load()
    return null
  }, [load])

  const removeOperator = useCallback(async (profileId: string): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_remove_operator', { target: profileId })
    if (error) return error.message
    await load()
    return null
  }, [load])

  const setOperatorRole = useCallback(async (profileId: string, role: OperatorRole): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_set_operator_role', { target: profileId, new_role: role })
    if (error) return error.message
    await load()
    return null
  }, [load])

  return {
    isAdmin, myRole, communities, requests, operators, audit, loading, reload: load,
    setRequestStatus, enterCommunity, addOperator, removeOperator, setOperatorRole,
  }
}
