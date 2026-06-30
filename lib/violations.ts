// Violations & Enforcement, backed by the Supabase `ev_violations` table.
//   - app/admin/violations/page.tsx — the board issues + manages (community)
//   - app/app/voice (Contact) + /app/documents strip — a resident sees their OWN
// Each violation is owned by a resident (profile_id); RLS shows residents
// only their own and the board the whole community. Issuing one fires a
// personal in-app notice to that resident (DB trigger).

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

export type ViolationKind = 'warning' | 'fine'
export type ViolationStatus = 'open' | 'appealed' | 'closed'
export type ViolationResolution = 'stripe-paid' | 'manual-paid' | 'waived' | 'dismissed'
export type DisputeStatus = 'filed' | 'under_review' | 'upheld' | 'dismissed' | 'reduced'

export type Violation = {
  id: string
  profile_id: string | null
  kind: ViolationKind
  rule_id: string | null
  rule_title: string | null
  resident: string            // resident_label (denormalized "Name · Unit")
  amount: number | null
  status: ViolationStatus
  resolution: ViolationResolution | null
  stripe_invoice_id: string | null
  notes: string | null
  opened_at: string
  due_at: string | null       // fine payment deadline (fine-due-date.sql); null for warnings
  closed_at: string | null
  // Fine-dispute layer (fine-disputes.sql)
  dispute_status: DisputeStatus | null
  dispute_filed_at: string | null
  dispute_reason: string | null
  dispute_decided_at: string | null
  dispute_decision_note: string | null
  reduced_amount: number | null
  dispute_attachment_path: string | null
  dispute_attachment_name: string | null
}

const SELECT = 'id, profile_id, kind, rule_id, rule_title, resident_label, amount, status, resolution, stripe_invoice_id, notes, opened_at, due_at, closed_at, dispute_status, dispute_filed_at, dispute_reason, dispute_decided_at, dispute_decision_note, reduced_amount, dispute_attachment_path, dispute_attachment_name'
// Pre-migration fallback: same columns minus due_at (fine-due-date.sql not run
// yet). Lets the app keep working — the card computes the due date instead.
const SELECT_LEGACY = SELECT.replace('opened_at, due_at,', 'opened_at,')
// Flips true the first time the DB reports due_at is missing, so we stop
// firing a query that 42703s on every load / realtime refresh. A page refresh
// (after the migration runs) resets it back to false.
let dueColumnMissing = false
const isMissingDueColumn = (e: any) =>
  e?.code === '42703' && typeof e?.message === 'string' && e.message.includes('due_at')

const rowTo = (r: any): Violation => ({
  id: r.id,
  profile_id: r.profile_id ?? null,
  kind: r.kind,
  rule_id: r.rule_id ?? null,
  rule_title: r.rule_title ?? null,
  resident: r.resident_label ?? '—',
  amount: r.amount ?? null,
  status: r.status,
  resolution: r.resolution ?? null,
  stripe_invoice_id: r.stripe_invoice_id ?? null,
  notes: r.notes ?? null,
  opened_at: r.opened_at,
  due_at: r.due_at ?? null,
  closed_at: r.closed_at ?? null,
  dispute_status: r.dispute_status ?? null,
  dispute_filed_at: r.dispute_filed_at ?? null,
  dispute_reason: r.dispute_reason ?? null,
  dispute_decided_at: r.dispute_decided_at ?? null,
  dispute_decision_note: r.dispute_decision_note ?? null,
  reduced_amount: r.reduced_amount ?? null,
  dispute_attachment_path: r.dispute_attachment_path ?? null,
  dispute_attachment_name: r.dispute_attachment_name ?? null,
})

const today = () => new Date().toISOString().slice(0, 10)

// ---------- bridge: unpaid fine → collections ----------
// Escalate an unpaid violation fine into a collection case. The fine and the
// collection ladder live in two different sections (Easy Documents vs.
// Compliance); this is the one-click handoff between them. Returns the owner's
// EXISTING open collection case if they already have one (a partial-unique index
// allows only one open case per owner, so we reuse rather than collide), else
// opens a new fine-only case (is_fine_only=true → the HB 1203 sub-$1,000
// fine-floor warning applies). Caller navigates to caseId.
const COLLECTION_OPEN_STAGES = ['delinquent', 'notice_30', 'intent_to_lien', 'lien_recorded', 'intent_to_foreclose', 'foreclosure']
export async function sendFineToCollections(opts: {
  violation: Violation
  communityId: string
  createdBy: string | null
  residents: { id: string; profile_id: string | null; label: string }[]
}): Promise<{ caseId: string; created: boolean }> {
  if (!hasSupabase || !supabase) throw new Error('Supabase is not configured')
  const { violation: v, communityId, createdBy, residents } = opts
  const resident = residents.find(r => r.profile_id && r.profile_id === v.profile_id) || null

  // Reuse the owner's existing open case if there is one.
  let q = supabase.from('ev_collection_cases').select('id')
    .eq('community_id', communityId).in('stage', COLLECTION_OPEN_STAGES).limit(1)
  if (resident && v.profile_id) q = q.or(`resident_id.eq.${resident.id},profile_id.eq.${v.profile_id}`)
  else if (resident) q = q.eq('resident_id', resident.id)
  else if (v.profile_id) q = q.eq('profile_id', v.profile_id)
  const { data: existing } = await q
  if (existing && existing[0]) return { caseId: (existing[0] as any).id, created: false }

  const amount = Number(v.amount) || 0
  const note = `Opened from an unpaid fine: ${v.rule_title || 'violation'} ($${Math.round(amount).toLocaleString('en-US')}). Violation ${v.id}.`
  const { data: ins, error } = await supabase.from('ev_collection_cases').insert({
    community_id: communityId,
    profile_id: v.profile_id,
    resident_id: resident?.id ?? null,
    unit_label: v.resident || resident?.label || null,
    stage: 'delinquent',
    delinquent_since: v.opened_at || null,
    principal_balance: amount,
    total_balance: amount,
    is_fine_only: true,
    notes: note,
    created_by: createdBy,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return { caseId: (ins as any).id, created: true }
}

// Derived headline stats for the resident strip (unchanged contract).
export function computeStats(list: Violation[]) {
  let warnings = 0, fines_collected = 0, resolved = 0, appeals = 0
  for (const v of list) {
    if (v.kind === 'warning') warnings++
    if (v.kind === 'fine' && (v.resolution === 'stripe-paid' || v.resolution === 'manual-paid')) {
      fines_collected += Number(v.amount) || 0
    }
    if (v.status === 'closed') resolved++
    if (v.status === 'appealed') appeals++
  }
  return { warnings, fines: fines_collected, resolved, appeals }
}

// ---------- core fetch (realtime) ----------
function useViolations(scope: 'community' | 'mine') {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const myId = profile?.id
  const [list, setList] = useState<Violation[]>([])
  const [loading, setLoading] = useState(true)
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    try {
      const run = (sel: string) => {
        const base = supabase!.from('ev_violations').select(sel).order('opened_at', { ascending: false })
        return scope === 'mine' ? base.eq('profile_id', myId) : base.eq('community_id', communityId)
      }
      let { data, error } = await run(dueColumnMissing ? SELECT_LEGACY : SELECT)
      if (error && isMissingDueColumn(error)) {
        // due_at column not migrated yet — fall back for the rest of the session.
        dueColumnMissing = true
        ;({ data, error } = await run(SELECT_LEGACY))
      }
      if (error) throw error
      setList((data ?? []).map(rowTo))
    } finally {
      setLoading(false)
    }
  }, [communityId, myId, scope])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const channel = supabase
      .channel(`violations:${scope}:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_violations',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [communityId, channelId, scope, load])

  return { list, loading, reload: load, communityId, myId }
}

// Community list (board sees all; a resident viewing this still sees only
// their own via RLS). Used by admin + the /app/documents strip.
export function useViolationsData(): Violation[] {
  return useViolations('community').list
}

// The signed-in resident's own violations, regardless of role. For Contact.
export function useMyViolations(): { violations: Violation[]; loading: boolean } {
  const { list, loading } = useViolations('mine')
  return { violations: list, loading }
}

// Community residents for the "issue against" picker.
export function useCommunityResidents(): { id: string; profile_id: string | null; label: string }[] {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<{ id: string; profile_id: string | null; label: string }[]>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!hasSupabase || !supabase || !communityId) return
      const { data } = await supabase
        .from('residents')
        .select('id, profile_id, full_name, unit_number, address')
        .eq('community_id', communityId)
      if (cancelled || !data) return
      setRows(data.map((r: any) => {
        const name = r.full_name || 'Resident'
        const unit = r.unit_number || r.address
        return { id: r.id, profile_id: r.profile_id ?? null, label: unit ? `${name} · ${unit}` : name }
      }).sort((a, b) => a.label.localeCompare(b.label)))
    }
    run()
    return () => { cancelled = true }
  }, [communityId])

  return rows
}

// ---------- status workflow (update by id; RLS enforces; realtime refreshes) ----------
async function setStatus(id: string, patch: Partial<{ status: ViolationStatus; resolution: ViolationResolution | null; closed_at: string | null }>) {
  if (!hasSupabase || !supabase) return
  await supabase.from('ev_violations').update(patch).eq('id', id)
}
export const markStripePaid = (id: string) => setStatus(id, { status: 'closed', resolution: 'stripe-paid', closed_at: today() })
export const markManualPaid = (id: string) => setStatus(id, { status: 'closed', resolution: 'manual-paid', closed_at: today() })
export const waive          = (id: string) => setStatus(id, { status: 'closed', resolution: 'waived', closed_at: today() })
export const dismiss        = (id: string) => setStatus(id, { status: 'closed', resolution: 'dismissed', closed_at: today() })
export const appeal         = (id: string) => setStatus(id, { status: 'appealed', resolution: null, closed_at: null })
export const reopen         = (id: string) => setStatus(id, { status: 'open', resolution: null, closed_at: null })
export async function removeStoredViolation(id: string) {
  if (!hasSupabase || !supabase) return
  await supabase.from('ev_violations').delete().eq('id', id)
}

// Resident pays their own open fine. Starts a Stripe Checkout session via the
// create-fine-checkout edge function and redirects to Stripe's hosted page.
// On return, the stripe-webhook closes the fine as 'stripe-paid' and the
// realtime subscription refreshes the row. Mirrors the dues checkout flow.
// Returns an error message on failure, or null on a successful redirect.
export async function payFine(violationId: string): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Payments are not configured.'
  try {
    const { data, error } = await supabase.functions.invoke('create-fine-checkout', {
      body: { violation_id: violationId },
    })
    if (error) return error.message || 'Could not start checkout.'
    const url = (data as { url?: string })?.url
    if (!url) return 'Could not start checkout.'
    window.location.href = url
    return null
  } catch (err) {
    return (err as Error)?.message || 'Could not start checkout.'
  }
}

// ---------- fine disputes (statutory contest) ----------
const MAX_EVIDENCE = 10 * 1024 * 1024  // 10MB, matches RequestForm

// Resident contests their own fine. Optionally uploads photo/PDF evidence to the
// existing 'request-attachments' bucket, then files the dispute via the
// file_fine_dispute RPC (security definer — writes only the dispute_* fields).
// Routes the fine onto the hearing track. Returns an error string, or null.
export async function fileDispute(
  violationId: string,
  reason: string,
  file?: File | null,
): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Not configured.'
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return 'Please sign in to contest a fine.'
  if (file && file.size > MAX_EVIDENCE) return 'That file is too large (max 10MB).'

  let attachment_path: string | null = null
  let attachment_name: string | null = null
  let uploadedPath: string | null = null
  try {
    if (file) {
      // community comes from the caller's profile (same convention as RequestForm).
      const { data: prof } = await supabase.from('profiles').select('community_id').eq('id', user.id).single()
      const communityId = prof?.community_id
      if (!communityId) return 'Could not resolve your community.'
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
      const path = `${communityId}/${user.id}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('request-attachments').upload(path, file)
      if (up.error) return up.error.message || 'Could not upload your evidence.'
      uploadedPath = path
      attachment_path = path
      attachment_name = file.name
    }
    const { error } = await supabase.rpc('file_fine_dispute', {
      p_violation_id: violationId,
      p_reason: reason,
      p_attachment_path: attachment_path,
      p_attachment_name: attachment_name,
    })
    if (error) {
      if (uploadedPath) supabase.storage.from('request-attachments').remove([uploadedPath])
      return error.message || 'Could not file the dispute.'
    }
    return null
  } catch (err) {
    if (uploadedPath) supabase.storage.from('request-attachments').remove([uploadedPath])
    return (err as Error)?.message || 'Could not file the dispute.'
  }
}

// Board records the fining committee's decision on a contested fine. 'dismissed'
// closes the fine (waived); 'reduced' sets the payable amount; 'upheld' keeps the
// fine open for payment. The DB trigger notifies the owner of the decision.
export async function decideDispute(
  id: string,
  decision: 'upheld' | 'dismissed' | 'reduced',
  note: string,
  reducedAmount?: number | null,
): Promise<string | null> {
  if (!hasSupabase || !supabase) return 'Not configured.'
  const patch: Record<string, any> = {
    dispute_status: decision,
    dispute_decided_at: today(),
    dispute_decision_note: note || null,
  }
  if (decision === 'reduced') patch.reduced_amount = reducedAmount ?? null
  if (decision === 'dismissed') {
    // Contest upheld for the owner → the fine is waived and closed.
    patch.status = 'closed'
    patch.resolution = 'waived'
    patch.closed_at = today()
    patch.enforcement_stage = 'rejected'
  } else {
    // upheld / reduced → fine stands; reopen for payment, mark the committee result.
    patch.status = 'open'
    patch.enforcement_stage = 'upheld'
  }
  const { error } = await supabase.from('ev_violations').update(patch).eq('id', id)
  return error ? (error.message || 'Could not record the decision.') : null
}

// ---------- admin management ----------
export type NewViolation = {
  profile_id: string | null
  resident_label: string
  kind: ViolationKind
  rule_id: string | null
  rule_title: string | null
  amount: number | null
  due_at: string | null       // fine payment deadline (ignored for warnings)
  notes: string | null
}

export function useViolationsAdmin() {
  const { list, loading, reload, communityId } = useViolations('community')

  const addViolation = useCallback(async (v: NewViolation): Promise<string | null> => {
    if (!hasSupabase || !supabase || !communityId) return null
    const { data, error } = await supabase
      .from('ev_violations')
      .insert({
        community_id: communityId,
        profile_id: v.profile_id,
        resident_label: v.resident_label,
        kind: v.kind,
        rule_id: v.rule_id,
        rule_title: v.rule_title,
        amount: v.amount,
        // Only send due_at once the column exists (fine-due-date.sql), else the
        // insert 42703s pre-migration. dueColumnMissing is set by the loader.
        ...(dueColumnMissing ? {} : { due_at: v.kind === 'fine' ? v.due_at : null }),
        notes: v.notes,
      })
      .select('id')
      .single()
    if (error) throw error
    await reload()
    return data?.id ?? null
  }, [communityId, reload])

  const deleteAll = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) return
    const { error } = await supabase.from('ev_violations').delete().eq('community_id', communityId)
    if (error) throw error
    await reload()
  }, [communityId, reload])

  return { violations: list, loading, reload, addViolation, deleteAll }
}
