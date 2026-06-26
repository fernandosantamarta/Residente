// Owner-verifiable monthly statements — derived from the resident's REAL ledger,
// never invented. One row per billing month from the resident's start (created_at)
// through the current month, newest first. Each row is a genuine mini-statement
// the owner can check against their own records:
//
//   opening balance  (carried forward — the prior month's closing)
//   + dues assessed   (the same flat monthly_dues the dashboard balance accrues)
//   + interest & fees (only when the community has opted into APR / late fees)
//   − payments         (everything we actually recorded that month, any method)
//   = closing balance  (carried into next month)
//
// The running balance RECONCILES to lib/dues residentBalance(): the closing
// balance of the newest month equals the Current Balance shown on the Pay screen
// (opening + Σdues + Σinterest&fees − Σpayments). That exact tie is what makes a
// statement owner-verifiable rather than a decorative PDF.
//
// This replaces the old hardcoded DEMO_STATEMENTS placeholder on the Pay screen.
// Preview / no-roster-match mode (resident == null) still shows the demo set so the
// marketing showcase stays alive — exactly how DEMO_HISTORY is gated.

import { monthsOwed, lateInterest, adminLateFees, type DuesConfig, type Payment, type Resident } from './dues'

export interface AccountStatement {
  /** 'YYYY-MM' — stable key + sort handle (also the print-route param). */
  id: string
  /** First day of the billed month, 'YYYY-MM-01'. */
  periodStart: string
  /** Balance carried in from the prior month (first month = board-set opening_balance). */
  openingBalance: number
  /** Dues assessed that month (flat monthly_dues; 0 if the community has none). */
  dues: number
  /** Late interest + admin late fees that accrued this month (0 unless the community opted in). */
  interestFees: number
  /** Total charges this month (dues + interestFees). */
  charges: number
  /** Payments recorded that month, any method (dues, fines, installments). */
  paid: number
  /** Balance carried out to next month (opening + charges − paid). */
  closingBalance: number
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
const monthKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const paymentWhen = (p: Payment): string | null =>
  (p as { paid_on?: string | null; created_at?: string | null }).paid_on
  || (p as { created_at?: string | null }).created_at
  || null

/**
 * Build month-by-month statements from real data. Returns newest-first, capped to
 * `max` months (default 12). Returns [] when there's no resident start date to
 * anchor the schedule — callers fall back to the demo set in that case.
 *
 * `cfg` carries the community's statutory interest/late-fee config so the
 * interest & fees line matches the dashboard balance; omit it (or pass {}) for a
 * dues-only community and the interest line stays $0.
 */
export function deriveStatements(
  resident: Resident | null | undefined,
  monthlyDues: number,
  payments: Payment[] = [],
  opts: { now?: Date; max?: number; cfg?: DuesConfig } = {},
): AccountStatement[] {
  if (!resident?.created_at) return []
  const created = new Date(resident.created_at)
  if (isNaN(created.getTime())) return []

  const now = opts.now ?? new Date()
  const max = opts.max ?? 12
  const cfg = opts.cfg ?? {}
  const dues = Math.max(0, round2(Number(monthlyDues) || 0))

  // Payments summed into the calendar month they landed in (paid_on preferred,
  // else created_at — mirrors the Pay screen's history rendering).
  const paidByMonth = new Map<string, number>()
  for (const p of payments) {
    const when = paymentWhen(p)
    if (!when) continue
    const d = new Date(when)
    if (isNaN(d.getTime())) continue
    const key = monthKey(d)
    paidByMonth.set(key, (paidByMonth.get(key) || 0) + (Number(p.amount) || 0))
  }

  // Cumulative interest + admin fees as of a given month-end, using only the
  // payments received by then — so the per-month delta telescopes to the
  // dashboard's interest/fees total at `now`.
  const cumInterestFees = (monthEnd: Date): number => {
    if (!(cfg.apr || cfg.lateFeeFlat || cfg.lateFeePct)) return 0
    const upTo = payments.filter(p => {
      const w = paymentWhen(p); if (!w) return false
      const d = new Date(w); return !isNaN(d.getTime()) && d <= monthEnd
    })
    return round2(
      lateInterest(resident, dues, upTo, cfg.apr || 0, monthEnd)
      + adminLateFees(resident, dues, upTo, cfg, monthEnd),
    )
  }

  // monthsOwed counts the start month through the current month (inclusive), the
  // same horizon the dashboard accrues dues over — so the statement list and the
  // balance agree.
  const owed = monthsOwed(resident, now)
  const out: AccountStatement[] = []
  let running = round2(Number(resident.opening_balance) || 0)
  let prevCumIF = 0
  for (let i = 0; i < owed; i++) {
    const monthStart = new Date(created.getFullYear(), created.getMonth() + i, 1)
    const monthEnd = new Date(created.getFullYear(), created.getMonth() + i + 1, 0)
    const key = monthKey(monthStart)
    const cum = cumInterestFees(monthEnd)
    const interestFees = round2(cum - prevCumIF)
    prevCumIF = cum
    const paid = round2(paidByMonth.get(key) || 0)
    const opening = round2(running)
    const charges = round2(dues + interestFees)
    const closing = round2(opening + charges - paid)
    out.push({
      id: key,
      periodStart: `${key}-01`,
      openingBalance: opening,
      dues,
      interestFees,
      charges,
      paid,
      closingBalance: closing,
    })
    running = closing
  }
  return out.reverse().slice(0, max)
}

/** Look up a single statement by its 'YYYY-MM' id (used by the print route). */
export function findStatement(
  resident: Resident | null | undefined,
  monthlyDues: number,
  payments: Payment[] = [],
  periodId: string,
  opts: { now?: Date; cfg?: DuesConfig } = {},
): AccountStatement | null {
  const all = deriveStatements(resident, monthlyDues, payments, { ...opts, max: 1200 })
  return all.find(s => s.id === periodId) || null
}
