// Dues accrual + status — shared by the Residents, Home and Pay screens.
// Model: a board-set opening balance, plus monthly_dues accrued every month
// since the resident was added, minus payments — plus late interest once a
// household falls behind. Status is derived.

export const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

export const DUES_LABEL = { paid: 'Paid', due: 'Due', late: 'Late' }

const sumPayments = (payments) =>
  (payments || []).reduce((s, p) => s + (Number(p?.amount) || 0), 0)

// Whole calendar-month boundaries crossed between a date and now.
export function monthsSince(dateInput, now = new Date()) {
  if (!dateInput) return 0
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return 0
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()))
}

// Months of dues a resident owes. The current month always counts — a
// household owes dues for the month it was added, then one more each month.
export function monthsOwed(resident, now = new Date()) {
  return monthsSince(resident?.created_at, now) + 1
}

// Whole months of dues the resident's payments have fully covered. Payments
// pay down the opening balance first, then dues months in order.
export function monthsCovered(resident, monthlyDues, payments = []) {
  const m = Number(monthlyDues) || 0
  if (m <= 0) return 0
  const opening = Number(resident?.opening_balance) || 0
  const afterOpening = Math.max(0, sumPayments(payments) - opening)
  return Math.min(monthsOwed(resident), Math.floor(afterOpening / m))
}

// Months that are overdue — owed, unpaid, and not the current month.
export function monthsLate(resident, monthlyDues, payments = []) {
  return Math.max(0, monthsOwed(resident) - monthsCovered(resident, monthlyDues, payments) - 1)
}

// Simple interest on overdue dues. `rate` is percent per month (board-set in
// Community settings). Each overdue month accrues rate% of a month's dues for
// every month it stays unpaid — so the total grows the longer a household is
// behind. Returns 0 when no rate is set or the household is current.
export function lateInterest(resident, monthlyDues, payments = [], rate = 0) {
  const r = Number(rate) || 0
  const m = Number(monthlyDues) || 0
  if (r <= 0 || m <= 0) return 0
  const late = monthsLate(resident, monthlyDues, payments)
  if (late <= 0) return 0
  const triangular = (late * (late + 1)) / 2   // 1 + 2 + … + late
  return Math.round(m * (r / 100) * triangular * 100) / 100
}

// What a resident currently owes: opening + accrued dues − payments + late interest.
export function residentBalance(resident, monthlyDues, payments = [], rate = 0) {
  const opening = Number(resident?.opening_balance) || 0
  const accrued = monthsOwed(resident) * (Number(monthlyDues) || 0)
  const paid = sumPayments(payments)
  const interest = lateInterest(resident, monthlyDues, payments, rate)
  return Math.round((opening + accrued - paid + interest) * 100) / 100
}

// paid: nothing owed · due: within one month's dues · late: more than that.
export function duesStatus(balance, monthlyDues) {
  const m = Number(monthlyDues) || 0
  if (balance <= 0.005) return 'paid'
  if (balance <= m + 0.005) return 'due'
  return 'late'
}

// A month-by-month view of dues for the Pay calendar — one entry per dues
// month from when the resident joined through the current month.
export function paymentCalendar(resident, monthlyDues, payments = []) {
  const owed = monthsOwed(resident)
  const covered = monthsCovered(resident, monthlyDues, payments)
  const start = new Date(resident?.created_at || Date.now())
  const out = []
  for (let i = 0; i < owed; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    let state
    if (i < covered) state = 'paid'
    else if (i === owed - 1) state = 'due'     // current month — not late yet
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
