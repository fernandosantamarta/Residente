// Financial reporting, audit tiers & reserve funding.
// Applies to BOTH condo (FS 718.111(13), 718.112(2)(f)) and HOA (FS 720.303(6)-(7)).
//
// Posture: Enable + Monitor (advisory). Constants carry their FS citation and
// validated:false until Florida community-association counsel confirms them.
//
// Reserve note: the per-component SIRS funding signal lives in the structural
// domain (lib/compliance/structural.ts). This module covers the budget-adoption
// clock, the annual-financial-report clock, the audited/reviewed/compiled audit
// tier, aggregate reserve under-funding, and the prohibition on waiving SIRS
// reserves for budgets adopted on/after 2024-12-31.

import {
  rule,
  toDate,
  ymd,
  addCalendarDays,
  calendarDaysUntil,
  signal,
  type AssociationType,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Statutory constants (validated:false).
// ----------------------------------------------------------------------------

export type AuditTier = 'cash' | 'compiled' | 'reviewed' | 'audited'

// Revenue tiers that set the required financial-statement level. Keys are the
// MINIMUM revenue at which the next tier up applies: revenue ≥ compiledMin →
// compiled, ≥ reviewedMin → reviewed, ≥ the (regime-specific) audited cutoff →
// audited, else cash. (Shared across regimes; only the audited cutoff differs.)
export const AUDIT_TIER_CUTOFFS = rule(
  { compiledMin: 150_000, reviewedMin: 300_000 },
  'FS 718.111(13) / 720.303(7)',
  { note: '<150k cash; 150–300k compiled; 300–500k reviewed; ≥ audited cutoff = audited' },
)
// "Audited" kicks in at this revenue. HOAs drop from $500k to $250k on 2026-07-01.
export const AUDITED_CUTOFF = rule(
  { condo: 500_000, hoa_before: 500_000, hoa_after: 250_000 },
  'FS 718.111(13) / 720.303(7)',
  { note: 'condo ≥$500k; HOA ≥$500k now, ≥$250k from 2026-07-01' },
)
export const HOA_AUDITED_CUTOFF_CHANGE_DATE = rule('2026-07-01', 'FS 720.303(7)', { note: 'HOA audited threshold drops to $250k' })
// An HOA with this many parcels must obtain audited statements regardless of revenue.
export const HOA_PARCELS_FORCE_AUDITED = rule(1000, 'FS 720.303(7)', { note: 'HOA ≥1000 parcels → audited' })

// Budget: the board must mail/post the proposed budget to members at least this
// many days before the adoption meeting, and adopt a budget before the fiscal
// year begins.
export const BUDGET_NOTICE_LEAD_DAYS = rule(14, 'FS 718.112(2)(e) / 720.303(2)(c)', { note: 'proposed-budget notice before adoption meeting' })

// Annual financial report: completed within 90 days after fiscal year-end and
// delivered/made available to members within 21 days of completion (or of a
// member request). We treat 90+21 ≈ a ~111-day soft horizon and flag hard at
// well past year-end.
export const AFR_COMPLETE_DAYS = rule(90, 'FS 718.111(13) / 720.303(7)', { note: 'days after FY-end to complete the AFR' })
export const AFR_DELIVER_DAYS = rule(21, 'FS 718.111(13) / 720.303(7)', { note: 'days after completion / request to deliver to members' })

// Reserves: advisory minimum % funded before we flag a line, and the SIRS
// no-waiver / full-funding rules that mirror the structural domain.
export const MIN_RESERVE_FUNDING_PCT = rule(50, 'FS 718.112(2)(f) / 720.303(6)', { note: 'advisory floor — flag a reserve line below this' })
// Citations align with lib/compliance/structural.ts (the per-component SIRS
// signal lives there); kept here for the aggregate reserve + no-waiver rule.
export const SIRS_WAIVER_PROHIBITED_SINCE = rule('2024-12-31', 'FS 718.112(2)(g)2', { note: 'SIRS reserves may not be waived/reduced for budgets adopted on/after this date' })
export const SIRS_FULL_FUNDING_EFFECTIVE = rule('2026-01-01', 'FS 718.112(2)(g)2', { note: 'SIRS reserves must be fully funded' })
// The vote standard to WAIVE or REDUCE reserve funding. ⚠ The two regimes differ:
// an HOA (720.303(6)(f)) needs a majority of the voting interests PRESENT at a
// quorum meeting — NOT a majority of all voting interests — and the waiver lasts
// one budget year only. The condo basis (718.112(2)(f)2) must be confirmed by
// counsel; it is kept here for the condo print artifacts.
export const RESERVE_WAIVER_VOTE_BASIS = rule(
  {
    condo: 'a majority of the total voting interests',
    hoa: 'a majority of the voting interests present at a meeting at which a quorum is present',
  } as { condo: string; hoa: string },
  'FS 718.112(2)(f)2 / 720.303(6)(f)',
  { note: 'HOA (720.303(6)(f)): majority of those PRESENT at a quorum meeting, effective ONE budget year; condo (718.112(2)(f)2) basis to be confirmed by counsel' },
)
// HOA: a reserve waiver/reduction is effective for only one budget year and must
// be re-approved annually.
export const RESERVE_WAIVER_VALID_YEARS = rule(1, 'FS 720.303(6)(f)', { note: 'HOA reserve waiver/reduction lasts one budget year; renew annually' })
// HOA: USING reserves for a non-reserve purpose is a separate member decision
// (720.303(6)(h)) with no one-year expiry; the pre-turnover standard is stricter.
export const RESERVE_DIVERSION_VOTE_BASIS = rule(
  'a majority of the voting interests present at a quorum meeting (after turnover); during developer control, a majority of all non-developer voting interests',
  'FS 720.303(6)(h)',
  { note: 'HOA: diverting reserves to another purpose needs a separate vote; no annual expiry; stricter pre-turnover standard' },
)

// ----------------------------------------------------------------------------
// Row shapes.
// ----------------------------------------------------------------------------
export interface BudgetCategoryRow {
  id: string
  community_id?: string
  name?: string | null
  budget?: number | null
  spent?: number | null
  fiscal_year?: number | null
  is_reserve?: boolean | null
  status?: 'draft' | 'proposed' | 'adopted' | string | null
}

export interface ReserveComponentRow {
  id: string
  community_id?: string
  name?: string | null
  current_balance?: number | null
  fully_funded_balance?: number | null
  is_sirs?: boolean | null
}

export type FilingType = 'budget_adoption' | 'annual_financial_report' | 'reserve_study' | 'audit_tier' | 'reserve_waiver'
export interface FinancialFilingRow {
  id: string
  community_id?: string
  fiscal_year?: number | null
  filing_type?: FilingType | string | null
  status?: 'planned' | 'in_progress' | 'completed' | 'delivered' | 'waived' | string | null
  audit_tier?: AuditTier | string | null
  completed_at?: string | null
  delivered_at?: string | null
  notes?: string | null
}

// ----------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ----------------------------------------------------------------------------
const regimeOf = (t: AssociationType | string | null | undefined): AssociationType => (t === 'hoa' ? 'hoa' : 'condo')

/** The audited-revenue cutoff for a regime as of `now` (HOA drops on 2026-07-01). */
export function auditedCutoff(regime: AssociationType, now: Date = new Date()): number {
  if (regime === 'condo') return AUDITED_CUTOFF.value.condo
  const flipped = calendarDaysUntil(HOA_AUDITED_CUTOFF_CHANGE_DATE.value, now) <= 0
  return flipped ? AUDITED_CUTOFF.value.hoa_after : AUDITED_CUTOFF.value.hoa_before
}

/** Required financial-statement tier for a revenue + regime (+HOA parcel force). */
export function requiredAuditTier(
  revenue: number,
  regime: AssociationType,
  parcelCount = 0,
  now: Date = new Date(),
): AuditTier {
  if (regime === 'hoa' && parcelCount >= HOA_PARCELS_FORCE_AUDITED.value) return 'audited'
  const rev = Number(revenue) || 0
  if (rev >= auditedCutoff(regime, now)) return 'audited'
  if (rev >= AUDIT_TIER_CUTOFFS.value.reviewedMin) return 'reviewed'
  if (rev >= AUDIT_TIER_CUTOFFS.value.compiledMin) return 'compiled'
  return 'cash'
}

const AUDIT_TIER_RANK: Record<AuditTier, number> = { cash: 0, compiled: 1, reviewed: 2, audited: 3 }
export const AUDIT_TIER_LABEL: Record<AuditTier, string> = {
  cash: 'cash-basis report of receipts & disbursements',
  compiled: 'compiled financial statements',
  reviewed: 'reviewed financial statements',
  audited: 'audited financial statements',
}

/**
 * Annual revenue for the audit tier. Precedence: an explicit `annual_revenue`
 * field the board set (deliberate override) → `liveRevenue` (current-FY earned
 * revenue from the general ledger, when a ledger exists) → the sum of operating
 * budgets (the estimate used before any ledger is built). Measured GL revenue is
 * more defensible for a statutory threshold than a budget figure, but never
 * overrides a number the board explicitly stated.
 */
export function estimateAnnualRevenue(
  community: Record<string, any> | null | undefined,
  budgets: BudgetCategoryRow[] = [],
  liveRevenue?: number,
): number {
  const explicit = Number(community?.annual_revenue) || 0
  if (explicit > 0) return explicit
  const live = Number(liveRevenue) || 0
  if (live > 0) return live
  return budgets.filter(b => !b.is_reserve).reduce((s, b) => s + (Number(b.budget) || 0), 0)
}

/** Fiscal-year start date for a given calendar year (fiscal_year_start_month, 1-12). */
export function fiscalYearStart(community: Record<string, any> | null | undefined, year: number): Date {
  const m = Math.min(12, Math.max(1, Number(community?.fiscal_year_start_month) || 1))
  return new Date(Date.UTC(year, m - 1, 1))
}

/** The most recent fiscal-year-end on/before `now` (the FY that just closed). */
export function lastFiscalYearEnd(community: Record<string, any> | null | undefined, now: Date = new Date()): { fyEnd: Date; fyLabel: number } {
  const n = toDate(now)!
  const m = Math.min(12, Math.max(1, Number(community?.fiscal_year_start_month) || 1))
  // FY start in this calendar year:
  const startThisYear = Date.UTC(n.getUTCFullYear(), m - 1, 1)
  // The current FY started either this year or last year.
  const fyStartYear = n.getTime() >= startThisYear ? n.getUTCFullYear() : n.getUTCFullYear() - 1
  // The FY that has ENDED most recently started a year before the current one.
  const endedFyStart = new Date(Date.UTC(fyStartYear - 1, m - 1, 1))
  const fyEnd = new Date(Date.UTC(fyStartYear, m - 1, 1) - 86400000) // day before current FY start
  return { fyEnd, fyLabel: endedFyStart.getUTCFullYear() }
}

const ADOPTED = (s: string | null | undefined) => String(s ?? '') === 'adopted'

// ----------------------------------------------------------------------------
// Monitor signal producer (condo + HOA).
// ----------------------------------------------------------------------------
const HREF = '/admin/financials'

export function financialSignals(
  community: Record<string, any> | null | undefined,
  budgets: BudgetCategoryRow[] = [],
  reserves: ReserveComponentRow[] = [],
  filings: FinancialFilingRow[] = [],
  now: Date = new Date(),
  liveRevenue?: number,
): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const regime = regimeOf(community.association_type)
  const cite = 'FS 718.111(13) / 720.303(6)-(7)'

  // --- Audit tier (driven by live GL revenue when a ledger exists) ---
  const revenue = estimateAnnualRevenue(community, budgets, liveRevenue)
  const parcelCount = Number(community.parcel_count) || 0
  const required = requiredAuditTier(revenue, regime, parcelCount, now)
  if (revenue > 0) {
    // Did the latest audit_tier / AFR filing meet the required level?
    const tierFiling = filings
      .filter(f => f.filing_type === 'audit_tier' || f.filing_type === 'annual_financial_report')
      .sort((a, b) => (Number(b.fiscal_year) || 0) - (Number(a.fiscal_year) || 0))[0]
    const haveTier = tierFiling?.audit_tier as AuditTier | undefined
    if (haveTier && AUDIT_TIER_RANK[haveTier] < AUDIT_TIER_RANK[required]) {
      out.push(signal({
        id: 'financial:audit-tier-mismatch',
        domain: 'Financial reporting',
        severity: 'overdue',
        title: `Financial statements below the required level (need ${AUDIT_TIER_LABEL[required]})`,
        detail: `At ~$${Math.round(revenue).toLocaleString('en-US')} annual revenue${regime === 'hoa' && parcelCount >= HOA_PARCELS_FORCE_AUDITED.value ? ' / ≥1,000 parcels' : ''}, the law requires ${AUDIT_TIER_LABEL[required]}; the last report on file was ${AUDIT_TIER_LABEL[haveTier]}.`,
        href: HREF,
        citation: cite,
      }))
    } else if (required === 'audited' && (!haveTier || AUDIT_TIER_RANK[haveTier as AuditTier] < AUDIT_TIER_RANK['audited'])) {
      out.push(signal({
        id: 'financial:audit-tier-required',
        domain: 'Financial reporting',
        severity: 'info',
        title: 'Audited financial statements are required at this revenue',
        detail: `~$${Math.round(revenue).toLocaleString('en-US')} annual revenue requires audited financial statements.`,
        href: HREF,
        citation: cite,
      }))
    }
    // HOA approaching the 2026-07-01 audited-threshold drop to $250k.
    if (regime === 'hoa') {
      const daysToFlip = calendarDaysUntil(HOA_AUDITED_CUTOFF_CHANGE_DATE.value, now)
      const wouldBecomeAudited = revenue >= AUDITED_CUTOFF.value.hoa_after && revenue < AUDITED_CUTOFF.value.hoa_before
      if (wouldBecomeAudited && daysToFlip >= 0) {
        out.push(signal({
          id: 'financial:hoa-audit-threshold-flip',
          domain: 'Financial reporting',
          severity: daysToFlip <= 90 ? 'soon' : 'info',
          title: 'HOA audited-statement threshold drops to $250k on 2026-07-01',
          detail: `At ~$${Math.round(revenue).toLocaleString('en-US')} revenue, your association will require audited financial statements once the threshold drops (${daysToFlip} days).`,
          href: HREF,
          citation: HOA_AUDITED_CUTOFF_CHANGE_DATE.citation,
        }))
      }
    }
  }

  // --- Annual financial report clock (for the FY that just ended) ---
  const { fyEnd, fyLabel } = lastFiscalYearEnd(community, now)
  const afr = filings.find(f => f.filing_type === 'annual_financial_report' && Number(f.fiscal_year) === fyLabel)
  const afrDone = afr && (String(afr.status) === 'completed' || String(afr.status) === 'delivered')
  if (!afrDone) {
    const completeBy = addCalendarDays(fyEnd, AFR_COMPLETE_DAYS.value)!
    const daysLeft = calendarDaysUntil(completeBy, now)
    if (daysLeft < 0) {
      out.push(signal({
        id: `financial:afr-overdue:${fyLabel}`,
        domain: 'Financial reporting',
        severity: 'overdue',
        title: `${fyLabel} annual financial report is overdue`,
        detail: `It was due ${ymd(completeBy)} (within ${AFR_COMPLETE_DAYS.value} days after the ${ymd(fyEnd)} fiscal year-end) and must be delivered to members within ${AFR_DELIVER_DAYS.value} days of completion.`,
        href: HREF,
        citation: cite,
      }))
    } else if (daysLeft <= 30) {
      out.push(signal({
        id: `financial:afr-soon:${fyLabel}`,
        domain: 'Financial reporting',
        severity: 'soon',
        title: `${fyLabel} annual financial report due soon`,
        detail: `Due ${ymd(completeBy)} (90 days after fiscal year-end).`,
        href: HREF,
        citation: cite,
      }))
    }
  } else if (afr && String(afr.status) === 'completed' && !afr.delivered_at) {
    const deliverBy = addCalendarDays(afr.completed_at ?? fyEnd, AFR_DELIVER_DAYS.value)!
    const d = calendarDaysUntil(deliverBy, now)
    out.push(signal({
      id: `financial:afr-deliver:${fyLabel}`,
      domain: 'Financial reporting',
      severity: d < 0 ? 'overdue' : 'soon',
      title: `${fyLabel} annual financial report not yet delivered to members`,
      detail: `Deliver within ${AFR_DELIVER_DAYS.value} days of completion (by ${ymd(deliverBy)}).`,
      href: HREF,
      citation: cite,
    }))
  }

  // --- Budget adoption for the upcoming/current fiscal year ---
  const n = toDate(now)!
  const fyStartThisYear = fiscalYearStart(community, n.getUTCFullYear())
  // The next FY start on/after now (could be this calendar year or next).
  const nextFyStart = n.getTime() <= fyStartThisYear.getTime()
    ? fyStartThisYear
    : fiscalYearStart(community, n.getUTCFullYear() + 1)
  const nextFyLabel = nextFyStart.getUTCFullYear()
  const adoptedNext = budgets.some(b => Number(b.fiscal_year) === nextFyLabel && ADOPTED(b.status)) ||
    filings.some(f => f.filing_type === 'budget_adoption' && Number(f.fiscal_year) === nextFyLabel && (String(f.status) === 'completed' || String(f.status) === 'delivered'))
  const daysToFyStart = calendarDaysUntil(nextFyStart, now)
  if (!adoptedNext && daysToFyStart <= BUDGET_NOTICE_LEAD_DAYS.value) {
    out.push(signal({
      id: `financial:budget-adoption:${nextFyLabel}`,
      domain: 'Financial reporting',
      severity: daysToFyStart < 0 ? 'overdue' : 'soon',
      title: daysToFyStart < 0
        ? `${nextFyLabel} budget was not adopted before the fiscal year began`
        : `${nextFyLabel} budget must be adopted before the fiscal year begins`,
      detail: `Fiscal year starts ${ymd(nextFyStart)}. The proposed budget must reach members at least ${BUDGET_NOTICE_LEAD_DAYS.value} days before the adoption meeting.`,
      href: HREF,
      citation: 'FS 718.112(2)(e) / 720.303(2)',
    }))
  }

  // --- Aggregate reserve under-funding ---
  const fundable = reserves.filter(r => (Number(r.fully_funded_balance) || 0) > 0)
  const under = fundable.filter(r => (Number(r.current_balance) || 0) / (Number(r.fully_funded_balance) || 1) * 100 < MIN_RESERVE_FUNDING_PCT.value)
  if (under.length) {
    out.push(signal({
      id: 'financial:reserve-underfunded',
      domain: 'Financial reporting',
      severity: 'soon',
      title: `${under.length} reserve line(s) are under ${MIN_RESERVE_FUNDING_PCT.value}% funded`,
      detail: `Underfunded reserves increase the risk of a special assessment. SIRS-component reserves must be fully funded for budgets adopted on/after ${SIRS_FULL_FUNDING_EFFECTIVE.value}.`,
      href: HREF,
      citation: MIN_RESERVE_FUNDING_PCT.citation,
    }))
  }

  // --- SIRS reserve waiver prohibited (budgets adopted on/after 2024-12-31) ---
  // Only a waiver that actually post-dates the prohibition counts — match by the
  // date it was recorded (completed_at) or a budget year after the cutoff year, so
  // a stale pre-2024 waiver record doesn't perpetually flag as "overdue".
  const waiverProhibited = calendarDaysUntil(SIRS_WAIVER_PROHIBITED_SINCE.value, now) <= 0 // on/after the date
  const prohibitedSinceMs = toDate(SIRS_WAIVER_PROHIBITED_SINCE.value)!.getTime()
  const prohibitedYear = toDate(SIRS_WAIVER_PROHIBITED_SINCE.value)!.getUTCFullYear() // 2024
  const sirsWaiver = filings.find(f =>
    f.filing_type === 'reserve_waiver' && String(f.status) === 'waived' &&
    ((toDate(f.completed_at)?.getTime() ?? 0) >= prohibitedSinceMs || (Number(f.fiscal_year) || 0) > prohibitedYear))
  const hasSirsReserve = reserves.some(r => r.is_sirs)
  if (waiverProhibited && sirsWaiver && hasSirsReserve && regime === 'condo') {
    out.push(signal({
      id: 'financial:sirs-waiver-prohibited',
      domain: 'Financial reporting',
      severity: 'overdue',
      title: 'A reserve waiver was recorded but SIRS reserves may no longer be waived',
      detail: `Since ${SIRS_WAIVER_PROHIBITED_SINCE.value}, reserves for SIRS structural components may not be waived or reduced by a member vote.`,
      href: HREF,
      citation: SIRS_WAIVER_PROHIBITED_SINCE.citation,
    }))
  }

  // --- HOA reserve-waiver one-year expiry + diversion advisory (720.303(6)) ---
  // A recorded reserve waiver is good for one budget year only. If the most recent
  // waiver predates the budget year now in effect, nudge that a fresh annual vote
  // is needed to waive again — and that diverting reserves is a separate decision.
  if (regime === 'hoa') {
    const latestWaiverYear = filings
      .filter(f => f.filing_type === 'reserve_waiver' && String(f.status) === 'waived')
      .reduce((max, f) => Math.max(max, Number(f.fiscal_year) || 0), 0)
    if (latestWaiverYear > 0) {
      const nowD = toDate(now)!
      const fyStartThis = fiscalYearStart(community, nowD.getUTCFullYear())
      const currentBudgetYear = nowD.getTime() >= fyStartThis.getTime() ? nowD.getUTCFullYear() : nowD.getUTCFullYear() - 1
      if (latestWaiverYear < currentBudgetYear) {
        out.push(signal({
          id: 'financial:hoa-reserve-waiver-expired',
          domain: 'Financial reporting',
          severity: 'info',
          title: `The last reserve waiver (FY${latestWaiverYear}) has expired — a waiver lasts one budget year`,
          detail: `An HOA reserve waiver or reduction is approved by ${RESERVE_WAIVER_VOTE_BASIS.value.hoa} and is effective for one budget year only; to waive again for FY${currentBudgetYear} the members must vote anew. Using reserve funds for any non-reserve purpose is a separate decision requiring ${RESERVE_DIVERSION_VOTE_BASIS.value}.`,
          href: HREF,
          citation: RESERVE_WAIVER_VALID_YEARS.citation,
        }))
      }
    }
  }

  return out
}
