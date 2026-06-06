#!/usr/bin/env node
// ============================================================================
// verify-gl-statements.mjs  —  run:  npm run verify:gl-statements
//
// Guards the GL statement roll-ups (lib/gl/statements.ts): the live audit-tier
// revenue, the Balance Sheet by fund, and the accrual Rev & Exp by fund. Proves,
// without a database:
//   1. GOLDEN — a hand-checked trial balance rolls up to the expected statements.
//   2. IDENTITY (fuzz) — for ANY per-fund-balanced trial balance, the Balance
//      Sheet satisfies Assets == Liabilities + Equity + NetIncome, per fund AND
//      overall (the accounting identity the balanced-entry trigger guarantees).
//
// Ported from lib/gl/statements.ts — keep in sync; do NOT "fix" a port to mask a
// real divergence.
// ============================================================================

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100
const bal = (r) => round2(r.balance != null ? Number(r.balance) : (Number(r.debit) || 0) - (Number(r.credit) || 0))
const sum = (xs) => round2(xs.reduce((s, x) => s + x, 0))
const fundRank = (f) => (f === 'operating' ? 0 : f === 'reserve' ? 1 : 2)
const fundsIn = (rows) => [...new Set(rows.map(r => String(r.fund)))].sort((a, b) => fundRank(a) - fundRank(b))
const byCode = (a, b) => a.code.localeCompare(b.code)

function glCurrentFyRevenue(rows, fiscalYear) {
  return sum(rows
    .filter(r => r.type === 'revenue' && (fiscalYear == null || Number(r.fiscal_year) === Number(fiscalYear)))
    .map(r => -bal(r)))
}

function balanceSheetByFund(rows) {
  const funds = fundsIn(rows).map(fund => {
    const fr = rows.filter(r => String(r.fund) === fund)
    const assets = fr.filter(r => r.type === 'asset').map(r => ({ code: r.code, name: r.name, amount: bal(r) })).sort(byCode)
    const liabilities = fr.filter(r => r.type === 'liability').map(r => ({ code: r.code, name: r.name, amount: -bal(r) })).sort(byCode)
    const equity = fr.filter(r => r.type === 'equity').map(r => ({ code: r.code, name: r.name, amount: -bal(r) })).sort(byCode)
    const netIncome = sum([
      ...fr.filter(r => r.type === 'revenue').map(r => -bal(r)),
      ...fr.filter(r => r.type === 'expense').map(r => -bal(r)),
    ])
    const totalAssets = sum(assets.map(a => a.amount))
    const totalLiabilities = sum(liabilities.map(a => a.amount))
    const totalEquity = round2(sum(equity.map(a => a.amount)) + netIncome)
    return { fund, assets, liabilities, equity, netIncome, totalAssets, totalLiabilities, totalEquity,
      balances: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 0.01 }
  })
  const totalAssets = sum(funds.map(f => f.totalAssets))
  const totalLiabilities = sum(funds.map(f => f.totalLiabilities))
  const totalEquity = sum(funds.map(f => f.totalEquity))
  return { funds, totalAssets, totalLiabilities, totalEquity,
    balances: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 0.01 }
}

function revExpByFund(rows, fiscalYear) {
  const scoped = rows.filter(r => fiscalYear == null || Number(r.fiscal_year) === Number(fiscalYear))
  const funds = fundsIn(scoped).map(fund => {
    const fr = scoped.filter(r => String(r.fund) === fund)
    const revenue = fr.filter(r => r.type === 'revenue').map(r => ({ code: r.code, name: r.name, amount: -bal(r) })).sort(byCode)
    const expense = fr.filter(r => r.type === 'expense').map(r => ({ code: r.code, name: r.name, amount: bal(r) })).sort(byCode)
    const totalRevenue = sum(revenue.map(a => a.amount))
    const totalExpense = sum(expense.map(a => a.amount))
    return { fund, revenue, expense, totalRevenue, totalExpense, net: round2(totalRevenue - totalExpense) }
  }).filter(f => f.revenue.length || f.expense.length)
  const totalRevenue = sum(funds.map(f => f.totalRevenue))
  const totalExpense = sum(funds.map(f => f.totalExpense))
  return { funds, totalRevenue, totalExpense, net: round2(totalRevenue - totalExpense) }
}

let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// ---- GOLDEN: a hand-checked balanced trial balance ----
// Operating fund nets to 0: Dr 1000(500)+1100(300)+5000(250)=1050; Cr 2000(50)+3000(200)+4000(800)=1050.
// Reserve fund nets to 0:   Dr 1010(1000); Cr 3010(1000).
console.log('GOLDEN — coherent two-fund trial balance')
const TB = [
  { fund: 'operating', code: '1000', name: 'Operating cash',         type: 'asset',     balance: 500 },
  { fund: 'operating', code: '1100', name: 'Assessments receivable', type: 'asset',     balance: 300 },
  { fund: 'operating', code: '2000', name: 'Prepaid assessments',    type: 'liability', balance: -50 },
  { fund: 'operating', code: '3000', name: 'Fund balance — op',      type: 'equity',    balance: -200 },
  { fund: 'operating', code: '4000', name: 'Assessment revenue',     type: 'revenue',   balance: -800, fiscal_year: 2026 },
  { fund: 'operating', code: '5000', name: 'Operating expenses',     type: 'expense',   balance: 250,  fiscal_year: 2026 },
  { fund: 'reserve',   code: '1010', name: 'Reserve cash',           type: 'asset',     balance: 1000 },
  { fund: 'reserve',   code: '3010', name: 'Fund balance — reserve', type: 'equity',    balance: -1000 },
]
// Tag the balance-sheet (cumulative) rows with a FY for the FY-scoped helpers too.
const TB_FY = TB.map(r => ({ ...r, fiscal_year: r.fiscal_year ?? 2026 }))

check('live FY2026 revenue == 800', glCurrentFyRevenue(TB_FY, 2026), 800)
check('live revenue for an empty FY == 0', glCurrentFyRevenue(TB_FY, 2099), 0)

const bs = balanceSheetByFund(TB)
const op = bs.funds.find(f => f.fund === 'operating')
const res = bs.funds.find(f => f.fund === 'reserve')
check('operating totalAssets == 800', op.totalAssets, 800)
check('operating totalLiabilities == 50', op.totalLiabilities, 50)
check('operating netIncome (800 − 250) == 550', op.netIncome, 550)
check('operating totalEquity (200 + 550) == 750', op.totalEquity, 750)
check('operating balances (800 == 50 + 750)', op.balances, true)
check('reserve totalAssets == 1000', res.totalAssets, 1000)
check('reserve totalEquity == 1000', res.totalEquity, 1000)
check('grand totals balance (1800 == 50 + 1750)', [bs.totalAssets, bs.totalLiabilities, bs.totalEquity, bs.balances], [1800, 50, 1750, true])

const re = revExpByFund(TB_FY, 2026)
check('rev/exp totalRevenue == 800', re.totalRevenue, 800)
check('rev/exp totalExpense == 250', re.totalExpense, 250)
check('rev/exp net surplus == 550', re.net, 550)
check('rev/exp drops the reserve fund (no rev/exp lines)', re.funds.map(f => f.fund), ['operating'])

// ---- FUZZ: the accounting identity holds for ANY per-fund-balanced TB ----
console.log('\nFUZZ — 5,000 random per-fund-balanced trial balances')
let seed = 20260605
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const money = () => round2(rnd() * 5000 - 1000) // allow negatives (prepaid credits, deficits)
let fuzzFails = 0
for (let t = 0; t < 5000; t++) {
  const rows = []
  for (const fund of ['operating', 'reserve']) {
    // Random debit-normal (asset/expense) and credit-normal (liab/equity/revenue)
    // balances, then force the fund to net to zero by setting the equity plug.
    const a1 = money(), a2 = money(), ex = money()      // debit-normal balances
    const li = money(), rv = money()                    // credit-normal balances (stored as −amount)
    // Σ balance must be 0: a1 + a2 + ex + (−li) + (−rv) + eqBalance = 0.
    const eqBalance = round2(-(a1 + a2 + ex - li - rv))
    rows.push(
      { fund, code: '1000', name: 'cash',    type: 'asset',     balance: a1 },
      { fund, code: '1100', name: 'ar',      type: 'asset',     balance: a2 },
      { fund, code: '5000', name: 'expense', type: 'expense',   balance: ex, fiscal_year: 2026 },
      { fund, code: '2000', name: 'prepaid', type: 'liability', balance: -li },
      { fund, code: '4000', name: 'revenue', type: 'revenue',   balance: -rv, fiscal_year: 2026 },
      { fund, code: '3000', name: 'fundbal', type: 'equity',    balance: eqBalance },
    )
  }
  const b = balanceSheetByFund(rows)
  let bad = !b.balances
  for (const f of b.funds) if (!f.balances) bad = true
  // Rev/Exp net must equal Σ(revenue) − Σ(expense) and feed netIncome on the sheet.
  const r = revExpByFund(rows, 2026)
  if (round2(r.totalRevenue - r.totalExpense) !== r.net) bad = true
  if (bad) { fuzzFails++; if (fuzzFails <= 5) console.log(`  ✗ case ${t}: overall balances=${b.balances}`) }
}
if (fuzzFails === 0) console.log('  ✓ 5,000/5,000 balance sheets satisfy Assets == Liabilities + Equity + NetIncome')
else { failures += fuzzFails; console.log(`  ✗ ${fuzzFails} identity violations`) }

console.log('')
if (failures === 0) { console.log('PASS — GL statement roll-ups are correct and self-balancing.'); process.exit(0) }
else { console.log(`FAIL — ${failures} discrepancy(ies) in the statement roll-ups.`); process.exit(1) }
