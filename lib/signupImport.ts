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
  subdivision?: string
  address?: string
  email?: string
  phone?: string
}

export interface BudgetRow {
  name: string
  budget: string
  spent: string
}

// Roster CSV → residents rows. Columns (header auto-detected): name, subdivision,
// address, email, phone. Mirrors parseResidentsCsv in app/admin/residents/page.tsx.
export function parseRosterCsv(text: string): RosterRow[] {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line: string) => line.split(',').map(c => c.trim())
  const first = cells(lines[0]).map(c => c.toLowerCase())
  const hasHeader = first.some(c =>
    ['name', 'full name', 'subdivision', 'address', 'email', 'phone', 'unit'].includes(c))
  const out: RosterRow[] = []
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = cells(lines[i])
    if (!c[0]) continue
    out.push({ full_name: c[0], subdivision: c[1] || '', address: c[2] || '', email: c[3] || '', phone: c[4] || '' })
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
        subdivision: r.subdivision?.trim() || null,
        address: r.address?.trim() || null,
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
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
