// Dues accrual + status — shared by the Residents, Home and Pay screens.
// Model: a board-set opening balance, plus monthly_dues accrued every month
// since the resident was added, minus payments made. Status is derived.

export const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

export const DUES_LABEL = { paid: 'Paid', due: 'Due', late: 'Late' }

// Whole calendar-month boundaries crossed between a date and now.
export function monthsSince(dateInput, now = new Date()) {
  if (!dateInput) return 0
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return 0
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()))
}

// What a resident currently owes: opening balance + accrued dues − payments.
export function residentBalance(resident, monthlyDues, payments = []) {
  const opening = Number(resident?.opening_balance) || 0
  const accrued = monthsSince(resident?.created_at) * (Number(monthlyDues) || 0)
  const paid = (payments || []).reduce((s, p) => s + (Number(p?.amount) || 0), 0)
  return Math.round((opening + accrued - paid) * 100) / 100
}

// paid: nothing owed · due: within one month's dues · late: more than that.
export function duesStatus(balance, monthlyDues) {
  const m = Number(monthlyDues) || 0
  if (balance <= 0.005) return 'paid'
  if (balance <= m + 0.005) return 'due'
  return 'late'
}
