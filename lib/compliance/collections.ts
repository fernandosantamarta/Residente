// Assessments, liens & collections — FS 718.116 / 718.121 (condo) and
// FS 720.3085 / 720.305 (HOA). The statutory collection ladder (delinquent →
// 30-day notice of late assessment → 45-day notice of intent to record a claim
// of lien → claim of lien recorded → 45-day notice of intent to foreclose →
// foreclosure), the cited day-counts, the lien-life / SOL math, and the Monitor
// signal producer. Posture: Enable + Monitor (advisory — nothing here blocks).
//
// ⚠ REQUIRES ATTORNEY REVIEW — the day-counts (30 / 45 / 45), the certified-mail
// + first-class dual-delivery requirement, the condo 1-year lien-foreclosure
// window vs. the HOA 5-year limitations period, the HB 1203 "$1,000 floor before
// an HOA fine can become a lien" rule, the 15-business-day detailed-accounting
// duty, and the payment-application order must all be confirmed by a Florida
// community-association attorney (and against the unit's declaration) before an
// association relies on any generated notice or ledger.

import {
  rule,
  forType,
  toDate,
  ymd,
  addCalendarDays,
  calendarDaysUntil,
  signal,
  type ByRegime,
  type AssociationType,
  type ComplianceSignal,
} from './rules-core'
import {
  residentBalance, duesStatus, monthsLate, daysPastDue,
  type DuesConfig, type Resident, type Payment,
} from '@/lib/dues'

// ----------------------------------------------------------------------------
// Statutory constants
// ----------------------------------------------------------------------------

// Notice of late assessment: the statutory-form courtesy notice that gates
// attorney fees. The owner gets 30 days from the date of the letter to pay
// without attorney fees. Delivery is by first-class mail to the owner's address
// of record AND, if it differs, the unit/parcel address (see dualAddressRule).
// Condo FS 718.121(5); HOA FS 720.3085(3)(d) (both created by SB 56, 2021).
export const NOTICE_30_DAY_DAYS = rule(30, 'FS 718.121(5) / 720.3085(3)(d)', {
  note: 'notice of late assessment — 30 days to pay (without attorney fees) before collection costs & escalation; first-class to the address of record + unit/parcel address if different',
})

// 45-day written notice of intent to record a claim of lien, by certified or
// registered mail (return receipt requested) AND by first-class mail — to the
// owner's address of record and, if different, the unit/parcel address.
// Condo FS 718.121(6); HOA FS 720.3085(4)(b).
export const INTENT_TO_LIEN_DAYS = rule(45, 'FS 718.121(6) / 720.3085(4)(b)', {
  note: '45 days written notice (certified/registered + return receipt AND first-class) before recording a claim of lien',
})

// 45-day written notice of intent to foreclose the recorded lien.
export const INTENT_TO_FORECLOSE_DAYS = rule(45, 'FS 718.116(6)(b) / 720.3085(5)', {
  note: '45 days written notice of intent to foreclose before filing the action',
})

// Lien enforcement window. CONDO: a claim of lien is unenforceable unless an
// action to foreclose is commenced within 1 year of recording (FS 718.116(5)(b)).
// HOA: the lien is enforceable for the general 5-year real-property limitations
// period (FS 95.11(2)(c)). Days, by regime.
export const LIEN_ENFORCE_WINDOW_DAYS = rule<ByRegime<number>>(
  { condo: 365, hoa: 365 * 5 },
  'FS 718.116(5)(b) (condo, 1 yr) / FS 95.11(2)(c) (HOA, 5 yr)',
  { note: 'condo: foreclose within 1 year of recording or the lien expires; HOA: 5-year SOL to enforce' },
)

// HB 1203: an HOA fine of LESS THAN $1,000 may not become a lien against a
// parcel. (Condo fines may never be a lien.) Applies to the HOA regime only.
export const HOA_FINE_LIEN_FLOOR = rule(1000, 'FS 720.305(2) (HB 1203, eff 2024-07-01)', {
  note: 'an HOA fine under $1,000 may not become a lien; a condo fine is never a lien',
})

// Itemized written accounting owed within 15 business days of an owner's written
// request for the amount required to bring the account current.
export const ACCOUNTING_RESPONSE_BUSINESS_DAYS = rule(15, 'FS 718.116 / 720.3085', {
  note: 'detailed written accounting due within 15 business days of a written owner request',
})

// A qualifying offer can stay a collections/foreclosure action for up to 60 days.
export const QUALIFYING_OFFER_STAY_DAYS = rule(60, 'FS 720.3085 / FS 702.10', {
  note: 'a qualifying offer may stay a foreclosure action up to 60 days',
})

// Statutory payment-application order for any payment on a delinquent account.
export const PAYMENT_APPLICATION_ORDER = rule(
  ['interest', 'late_fee', 'cost', 'principal'] as const,
  'FS 718.116(3) / 720.3085(3)',
  { note: 'apply payments first to interest, then admin late fees, then collection/attorney costs, then the delinquent assessment' },
)

// ----------------------------------------------------------------------------
// Domain types
// ----------------------------------------------------------------------------

// The escalation ladder. `resolved` / `cancelled` are terminal; a payment plan
// is tracked separately (ev_payment_plans) and does not move the stage.
export type CollectionStage =
  | 'delinquent'
  | 'notice_30'
  | 'intent_to_lien'
  | 'lien_recorded'
  | 'intent_to_foreclose'
  | 'foreclosure'
  | 'resolved'
  | 'cancelled'

export type CollectionNoticeKind =
  | 'late_assessment_30'
  | 'intent_to_lien_45'
  | 'intent_to_foreclose_45'
  | 'tenant_rent_demand'
  | 'detailed_accounting'

export type NoticeDeliveryMethod =
  | 'certified_mail'
  | 'first_class'
  | 'both' // certified/registered + first-class (the statutory dual delivery)
  | 'electronic'
  | 'hand'

export type PaymentPlanStatus = 'active' | 'completed' | 'defaulted' | 'cancelled'

export const STAGE_LABELS: Record<CollectionStage, string> = {
  delinquent:          'Delinquent',
  notice_30:           '30-day notice sent',
  intent_to_lien:      'Intent-to-lien sent',
  lien_recorded:       'Lien recorded',
  intent_to_foreclose: 'Intent-to-foreclose sent',
  foreclosure:         'Foreclosure filed',
  resolved:            'Resolved',
  cancelled:           'Cancelled',
}

// Display order for the worklist (open stages first, terminal last).
export const STAGE_ORDER: CollectionStage[] = [
  'delinquent', 'notice_30', 'intent_to_lien', 'lien_recorded',
  'intent_to_foreclose', 'foreclosure', 'resolved', 'cancelled',
]

const OPEN_STAGES = new Set<string>([
  'delinquent', 'notice_30', 'intent_to_lien', 'lien_recorded', 'intent_to_foreclose', 'foreclosure',
])

export const NOTICE_KIND_LABELS: Record<CollectionNoticeKind, string> = {
  late_assessment_30:     'Notice of late assessment (30-day)',
  intent_to_lien_45:      'Notice of intent to record claim of lien (45-day)',
  intent_to_foreclose_45: 'Notice of intent to foreclose (45-day)',
  tenant_rent_demand:     'Demand for rent from tenant',
  detailed_accounting:    'Detailed accounting statement',
}

export interface CollectionCaseRow {
  id: string
  community_id?: string
  profile_id?: string | null
  resident_id?: string | null
  unit_label?: string | null
  stage?: CollectionStage | string | null
  opened_at?: string | null
  delinquent_since?: string | null
  // stage timestamps (denormalized from ev_collection_notices for fast signal math)
  notice_30_sent_at?: string | null
  intent_to_lien_sent_at?: string | null
  lien_recorded_at?: string | null
  intent_to_foreclose_sent_at?: string | null
  foreclosure_filed_at?: string | null
  resolved_at?: string | null
  // money snapshot (dollars)
  principal_balance?: number | null
  interest_balance?: number | null
  late_fee_balance?: number | null
  cost_balance?: number | null
  total_balance?: number | null
  // flags
  is_fine_only?: boolean | null   // HOA: a case driven only by an unpaid fine
  on_payment_plan?: boolean | null
}

export interface CollectionNoticeRow {
  id: string
  community_id?: string
  case_id?: string | null
  kind?: CollectionNoticeKind | string | null
  sent_at?: string | null
  method?: NoticeDeliveryMethod | string | null
  tracking_number?: string | null
  return_receipt_at?: string | null
  recipient_name?: string | null
  // dual-address evidence (the pair of addresses the notice was mailed to)
  mailed_to_record_address?: string | null
  mailed_to_unit_address?: string | null
  dual_address_required?: boolean | null
  // certified-mail rail (Lob) metadata (certified-mail.sql) — null for manual logs
  mail_provider?: string | null
  lob_status?: string | null
  lob_cost?: number | null
  lob_expected_delivery?: string | null
  lob_url?: string | null
}

export type PlanRequestStatus = 'requested' | 'approved' | 'modified' | 'denied' | 'withdrawn'

export interface PaymentPlanRow {
  id: string
  community_id?: string
  case_id?: string | null
  status?: PaymentPlanStatus | string | null
  start_date?: string | null
  installment_amount?: number | null
  installment_count?: number | null
  frequency_days?: number | null   // e.g. 30 monthly
  next_due_at?: string | null
  paid_count?: number | null
  // Resident-requested plan layer (payment-plan-requests.sql)
  requested_by_owner?: boolean | null
  request_status?: PlanRequestStatus | string | null
  requested_amount?: number | null
  requested_count?: number | null
  requested_frequency_days?: number | null
  decision_reason?: string | null
  decided_at?: string | null
  profile_id?: string | null
  autopay_opt_in?: boolean | null
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

const asType = (t: AssociationType | string | null | undefined): AssociationType =>
  t === 'hoa' ? 'hoa' : 'condo'

/** Is this stage still open (i.e. a deadline could be running)? */
export function isOpenStage(stage: string | null | undefined): boolean {
  return OPEN_STAGES.has(String(stage ?? 'delinquent'))
}

/**
 * For an OPEN case, the next escalation the board can take and the earliest date
 * it becomes available (the statutory waiting period after the gating notice).
 * Returns null for stages with no fixed waiting period (delinquent, lien_recorded,
 * foreclosure) — those are surfaced by their own signals.
 */
export function nextEscalation(c: CollectionCaseRow): {
  readyAt: Date | null
  label: string
  citation: string
} | null {
  const stage = String(c.stage ?? 'delinquent') as CollectionStage
  switch (stage) {
    case 'notice_30': {
      const readyAt = addCalendarDays(c.notice_30_sent_at, NOTICE_30_DAY_DAYS.value)
      return { readyAt, label: 'send the 45-day notice of intent to record a claim of lien', citation: INTENT_TO_LIEN_DAYS.citation }
    }
    case 'intent_to_lien': {
      const readyAt = addCalendarDays(c.intent_to_lien_sent_at, INTENT_TO_LIEN_DAYS.value)
      return { readyAt, label: 'record the claim of lien', citation: INTENT_TO_LIEN_DAYS.citation }
    }
    case 'intent_to_foreclose': {
      const readyAt = addCalendarDays(c.intent_to_foreclose_sent_at, INTENT_TO_FORECLOSE_DAYS.value)
      return { readyAt, label: 'file the foreclosure action', citation: INTENT_TO_FORECLOSE_DAYS.citation }
    }
    default:
      return null
  }
}

/** Condo lien must be foreclosed within 1 yr of recording; HOA within the 5-yr
 *  SOL. Returns the hard deadline once a lien is recorded, else null. */
export function lienEnforceDeadline(c: CollectionCaseRow, type: AssociationType | string | null | undefined): Date | null {
  if (!c.lien_recorded_at) return null
  const days = forType(LIEN_ENFORCE_WINDOW_DAYS.value, asType(type))
  return addCalendarDays(c.lien_recorded_at, days)
}

/** The statutory dual-delivery requirement for the 45-day intent-to-lien notice
 *  (certified/registered + first-class). Returns an advisory string when the
 *  recorded method does not satisfy it, else null. Advisory only. */
export function noticeMethodWarning(kind: string | null | undefined, method: string | null | undefined): string | null {
  if (kind !== 'intent_to_lien_45') return null
  if (method === 'both') return null
  return 'The 45-day notice of intent to record a lien must be sent by certified or registered mail (return receipt) AND by first-class mail.'
}

// ----------------------------------------------------------------------------
// Dual-address rule — the statutory COLLECTION notices must be mailed to the
// owner at the last address reflected in the association's records AND, if that
// is not the unit/parcel address, ALSO to the unit/parcel address. "Notice is
// deemed ... delivered upon mailing," so the compliance evidence is the pair of
// addresses mailed to — not a delivery confirmation. Routine meeting/general
// notices do NOT carry this rule (a single address on file controls). Pure.
//   - Notice of late assessment:       condo FS 718.121(5) / HOA FS 720.3085(3)(d)
//   - Notice of intent to record lien:  condo FS 718.121(6) / HOA FS 720.3085(4)(b)
//   - Notice of intent to foreclose:    HOA FS 720.3085(5) (same manner as (4)(b)).
//       The condo statute (FS 718.116(6)(b)) speaks of a single "last known
//       address"; mailing to both is the conservative practice — advised, not
//       mandated.
// ----------------------------------------------------------------------------

/** Normalize an address for equality testing: collapse whitespace/commas and
 *  lowercase. Empty → null. */
export function normalizeAddress(a: string | null | undefined): string | null {
  const s = String(a ?? '').replace(/[\s,]+/g, ' ').trim().toLowerCase()
  return s || null
}

export interface NoticeAddressInput {
  /** owner's last address as reflected in the association's records (mailing) */
  recordAddress?: string | null
  /** the physical unit/parcel address */
  unitAddress?: string | null
}

export interface ResolvedAddresses {
  /** the distinct address(es) the notice must be mailed to, in send order */
  addresses: string[]
  /** true when record & unit are both present AND differ → a second copy is required */
  dualRequired: boolean
  /** what the dual-address rule still needs but is missing (null when complete) */
  missing: 'record' | 'unit' | 'both' | null
  /** the resolved record (mailing) address actually used */
  recordAddress: string | null
  /** the unit/parcel second-copy address (only set when dualRequired) */
  unitAddress: string | null
}

/**
 * Resolve which address(es) a mailed collection notice goes to. The owner's
 * address of record defaults to the unit/parcel address when no separate
 * address was furnished. When both are present and differ, BOTH are required.
 * Pure; tolerates partial input.
 */
export function resolveNoticeAddresses(input: NoticeAddressInput): ResolvedAddresses {
  const rawRecord = String(input.recordAddress ?? '').trim() || null
  const rawUnit = String(input.unitAddress ?? '').trim() || null
  const nRecord = normalizeAddress(rawRecord)
  const nUnit = normalizeAddress(rawUnit)

  // The owner's "address of record" defaults to the unit/parcel address.
  const record = rawRecord ?? rawUnit

  let missing: ResolvedAddresses['missing'] = null
  if (!nRecord && !nUnit) missing = 'both'
  else if (nRecord && !nUnit) missing = 'unit' // can't confirm/produce the second copy

  const dualRequired = !!(nRecord && nUnit && nRecord !== nUnit)
  const addresses = dualRequired
    ? [rawRecord as string, rawUnit as string]
    : (record ? [record] : [])

  return {
    addresses,
    dualRequired,
    missing,
    recordAddress: record,
    unitAddress: dualRequired ? rawUnit : null,
  }
}

export interface DualAddressRule {
  applies: boolean
  /** true where the statute MANDATES the second copy; false where it's advised practice */
  statutory: boolean
  citation: string
  note: string
}

/** Does a notice kind carry the dual-address rule, and under which citation
 *  (regime-specific)? Side-effect free. */
export function dualAddressRule(
  kind: string | null | undefined,
  type: AssociationType | string | null | undefined = 'condo',
): DualAddressRule {
  const regime = asType(type)
  switch (kind) {
    case 'late_assessment_30':
      return {
        applies: true, statutory: true,
        citation: regime === 'hoa' ? 'FS 720.3085(3)(d)' : 'FS 718.121(5)',
        note: 'Mail by first-class to the owner’s address of record and, if it differs, also to the unit/parcel address.',
      }
    case 'intent_to_lien_45':
      return {
        applies: true, statutory: true,
        citation: regime === 'hoa' ? 'FS 720.3085(4)(b)' : 'FS 718.121(6)',
        note: 'Certified/registered (return receipt) + first-class to the address of record and, if it differs, also to the unit/parcel address.',
      }
    case 'intent_to_foreclose_45':
      return regime === 'hoa'
        ? { applies: true, statutory: true, citation: 'FS 720.3085(5)', note: 'Same manner as the intent-to-lien notice — to the address of record and, if it differs, also to the parcel address.' }
        : { applies: true, statutory: false, citation: 'FS 718.116(6)(b)', note: 'The condo statute references a single last-known address; mailing to both the record and unit addresses is the conservative practice.' }
    default:
      return { applies: false, statutory: false, citation: '', note: '' }
  }
}

/**
 * Advisory when a notice that carries the dual-address rule can't be fully
 * documented from the addresses on file. Returns null when nothing is wrong —
 * including the correct dual-mailing case, which the UI surfaces as info, not a
 * warning. Advisory only.
 */
export function noticeAddressWarning(
  kind: string | null | undefined,
  type: AssociationType | string | null | undefined,
  input: NoticeAddressInput,
): string | null {
  const r = dualAddressRule(kind, type)
  if (!r.applies) return null
  const a = resolveNoticeAddresses(input)
  if (a.missing === 'both')
    return `No mailing address is on file for this owner. ${r.note} (${r.citation})`
  if (a.missing === 'unit')
    return `The unit/parcel address is missing, so the statutory second copy can’t be confirmed. Add it to the owner’s roster record. ${r.note} (${r.citation})`
  return null
}

/** Pull the two statutory addresses from a roster resident row: the record
 *  (mailing) address is last_known_address; the unit/parcel address is the
 *  roster `address`. */
export function ownerNoticeAddresses(resident: {
  last_known_address?: string | null
  address?: string | null
} | null | undefined): NoticeAddressInput {
  return {
    recordAddress: resident?.last_known_address ?? null,
    unitAddress: resident?.address ?? null,
  }
}

// ----------------------------------------------------------------------------
// Monitor signal producer
// ----------------------------------------------------------------------------

const DOMAIN = 'Collections & liens'
const HREF = '/admin/collections'

/**
 * Turn collection-case rows into Monitor signals. `type` is the association
 * regime (condo/hoa) so the lien-window math branches correctly. Side-effect
 * free; tolerates partial rows; never throws.
 */
export function collectionsSignals(
  cases: CollectionCaseRow[] = [],
  type: AssociationType | string | null | undefined = 'condo',
  now: Date = new Date(),
): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const nowMs = toDate(now)!.getTime()
  const regime = asType(type)

  for (const c of cases) {
    if (!isOpenStage(c.stage)) continue
    const label = c.unit_label || c.id.slice(0, 8)
    const stage = String(c.stage ?? 'delinquent') as CollectionStage

    // 1. A brand-new delinquency with no notice yet — start the 30-day notice.
    if (stage === 'delinquent') {
      out.push(signal({
        id: `collections:start:${c.id}`,
        domain: DOMAIN,
        severity: 'info',
        title: `${label}: begin the statutory collection notice`,
        detail: 'Deliver the 30-day notice of late assessment before charging collection costs or escalating to a lien.',
        href: HREF,
        citation: NOTICE_30_DAY_DAYS.citation,
      }))
    }

    // 2. A statutory waiting period has elapsed — the next escalation is available.
    const esc = nextEscalation(c)
    if (esc?.readyAt) {
      const daysOver = calendarDaysUntil(now, esc.readyAt) // >=0 once now is past readyAt
      if (esc.readyAt.getTime() <= nowMs) {
        out.push(signal({
          id: `collections:ready:${c.id}`,
          domain: DOMAIN,
          severity: 'soon',
          title: `${label}: you may now ${esc.label}`,
          detail: `The statutory waiting period elapsed on ${ymd(esc.readyAt)}${daysOver > 0 ? ` (${daysOver} day${daysOver === 1 ? '' : 's'} ago)` : ''}.`,
          href: HREF,
          citation: esc.citation,
        }))
      } else if (calendarDaysUntil(esc.readyAt, now) <= 5) {
        out.push(signal({
          id: `collections:waiting:${c.id}`,
          domain: DOMAIN,
          severity: 'info',
          title: `${label}: waiting period ends ${ymd(esc.readyAt)}`,
          detail: `You may ${esc.label} on or after that date.`,
          href: HREF,
          citation: esc.citation,
        }))
      }
    }

    // 3. Lien recorded — the enforcement window (condo 1 yr / HOA 5 yr) is running.
    // The window countdown must remain visible even after the board advances to
    // intent_to_foreclose or foreclosure — a stalled case can still miss the
    // hard filing deadline (see finding COL-02).
    const lienDeadline = lienEnforceDeadline(c, regime)
    if ((stage === 'lien_recorded' || stage === 'intent_to_foreclose' || stage === 'foreclosure') && lienDeadline) {
      const daysLeft = calendarDaysUntil(lienDeadline, now)
      if (daysLeft < 0) {
        out.push(signal({
          id: `collections:lien-expired:${c.id}`,
          domain: DOMAIN,
          severity: 'overdue',
          title: `${label}: the recorded lien's enforcement window has lapsed`,
          detail: `${regime === 'condo' ? 'A condo claim of lien must be foreclosed within 1 year of recording.' : 'The HOA lien limitations period has run.'} Window ended ${ymd(lienDeadline)}.`,
          href: HREF,
          citation: LIEN_ENFORCE_WINDOW_DAYS.citation,
        }))
      } else if (regime === 'condo' ? daysLeft <= 60 : daysLeft <= 90) {
        out.push(signal({
          id: `collections:lien-expiring:${c.id}`,
          domain: DOMAIN,
          severity: 'soon',
          title: `${label}: the recorded lien must be enforced soon`,
          detail: `${regime === 'condo' ? 'Foreclose within 1 year of recording' : 'Enforce within the 5-year limitations period'} — window closes ${ymd(lienDeadline)} (${daysLeft} days left).`,
          href: HREF,
          citation: LIEN_ENFORCE_WINDOW_DAYS.citation,
        }))
      }
    }

    // 4. HOA fine-only case under the $1,000 lien floor (HB 1203) heading toward a lien.
    if (regime === 'hoa' && c.is_fine_only) {
      const principal = Number(c.principal_balance) || 0
      const escalatingToLien = stage === 'intent_to_lien' || stage === 'lien_recorded' || stage === 'intent_to_foreclose'
      if (escalatingToLien && principal < HOA_FINE_LIEN_FLOOR.value) {
        out.push(signal({
          id: `collections:fine-floor:${c.id}`,
          domain: DOMAIN,
          severity: 'overdue',
          title: `${label}: an HOA fine under $${HOA_FINE_LIEN_FLOOR.value} cannot become a lien`,
          detail: `This case is fine-only ($${Math.round(principal)}). Under HB 1203 an HOA fine of less than $${HOA_FINE_LIEN_FLOOR.value} may not be secured by a lien.`,
          href: HREF,
          citation: HOA_FINE_LIEN_FLOOR.citation,
        }))
      }
    }
  }

  return out
}

// ----------------------------------------------------------------------------
// Delinquency scan — detect owners who are behind and have NO open case yet, so
// the board can be PROMPTED to open one (or the cron can auto-open a pre-notice
// case at a board-configured threshold). Detection/prompting is automated; the
// statutory legal steps stay a human action.
// ----------------------------------------------------------------------------

export interface RosterResident {
  id: string
  profile_id?: string | null
  full_name?: string | null
  unit_number?: string | null
  opening_balance?: number | null
  created_at?: string | null
}

export interface DelinquentCandidate {
  resident_id: string
  profile_id: string | null
  unit_label: string
  balance: number
  months_late: number
  days_past_due: number
}

export interface DelinquencyScan {
  residents?: RosterResident[]
  paymentsByResident?: Record<string, { amount?: number | null }[]>
  cases?: CollectionCaseRow[]
  monthlyDues?: number
  duesConfig?: DuesConfig
  /** Optional $ floor — only suggest owners owing at least this. */
  minBalance?: number
  /** Optional days-past-due floor. */
  minDays?: number
  dueDay?: number
  now?: Date
}

/**
 * Owners who are delinquent (dues status 'late' — behind more than the current
 * installment) and have NO OPEN collection case, filtered by the optional
 * $ / days thresholds. Worst balance first. Pure; tolerates partial input.
 */
export function delinquentOwnersWithoutCase(scan: DelinquencyScan): DelinquentCandidate[] {
  const residents = scan.residents || []
  const payByRes = scan.paymentsByResident || {}
  const monthly = Number(scan.monthlyDues) || 0
  const cfg = scan.duesConfig || {}
  const minBalance = Number(scan.minBalance) || 0
  const minDays = Number(scan.minDays) || 0

  const openResidentIds = new Set<string>()
  for (const c of scan.cases || []) {
    if (c.resident_id && isOpenStage(c.stage)) openResidentIds.add(String(c.resident_id))
  }

  const out: DelinquentCandidate[] = []
  for (const r of residents) {
    if (!r?.id || openResidentIds.has(String(r.id))) continue
    const pays = (payByRes[r.id] || []) as Payment[]
    const bal = residentBalance(r as Resident, monthly, pays, cfg)
    if (duesStatus(bal, monthly) !== 'late') continue
    if (bal < minBalance) continue
    const dpd = daysPastDue(r as Resident, monthly, pays, { dueDay: scan.dueDay, now: scan.now })
    if (minDays && dpd < minDays) continue
    out.push({
      resident_id: r.id,
      profile_id: r.profile_id ?? null,
      unit_label: `${r.full_name || ''}${r.unit_number ? ` · ${r.unit_number}` : ''}`.trim() || r.id.slice(0, 8),
      balance: bal,
      months_late: monthsLate(r as Resident, monthly, pays),
      days_past_due: dpd,
    })
  }
  return out.sort((a, b) => b.balance - a.balance)
}

/** One aggregate Monitor signal nudging the board to open cases for delinquents. */
export function delinquencySignals(candidates: DelinquentCandidate[] = []): ComplianceSignal[] {
  if (!candidates.length) return []
  const total = candidates.reduce((s, c) => s + (Number(c.balance) || 0), 0)
  const n = candidates.length
  return [signal({
    id: 'collections:delinquent-no-case',
    domain: DOMAIN,
    severity: 'soon',
    title: `${n} delinquent owner${n === 1 ? '' : 's'} with no open collection case`,
    detail: `About $${Math.round(total)} past due across ${n} owner${n === 1 ? '' : 's'}. Open a case to begin the statutory collection process.`,
    href: HREF,
    citation: NOTICE_30_DAY_DAYS.citation,
  })]
}

/**
 * Signals from active payment plans — a missed installment (next_due_at is past)
 * is advisory. Kept separate so the case producer stays focused on the ladder.
 */
export function paymentPlanSignals(plans: PaymentPlanRow[] = [], now: Date = new Date()): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const nowMs = toDate(now)!.getTime()
  for (const p of plans) {
    // An owner-requested plan awaiting board review — the board should act.
    if (p.request_status === 'requested') {
      out.push(signal({
        id: `collections:plan-requested:${p.id}`,
        domain: DOMAIN,
        severity: 'soon',
        title: 'An owner requested a payment plan',
        detail: 'Review the proposed installment terms and approve, modify, or deny the request on the collection case.',
        href: HREF,
        citation: 'FS 718.116 / 720.3085',
      }))
      continue
    }
    if (String(p.status ?? 'active') !== 'active') continue
    const due = toDate(p.next_due_at)
    if (due && due.getTime() < nowMs) {
      const daysOver = calendarDaysUntil(now, due)
      out.push(signal({
        id: `collections:plan-missed:${p.id}`,
        domain: DOMAIN,
        severity: 'soon',
        title: 'A payment-plan installment is past due',
        detail: `Installment due ${ymd(due)}${daysOver > 0 ? ` (${daysOver} day${daysOver === 1 ? '' : 's'} ago)` : ''}. A missed installment may void the plan and resume collection.`,
        href: HREF,
        citation: 'FS 718.116 / 720.3085',
      }))
    }
  }
  return out
}
