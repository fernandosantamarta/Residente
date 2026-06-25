// Deterministic onboarding import (Phase 0 of ONBOARDING_SETUP_PLAN.md).
//
// The signup "Upload your documents" path parses clean CSV/Excel-exported files
// entirely in code — no AI — and stashes the parsed rows in component state.
// After provisioning creates the community, applySignupImport() writes them to
// the live tables. Mirrors uploadSignupDocuments / saveSignupNotes: best-effort,
// non-fatal, board/management only. The fuzzy bits (CC&Rs prose -> fines/rules)
// are Phase 1 (the extract-setup edge fn) and are NOT handled here.

import { hasSupabase, supabase } from './supabase'

export interface RosterRow {
  full_name: string
  unit_number?: string
  subdivision?: string
  address?: string
  email?: string
  phone?: string
  // Owner balance carried over from the prior manager, "as of" go-live. Positive
  // = the owner owes; negative = a credit. Feeds residents.opening_balance, which
  // residentBalance()/casePayoff()/the GL all read. Undefined when the column is
  // absent or blank (so we never overwrite a real balance with 0).
  opening_balance?: number
}

export interface BudgetRow {
  name: string
  budget: string
  spent: string
}

// A quote-aware CSV line splitter (RFC-4180-ish): keeps "fields, with commas" and
// "escaped ""quotes"" intact. Critical now that a money column is in play — a
// naive split(',') would shred a quoted "1,234.56" into two cells. Embedded
// newlines inside a field aren't supported (we split on lines first), which is
// fine for the roster/balance exports boards actually upload.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(c => c.trim())
}

type RosterField = 'full_name' | 'unit_number' | 'subdivision' | 'address' | 'email' | 'phone' | 'opening_balance'

// Map a header cell to a known field so boards can put columns in ANY order and
// include the opening-balance / unit columns the old positional parser dropped.
// Unrecognized headers are ignored.
function headerField(h: string): RosterField | null {
  const k = h.toLowerCase().replace(/[_#]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (['name', 'full name', 'owner', 'household', 'resident'].includes(k)) return 'full_name'
  if (['unit', 'unit number', 'unit no', 'apt', 'unit / address'].includes(k)) return 'unit_number'
  if (['subdivision', 'sub', 'neighborhood', 'village', 'section'].includes(k)) return 'subdivision'
  if (['address', 'mailing address', 'street', 'street address', 'property address'].includes(k)) return 'address'
  if (['email', 'e mail', 'email address'].includes(k)) return 'email'
  if (['phone', 'telephone', 'mobile', 'cell', 'phone number'].includes(k)) return 'phone'
  if (['opening balance', 'balance', 'balance due', 'amount owed', 'amount due', 'opening ar', 'opening', 'starting balance'].includes(k)) return 'opening_balance'
  return null
}

// Roster CSV → residents rows. If the first row names recognizable columns we map
// by header (any order; picks up unit + opening_balance); otherwise we fall back
// to the legacy positional layout (name, subdivision, address, email, phone) so
// older headerless files keep importing exactly as before. Mirrors the parser in
// app/admin/residents/page.tsx, which now delegates here.
export function parseRosterCsv(text: string): RosterRow[] {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const head = splitCsvLine(lines[0])
  const map: Partial<Record<RosterField, number>> = {}
  let hasHeader = false
  head.forEach((h, i) => {
    const f = headerField(h)
    if (f && map[f] === undefined) { map[f] = i; hasHeader = true }
  })
  const out: RosterRow[] = []
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = splitCsvLine(lines[i])
    if (!c[0]) continue
    if (hasHeader) {
      const at = (f: RosterField) => (map[f] !== undefined ? (c[map[f]!] || '') : '')
      const name = at('full_name')
      if (!name) continue
      const bal = at('opening_balance')
      out.push({
        full_name: name,
        unit_number: at('unit_number'),
        subdivision: at('subdivision'),
        address: at('address'),
        email: at('email'),
        phone: at('phone'),
        opening_balance: bal.trim() ? num(bal) : undefined,
      })
    } else {
      out.push({ full_name: c[0], subdivision: c[1] || '', address: c[2] || '', email: c[3] || '', phone: c[4] || '' })
    }
  }
  return out
}

// Budget CSV → category rows. Columns (header auto-detected if col 2 isn't a
// number): name, budget, spent. Mirrors parseCsv in app/admin/community/page.tsx.
export function parseBudgetCsv(text: string): BudgetRow[] {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line: string) => line.split(',').map(c => c.trim())
  const head = cells(lines[0])
  const start = (head.length >= 2 && isNaN(Number(head[1]))) ? 1 : 0
  const out: BudgetRow[] = []
  for (let i = start; i < lines.length; i++) {
    const c = cells(lines[i])
    if (!c[0]) continue
    out.push({ name: c[0], budget: c[1] || '', spent: c[2] || '' })
  }
  return out
}

const num = (v: string) => { const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }

export interface SignupImport {
  roster?: RosterRow[]
  budget?: BudgetRow[]
}

export interface ImportResult {
  residents: number
  budgetCategories: number
}

// Apply the parsed onboarding import to the freshly-provisioned community.
// Best-effort and per-section isolated: a failure in one never blocks the other
// or the rest of signup. The board can always re-import from /admin. Skips the
// signer's own roster row (already created by signup-provision) by matching on a
// case-insensitive full_name, so they aren't duplicated.
export async function applySignupImport(
  communityId: string,
  data: SignupImport,
  opts: { skipName?: string } = {},
): Promise<ImportResult> {
  const result: ImportResult = { residents: 0, budgetCategories: 0 }
  if (!hasSupabase || !supabase || !communityId) return result

  // Residents — dedupe against the signer's own row.
  const skip = (opts.skipName || '').trim().toLowerCase()
  const roster = (data.roster || [])
    .filter(r => r.full_name && r.full_name.trim())
    .filter(r => r.full_name.trim().toLowerCase() !== skip)
  if (roster.length) {
    try {
      const rows = roster.map(r => ({
        community_id: communityId,
        full_name: r.full_name.trim(),
        unit_number: r.unit_number?.trim() || null,
        subdivision: r.subdivision?.trim() || null,
        address: r.address?.trim() || null,
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
        // Carry the opening balance from the prior manager at onboarding too (same
        // as the /admin/residents import) — only when present, never overwrite with 0.
        ...(typeof r.opening_balance === 'number' && Number.isFinite(r.opening_balance)
          ? { opening_balance: r.opening_balance } : {}),
      }))
      const { error } = await supabase.from('residents').insert(rows)
      if (!error) result.residents = rows.length
    } catch { /* non-fatal */ }
  }

  // Budget categories — clean-replace the starter seed with the uploaded budget.
  const budget = (data.budget || []).filter(b => b.name && b.name.trim())
  if (budget.length) {
    try {
      await supabase.from('budget_categories').delete().eq('community_id', communityId)
      const rows = budget.map((b, i) => ({
        community_id: communityId,
        name: b.name.trim(),
        budget: num(b.budget),
        spent: num(b.spent),
        sort_order: i + 1,
      }))
      const { error } = await supabase.from('budget_categories').insert(rows)
      if (!error) result.budgetCategories = rows.length
    } catch { /* non-fatal */ }
  }

  return result
}

// ---------------------------------------------------------------------------
// Phase 1: AI extraction from a governing-document PDF (CC&Rs / declaration).
// Calls the extract-setup edge function (Claude). Inert until ANTHROPIC_API_KEY
// is set + the function is deployed — every failure returns null and the caller
// falls back to manual entry. The board reviews/edits the result in /admin.
// ---------------------------------------------------------------------------

export interface ExtractedRule { section?: string; title: string; body?: string; fine?: number }
export interface ExtractedSetup {
  late_fee_flat?: number
  late_fee_pct?: number
  interest_apr?: number
  rules?: ExtractedRule[]
  reserves?: { name: string; target?: number }[]
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s) // strip the data: URI prefix
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })

// Send a governing-doc PDF to the extract-setup edge fn. Returns the structured
// fields, or null if AI isn't configured / the call failed (caller falls back).
export async function extractSetupFromPdf(file: File): Promise<ExtractedSetup | null> {
  if (!hasSupabase || !supabase || !file) return null
  try {
    const pdf_base64 = await fileToBase64(file)
    const { data, error } = await supabase.functions.invoke('extract-setup', { body: { pdf_base64 } })
    if (error || !data?.ok || !data?.extracted) return null
    return data.extracted as ExtractedSetup
  } catch { return null }
}

// AI document → roster rows. Sends an uploaded PDF or image (a scanned ledger, a
// photo of a spreadsheet, any layout) to the extract-roster edge fn (Claude
// vision) and returns parsed RosterRow[] for the board to review before import.
// Returns null if AI isn't configured / the call failed (caller falls back to CSV).
export async function extractRosterFromFile(file: File): Promise<RosterRow[] | null> {
  if (!hasSupabase || !supabase || !file) return null
  try {
    const file_base64 = await fileToBase64(file)
    const media_type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/png')
    const { data, error } = await supabase.functions.invoke('extract-roster', { body: { file_base64, media_type } })
    if (error || !data?.ok || !Array.isArray(data?.owners)) return null
    return (data.owners as any[])
      .map(o => ({
        full_name: String(o?.full_name || '').trim(),
        unit_number: o?.unit_number ? String(o.unit_number).trim() : '',
        email: o?.email ? String(o.email).trim() : '',
        phone: o?.phone ? String(o.phone).trim() : '',
        address: o?.address ? String(o.address).trim() : '',
        opening_balance: typeof o?.opening_balance === 'number' && Number.isFinite(o.opening_balance) ? o.opening_balance : undefined,
      }))
      .filter(r => r.full_name)
  } catch { return null }
}

// AI document → operating-budget categories. Sends an uploaded PDF or image (a
// scanned budget, a photo of a spreadsheet, any layout) to the extract-doc edge
// fn (kind 'budget', Claude vision) and returns parsed BudgetRow[] for the board
// to review before saving. Returns null if AI isn't configured / the call failed
// (caller falls back to CSV).
export async function extractBudgetFromFile(file: File): Promise<BudgetRow[] | null> {
  if (!hasSupabase || !supabase || !file) return null
  try {
    const file_base64 = await fileToBase64(file)
    const media_type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/png')
    const { data, error } = await supabase.functions.invoke('extract-doc', { body: { file_base64, media_type, kind: 'budget' } })
    if (error || !data?.ok || !Array.isArray(data?.data?.categories)) return null
    return (data.data.categories as any[])
      .map(c => ({
        name: String(c?.name || '').trim(),
        budget: typeof c?.budget === 'number' && Number.isFinite(c.budget) ? String(c.budget) : '',
        spent: typeof c?.spent === 'number' && Number.isFinite(c.spent) ? String(c.spent) : '',
      }))
      .filter(r => r.name)
  } catch { return null }
}

// One insurance policy's fields, as read off a declaration page / certificate.
// Dates are YYYY-MM-DD strings (or undefined); amounts are numbers (or undefined).
export interface ExtractedInsurance {
  insurance_kind?: 'property' | 'fidelity_bond'
  carrier?: string
  policy_number?: string
  amount?: number
  effective_date?: string
  expiration_date?: string
  replacement_cost_value?: number
  last_appraisal_date?: string
}

// AI document → insurance policy fields. Sends an uploaded PDF or image of a
// declaration page / certificate to the extract-doc edge fn (kind 'insurance').
// `subhint` (e.g. "property insurance policy") focuses the read for the section
// the upload sits under. Returns null if AI isn't configured / the call failed
// (caller falls back to typing the policy in by hand).
export async function extractInsuranceFromFile(file: File, subhint?: string): Promise<ExtractedInsurance | null> {
  if (!hasSupabase || !supabase || !file) return null
  try {
    const file_base64 = await fileToBase64(file)
    const media_type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/png')
    const { data, error } = await supabase.functions.invoke('extract-doc', { body: { file_base64, media_type, kind: 'insurance', subhint: subhint || '' } })
    if (error || !data?.ok || !data?.data) return null
    const d = data.data as any
    const str = (v: any) => (v == null ? undefined : String(v).trim() || undefined)
    const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    return {
      insurance_kind: d.insurance_kind === 'property' || d.insurance_kind === 'fidelity_bond' ? d.insurance_kind : undefined,
      carrier: str(d.carrier),
      policy_number: str(d.policy_number),
      amount: num(d.amount),
      effective_date: str(d.effective_date),
      expiration_date: str(d.expiration_date),
      replacement_cost_value: num(d.replacement_cost_value),
      last_appraisal_date: str(d.last_appraisal_date),
    }
  } catch { return null }
}

// AI: classify a governing document into one official-records category. Sends
// the canonical category list (DOC_CATEGORIES, passed by the caller) so the
// suggestion is always one of the real categories. Returns the suggested category
// string, or null if AI isn't configured / failed (caller keeps the default).
export async function classifyDocCategory(file: File, categories: string[]): Promise<string | null> {
  if (!hasSupabase || !supabase || !file) return null
  try {
    const file_base64 = await fileToBase64(file)
    const media_type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/png')
    const { data, error } = await supabase.functions.invoke('extract-doc', { body: { file_base64, media_type, kind: 'categorize', categories } })
    if (error || !data?.ok) return null
    const cat = data?.data?.category ? String(data.data.category) : ''
    return cat && categories.includes(cat) ? cat : null
  } catch { return null }
}

export interface ExtractedMinutesMotion {
  motion: string; moved_by?: string; seconded_by?: string
  votes_for?: number; votes_against?: number; votes_abstain?: number; outcome?: string
}
export interface ExtractedMinutesAction { action: string; owner?: string; due?: string }
export interface ExtractedMinutes { motions: ExtractedMinutesMotion[]; action_items: ExtractedMinutesAction[] }

// AI: read a meeting-minutes PDF/photo → motions, vote tallies, action items,
// for the board to review before saving. Null if AI isn't configured / failed.
export async function extractMinutesFromFile(file: File): Promise<ExtractedMinutes | null> {
  if (!hasSupabase || !supabase || !file) return null
  try {
    const file_base64 = await fileToBase64(file)
    const media_type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/png')
    const { data, error } = await supabase.functions.invoke('extract-doc', { body: { file_base64, media_type, kind: 'minutes' } })
    if (error || !data?.ok || !data?.data) return null
    const d = data.data as any
    const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const str = (v: any) => (v == null ? undefined : String(v).trim() || undefined)
    const motions: ExtractedMinutesMotion[] = (Array.isArray(d.motions) ? d.motions : [])
      .map((m: any) => ({
        motion: String(m?.motion || '').trim(),
        moved_by: str(m?.moved_by), seconded_by: str(m?.seconded_by),
        votes_for: num(m?.votes_for), votes_against: num(m?.votes_against), votes_abstain: num(m?.votes_abstain),
        outcome: str(m?.outcome),
      }))
      .filter((m: ExtractedMinutesMotion) => m.motion)
    const action_items: ExtractedMinutesAction[] = (Array.isArray(d.action_items) ? d.action_items : [])
      .map((a: any) => ({ action: String(a?.action || '').trim(), owner: str(a?.owner), due: str(a?.due) }))
      .filter((a: ExtractedMinutesAction) => a.action)
    return { motions, action_items }
  } catch { return null }
}

export interface ExtractedViolation {
  observed_text: string
  suggested_rule_id: string | null
  suggested_rule_title: string | null
  draft_description: string
  suggested_fine: number | null
}

// AI: read a violation photo, match it to a community rule, and draft the notice.
// The caller passes the rule book (id/section/title/fine) as matching context.
// Null if AI isn't configured / failed (caller fills the form by hand).
export async function extractViolationFromPhoto(
  file: File,
  rules: { id: string; section?: string | null; title?: string | null; fine?: number | null }[],
): Promise<ExtractedViolation | null> {
  if (!hasSupabase || !supabase || !file) return null
  try {
    const file_base64 = await fileToBase64(file)
    const media_type = file.type || 'image/png'
    const context_rules = (rules || []).map(r => ({ id: r.id, section: r.section || undefined, title: r.title || undefined, fine: typeof r.fine === 'number' ? r.fine : undefined }))
    const { data, error } = await supabase.functions.invoke('extract-doc', { body: { file_base64, media_type, kind: 'violation', context_rules } })
    if (error || !data?.ok || !data?.data) return null
    const d = data.data as any
    return {
      observed_text: String(d.observed_text || '').trim(),
      suggested_rule_id: d.suggested_rule_id ? String(d.suggested_rule_id) : null,
      suggested_rule_title: d.suggested_rule_title ? String(d.suggested_rule_title).trim() : null,
      draft_description: String(d.draft_description || '').trim(),
      suggested_fine: typeof d.suggested_fine === 'number' && Number.isFinite(d.suggested_fine) ? d.suggested_fine : null,
    }
  } catch { return null }
}

// Apply extracted billing settings + rules to the provisioned community.
// Best-effort and field-isolated. Returns the number of rules written.
export async function applyExtractedSetup(communityId: string, ex: ExtractedSetup): Promise<{ settings: boolean; rules: number }> {
  const out = { settings: false, rules: 0 }
  if (!hasSupabase || !supabase || !communityId || !ex) return out

  // Billing settings — only write fields the document actually stated.
  const patch: Record<string, number> = {}
  if (typeof ex.late_fee_flat === 'number') patch.late_fee_flat = ex.late_fee_flat
  if (typeof ex.late_fee_pct === 'number') patch.late_fee_pct = ex.late_fee_pct
  if (typeof ex.interest_apr === 'number') patch.interest_apr = ex.interest_apr
  if (Object.keys(patch).length) {
    try {
      const { error } = await supabase.from('communities').update(patch).eq('id', communityId)
      if (!error) out.settings = true
    } catch { /* non-fatal */ }
  }

  // Rules — append to the rule book (same table the Rules tab reads).
  const rules = (ex.rules || []).filter(r => r.title && r.title.trim())
  if (rules.length) {
    try {
      const rows = rules.map((r, i) => ({
        community_id: communityId,
        section: r.section?.trim() || null,
        title: r.title.trim(),
        body: r.body?.trim() || null,
        fine: typeof r.fine === 'number' ? r.fine : null,
        sort_order: i + 1,
      }))
      const { error } = await supabase.from('rules').insert(rows)
      if (!error) out.rules = rows.length
    } catch { /* non-fatal */ }
  }

  return out
}
