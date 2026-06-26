// Dues accrual + status — shared by the Residents, Home and Pay screens.
// Model: a board-set opening balance, plus monthly_dues accrued every month
// since the resident was added, minus payments — plus late interest and an
// optional administrative late fee once a household falls behind. Status is
// derived.
//
// FLORIDA STATUTORY NOTE (FS 718.116(3) / 720.3085(3), HB 1203 simple-only eff
// 2024-07-01): interest on a delinquent assessment is SIMPLE interest accruing
// from each installment's due date at the rate in the declaration, or 18%/year
// when the declaration is silent. The rate is expressed ANNUALLY.
//   • `apr` here is the ANNUAL percentage (monthly factor = apr / 12 / 100).
//   • The per-installment sum below (1+2+…+late = late·(late+1)/2) is SIMPLE
//     interest: the installment due `j` months ago accrues `j` months of
//     interest, with no compounding. Daily-exact, due-date-anchored accrual
//     arrives with the per-installment collections ledger (compliance domain F).
//   • Interest and late fees are OPT-IN per community: when unconfigured the
//     platform charges neither (it never invents interest). See
//     communityDuesConfig().

export type DuesStatus = 'paid' | 'due' | 'late'

export type Resident = {
  id?: string
  created_at?: string
  opening_balance?: number | null
  [key: string]: unknown
}

export type Payment = { amount?: number | null; [key: string]: unknown }

/** Per-community dues/interest configuration (statutory-aware). */
export interface DuesConfig {
  /** Annual interest %, statutory cap 18 (FS 718.116(3)/720.3085(3)). 0 = none. */
  apr?: number
  /** Flat admin late fee $ per delinquent installment. 0/undefined = none. */
  lateFeeFlat?: number
  /** Admin late fee % of each delinquent installment. 0/undefined = none. */
  lateFeePct?: number
}

// Statutory references for the compliance layer (the cap/floor, NOT defaults we
// silently apply — boards opt in via community settings).
export const STATUTORY_MAX_APR = 18 // FS 718.116(3) / 720.3085(3)
export const STATUTORY_LATE_FEE_MIN = 25 // FS 718.116(3) / 720.3085(3): greater of $25
export const STATUTORY_LATE_FEE_PCT = 5 //                              … or 5% of the installment

export const fmtMoney = (n: number | string | null | undefined): string =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

export const DUES_LABEL: Record<DuesStatus, string> = { paid: 'Paid', due: 'Due', late: 'Late' }

const sumPayments = (payments: Payment[] = []): number =>
  payments.reduce((s, p) => s + (Number(p?.amount) || 0), 0)

/**
 * Resolve a community row to a DuesConfig. Prefers the new annual `interest_apr`
 * column; falls back to the legacy monthly `late_interest_rate` × 12 so the
 * computed figure is IDENTICAL before and after the compliance migration runs
 * (1.5%/month ⇒ 18%/year ⇒ same monthly factor). Unconfigured ⇒ no interest.
 */
export function communityDuesConfig(community: Record<string, unknown> | null | undefined): DuesConfig {
  if (!community) return { apr: 0 }
  const aprCol = community['interest_apr']
  const legacyMonthly = Number(community['late_interest_rate']) || 0
  const apr = aprCol != null && aprCol !== ''
    ? Number(aprCol) || 0
    : legacyMonthly * 12
  return {
    apr,
    lateFeeFlat: Number(community['late_fee_flat']) || 0,
    lateFeePct: Number(community['late_fee_pct']) || 0,
  }
}

// Whole calendar-month boundaries crossed between a date and now.
export function monthsSince(dateInput: string | Date | null | undefined, now: Date = new Date()): number {
  if (!dateInput) return 0
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return 0
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()))
}

// Months of dues a resident owes. The current month always counts — a
// household owes dues for the month it was added, then one more each month.
export function monthsOwed(resident: Resident | null | undefined, now: Date = new Date()): number {
  return monthsSince(resident?.created_at, now) + 1
}

// Whole months of dues the resident's payments have fully covered.
export function monthsCovered(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], now: Date = new Date()): number {
  const m = Number(monthlyDues) || 0
  if (m <= 0) return 0
  const opening = Number(resident?.opening_balance) || 0
  const afterOpening = Math.max(0, sumPayments(payments) - opening)
  return Math.min(monthsOwed(resident, now), Math.floor(afterOpening / m))
}

export function monthsLate(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], now: Date = new Date()): number {
  return Math.max(0, monthsOwed(resident, now) - monthsCovered(resident, monthlyDues, payments, now) - 1)
}

// Triangular helper: the simple-interest month-sum for `late` overdue installments.
const triangular = (late: number): number => (late * (late + 1)) / 2

/**
 * Simple late interest. `apr` is the ANNUAL percentage; the monthly factor is
 * apr/12/100. See the file-header statutory note. Returns 0 when apr ≤ 0.
 */
export function lateInterest(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], apr: number = 0, now: Date = new Date()): number {
  const a = Number(apr) || 0
  const m = Number(monthlyDues) || 0
  if (a <= 0 || m <= 0) return 0
  const late = monthsLate(resident, monthlyDues, payments, now)
  if (late <= 0) return 0
  const monthlyFactor = a / 12 / 100
  return Math.round(m * monthlyFactor * triangular(late) * 100) / 100
}

/**
 * Administrative late fees — one fee per delinquent installment, the statute
 * caps it at the greater of a flat $ amount or a % of the installment. Returns
 * 0 unless the community has opted into a flat and/or % fee.
 */
export function adminLateFees(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], cfg: DuesConfig = {}, now: Date = new Date()): number {
  const m = Number(monthlyDues) || 0
  const flat = Number(cfg.lateFeeFlat) || 0
  const pct = Number(cfg.lateFeePct) || 0
  if (m <= 0 || (flat <= 0 && pct <= 0)) return 0
  const late = monthsLate(resident, monthlyDues, payments, now)
  if (late <= 0) return 0
  const perInstallment = Math.max(flat, (m * pct) / 100)
  return Math.round(perInstallment * late * 100) / 100
}

/** Accept either a DuesConfig or a bare annual-APR number (legacy callers). */
function asConfig(cfg: DuesConfig | number | undefined): DuesConfig {
  if (cfg == null) return { apr: 0 }
  return typeof cfg === 'number' ? { apr: cfg } : cfg
}

export function residentBalance(
  resident: Resident | null | undefined,
  monthlyDues: number,
  payments: Payment[] = [],
  cfg: DuesConfig | number = {},
  now: Date = new Date(),
): number {
  const c = asConfig(cfg)
  const opening = Number(resident?.opening_balance) || 0
  const accrued = monthsOwed(resident, now) * (Number(monthlyDues) || 0)
  const paid = sumPayments(payments)
  const interest = lateInterest(resident, monthlyDues, payments, c.apr || 0, now)
  const fees = adminLateFees(resident, monthlyDues, payments, c, now)
  return Math.round((opening + accrued - paid + interest + fees) * 100) / 100
}

export function duesStatus(balance: number, monthlyDues: number): DuesStatus {
  const m = Number(monthlyDues) || 0
  if (balance <= 0.005) return 'paid'
  if (balance <= m + 0.005) return 'due'
  return 'late'
}

// ============================================================================
// Collections ledger (compliance domain F) — FS 718.116(3) / 720.3085(3).
//
// The dashboard balance above is a month-granular ESTIMATE. For a delinquent
// account heading into a lien/foreclosure, the statutory payoff must be:
//   • SIMPLE interest accruing DAILY from each installment's due date, and
//   • payments applied in the statutory order: interest → admin late fees →
//     collection/attorney costs → the delinquent assessment (principal).
// These pure, side-effect-free helpers produce that sworn-ledger payoff. They
// are OPT-IN (no apr/fees ⇒ no interest/fees) exactly like the dashboard model.
//
// ⚠ The day-count convention (actual/365), the late-fee-per-installment rule,
// and the application order require attorney confirmation per community before
// any generated ledger is relied upon.
// ============================================================================

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** Parse a date input to its UTC-midnight epoch ms, or null. */
function utcMidnightMs(input: string | Date | null | undefined): number | null {
  if (input == null) return null
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return null
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

const ymdUTC = (input: string | Date | null | undefined): string => {
  const ms = utcMidnightMs(input)
  return ms == null ? '' : new Date(ms).toISOString().slice(0, 10)
}

/** The four statutory charge buckets, keyed in payment-application order. */
export interface LedgerBuckets {
  interest: number
  lateFee: number
  cost: number
  principal: number
}

/** Statutory payment-application order (FS 718.116(3) / 720.3085(3)). */
export const PAYMENT_APPLICATION_BUCKETS: (keyof LedgerBuckets)[] = ['interest', 'lateFee', 'cost', 'principal']

const normalizeBuckets = (b: Partial<LedgerBuckets>): LedgerBuckets => ({
  interest:  Math.max(0, round2(Number(b.interest) || 0)),
  lateFee:   Math.max(0, round2(Number(b.lateFee) || 0)),
  cost:      Math.max(0, round2(Number(b.cost) || 0)),
  principal: Math.max(0, round2(Number(b.principal) || 0)),
})

/**
 * Apply ONE payment across the buckets in statutory order. Returns how much was
 * applied to each bucket, the remaining (unpaid) buckets, and any leftover
 * credit (overpayment).
 */
export function applyPayment(
  buckets: Partial<LedgerBuckets>,
  payment: number,
): { applied: LedgerBuckets; remaining: LedgerBuckets; credit: number } {
  let amt = Math.max(0, round2(Number(payment) || 0))
  const remaining = normalizeBuckets(buckets)
  const applied: LedgerBuckets = { interest: 0, lateFee: 0, cost: 0, principal: 0 }
  for (const k of PAYMENT_APPLICATION_BUCKETS) {
    const pay = Math.min(remaining[k], amt)
    applied[k] = round2(pay)
    remaining[k] = round2(remaining[k] - pay)
    amt = round2(amt - pay)
  }
  return { applied, remaining, credit: round2(amt) }
}

/**
 * Apply a sequence of payments, carrying any overpayment credit forward to the
 * next payment. Equivalent to applying the summed total, but exposed for
 * chronological ledgers. Returns the final remaining buckets + leftover credit.
 */
export function applyPayments(
  buckets: Partial<LedgerBuckets>,
  payments: number[] = [],
): { remaining: LedgerBuckets; credit: number } {
  let remaining: LedgerBuckets = normalizeBuckets(buckets)
  let carry = 0
  for (const p of payments) {
    const r = applyPayment(remaining, (Number(p) || 0) + carry)
    remaining = r.remaining
    carry = r.credit
  }
  return { remaining, credit: carry }
}

/**
 * SIMPLE interest on `principal` from `from` to `to` at annual `apr` %, accruing
 * daily (actual/365). Returns 0 when apr ≤ 0, principal ≤ 0, or `to` ≤ `from`.
 */
export function dailyInterest(
  principal: number,
  apr: number,
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): number {
  const p = Number(principal) || 0
  const a = Number(apr) || 0
  if (p <= 0 || a <= 0) return 0
  const f = utcMidnightMs(from)
  const t = utcMidnightMs(to)
  if (f == null || t == null) return 0
  const days = Math.max(0, Math.round((t - f) / 86400000))
  return round2(p * (a / 100) * (days / 365))
}

/** A single principal charge with its statutory due date. */
export interface Installment {
  dueDate: string | Date
  amount: number
}

export interface PayoffInput {
  installments: Installment[]
  apr?: number
  lateFeeFlat?: number
  lateFeePct?: number
  /** Recorded collection / attorney costs (dollars). */
  extraCosts?: number
  /** Sum of all payments received on the account (dollars). */
  totalPaid?: number
  asOf?: string | Date
}

export interface PayoffLine {
  dueDate: string
  principal: number
  interest: number
  lateFee: number
}

export interface PayoffResult {
  /** Gross amounts owed before payments, by bucket. */
  gross: LedgerBuckets
  /** How the payments were applied across the buckets (statutory order). */
  applied: LedgerBuckets
  /** Remaining unpaid amount, by bucket. */
  remaining: LedgerBuckets
  /** Total amount required to bring the account current. */
  payoff: number
  /** Overpayment credit, if any. */
  credit: number
  asOf: string
  /** Per-installment itemisation for the sworn ledger. */
  lines: PayoffLine[]
}

/**
 * Build the statutory payoff for a delinquent account: accrue daily interest +
 * per-installment admin late fees, add recorded costs, then apply payments in
 * the statutory order. Pure and unit-testable.
 */
export function buildPayoff(input: PayoffInput): PayoffResult {
  const asOfDate = input.asOf ? new Date(input.asOf) : new Date()
  const asOfMs = utcMidnightMs(asOfDate)
  const apr = Number(input.apr) || 0
  const flat = Number(input.lateFeeFlat) || 0
  const pct = Number(input.lateFeePct) || 0

  const lines: PayoffLine[] = []
  let principal = 0
  let interest = 0
  let lateFee = 0

  for (const inst of input.installments || []) {
    const amt = round2(Number(inst.amount) || 0)
    if (amt <= 0) continue
    const int = dailyInterest(amt, apr, inst.dueDate, asOfDate)
    const dueMs = utcMidnightMs(inst.dueDate)
    const overdue = dueMs != null && asOfMs != null && dueMs < asOfMs
    const fee = overdue && (flat > 0 || pct > 0) ? round2(Math.max(flat, (amt * pct) / 100)) : 0
    principal = round2(principal + amt)
    interest = round2(interest + int)
    lateFee = round2(lateFee + fee)
    lines.push({ dueDate: ymdUTC(inst.dueDate), principal: amt, interest: int, lateFee: fee })
  }

  const gross: LedgerBuckets = { interest, lateFee, cost: round2(Number(input.extraCosts) || 0), principal }
  const { applied, remaining, credit } = applyPayment(gross, Number(input.totalPaid) || 0)
  const payoff = round2(remaining.interest + remaining.lateFee + remaining.cost + remaining.principal)
  return { gross, applied, remaining, payoff, credit, asOf: ymdUTC(asOfDate), lines }
}

/**
 * Derive the principal installment schedule for a resident: the opening balance
 * (dated at the resident's start) plus one `monthlyDues` installment per month
 * owed, each due on `dueDay` (1–28). Mirrors monthsOwed() so the payoff is
 * consistent with the dashboard's accrual count.
 */
export function deriveInstallments(
  resident: Resident | null | undefined,
  monthlyDues: number,
  opts: { asOf?: string | Date; dueDay?: number } = {},
): Installment[] {
  const m = round2(Number(monthlyDues) || 0)
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date()
  const dueDay = Math.min(28, Math.max(1, Math.round(Number(opts.dueDay) || 1)))
  const created = new Date(resident?.created_at || asOf)
  const baseY = created.getUTCFullYear()
  const baseM = created.getUTCMonth()
  const out: Installment[] = []

  const opening = round2(Number(resident?.opening_balance) || 0)
  if (opening > 0) {
    out.push({ dueDate: ymdUTC(new Date(Date.UTC(baseY, baseM, dueDay))), amount: opening })
  }

  const owed = monthsOwed(resident, asOf)
  for (let i = 0; i < owed && m > 0; i++) {
    out.push({ dueDate: ymdUTC(new Date(Date.UTC(baseY, baseM + i, dueDay))), amount: m })
  }
  return out
}

/**
 * Convenience: the statutory payoff for a collection case derived from the
 * resident + community profile. `extraCosts` are the case's recorded collection
 * / attorney costs (not derivable from the profile).
 */
export function casePayoff(
  resident: Resident | null | undefined,
  community: Record<string, unknown> | null | undefined,
  payments: Payment[] = [],
  opts: { asOf?: string | Date; extraCosts?: number; freeze?: boolean; freezeInterest?: boolean; freezeLateFees?: boolean } = {},
): PayoffResult {
  const monthly = Number((community as any)?.monthly_dues) || 0
  const cfg = communityDuesConfig(community)
  const dueDay = Number((community as any)?.assessment_due_day) || 1
  const asOf = opts.asOf ?? new Date()
  // Good-faith freeze: interest and late fees can each be frozen independently
  // (zeroed in the payoff). `freeze` freezes both; each resumes once cleared.
  const fInt = opts.freeze || opts.freezeInterest
  const fLate = opts.freeze || opts.freezeLateFees
  return buildPayoff({
    installments: deriveInstallments(resident, monthly, { asOf, dueDay }),
    apr: fInt ? 0 : (cfg.apr || 0),
    lateFeeFlat: fLate ? 0 : (cfg.lateFeeFlat || 0),
    lateFeePct: fLate ? 0 : (cfg.lateFeePct || 0),
    extraCosts: Number(opts.extraCosts) || 0,
    totalPaid: sumPayments(payments),
    asOf,
  })
}

/**
 * Approximate days past due = days since the OLDEST unpaid (delinquent)
 * installment's due date. Returns 0 when the resident is not behind beyond the
 * current month (i.e. monthsLate < 1). Uses the same month-granular model as
 * the dashboard, so it is an estimate for the "X days delinquent" threshold —
 * relative to today.
 */
export function daysPastDue(
  resident: Resident | null | undefined,
  monthlyDues: number,
  payments: Payment[] = [],
  opts: { dueDay?: number; now?: Date } = {},
): number {
  const now = opts.now ?? new Date()
  if (!resident?.created_at) return 0
  if (monthsLate(resident, monthlyDues, payments) < 1) return 0
  const covered = monthsCovered(resident, monthlyDues, payments)
  const created = new Date(resident.created_at)
  if (isNaN(created.getTime())) return 0
  const dueDay = Math.min(28, Math.max(1, Math.round(Number(opts.dueDay) || 1)))
  // The oldest still-uncovered installment falls `covered` months after the start.
  const dueMs = Date.UTC(created.getUTCFullYear(), created.getUTCMonth() + covered, dueDay)
  const nowMs = utcMidnightMs(now)
  if (nowMs == null) return 0
  return Math.max(0, Math.round((nowMs - dueMs) / 86400000))
}

export function paymentCalendar(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = []) {
  const owed = monthsOwed(resident)
  const covered = monthsCovered(resident, monthlyDues, payments)
  const start = new Date(resident?.created_at || Date.now())
  const out: { key: string; label: string; year: number; state: 'paid' | 'due' | 'overdue' }[] = []
  for (let i = 0; i < owed; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    let state: 'paid' | 'due' | 'overdue'
    if (i < covered) state = 'paid'
    else if (i === owed - 1) state = 'due'
    else state = 'overdue'
    out.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      year: d.getFullYear(),
      state,
    })
  }
  return out
}
