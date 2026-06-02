// Official records — retention, website posting, and the inspection SLA.
// Applies to BOTH condo (FS 718.111(12)) and HOA (FS 720.303(4)-(5)).
//
// Posture: Enable + Monitor (advisory). Constants carry their FS citation and
// validated:false until Florida community-association counsel confirms them.
//
// NOTE on overlap: the website-posting *applicability* signal (is this community
// in scope, and is the portal enabled before the in-force date) already lives in
// lib/compliance/signals.ts foundationSignals() as ids `records:website-condo` /
// `records:website-hoa`. This module owns the document-level obligations that
// follow once posting applies — the 30-day per-document posting clock, retention
// tiers, redaction-before-posting, and the records-inspection SLA — and must NOT
// re-emit those reserved ids.

import {
  rule,
  toDate,
  ymd,
  addBusinessDays,
  addCalendarDays,
  calendarDaysUntil,
  signal,
  type AssociationType,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Document categories (moved here from app/admin/documents/page.tsx so the
// statutory category set has one home). The admin + resident document pages
// import these back. Labels are load-bearing: FL_REQUIRED_CATEGORIES.label must
// be a member of DOC_CATEGORIES (enforced by the DocCategory type).
// ----------------------------------------------------------------------------
export const DOC_CATEGORIES = [
  'Governing Documents',       // Declaration, bylaws, articles, amendments
  'Financial Documents',       // Budgets, monthly statements, audits, reserve studies
  'Rules & Policies',          // Current rules, CC&Rs, enforcement policies
  'Reports & Meeting Minutes', // Board + member meeting minutes
  'Notices & Announcements',   // Meeting notices and agendas
  'Insurance',                 // Master policy, certificates of insurance
  'Vendor & Contracts',        // Service contracts >$500, bid summaries
  'Director Records',          // Director certifications, conflict disclosures
  'Inspection Reports',        // Structural, milestone, SIRS (15-yr retention)
  'Bank Records & Ledgers',    // HB 913 — bank statements + accounting ledgers
  'Building Permits',          // HB 913 — building permits / approvals
  'Forms & Applications',      // ARC, pet, lease, move-in/out
  'Maps & Layouts',            // Site plan, parking, common areas
  'Other',
] as const
export type DocCategory = typeof DOC_CATEGORIES[number]

// FL-required record types an in-scope association must post online.
// (HB 913 broadened the set — bank records/ledgers + permits added above.)
export const FL_REQUIRED_CATEGORIES: { label: DocCategory; statute: string }[] = [
  { label: 'Governing Documents',       statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Financial Documents',       statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Rules & Policies',          statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Reports & Meeting Minutes', statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Insurance',                 statute: '720.303(4)(b)1' },
  { label: 'Vendor & Contracts',        statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Director Records',          statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Inspection Reports',        statute: '718.111(12)(g)2' },
  { label: 'Bank Records & Ledgers',    statute: '718.111(12)(a) / 720.303(4) (HB 913)' },
]

// ----------------------------------------------------------------------------
// Statutory constants (validated:false).
// ----------------------------------------------------------------------------

// Records-website posting applies at these size thresholds and took effect on
// these dates (both already past). Mirrors lib/compliance/signals.ts — kept here
// because the document-level posting clock below needs the same gate.
export const POSTING_THRESHOLD = rule(
  { condo: 25, hoa: 100 } as ByRegimeNum,
  'FS 718.111(12)(g) (HB 1021) / 720.303(4)(b) (HB 1203)',
  { note: 'condo ≥25 units; HOA ≥100 parcels' },
)
export const POSTING_IN_FORCE = rule(
  { condo: '2026-01-01', hoa: '2025-01-01' } as ByRegimeStr,
  'FS 718.111(12)(g) (HB 1021) / 720.303(4)(b) (HB 1203)',
  { note: 'no statutory grace/cure window' },
)
// Once a record is created/received, an in-scope association must post it within
// 30 days.
export const POSTING_CLOCK_DAYS = rule(30, 'FS 718.111(12)(g) / 720.303(4)(b)', { note: 'days to post a new official record' })

// Records-inspection request SLA: the association must make records available
// within 10 working/business days of a written request.
//   condo — FS 718.111(12)(c): 10 working days.
//   HOA   — FS 720.303(5)(a):  10 business days; on failure a rebuttable
//           presumption of willful non-compliance arises and the member may
//           recover $50/day for up to 10 days ($500), beginning on the 11th day.
export const RECORDS_INSPECTION_DAYS = rule(10, 'FS 718.111(12)(c) / 720.303(5)', { note: 'working (condo) / business (HOA) days to produce records' })
export const HOA_RECORDS_FINE_PER_DAY = rule(50, 'FS 720.303(5)(b)', { note: 'HOA only; a rebuttable presumption of willful non-compliance arises on the 11th business day — the member MAY recover $50/day (cap 10 days = $500); the association may rebut' })
export const HOA_RECORDS_FINE_MAX_DAYS = rule(10, 'FS 720.303(5)(b)', { note: 'HOA only; $50/day capped at 10 days = $500' })

// Retention tiers. PERMANENT = keep for the life of the association.
export const RETENTION_YEARS = rule(
  { permanent: null as number | null, structural: 15, default: 7 },
  'FS 718.111(12) / 720.303(4)',
  { note: 'structural/milestone/SIRS reports kept 15 yr; governing docs & plans permanent; most records 7 yr' },
)

// Categories whose records are kept 15 years (structural) or permanently.
// Everything else (incl. HB 913 'Bank Records & Ledgers', for which the statute
// specifies no unique retention) falls to the 7-year default.
const STRUCTURAL_CATEGORIES = new Set<string>(['Inspection Reports'])
const PERMANENT_CATEGORIES = new Set<string>(['Governing Documents', 'Building Permits', 'Maps & Layouts'])

/** Statutory minimum retention (years) for a category; null = permanent. */
export function retentionYearsForCategory(category: string | null | undefined): number | null {
  const c = String(category ?? '')
  if (PERMANENT_CATEGORIES.has(c)) return RETENTION_YEARS.value.permanent // null
  if (STRUCTURAL_CATEGORIES.has(c)) return RETENTION_YEARS.value.structural // 15
  return RETENTION_YEARS.value.default // 7
}

// Personal information that must be redacted before a record is produced or
// posted (not exhaustive — counsel must confirm the controlling list).
export const REDACTION_PROTECTED = rule(
  [
    'Social Security numbers', 'Driver-license / state-ID numbers',
    'Bank-account and credit/debit-card numbers', 'Medical records / health information',
    'Personnel records (other than budgetary salary info)', 'Email addresses & phone numbers where opted out',
    'Security/fire-alarm information', 'Electronic-voting credentials',
  ] as string[],
  'FS 718.111(12)(c)3 / 720.303(5)(c)',
  { note: 'redact before producing/posting; confirm the full protected list' },
)

// Copy/labor fee guardrails (informational — exact schedule is governing-doc/
// statute dependent). Wrapped in rule() so it carries validated:false like every
// other statutory constant here.
export const COPY_FEE_NOTE = rule(
  'Copy charges are limited to the actual cost of materials and labor; confirm the permissible per-page and personnel rates with counsel.',
  'FS 718.111(12)(c) / 720.303(5)',
  { note: 'copy/labor fee guardrail' },
)

// ----------------------------------------------------------------------------
type ByRegimeNum = Record<AssociationType, number>
type ByRegimeStr = Record<AssociationType, string>

export interface DocumentRow {
  id: string
  community_id?: string
  title?: string | null
  category?: string | null
  posted_to_portal?: boolean | null
  posted_at?: string | null
  date_received?: string | null
  effective_date?: string | null
  uploaded_at?: string | null
  redaction_status?: 'pending' | 'redacted' | 'not_required' | string | null
  access_level?: 'members' | 'public' | string | null
  retention_until?: string | null
}

export interface RecordsRequestRow {
  id: string
  community_id?: string
  category?: string | null
  subject?: string | null
  status?: string | null
  created_at?: string | null
  due_at?: string | null
  responded_at?: string | null
}

// ----------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ----------------------------------------------------------------------------
const regimeOf = (t: AssociationType | string | null | undefined): AssociationType => (t === 'hoa' ? 'hoa' : 'condo')

/** Is this community in scope for records-website posting (size + in-force)? */
export function postingApplies(community: Record<string, any> | null | undefined, now: Date = new Date()): boolean {
  if (!community) return false
  const regime = regimeOf(community.association_type)
  const size = regime === 'condo' ? Number(community.unit_count) || 0 : Number(community.parcel_count) || 0
  const inForce = calendarDaysUntil(POSTING_IN_FORCE.value[regime], now) <= 0
  return size >= POSTING_THRESHOLD.value[regime] && inForce
}

/** Statutory deadline to produce records for an inspection request. */
export function recordsInspectionDueAt(
  receivedAt: string | Date | null | undefined,
  // condo "working days" and HOA "business days" both toll weekends + holidays.
): Date | null {
  return addBusinessDays(receivedAt, RECORDS_INSPECTION_DAYS.value)
}

/** The per-document deadline to post a record after it is created/received. */
export function postingDeadline(doc: DocumentRow): Date | null {
  const basis = doc.date_received || doc.effective_date || doc.uploaded_at
  return addCalendarDays(basis, POSTING_CLOCK_DAYS.value)
}

const OPEN_REQUEST = (s: string | null | undefined) => String(s ?? 'new') !== 'resolved' && String(s ?? 'new') !== 'cancelled'

// ----------------------------------------------------------------------------
// Monitor signal producer (condo + HOA).
// ----------------------------------------------------------------------------
const HREF = '/admin/documents#documents'

export function officialRecordsSignals(
  community: Record<string, any> | null | undefined,
  documents: DocumentRow[] = [],
  requests: RecordsRequestRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const regime = regimeOf(community.association_type)
  const applies = postingApplies(community, now)
  const nowMs = toDate(now)!.getTime()

  // --- Posting obligations (only once the community is in scope) ---
  if (applies && community.website_posting_enabled) {
    // (1) Required-category gaps — one aggregate signal listing what's missing.
    const present = new Set(documents.map(d => String(d.category ?? '').toLowerCase()))
    const missing = FL_REQUIRED_CATEGORIES.filter(c => !present.has(c.label.toLowerCase()))
    if (missing.length) {
      out.push(signal({
        id: 'records:category-gaps',
        domain: 'Official records',
        severity: 'soon',
        title: `${missing.length} required record type(s) are not yet posted`,
        detail: `Missing from the portal: ${missing.map(m => m.label).join(', ')}.`,
        href: HREF,
        citation: 'FS 718.111(12)(g) / 720.303(4)(b)',
      }))
    }

    // (2) 30-day per-document posting clock — aggregate overdue + soon.
    let overdue = 0, soon = 0
    for (const d of documents) {
      if (d.posted_to_portal) continue
      const due = postingDeadline(d)
      if (!due) continue
      const left = Math.round((due.getTime() - nowMs) / 86400000)
      if (left < 0) overdue++
      else if (left <= 7) soon++
    }
    if (overdue) {
      out.push(signal({
        id: 'records:unposted-overdue',
        domain: 'Official records',
        severity: 'overdue',
        title: `${overdue} record(s) past the 30-day posting deadline`,
        detail: `These documents were created/received more than ${POSTING_CLOCK_DAYS.value} days ago and are not marked posted to the portal.`,
        href: HREF,
        citation: POSTING_CLOCK_DAYS.citation,
      }))
    }
    if (soon) {
      out.push(signal({
        id: 'records:unposted-soon',
        domain: 'Official records',
        severity: 'soon',
        title: `${soon} record(s) approaching the 30-day posting deadline`,
        detail: 'Mark each document posted once it is live on the portal.',
        href: HREF,
        citation: POSTING_CLOCK_DAYS.citation,
      }))
    }

    // (3) Redaction still pending on a record already posted.
    const postedPending = documents.filter(d => d.posted_to_portal && String(d.redaction_status) === 'pending').length
    if (postedPending) {
      out.push(signal({
        id: 'records:redaction-pending',
        domain: 'Official records',
        severity: 'overdue',
        title: `${postedPending} posted record(s) still flagged for redaction`,
        detail: 'Protected personal information must be redacted before a record is produced or posted.',
        href: HREF,
        citation: REDACTION_PROTECTED.citation,
      }))
    }
  }

  // --- Records-inspection request SLA (applies regardless of posting scope) ---
  for (const r of requests) {
    if (String(r.category) !== 'records' || !OPEN_REQUEST(r.status)) continue
    const due = toDate(r.due_at) ?? recordsInspectionDueAt(r.created_at)
    if (!due) continue
    const left = Math.round((due.getTime() - nowMs) / 86400000)
    const label = r.subject || r.id.slice(0, 8)
    if (left < 0) {
      const hoaTail = regime === 'hoa'
        ? ` From the 11th business day the member may seek $${HOA_RECORDS_FINE_PER_DAY.value}/day (up to $${HOA_RECORDS_FINE_PER_DAY.value * HOA_RECORDS_FINE_MAX_DAYS.value}).`
        : ''
      out.push(signal({
        id: `records:inspection-overdue:${r.id}`,
        domain: 'Official records',
        severity: 'overdue',
        title: `Records-inspection request "${label}" is past its deadline`,
        detail: `Records were due ${ymd(due)} (${RECORDS_INSPECTION_DAYS.value} ${regime === 'hoa' ? 'business' : 'working'} days).${hoaTail}`,
        href: '/admin/documents#records-requests',
        citation: RECORDS_INSPECTION_DAYS.citation,
      }))
    } else if (left <= 3) {
      out.push(signal({
        id: `records:inspection-soon:${r.id}`,
        domain: 'Official records',
        severity: 'soon',
        title: `Records-inspection request "${label}" is due soon`,
        detail: `Statutory deadline ${ymd(due)}.`,
        href: '/admin/documents#records-requests',
        citation: RECORDS_INSPECTION_DAYS.citation,
      }))
    }
  }

  // --- Structural reports kept under the 15-year tier (advisory info) ---
  const misRetained = documents.filter(d => {
    if (!STRUCTURAL_CATEGORIES.has(String(d.category ?? ''))) return false
    const until = toDate(d.retention_until)
    const basis = toDate(d.date_received || d.effective_date || d.uploaded_at)
    if (!until || !basis) return false
    const fifteen = new Date(Date.UTC(basis.getUTCFullYear() + 15, basis.getUTCMonth(), basis.getUTCDate()))
    return until.getTime() < fifteen.getTime()
  }).length
  if (misRetained) {
    out.push(signal({
      id: 'records:retention-structural',
      domain: 'Official records',
      severity: 'info',
      title: `${misRetained} structural report(s) set below the 15-year retention`,
      detail: 'Milestone / SIRS / structural inspection reports must be kept for 15 years.',
      href: HREF,
      citation: 'FS 718.111(12)(g)',
    }))
  }

  return out
}
