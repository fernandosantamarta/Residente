#!/usr/bin/env node
// ============================================================================
// verify-dues-summary.mjs  —  run:  npm run verify:dues
//
// PARITY GUARD for the Phase-1 "eliminate the back office" blocker.
//
// supabase/migrations/0002_community_dues_summary.sql (the SECURITY DEFINER
// aggregate behind the resident "% collected" tile) must compute the SAME dues
// model as lib/dues.ts residentBalance()/duesStatus(). Before this guard, the SQL
// used the legacy monthly rate, triangular interest, and OMITTED admin late fees,
// so it silently disagreed with what residents see on their own balance.
//
// This script encodes BOTH sides as plain JS — one transliterated from lib/dues.ts
// (the canonical engine) and one transliterated from the SQL function text — and
// proves they agree on a battery of golden cases (independently hand-computed) and
// a randomized fuzz. Zero dependencies; needs only Node.
//
// If you change EITHER side, re-run this. Keep `sql*` transliterated from the .sql
// (do NOT "fix" it to match `ts*` — that would defeat the cross-check).
// ============================================================================

// JS Math.round(x*100)/100 == the rounding used in lib/dues.ts. Postgres round(n,2)
// rounds half AWAY from zero; these differ only at exact half-cent thirds, which do
// not arise for 2-decimal money + the integer-ish dues/fee math below.
const round2 = (x) => Math.round(x * 100) / 100
const tri = (n) => (n * (n + 1)) / 2

// ---------------------------------------------------------------------------
// Canonical side — transliterated from lib/dues.ts
//   communityDuesConfig (L61), monthsCovered (L90), monthsLate (L98),
//   lateInterest (L109), adminLateFees (L124), residentBalance (L141),
//   duesStatus (L156).  `monthsOwed` is supplied directly (it is identical on
//   both sides and not what changed).
// ---------------------------------------------------------------------------
function tsResolveApr(c) {
  const aprCol = c.interest_apr
  const legacyMonthly = Number(c.late_interest_rate) || 0
  return aprCol != null && aprCol !== '' ? Number(aprCol) || 0 : legacyMonthly * 12
}
function tsResident(res, c) {
  const monthly = Number(c.monthly) || 0
  const apr = tsResolveApr(c)
  const flat = Number(c.late_fee_flat) || 0
  const pct = Number(c.late_fee_pct) || 0
  const opening = Number(res.opening) || 0
  const paid = Number(res.paid) || 0
  const monthsOwed = res.monthsOwed

  const afterOpening = Math.max(0, paid - opening)
  const monthsCovered = monthly <= 0 ? 0 : Math.min(monthsOwed, Math.floor(afterOpening / monthly))
  const late = Math.max(0, monthsOwed - monthsCovered - 1)

  const interest = apr > 0 && monthly > 0 && late > 0 ? round2(monthly * (apr / 12 / 100) * tri(late)) : 0
  const fee = monthly > 0 && (flat > 0 || pct > 0) && late > 0 ? round2(Math.max(flat, (monthly * pct) / 100) * late) : 0

  const accrued = monthsOwed * monthly
  const balance = round2(opening + accrued - paid + interest + fee)
  const status = balance <= 0.005 ? 'paid' : balance <= monthly + 0.005 ? 'due' : 'late'
  return { balance, status }
}

// ---------------------------------------------------------------------------
// SQL side — transliterated from supabase/migrations/0002_community_dues_summary.sql
// (the per-resident loop body). Kept deliberately separate from tsResident above.
// ---------------------------------------------------------------------------
function sqlResolveApr(c) {
  // v_apr := coalesce(interest_apr, coalesce(late_interest_rate,0) * 12)
  return c.interest_apr != null ? Number(c.interest_apr) : (Number(c.late_interest_rate) || 0) * 12
}
function sqlResident(res, c) {
  const v_monthly = Number(c.monthly) || 0
  const v_apr = sqlResolveApr(c)
  const v_flat = Number(c.late_fee_flat) || 0
  const v_pct = Number(c.late_fee_pct) || 0
  const opening = Number(res.opening) || 0
  const paid_sum = Number(res.paid) || 0
  const v_months_owed = res.monthsOwed

  let v_months_covered
  if (v_monthly > 0) {
    const v_after_opening = Math.max(0, paid_sum - opening)
    v_months_covered = Math.min(v_months_owed, Math.floor(v_after_opening / v_monthly))
  } else {
    v_months_covered = 0
  }
  const v_months_late = Math.max(0, v_months_owed - v_months_covered - 1)

  let v_interest = 0
  if (v_apr > 0 && v_monthly > 0 && v_months_late > 0) {
    const v_triangular = (v_months_late * (v_months_late + 1)) / 2.0
    v_interest = round2(v_monthly * (v_apr / 12.0 / 100.0) * v_triangular)
  }
  let v_fee = 0
  if (v_monthly > 0 && v_months_late > 0 && (v_flat > 0 || v_pct > 0)) {
    const v_per_install = Math.max(v_flat, (v_monthly * v_pct) / 100.0)
    v_fee = round2(v_per_install * v_months_late)
  }
  const v_accrued = v_months_owed * v_monthly
  const v_balance = round2(opening + v_accrued - paid_sum + v_interest + v_fee)
  const status = v_balance <= 0.005 ? 'paid' : v_balance <= v_monthly + 0.005 ? 'due' : 'late'
  return { balance: v_balance, status }
}

// Aggregate exactly as the SQL function does (outstanding sums positive balances).
function aggregate(residents, c, residentFn) {
  let collected = 0, outstanding = 0, paid = 0, due = 0, late = 0
  for (const res of residents) {
    collected += Number(res.paid) || 0
    const { balance, status } = residentFn(res, c)
    if (balance > 0) outstanding += balance
    if (status === 'paid') paid++
    else if (status === 'due') due++
    else late++
  }
  const rate = collected + outstanding > 0 ? Math.round((collected / (collected + outstanding)) * 100) : 100
  return {
    collected: round2(collected),
    outstanding: round2(outstanding),
    paid, due, late, households: residents.length, rate,
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let failures = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

console.log('GOLDEN per-resident cases (hand-computed; community: dues=100, apr=18, flat=25, pct=5)')
const C = { monthly: 100, interest_apr: 18, late_fee_flat: 25, late_fee_pct: 5 }
const golden = [
  ['R1 fresh, unpaid (1 mo owed)',        { monthsOwed: 1, opening: 0,  paid: 0   }, { balance: 100,   status: 'due'  }],
  ['R2 paid in full (6 mo, $600)',        { monthsOwed: 6, opening: 0,  paid: 600 }, { balance: 0,     status: 'paid' }],
  ['R3 late w/ interest+fee (6 mo, $200)',{ monthsOwed: 6, opening: 0,  paid: 200 }, { balance: 484,   status: 'late' }],
  ['R4 overpaid / credit',                { monthsOwed: 1, opening: 0,  paid: 300 }, { balance: -200,  status: 'paid' }],
  ['R5 opening + late (3 mo, $50 open)',  { monthsOwed: 3, opening: 50, paid: 0   }, { balance: 404.5, status: 'late' }],
]
for (const [label, res, exp] of golden) {
  check(`${label} — ts`,  tsResident(res, C),  exp)
  check(`${label} — sql`, sqlResident(res, C), exp)
}

console.log('\nGOLDEN aggregate over R1..R5 (== community_dues_summary output)')
const roster = golden.map(([, res]) => res)
const expectedAgg = { collected: 1100, outstanding: 988.5, paid: 2, due: 1, late: 2, households: 5, rate: 53 }
check('aggregate — ts',  aggregate(roster, C, tsResident),  expectedAgg)
check('aggregate — sql', aggregate(roster, C, sqlResident), expectedAgg)

console.log('\nGOLDEN branch coverage (one config knob at a time)')
check('zero dues → balance 0, paid',
  sqlResident({ monthsOwed: 5, opening: 0, paid: 0 }, { monthly: 0, interest_apr: 18, late_fee_flat: 25, late_fee_pct: 5 }),
  { balance: 0, status: 'paid' })
check('fee only, no interest (apr=0)',
  sqlResident({ monthsOwed: 4, opening: 0, paid: 0 }, { monthly: 100, interest_apr: 0, late_fee_flat: 25, late_fee_pct: 0 }),
  { balance: 475, status: 'late' })
check('interest only, no fee',
  sqlResident({ monthsOwed: 4, opening: 0, paid: 0 }, { monthly: 100, interest_apr: 18, late_fee_flat: 0, late_fee_pct: 0 }),
  { balance: 409, status: 'late' })
check('pct fee beats flat (5% of 1000 = 50 > 25)',
  sqlResident({ monthsOwed: 2, opening: 0, paid: 0 }, { monthly: 1000, interest_apr: 0, late_fee_flat: 25, late_fee_pct: 5 }),
  { balance: 2050, status: 'late' })
check('legacy late_interest_rate fallback (1.5%/mo ⇒ 18%/yr)',
  sqlResident({ monthsOwed: 3, opening: 0, paid: 0 }, { monthly: 100, interest_apr: null, late_interest_rate: 1.5, late_fee_flat: 0, late_fee_pct: 0 }),
  { balance: 304.5, status: 'late' })

// ---------------------------------------------------------------------------
// FUZZ — ts vs sql must agree on every random case (catches transcription drift).
// Seeded LCG so runs are reproducible.
// ---------------------------------------------------------------------------
console.log('\nFUZZ: ts vs sql parity over 20,000 random cases')
let seed = 1234567
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const monthlies = [0, 50, 100, 250, 1000]
const aprs = [0, 12, 18]
const flats = [0, 25, 50]
const pcts = [0, 5, 10]
const openings = [0, 50, 123.45, -20]
let fuzzFails = 0
for (let i = 0; i < 20000; i++) {
  const useLegacy = rnd() < 0.3
  const c = {
    monthly: pick(monthlies),
    interest_apr: useLegacy ? null : pick(aprs),
    late_interest_rate: useLegacy ? pick([0, 1, 1.5, 2]) : undefined,
    late_fee_flat: pick(flats),
    late_fee_pct: pick(pcts),
  }
  const res = {
    monthsOwed: 1 + Math.floor(rnd() * 24),
    opening: pick(openings),
    paid: round2(rnd() * 3000),
  }
  const t = tsResident(res, c)
  const s = sqlResident(res, c)
  if (t.balance !== s.balance || t.status !== s.status) {
    fuzzFails++
    if (fuzzFails <= 5) console.log(`  ✗ mismatch c=${JSON.stringify(c)} res=${JSON.stringify(res)} ts=${JSON.stringify(t)} sql=${JSON.stringify(s)}`)
  }
}
if (fuzzFails === 0) console.log('  ✓ 20,000/20,000 cases agree')
else { failures += fuzzFails; console.log(`  ✗ ${fuzzFails} mismatches`) }

console.log('')
if (failures === 0) {
  console.log('PASS — community_dues_summary matches lib/dues.ts (residentBalance/duesStatus).')
  process.exit(0)
} else {
  console.log(`FAIL — ${failures} discrepancy(ies). The SQL aggregate disagrees with lib/dues.ts.`)
  process.exit(1)
}
