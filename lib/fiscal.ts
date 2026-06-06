// Fiscal-year helpers. A community's fiscal year starts on
// communities.fiscal_year_start_month (1-12; default 1 = calendar year) and is
// LABELED by the calendar year it starts in. Used to scope financial statements
// to a period. Pure + UTC. Parity guard: scripts/verify-fiscal.mjs
// (npm run verify:fiscal) — re-run it if you change this.

export interface FiscalYear {
  /** Calendar year the fiscal year STARTS in (the label year). */
  year: number
  /** Inclusive start, 'YYYY-MM-01'. */
  startISO: string
  /** Exclusive end, 'YYYY-MM-01' (first day of the next fiscal year). */
  endISO: string
  /** Human label, e.g. 'FY2026' (Jan start) or 'FY2025–26' (mid-year start). */
  label: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const clampMonth = (m: unknown): number => {
  const n = Math.floor(Number(m))
  return n >= 1 && n <= 12 ? n : 1
}

/** The fiscal-year window for a given START calendar year. */
export function fiscalYearFor(fyStartMonth: number, startYear: number): FiscalYear {
  const m = clampMonth(fyStartMonth)
  const startISO = `${startYear}-${pad2(m)}-01`
  const endISO = `${startYear + 1}-${pad2(m)}-01`
  const label = m === 1 ? `FY${startYear}` : `FY${startYear}–${String(startYear + 1).slice(-2)}`
  return { year: startYear, startISO, endISO, label }
}

/** The fiscal year that contains `asOf` (default: today, UTC). */
export function currentFiscalYear(fyStartMonth: number, asOf: Date = new Date()): FiscalYear {
  const m = clampMonth(fyStartMonth)
  const y = asOf.getUTCFullYear()
  const mo = asOf.getUTCMonth() + 1 // 1-12
  const startYear = mo >= m ? y : y - 1
  return fiscalYearFor(m, startYear)
}

/** Is an ISO date ('YYYY-MM-DD…') within [start, end) of the fiscal year? */
export function inFiscalYear(dateISO: string | null | undefined, fy: FiscalYear): boolean {
  if (!dateISO) return false
  const d = String(dateISO).slice(0, 10)
  return d >= fy.startISO && d < fy.endISO
}

/** Inclusive last day of the window, for display ('YYYY-MM-DD'). */
export function fiscalYearEndInclusive(fy: FiscalYear): string {
  const end = new Date(fy.endISO + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() - 1)
  return end.toISOString().slice(0, 10)
}
