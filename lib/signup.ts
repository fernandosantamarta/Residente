import { supabase, hasSupabase, getProfile } from './supabase'

// Client helpers for the self-serve /signup flow. The heavy lifting (creating
// the community, profile, membership, and roster row) happens server-side in
// the `signup-provision` edge function, which runs with the service role. The
// browser's only job is to authenticate (supabase.auth.signUp) and then hand
// the collected answers to that function.

export type SignupRole = 'resident' | 'board_member' | 'admin'
export type PropertyType = 'condo' | 'hoa'

export interface ProvisionCreate {
  mode: 'create'
  association_type: PropertyType
  community_name: string
  location?: string
  unit_count?: number
  role: 'board_member' | 'admin'
  full_name: string
  unit_number?: string
}

export interface ProvisionJoin {
  mode: 'join'
  full_name: string
  join_code?: string
  unit_number?: string
}

export type ProvisionInput = ProvisionCreate | ProvisionJoin

export interface ProvisionResult {
  ok: boolean
  community_id: string
  role: SignupRole
  join_code?: string
  plan?: string           // free | pro | premium | enterprise
  needs_payment?: boolean // always true now (every plan bills after the trial); no
                          // longer triggers on-the-spot checkout — signup goes to
                          // /admin and add-payment happens via the billing page.
  pending?: boolean       // join only: the resident didn't match the roster (email
                          // or address), so they're awaiting board approval — show
                          // the "waiting for approval" screen instead of the cockpit.
}

// Start the platform-subscription Stripe Checkout for the caller's community and
// return the hosted-checkout URL (null on failure — the caller falls back to
// /admin, where the Activate banner lets them retry). Used by /signup right after
// provisioning and by the /admin Activate banner.
export async function startSubscriptionCheckout(): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
      body: {},
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined,
    })
    if (error || !data?.url) return null
    return data.url as string
  } catch {
    return null
  }
}

// Opens the Stripe Billing Customer Portal (manage card / invoices / cancel
// anytime) for the caller's community. Returns the portal URL or null on
// failure. Admin/board only — the edge fn 403s residents. Used by the /admin
// "Manage subscription" action and the past-due "Update payment" button.
export async function openBillingPortal(): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('create-billing-portal', {
      body: {},
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined,
    })
    if (error || !data?.url) return null
    return data.url as string
  } catch {
    return null
  }
}

// In-app subscription management (manage-subscription edge fn). action is
// status | cancel | resume | change_plan; change_plan takes { home_count, plan }.
// Returns the fn's JSON, or { error } on failure. Admin/board only (fn 403s
// residents). Used by the /admin Manage subscription dialog.
export async function manageSubscription(
  action: 'status' | 'cancel' | 'resume' | 'change_plan',
  payload: { home_count?: number; plan?: string; addons?: string[] } = {},
): Promise<any> {
  if (!hasSupabase || !supabase) return { error: 'Not available' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('manage-subscription', {
      body: { action, ...payload },
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    })
    if (error) {
      // Pull the edge fn's { error } body out of the non-2xx response.
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) return { error: b.error } } catch { /* ignore */ }
      return { error: 'Something went wrong.' }
    }
    return data
  } catch {
    return { error: 'Something went wrong.' }
  }
}

// Permanently delete the signed-in user's own account (delete-account edge fn).
// The community is owned collectively, so leaving is fine as long as another board
// member/admin remains (the owner pointer hands off automatically). If they're the
// LAST board member while the community still has other members, returns
// { code:'last_admin_with_members' }; if they're the sole member, the community is
// torn down too. Caller should sign out + redirect on { ok }.
export async function deleteAccount(): Promise<{ ok?: boolean; error?: string; code?: string }> {
  if (!hasSupabase || !supabase) return { error: 'Not available' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: {},
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    })
    if (error) {
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) return { error: b.error, code: b.code } } catch { /* ignore */ }
      return { error: 'Something went wrong.' }
    }
    return data
  } catch { return { error: 'Something went wrong.' } }
}

// Permanently delete the caller's whole community + all its data (delete-community
// edge fn). Admin/board only. Caller should sign out + redirect on { ok }.
export async function deleteCommunity(): Promise<{ ok?: boolean; error?: string }> {
  if (!hasSupabase || !supabase) return { error: 'Not available' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('delete-community', {
      body: {},
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    })
    if (error) {
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) return { error: b.error } } catch { /* ignore */ }
      return { error: 'Something went wrong.' }
    }
    return data
  } catch { return { error: 'Something went wrong.' } }
}

// Error thrown by provisionAccount. `code` mirrors the edge function's
// business-error codes (bad_code | no_match | ambiguous) so the UI can react
// — e.g. fall back from email-match to asking for a join code.
export class ProvisionError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ProvisionError'
    this.code = code
  }
}

// supabase.functions.invoke surfaces a non-2xx response as a FunctionsHttpError
// whose `context` is the raw Response. Pull our { error, code } body out of it.
async function readFnError(error: unknown): Promise<ProvisionError> {
  const anyErr = error as { message?: string; context?: Response }
  try {
    const res = anyErr?.context
    if (res && typeof res.json === 'function') {
      const body = await res.json()
      if (body?.error) return new ProvisionError(body.error, body.code)
    }
  } catch {
    /* fall through to the generic message */
  }
  return new ProvisionError(anyErr?.message || 'Could not finish setting up your account')
}

// ---------------------------------------------------------------------------
// Deferred provisioning (email-confirmation safety net).
//
// The happy path assumes email confirmation is OFF: supabase.auth.signUp returns
// a live session, so /signup provisions inline. If confirmation is ON, signUp
// returns NO session — the user must click an emailed link and come back to sign
// in, by which point the answers they typed are gone and nothing ever creates
// their community. To survive that, /signup stashes the collected ProvisionInput
// before showing the "check your email" screen, and the next authenticated page
// load (the login flow) resumes it. Idempotent by design: if the user already
// has a community, the stash is discarded rather than creating a duplicate.
// ---------------------------------------------------------------------------

const PENDING_KEY = 'residente.pendingProvision.v1'

export function stashPendingProvision(input: ProvisionInput): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(input)) } catch { /* private mode / no storage */ }
}

export function clearPendingProvision(): void {
  try { localStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
}

function readPendingProvision(): ProvisionInput | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.mode === 'create' || parsed?.mode === 'join') return parsed as ProvisionInput
  } catch { /* corrupt — fall through and clear */ }
  clearPendingProvision()
  return null
}

// If a sign-up was left mid-flight (email-confirm branch), finish it now that the
// user is authenticated. Returns the destination route ('/admin' | '/onboard')
// when provisioning ran, or null when there was nothing to resume. Safe to call
// on every authenticated entry point — it no-ops without a stashed payload, an
// active session, or when the user already belongs to a community.
export async function resumePendingProvision(): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  const input = readPendingProvision()
  if (!input) return null

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return null

  // Already provisioned (e.g. they completed signup elsewhere, or this is a
  // stale stash) — never create a second community. Discard and bail.
  const { data: existing } = await getProfile(session.user.id)
  if (existing?.community_id) { clearPendingProvision(); return null }

  try {
    const res = await provisionAccount(input, session.access_token)
    clearPendingProvision()
    return res.role === 'resident' ? '/onboard' : '/admin'
  } catch (e) {
    // Unrecoverable join errors (bad code / no match) would loop forever if we
    // kept retrying them on every load — drop the stash. Transient/network
    // errors keep it so the next load can try again.
    const code = (e as ProvisionError)?.code
    if (code && ['bad_code', 'no_match', 'ambiguous'].includes(code)) clearPendingProvision()
    return null
  }
}

// A document the board attached during the /signup document-collection wizard,
// ready to land in the community's vault once provisioning has created it.
export interface CollectedDoc {
  title: string
  category: string
  file: File
}

// A free-text note the board typed against one wizard category.
export interface CollectedNote {
  section: string
  note: string
}

// Persist the per-category notes the board typed in the signup wizard. One row
// per non-empty note in community_setup_notes (board-only RLS). Best-effort and
// non-fatal: a failure must never block finishing signup. A later AI slice reads
// these by community to pre-fill settings / flag missing docs. Returns the count
// actually saved.
export async function saveSignupNotes(
  communityId: string,
  notes: CollectedNote[],
): Promise<number> {
  if (!hasSupabase || !supabase || !communityId) return 0
  const rows = notes
    .map((n) => ({ community_id: communityId, section: n.section, note: n.note.trim() }))
    .filter((n) => n.note.length > 0)
  if (!rows.length) return 0
  try {
    const { error } = await supabase.from('community_setup_notes').insert(rows)
    return error ? 0 : rows.length
  } catch { return 0 }
}

// Persist documents gathered in the signup wizard to the new community's vault.
// Mirrors the admin Documents upload exactly (same `documents` bucket + table,
// same `${communityId}/${uuid}.${ext}` path) so they appear in /admin/documents
// like any other upload. Best-effort and per-file isolated: a single failed
// upload never aborts the rest, and the caller treats a total failure as
// non-fatal — the board can always re-add documents in /admin. Returns the
// count actually saved.
export async function uploadSignupDocuments(
  communityId: string,
  docs: CollectedDoc[],
): Promise<number> {
  if (!hasSupabase || !supabase || !communityId || !docs.length) return 0
  let saved = 0
  for (const d of docs) {
    try {
      const ext = d.file.name.includes('.') ? d.file.name.split('.').pop()!.toLowerCase() : 'bin'
      const path = `${communityId}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('documents').upload(path, d.file)
      if (up.error) continue
      const { error } = await supabase.from('documents').insert({
        community_id: communityId,
        title: d.title,
        category: d.category,
        storage_path: path,
        file_size: d.file.size,
      })
      if (error) {
        // Roll back the orphaned object so a failed row-insert leaves no litter.
        await supabase.storage.from('documents').remove([path])
        continue
      }
      saved++
    } catch { /* per-file best-effort — keep going */ }
  }
  return saved
}

export async function provisionAccount(
  input: ProvisionInput,
  accessToken?: string,
): Promise<ProvisionResult> {
  if (!hasSupabase || !supabase) throw new ProvisionError('Supabase is not configured')
  // Pass the user's access token explicitly. Right after signUp, the new session
  // isn't in storage yet, so supabase.auth.getSession() can return null and the
  // invoke goes out unauthenticated → the gateway 401s it ("Invalid credentials")
  // before the function runs. The caller (finish / resume) holds the fresh
  // session in memory, so it threads the token in here directly; we only fall
  // back to getSession() when no token was passed.
  let token = accessToken
  if (!token) token = (await supabase.auth.getSession()).data.session?.access_token
  const { data, error } = await supabase.functions.invoke('signup-provision', {
    body: input,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (error) throw await readFnError(error)
  if (data?.error) throw new ProvisionError(data.error, data.code)
  return data as ProvisionResult
}
