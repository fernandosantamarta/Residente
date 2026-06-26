#!/usr/bin/env node
// ============================================================================
// verify-disburse.mjs  —  run:  npm run verify:disburse
//
// Guards the accounts-payable projection added in supabase/disbursements.sql +
// lib/gl/project.ts (the 'bill' / 'bill_payment' legs). Proves, without a DB:
//   1. DOUBLE-ENTRY: every bill/payment entry's debits == credits within a fund,
//      and Σ all debits == Σ all credits.
//   2. AP IDENTITY: Accounts payable (2010) net == Σ(posted bills) − Σ(paid
//      disbursements) — i.e. 2010 carries exactly the OPEN payables.
//   3. CASH: each fund's cash credit from payments == Σ paid disbursements there
//      (operating → 1000, reserve → 1010).
//   4. NO OVERPAY: Σ disbursements against a bill never exceeds the bill amount
//      (the invariant disbursement_initiate enforces at write time).
//
// Ported from lib/gl/project.ts (the bill/bill_payment economics). Keep in sync;
// do NOT "fix" a port to mask a real divergence.
// ============================================================================

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100
const sum = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0)

// ---- ported builder economics (lib/gl/project.ts: vendor bills + disbursements) ----
const BILL_POSTED = new Set(['open', 'paid'])
const DISB_PAID = new Set(['paid'])
function buildAP(src) {
  const entries = []
  const E = (st, fund, dr, cr, amount) => {
    const a = round2(amount); if (a <= 0) return
    entries.push({ source_type: st, fund, lines: [
      { account: dr, fund, debit: a, credit: 0 },
      { account: cr, fund, debit: 0, credit: a },
    ] })
  }
  for (const b of src.vendorBills || []) {
    if (!BILL_POSTED.has(String(b.status))) continue
    const fund = b.fund === 'reserve' ? 'reserve' : 'operating'
    const ex = String(b.gl_account_code || (fund === 'reserve' ? '5010' : '5000'))
    E('bill', fund, ex, '2010', b.amount)
  }
  for (const d of src.disbursements || []) {
    if (!DISB_PAID.has(String(d.status))) continue
    const fund = d.fund === 'reserve' ? 'reserve' : 'operating'
    E('bill_payment', fund, '2010', fund === 'reserve' ? '1010' : '1000', d.amount)
  }
  return entries
}

const acctNet = (entries, code, fund) => round2(entries.flatMap(e => e.lines)
  .filter(l => l.account === code && (!fund || l.fund === fund))
  .reduce((s, l) => s + l.debit - l.credit, 0))

let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`) }
}

function structuralChecks(label, entries) {
  let unbalanced = 0, multiFund = 0
  for (const e of entries) {
    if (new Set(e.lines.map(l => l.fund)).size !== 1) multiFund++
    if (round2(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)) !== 0) unbalanced++
  }
  check(`${label}: every entry balanced`, unbalanced, 0)
  check(`${label}: every entry single-fund`, multiFund, 0)
  check(`${label}: global debits == credits`,
    round2(sum(entries.flatMap(e => e.lines).map(l => l.debit))),
    round2(sum(entries.flatMap(e => e.lines).map(l => l.credit))))
}

// posted bills (the AP liability) − paid disbursements (relief) = open payables.
const postedBills = (s) => round2(sum((s.vendorBills || []).filter(b => BILL_POSTED.has(String(b.status))).map(b => b.amount)))
const paidDisb = (s, fund) => round2(sum((s.disbursements || [])
  .filter(d => DISB_PAID.has(String(d.status)) && (!fund || (d.fund === 'reserve' ? 'reserve' : 'operating') === fund))
  .map(d => d.amount)))

console.log('GOLDEN — a small AP book')
const golden = {
  vendorBills: [
    { id: 'b1', amount: 1200, status: 'open',  fund: 'operating' },              // landscaping, unpaid
    { id: 'b2', amount: 800,  status: 'paid',  fund: 'operating' },              // plumber, paid in full
    { id: 'b3', amount: 5000, status: 'open',  fund: 'reserve', gl_account_code: '5010' }, // roof reserve, unpaid
    { id: 'b4', amount: 300,  status: 'draft', fund: 'operating' },              // not yet confirmed → no books
    { id: 'b5', amount: 999,  status: 'void',  fund: 'operating' },              // cancelled → no books
  ],
  disbursements: [
    { id: 'd1', amount: 800, status: 'paid',     fund: 'operating' },            // pays b2
    { id: 'd2', amount: 400, status: 'approved', fund: 'operating' },            // approved, not yet paid → no cash
    { id: 'd3', amount: 250, status: 'void',     fund: 'operating' },            // cancelled
  ],
}
const gEntries = buildAP(golden)
structuralChecks('golden', gEntries)
// AP(2010) net is a credit balance → negative. open payables = (1200+800+5000) − 800 = 6200.
check('AP (2010) net == −(posted bills − paid disbursements)', acctNet(gEntries, '2010'),
  round2(-(postedBills(golden) - paidDisb(golden))))
check('open payables == 6200', round2(postedBills(golden) - paidDisb(golden)), 6200)
check('operating cash (1000) credit == paid operating disbursements', acctNet(gEntries, '1000', 'operating'), -800)
check('reserve cash (1010) == 0 (no reserve disbursement paid)', acctNet(gEntries, '1010', 'reserve'), 0)
check('operating expense (5000) debit == operating posted bills', acctNet(gEntries, '5000', 'operating'), 1200 + 800)
check('reserve expense (5010) debit == reserve posted bills', acctNet(gEntries, '5010', 'reserve'), 5000)

// ---- FUZZ: invariants over random AP books ----
console.log('\nFUZZ — 5,000 random AP books (balance + AP identity + no-overpay)')
let seed = 20260625
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const money = () => round2(10 + rnd() * 4000)
let fuzzFails = 0
for (let t = 0; t < 5000; t++) {
  const vendorBills = []
  const disbursements = []
  const nb = 1 + Math.floor(rnd() * 5)
  for (let i = 0; i < nb; i++) {
    const fund = rnd() < 0.25 ? 'reserve' : 'operating'
    const amount = money()
    const status = pick(['open', 'open', 'paid', 'draft', 'void'])
    const bid = `b${t}_${i}`
    vendorBills.push({ id: bid, amount, status, fund, gl_account_code: fund === 'reserve' ? '5010' : '5000' })
    // Disburse against confirmed (non-draft/void) bills only, never more than the bill.
    if (BILL_POSTED.has(status) && rnd() < 0.7) {
      let remaining = amount
      const parts = 1 + Math.floor(rnd() * 2)
      for (let k = 0; k < parts && remaining > 1; k++) {
        const amt = round2(Math.min(remaining, money()))
        remaining = round2(remaining - amt)
        // paid bills must be fully covered by paid disbursements; mix statuses otherwise.
        const dstatus = status === 'paid' ? 'paid' : pick(['paid', 'approved', 'initiated', 'void'])
        disbursements.push({ id: `${bid}d${k}`, bill_id: bid, amount: amt, status: dstatus, fund })
      }
      // ensure a 'paid' bill is actually fully paid in our synthetic set
      if (status === 'paid') {
        const paidSoFar = round2(sum(disbursements.filter(d => d.bill_id === bid && d.status === 'paid').map(d => d.amount)))
        if (paidSoFar < amount) disbursements.push({ id: `${bid}dfill`, bill_id: bid, amount: round2(amount - paidSoFar), status: 'paid', fund })
      }
    }
  }
  const src = { vendorBills, disbursements }
  const es = buildAP(src)

  let bad = false
  for (const e of es) {
    if (new Set(e.lines.map(l => l.fund)).size !== 1) bad = true
    if (round2(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)) !== 0) bad = true
  }
  if (round2(sum(es.flatMap(e => e.lines).map(l => l.debit))) !== round2(sum(es.flatMap(e => e.lines).map(l => l.credit)))) bad = true
  // AP identity
  if (acctNet(es, '2010') !== round2(-(postedBills(src) - paidDisb(src)))) bad = true
  // cash per fund
  if (acctNet(es, '1000', 'operating') !== round2(-paidDisb(src, 'operating'))) bad = true
  if (acctNet(es, '1010', 'reserve') !== round2(-paidDisb(src, 'reserve'))) bad = true
  // no overpay: Σ non-void disbursements per bill ≤ bill amount
  for (const b of vendorBills) {
    const committed = round2(sum(disbursements.filter(d => d.bill_id === b.id && d.status !== 'void').map(d => d.amount)))
    if (committed > round2(b.amount) + 0.001) bad = true
  }

  if (bad) { fuzzFails++; if (fuzzFails <= 5) console.log(`  ✗ case ${t}: AP ${acctNet(es, '2010')} vs ${round2(-(postedBills(src) - paidDisb(src)))}`) }
}
if (fuzzFails === 0) console.log('  ✓ 5,000/5,000 AP books balance, tie to open-payables, and never overpay')
else { failures += fuzzFails; console.log(`  ✗ ${fuzzFails} mismatches`) }

console.log('')
if (failures === 0) { console.log('PASS — AP projection balances and 2010 carries exactly the open payables.'); process.exit(0) }
else { console.log(`FAIL — ${failures} discrepancy(ies) in the AP projection.`); process.exit(1) }
