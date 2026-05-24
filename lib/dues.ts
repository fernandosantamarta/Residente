// Dues accrual + status — shared by the Residents, Home and Pay screens.
// Model: a board-set opening balance, plus monthly_dues accrued every month
// since the resident was added, minus payments — plus late interest once a
// household falls behind. Status is derived.

export type DuesStatus = 'paid' | 'due' | 'late'

export type Resident = {
  id?: string
  created_at?: string
  opening_balance?: number | null
  [key: string]: unknown
}

export type Payment = { amount?: number | null; [key: string]: unknown }

export const fmtMoney = (n: number | string | null | undefined): string =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

export const DUES_LABEL: Record<DuesStatus, string> = { paid: 'Paid', due: 'Due', late: 'Late' }

const sumPayments = (payments: Payment[] = []): number =>
  payments.reduce((s, p) => s + (Number(p?.amount) || 0), 0)

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

export function lateInterest(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], rate: number = 0): number {
  const r = Number(rate) || 0
  const m = Number(monthlyDues) || 0
  if (r <= 0 || m <= 0) return 0
  const late = monthsLate(resident, monthlyDues, payments)
  if (late <= 0) return 0
  const triangular = (late * (late + 1)) / 2
  return Math.round(m * (r / 100) * triangular * 100) / 100
}

export function residentBalance(resident: Resident | null | undefined, monthlyDues: number, payments: Payment[] = [], rate: number = 0): number {
  const opening = Number(resident?.opening_balance) || 0
  const accrued = monthsOwed(resident) * (Number(monthlyDues) || 0)
  const paid = sumPayments(payments)
  const interest = lateInterest(resident, monthlyDues, payments, rate)
  return Math.round((opening + accrued - paid + interest) * 100) / 100
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
