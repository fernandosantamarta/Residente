import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

export type PlatformCommunity = {
  id: string; name: string; location: string | null
  subscription_status: string | null; join_code: string | null
  created_at: string; resident_count: number; board_count: number
  plan: string | null; home_count: number | null; unit_count: number | null
  stripe_subscription_id: string | null
  created_by_name: string | null; created_by_email: string | null
  // Current owner — reassignable, distinct from created_by (history). Null on
  // older DBs (before ownership-and-role-walls.sql) or for masked roles.
  owner_profile_id: string | null; owner_name: string | null; owner_email: string | null
}
export type PlatformResident = {
  id: string; profile_id: string | null; full_name: string | null; email: string | null
  unit_number: string | null; board_position: string | null
  is_board: boolean | null; created_at: string
}
export type PlatformRequest = {
  id: string; from_name: string | null; from_email: string | null
  from_community_id: string | null; subject: string; body: string | null
  status: 'open' | 'in_progress' | 'resolved'; created_at: string
}
// owner = "Owner" (full access + manage team), operator = "Onboarding",
// billing = "Billing" (financials), support = "Support" (inbox only).
// An operator holds one primary role plus optional extra teams (multi-role);
// their access is the union of the set — enforced in the DB role walls.
export type OperatorRole = 'owner' | 'operator' | 'support' | 'billing'
export type PlatformOperator = {
  profile_id: string; name: string; email: string | null
  role: OperatorRole; extra_roles: OperatorRole[]
  added_by_name: string | null; added_at: string
}
export type AuditEntry = {
  id: string; actor_name: string | null; actor_email: string | null
  action: string; target_type: string | null; target_id: string | null
  detail: Record<string, any> | null; created_at: string
}
// One row per community for the AI Insights tab — this calendar month's AI spend
// + call count, lifetime totals, the monthly cap (cents), and when AI was last
// used. From the platform_ai_usage() RPC (security definer; admins only).
export type PlatformAiUsage = {
  community_id: string; name: string | null; plan: string | null
  cap_cents: number
  month_cost_cents: number; month_calls: number
  total_cost_cents: number; total_calls: number
  last_used_at: string | null
}
// "Where is AI used most" — one row per (function, document kind): roster, budget,
// insurance, rules, categorize, minutes, violation. From platform_ai_usage_by_kind().
export type PlatformAiUsageByKind = {
  fn: string; kind: string
  month_cost_cents: number; month_calls: number
  total_cost_cents: number; total_calls: number
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

// The signed-in operator's full team set (primary + extras), e.g.
// ['operator','billing']. undefined while loading, null when the user isn't
// an operator at all. Falls back to the single platform_role on a DB that
// predates operator-multi-role.sql.
export function usePlatformRoles(): OperatorRole[] | null | undefined {
  const { profile } = useAuth() || {}
  const [roles, setRoles] = useState<OperatorRole[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    if (!hasSupabase || !supabase || !profile?.id) { setRoles(null); return }
    ;(async () => {
      const { data, error } = await supabase!.rpc('platform_roles', { uid: profile.id })
      if (!error && Array.isArray(data)) {
        if (!cancelled) setRoles(data.length ? (data as OperatorRole[]) : null)
        return
      }
      const { data: single, error: singleErr } = await supabase!.rpc('platform_role', { uid: profile.id })
      if (!cancelled) setRoles(!singleErr && single ? [single as OperatorRole] : null)
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  return roles
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
  const [myRoles, setMyRoles] = useState<OperatorRole[]>([])
  const [aiUsage, setAiUsage] = useState<PlatformAiUsage[]>([])
  const [aiByKind, setAiByKind] = useState<PlatformAiUsageByKind[]>([])
  const [loading, setLoading] = useState(true)

  // Only the FIRST load shows the loading shell; every reload after a
  // mutation (role change, transfer, …) refreshes silently in the background
  // so the console doesn't flash "Loading…" on each save.
  const loadedOnce = useRef(false)
  const load = useCallback(async () => {
    // No session/profile → resolve to "not authorized" instead of hanging on
    // the loading state forever (isAdmin must leave null, or the page's
    // `loading || isAdmin === null` guard never clears).
    if (!hasSupabase || !supabase || !profile?.id) { setIsAdmin(false); setLoading(false); return }
    const first = !loadedOnce.current
    if (first) setLoading(true)
    try {
      const { data, error } = await supabase.rpc('platform_overview')
      if (error) { setIsAdmin(false); setCommunities([]); setRequests([]); setOperators([]); setAudit([]); setMyRole(null); setMyRoles([]); return }
      setIsAdmin(true)
      // Alphabetical by community name — drives both the Communities and the
      // Subscriptions tables (they iterate this same array).
      setCommunities(
        ([...((data ?? []) as PlatformCommunity[])])
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      )
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
        extra_roles: (Array.isArray(o.extra_roles) ? o.extra_roles : []) as OperatorRole[],
        added_by_name: o.added_by_name || null, added_at: o.added_at,
      }))
      setOperators(mapped)
      const me = mapped.find(o => o.profile_id === profile.id)
      setMyRole(me?.role ?? null)
      setMyRoles(me ? [me.role, ...me.extra_roles.filter(r => r !== me.role)] : [])
      // Recent activity (audit log).
      const { data: log } = await supabase.rpc('platform_audit', { p_limit: 100 })
      setAudit((log ?? []) as AuditEntry[])
      // AI usage per community (this month + lifetime + cap). OWNER-ONLY — the
      // RPC is owner-gated, so skip the call for non-owners (no point firing a
      // guaranteed-to-fail request). Tolerant: also empty until ai-usage.sql runs.
      if (me?.role === 'owner') {
        const { data: ai } = await supabase.rpc('platform_ai_usage')
        setAiUsage((ai ?? []) as PlatformAiUsage[])
        const { data: byKind } = await supabase.rpc('platform_ai_usage_by_kind')
        setAiByKind((byKind ?? []) as PlatformAiUsageByKind[])
      } else {
        setAiUsage([]); setAiByKind([])
      }
    } finally {
      loadedOnce.current = true
      if (first) setLoading(false)
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
      // 'none' marks an operator with no home community: "exit" then parks
      // them at community_id = NULL instead of re-entering somewhere.
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('platform_return_to', profile?.community_id ?? 'none')
      }
      const { error } = await supabase.rpc('platform_enter_community', { target: communityId })
      return !error
    } catch { return false }
  }, [profile?.community_id])

  // ---- Owner-only operator management. The DB enforces owner + guardrails
  // (last-owner protection, valid roles); these just surface the error string.
  // extras lets the caller grant additional teams in the same act: the add RPC
  // only takes a primary role, so the extras are applied right after, looked up
  // by the email that was just added.
  const addOperator = useCallback(async (email: string, role: OperatorRole, extras: OperatorRole[] = []): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_add_operator', { target_email: email, target_role: role })
    if (error) return error.message
    const wanted = extras.filter(r => r !== role && r !== 'owner')
    if (role !== 'owner' && wanted.length > 0) {
      const { data: ops } = await supabase.rpc('platform_operators')
      const target = (ops ?? []).find((o: any) => (o.email || '').toLowerCase() === email.trim().toLowerCase())
      if (target) {
        const { error: exErr } = await supabase.rpc('platform_set_operator_extra_roles', { target: target.profile_id, extras: wanted })
        if (exErr) { await load(); return `Added as ${role}, but the extra teams failed: ${exErr.message}` }
      }
    }
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

  // Optimistic: flip the row locally the moment the save lands, then let the
  // silent background reload reconcile (no loading flash, no visible refresh).
  const setOperatorRole = useCallback(async (profileId: string, role: OperatorRole): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_set_operator_role', { target: profileId, new_role: role })
    if (error) return error.message
    setOperators(ops => ops.map(o => o.profile_id === profileId
      ? { ...o, role, extra_roles: role === 'owner' ? [] : o.extra_roles.filter(r => r !== role) }
      : o))
    await load()
    return null
  }, [load])

  // Owner-only: set an operator's extra teams (multi-role). Their access
  // becomes the union of primary + extras — enforced by the DB walls.
  const setOperatorExtraRoles = useCallback(async (profileId: string, extras: OperatorRole[]): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_set_operator_extra_roles', { target: profileId, extras })
    if (error) return error.message
    setOperators(ops => ops.map(o => o.profile_id === profileId ? { ...o, extra_roles: extras } : o))
    await load()
    return null
  }, [load])

  // Delete a whole community (operator). Goes through the delete-community edge
  // fn with a community_id so the Stripe subscription is cancelled too.
  const removeCommunity = useCallback(async (communityId: string): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('delete-community', {
      body: { community_id: communityId },
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    })
    if (error) {
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) return b.error } catch { /* ignore */ }
      return 'Could not delete the community.'
    }
    if (data?.error) return data.error
    await load()
    return null
  }, [load])

  // List a community's residents (operator), for the in-console roster modal.
  const fetchResidents = useCallback(async (communityId: string): Promise<PlatformResident[]> => {
    if (!hasSupabase || !supabase) return []
    const { data, error } = await supabase.rpc('platform_community_residents', { p_community: communityId })
    if (error) return []
    // Alphabetical by resident name.
    return ((data ?? []) as PlatformResident[])
      .sort((a, b) => (a.full_name || '~').localeCompare(b.full_name || '~'))
  }, [])

  const removeResident = useCallback(async (residentId: string): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_remove_resident', { p_resident: residentId })
    if (error) return error.message
    await load()
    return null
  }, [load])

  // Operator backstop: reassign a community's owner (owner/operator roles only,
  // enforced in the DB function; audited). stepDown also drops the outgoing
  // owner to a regular resident in the same act.
  const transferOwnership = useCallback(async (communityId: string, newOwnerProfileId: string, stepDown = false): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('community_transfer_ownership', {
      p_community: communityId, p_new_owner: newOwnerProfileId, p_step_down: stepDown,
    })
    if (error) return error.message
    await load()
    return null
  }, [load])

  // Set a community's monthly AI cap (cents). 0 = unlimited. Platform admins only
  // (enforced in the DB function). Refreshes the console after.
  const setAiCap = useCallback(async (communityId: string, cents: number): Promise<string | null> => {
    if (!hasSupabase || !supabase) return 'Not connected'
    const { error } = await supabase.rpc('platform_set_ai_cap', { p_community: communityId, p_cents: Math.max(0, Math.round(cents)) })
    if (error) return error.message
    await load()
    return null
  }, [load])

  return {
    isAdmin, myRole, myRoles, communities, requests, operators, audit, aiUsage, aiByKind, loading, reload: load,
    setRequestStatus, enterCommunity, addOperator, removeOperator, setOperatorRole,
    setOperatorExtraRoles, removeCommunity, fetchResidents, removeResident, transferOwnership, setAiCap,
  }
}

// ---- Two-way platform support threads (platform_request_messages) ----
export type PlatformThreadMessage = {
  id: string; requestId: string; authorRole: 'operator' | 'board'
  authorName: string | null; body: string
  attachmentPath: string | null; attachmentName: string | null
  attachmentUrl: string | null; createdAt: string
}

const ptRow = (r: any): PlatformThreadMessage => ({
  id: r.id, requestId: r.request_id,
  authorRole: r.author_role === 'operator' ? 'operator' : 'board',
  authorName: r.author_name ?? null, body: r.body,
  attachmentPath: r.attachment_path ?? null, attachmentName: r.attachment_name ?? null,
  attachmentUrl: null, createdAt: r.created_at,
})

// The message log for one support ticket, with realtime so a reply from the
// other side appears live. Used by both the platform console and admin support.
export function usePlatformThread(requestId: string | null) {
  const [messages, setMessages] = useState<PlatformThreadMessage[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !requestId) { setMessages([]); return }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('platform_request_messages')
        .select('*').eq('request_id', requestId)
        .order('created_at', { ascending: true })
      const msgs = (data || []).map(ptRow)
      // Sign attachment URLs so private photos render in-app.
      await Promise.all(msgs.map(async (m) => {
        if (!m.attachmentPath || !supabase) return
        const { data: s } = await supabase.storage.from('platform-attachments').createSignedUrl(m.attachmentPath, 3600)
        m.attachmentUrl = s?.signedUrl ?? null
      }))
      setMessages(msgs)
    } catch { /* keep what we have */ } finally { setLoading(false) }
  }, [requestId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hasSupabase || !supabase || !requestId) return
    const ch = supabase
      .channel(`platform-thread:${requestId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'platform_request_messages',
        filter: `request_id=eq.${requestId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase!.removeChannel(ch) }
  }, [requestId, load])

  return { messages, loading, reload: load }
}

// Operator reply — goes through the platform-reply edge fn (saves the message,
// uploads the optional photo, emails the board member). Returns null on success.
export async function sendPlatformReply(input: {
  requestId: string; body: string
  photo?: { base64: string; name: string } | null
}): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Not connected'
  // Explicitly forward the session token — invoke() doesn't auto-attach it with
  // this app's sessionStorage auth (same pattern as removeCommunity above).
  const { data: { session } } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('platform-reply', {
    body: {
      request_id: input.requestId, body: input.body,
      photo_base64: input.photo?.base64 ?? null, photo_name: input.photo?.name ?? null,
    },
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) {
    const anyErr = error as any
    try {
      const ctx = anyErr.context
      if (ctx && typeof ctx.json === 'function') { const b = await ctx.json(); if (b?.error || b?.message) return b.error || b.message }
      else if (ctx && typeof ctx.text === 'function') { const t = await ctx.text(); if (t) return t.slice(0, 300) }
    } catch { /* ignore */ }
    return anyErr.message || 'Could not send the reply.'
  }
  if (data && data.ok === false) return data.error || 'Could not send the reply.'
  return null
}

// Upload a board-side image to the private platform-attachments bucket under the
// ticket's folder (RLS scopes it to the submitter). Returns the stored path/name.
export async function uploadPlatformAttachment(
  requestId: string, file: File,
): Promise<{ path: string; name: string } | { error: string }> {
  if (!hasSupabase || !supabase) return { error: 'Not connected' }
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase()
  const path = `${requestId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('platform-attachments').upload(path, file, { upsert: false })
  if (error) return { error: error.message }
  return { path, name: file.name }
}

// Operator → community: open a new support thread addressed to a community. The
// ticket starts 'in_progress' (waiting on the community, so it stays off the
// operator badge until they reply). Returns null on success, else an error.
export async function openCommunityThread(input: {
  communityId: string; subject: string; body: string
  operatorId: string; operatorName: string | null; operatorEmail: string | null
}): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Not connected'
  const { data, error } = await supabase.from('platform_requests').insert({
    from_profile_id: input.operatorId,
    from_community_id: input.communityId,
    from_name: input.operatorName,
    from_email: input.operatorEmail,
    subject: input.subject,
    body: null,              // the opening message lives in the thread, posted below
    status: 'in_progress',
  }).select('id').single()
  if (error) return error.message
  const reqId = (data as any)?.id as string | undefined
  if (reqId) {
    const { error: mErr } = await supabase.from('platform_request_messages').insert({
      request_id: reqId, author_profile_id: input.operatorId,
      author_role: 'operator', author_name: input.operatorName, body: input.body,
    })
    if (mErr) return mErr.message
  }
  return null
}

// Board reply — the community side of the thread (direct insert, RLS-scoped to
// the submitter). Returns null on success.
export async function sendPlatformBoardMessage(input: {
  requestId: string; authorId: string; authorName: string | null; body: string
  attachmentPath?: string | null; attachmentName?: string | null
}): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Not connected'
  const { error } = await supabase.from('platform_request_messages').insert({
    request_id: input.requestId, author_profile_id: input.authorId,
    author_role: 'board', author_name: input.authorName, body: input.body,
    attachment_path: input.attachmentPath ?? null, attachment_name: input.attachmentName ?? null,
  })
  return error ? error.message : null
}
