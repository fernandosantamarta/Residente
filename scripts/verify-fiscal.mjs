#!/usr/bin/env node
// ============================================================================
// verify-fiscal.mjs  —  run:  npm run verify:fiscal
//
// Golden guard for lib/fiscal.ts. The fiscal year scopes every Phase-1 financial
// statement; a non-January fiscal_year_start_month is the classic off-by-one trap
// (a payment dated 2026-06-30 belongs to FY2025–26 when the year starts in July,
// not FY2026). These cases pin that behavior down.
//
// Transliterated from lib/fiscal.ts — keep in sync; do NOT "fix" to match a buggy
// edit there (that defeats the check).
// ============================================================================

const pad2 = (n) => String(n).padStart(2, '0')
const clampMonth = (m) => {
  const n = Math.floor(Number(m))
  return n >= 1 && n <= 12 ? n : 1
}
function fiscalYearFor(fyStartMonth, startYear) {
  const m = clampMonth(fyStartMonth)
  return {
    year: startYear,
    startISO: `${startYear}-${pad2(m)}-01`,
    endISO: `${startYear + 1}-${pad2(m)}-01`,
    label: m === 1 ? `FY${startYear}` : `FY${startYear}–${String(startYear + 1).slice(-2)}`,
  }
}
function currentFiscalYear(fyStartMonth, asOf) {
  const m = clampMonth(fyStartMonth)
  const y = asOf.getUTCFullYear()
  const mo = asOf.getUTCMonth() + 1
  const startYear = mo >= m ? y : y - 1
  return fiscalYearFor(m, startYear)
}
function inFiscalYear(dateISO, fy) {
  if (!dateISO) return false
  const d = String(dateISO).slice(0, 10)
  return d >= fy.startISO && d < fy.endISO
}

let failures = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`) }
}
const U = (s) => new Date(s + 'T12:00:00Z')

console.log('currentFiscalYear — January start (calendar year)')
check('asOf 2026-06-05 → FY2026',
  currentFiscalYear(1, U('2026-06-05')),
  { year: 2026, startISO: '2026-01-01', endISO: '2027-01-01', label: 'FY2026' })

console.log('\ncurrentFiscalYear — July start (non-January; the off-by-one trap)')
check('asOf 2026-06-05 (month 6 < 7) → starts 2025',
  currentFiscalYear(7, U('2026-06-05')),
  { year: 2025, startISO: '2025-07-01', endISO: '2026-07-01', label: 'FY2025–26' })
check('asOf 2026-08-15 (month 8 ≥ 7) → starts 2026',
  currentFiscalYear(7, U('2026-08-15')),
  { year: 2026, startISO: '2026-07-01', endISO: '2027-07-01', label: 'FY2026–27' })
check('asOf 2026-07-01 (exact start month) → starts 2026',
  currentFiscalYear(7, U('2026-07-01')),
  { year: 2026, startISO: '2026-07-01', endISO: '2027-07-01', label: 'FY2026–27' })

console.log('\ncurrentFiscalYear — October start')
check('asOf 2026-01-10 (month 1 < 10) → starts 2025',
  currentFiscalYear(10, U('2026-01-10')),
  { year: 2025, startISO: '2025-10-01', endISO: '2026-10-01', label: 'FY2025–26' })

console.log('\nclampMonth fallback (bad month → 1)')
check('month 0 → January', currentFiscalYear(0, U('2026-03-03')).startISO, '2026-01-01')
check('month 13 → January', currentFiscalYear(13, U('2026-03-03')).startISO, '2026-01-01')

console.log('\ninFiscalYear — boundaries (July-start FY2025–26)')
const fy = fiscalYearFor(7, 2025) // [2025-07-01, 2026-07-01)
check('2025-07-01 (inclusive start) → true', inFiscalYear('2025-07-01', fy), true)
check('2026-06-30 (last day) → true',        inFiscalYear('2026-06-30', fy), true)
check('2026-07-01 (exclusive end) → false',  inFiscalYear('2026-07-01', fy), false)
check('2025-06-30 (day before) → false',     inFiscalYear('2025-06-30', fy), false)
check('null → false',                        inFiscalYear(null, fy), false)
check('timestamp form 2025-12-25T09:00:00Z → true', inFiscalYear('2025-12-25T09:00:00Z', fy), true)

console.log('')
if (failures === 0) { console.log('PASS — fiscal-year classification is correct (incl. non-January starts).'); process.exit(0) }
else { console.log(`FAIL — ${failures} discrepancy(ies) in lib/fiscal.ts.`); process.exit(1) }
