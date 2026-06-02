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
export function monthsCovered(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = []): number {
  const m = Number(monthlyDues) || 0
  if (m <= 0) return 0
  const opening = Number(resident?.opening_balance) || 0
  const afterOpening = Math.max(0, sumPayments(payments) - opening)
  return Math.min(monthsOwed(resident), Math.floor(afterOpening / m))
}

export function monthsLate(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = []): number {
  return Math.max(0, monthsOwed(resident) - monthsCovered(resident, monthlyDues, payments) - 1)
}

// Triangular helper: the simple-interest month-sum for `late` overdue installments.
const triangular = (late: number): number => (late * (late + 1)) / 2

/**
 * Simple late interest. `apr` is the ANNUAL percentage; the monthly factor is
 * apr/12/100. See the file-header statutory note. Returns 0 when apr ≤ 0.
 */
export function lateInterest(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], apr: number = 0): number {
  const a = Number(apr) || 0
  const m = Number(monthlyDues) || 0
  if (a <= 0 || m <= 0) return 0
  const late = monthsLate(resident, monthlyDues, payments)
  if (late <= 0) return 0
  const monthlyFactor = a / 12 / 100
  return Math.round(m * monthlyFactor * triangular(late) * 100) / 100
}

/**
 * Administrative late fees — one fee per delinquent installment, the statute
 * caps it at the greater of a flat $ amount or a % of the installment. Returns
 * 0 unless the community has opted into a flat and/or % fee.
 */
export function adminLateFees(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], cfg: DuesConfig = {}): number {
  const m = Number(monthlyDues) || 0
  const flat = Number(cfg.lateFeeFlat) || 0
  const pct = Number(cfg.lateFeePct) || 0
  if (m <= 0 || (flat <= 0 && pct <= 0)) return 0
  const late = monthsLate(resident, monthlyDues, payments)
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
): number {
  const c = asConfig(cfg)
  const opening = Number(resident?.opening_balance) || 0
  const accrued = monthsOwed(resident) * (Number(monthlyDues) || 0)
  const paid = sumPayments(payments)
  const interest = lateInterest(resident, monthlyDues, payments, c.apr || 0)
  const fees = adminLateFees(resident, monthlyDues, payments, c)
  return Math.round((opening + accrued - paid + interest + fees) * 100) / 100
}

export function duesStatus(balance: number, monthlyDues: number): DuesStatus {
  const m = Number(monthlyDues) || 0
  if (balance <= 0.005) return 'paid'
  if (balance <= m + 0.005) return 'due'
  return 'late'
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
