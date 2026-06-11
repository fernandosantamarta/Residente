#!/usr/bin/env node
// ============================================================================
// verify-gl.mjs  —  run:  npm run verify:gl
//
// Guards the general-ledger projection (lib/gl/project.ts + supabase/gl-spine.sql).
// Proves, without a database, the three properties the spine must hold:
//   1. DOUBLE-ENTRY: every entry's debits == credits, and balances within a fund
//      (single-fund entries in this phase).
//   2. GLOBAL BALANCE: Σ all debits == Σ all credits (the trial balance balances).
//   3. TIE-OUT: operating "Assessments receivable" (1100) net == Σ residentBalance()
//      over the roster — the books agree with what residents see.
//   Plus: operating cash == payments + collected fines − expenses; reserve cash ==
//   Σ component balances.
//
// Ported from lib/gl/project.ts (the builder) + lib/dues.ts (residentBalance).
// Keep in sync; do NOT "fix" a port to mask a real divergence.
// ============================================================================

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100
const tri = (n) => (n * (n + 1)) / 2
const sum = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0)

// ---- canonical dues balance (lib/dues.ts residentBalance), monthsOwed supplied ----
function resolveApr(c) { return c.interest_apr != null ? Number(c.interest_apr) : (Number(c.late_interest_rate) || 0) * 12 }
function duesBalance(res, c) {
  const monthly = Number(c.monthly_dues) || 0
  const apr = resolveApr(c), flat = Number(c.late_fee_flat) || 0, pct = Number(c.late_fee_pct) || 0
  const opening = Number(res.opening) || 0, paid = sum(res.payments || []), mo = res.monthsOwed
  const afterOpening = Math.max(0, paid - opening)
  const covered = monthly <= 0 ? 0 : Math.min(mo, Math.floor(afterOpening / monthly))
  const late = Math.max(0, mo - covered - 1)
  const interest = apr > 0 && monthly > 0 && late > 0 ? round2(monthly * (apr / 12 / 100) * tri(late)) : 0
  const fee = monthly > 0 && (flat > 0 || pct > 0) && late > 0 ? round2(Math.max(flat, (monthly * pct) / 100) * late) : 0
  return round2(opening + mo * monthly - paid + interest + fee)
}

// ---- ported builder economics (lib/gl/project.ts), date logic elided (monthsOwed given) ----
function buildLedger(src) {
  const c = src.community, entries = []
  const monthly = Number(c.monthly_dues) || 0, apr = resolveApr(c)
  const flat = Number(c.late_fee_flat) || 0, pct = Number(c.late_fee_pct) || 0
  const E = (fund, debitAcct, creditAcct, amount) => {
    const a = round2(amount); if (a <= 0) return
    entries.push({ fund, lines: [{ account: debitAcct, fund, debit: a, credit: 0 }, { account: creditAcct, fund, debit: 0, credit: a }] })
  }
  for (const res of src.residents || []) {
    const opening = round2(Number(res.opening) || 0), paid = sum(res.payments || []), mo = res.monthsOwed
    if (opening > 0) E('operating', '1100', '3000', opening)
    else if (opening < 0) E('operating', '3000', '1100', -opening)
    if (monthly > 0 && mo > 0) for (let i = 0; i < mo; i++) E('operating', '1100', '4000', monthly)
    const afterOpening = Math.max(0, paid - opening)
    const covered = monthly <= 0 ? 0 : Math.min(mo, Math.floor(afterOpening / monthly))
    const late = Math.max(0, mo - covered - 1)
    if (apr > 0 && monthly > 0 && late > 0) E('operating', '1100', '4300', round2(monthly * (apr / 12 / 100) * tri(late)))
    if (monthly > 0 && (flat > 0 || pct > 0) && late > 0) E('operating', '1100', '4310', round2(Math.max(flat, (monthly * pct) / 100) * late))
  }
  // Payments: roster-applied → AR (1100); orphan/unknown resident → unapplied (2000).
  // Mirrors lib/gl/project.ts exactly (separate src.payments loop, roster routing).
  const roster = new Set((src.residents || []).map(r => String(r.id)).filter(Boolean))
  for (const p of src.payments || []) {
    const amt = round2(Number(p.amount) || 0); if (amt <= 0) continue
    const rid = p.resident_id ? String(p.resident_id) : null
    E('operating', '1000', (rid && roster.has(rid)) ? '1100' : '2000', amt)
  }
  for (const v of src.violations || []) if ((v.collected) && Number(v.amount) > 0) E('operating', '1000', '4100', v.amount)
  for (const e of src.expenses || []) E('operating', '5000', '1000', e.amount)
  for (const rc of src.reserveComponents || []) E('reserve', '1010', '3010', rc.current_balance)
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

// Invariants 1 & 2 over any entry set.
function structuralChecks(label, entries) {
  let unbalanced = 0, multiFund = 0
  for (const e of entries) {
    const funds = new Set(e.lines.map(l => l.fund))
    if (funds.size !== 1) multiFund++
    const net = round2(e.lines.reduce((s, l) => s + l.debit - l.credit, 0))
    if (net !== 0) unbalanced++
  }
  const totalDr = round2(sum(entries.flatMap(e => e.lines).map(l => l.debit)))
  const totalCr = round2(sum(entries.flatMap(e => e.lines).map(l => l.credit)))
  check(`${label}: every entry balanced`, unbalanced, 0)
  check(`${label}: every entry single-fund`, multiFund, 0)
  check(`${label}: global debits == credits`, totalDr, totalCr)
}

console.log('GOLDEN — small community (dues=100, apr=18, flat=25, pct=5)')
const C = { monthly_dues: 100, interest_apr: 18, late_fee_flat: 25, late_fee_pct: 5 }
const src = {
  community: C,
  residents: [
    { id: 'R1', monthsOwed: 6, opening: 0, payments: [200] },   // late: bal 484
    { id: 'R2', monthsOwed: 3, opening: 50, payments: [] },      // late: bal 404.5
  ],
  payments: [{ id: 'p1', resident_id: 'R1', amount: 200 }, { id: 'orphanG', resident_id: null, amount: 40 }],
  violations: [{ id: 'v1', amount: 150, collected: true }, { id: 'v2', amount: 75, collected: false }],
  expenses: [{ id: 'e1', amount: 300 }],
  reserveComponents: [{ id: 'rc1', current_balance: 5000 }],
}
const entries = buildLedger(src)
structuralChecks('golden', entries)
const expectedAR = round2(sum(src.residents.map(r => duesBalance(r, C)))) // 888.5
check('operating AR (1100) == Σ residentBalance', acctNet(entries, '1100', 'operating'), expectedAR)
check('Σ residentBalance is 888.5', expectedAR, 888.5)
check('operating cash (1000) == all payments + collected fines − expenses', acctNet(entries, '1000', 'operating'), 90) // 200 + 40 orphan + 150 fine − 300 expense
check('unapplied (2000) == orphan payment (no resident)', acctNet(entries, '2000', 'operating'), -40) // credit → negative net; never touches AR
check('reserve cash (1010) == Σ component balances', acctNet(entries, '1010', 'reserve'), 5000)
check('assessment revenue (4000) credit == Σ accrual', acctNet(entries, '4000', 'operating'), -(6 * 100 + 3 * 100)) // credit → negative net
check('fine revenue (4100) == collected fines only', acctNet(entries, '4100', 'operating'), -150)

// ---- FUZZ: tie-out + structural invariants over random communities ----
console.log('\nFUZZ — 5,000 random communities (tie-out + balance must always hold)')
let seed = 20260605
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const money = () => round2(rnd() * 2000)
let fuzzFails = 0
for (let t = 0; t < 5000; t++) {
  const useLegacy = rnd() < 0.3
  const c = {
    monthly_dues: pick([0, 50, 100, 250, 1000]),
    interest_apr: useLegacy ? null : pick([0, 12, 18]),
    late_interest_rate: useLegacy ? pick([0, 1, 1.5]) : undefined,
    late_fee_flat: pick([0, 25, 50]),
    late_fee_pct: pick([0, 5, 10]),
  }
  const n = 1 + Math.floor(rnd() * 4)
  const residents = []
  const payments = []
  for (let i = 0; i < n; i++) {
    const np = Math.floor(rnd() * 3)
    const pays = Array.from({ length: np }, () => money())
    residents.push({ id: 'R' + i, monthsOwed: 1 + Math.floor(rnd() * 18), opening: pick([0, 50, 123.45, -20]), payments: pays })
    pays.forEach((amt, j) => payments.push({ id: `R${i}p${j}`, resident_id: 'R' + i, amount: amt }))
  }
  if (rnd() < 0.12) payments.push({ id: 'orphan' + t, resident_id: null, amount: money() }) // unattributed cash
  const violations = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({ id: 'v' + i, amount: money(), collected: rnd() < 0.6 }))
  const expenses = Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ id: 'e' + i, amount: money() }))
  const reserveComponents = Array.from({ length: Math.floor(rnd() * 2) }, (_, i) => ({ id: 'rc' + i, current_balance: money() }))
  const es = buildLedger({ community: c, residents, payments, violations, expenses, reserveComponents })

  // structural
  let bad = false
  for (const e of es) {
    if (new Set(e.lines.map(l => l.fund)).size !== 1) bad = true
    if (round2(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)) !== 0) bad = true
  }
  const gDr = round2(sum(es.flatMap(e => e.lines).map(l => l.debit)))
  const gCr = round2(sum(es.flatMap(e => e.lines).map(l => l.credit)))
  if (gDr !== gCr) bad = true
  // tie-out
  const ar = acctNet(es, '1100', 'operating')
  const expAR = round2(sum(residents.map(r => duesBalance(r, c))))
  if (ar !== expAR) bad = true
  // cash + reserve
  const cash = acctNet(es, '1000', 'operating')
  const expCash = round2(sum(payments.map(p => p.amount)) + sum(violations.filter(v => v.collected).map(v => v.amount)) - sum(expenses.map(e => e.amount)))
  if (cash !== expCash) bad = true
  const reserve = acctNet(es, '1010', 'reserve')
  if (reserve !== round2(sum(reserveComponents.map(r => r.current_balance)))) bad = true
  // orphaned payments land in unapplied (2000) and must NEVER reach AR
  const unapplied = acctNet(es, '2000', 'operating')
  const expUnapplied = round2(-sum(payments.filter(p => !p.resident_id).map(p => p.amount)))
  if (unapplied !== expUnapplied) bad = true

  if (bad) { fuzzFails++; if (fuzzFails <= 5) console.log(`  ✗ case ${t}: AR ${ar} vs ${expAR}, cash ${cash} vs ${expCash}, unapplied ${unapplied} vs ${expUnapplied}`) }
}
if (fuzzFails === 0) console.log('  ✓ 5,000/5,000 cases balance and tie out')
else { failures += fuzzFails; console.log(`  ✗ ${fuzzFails} mismatches`) }

// ---- REAL-DB MODE (opt-in): tie out the builder against live data ----
// Runs ONLY when service-role creds are present, so the default `npm run verify`
// stays offline + zero-dep. With creds it proves, on REAL communities, the two
// properties the synthetic fuzz can't see real data shapes for:
//   (A) HARD: the builder's operating 1100 net == Σ residentBalance() over the
//       live roster (staleness-proof — both computed in memory, as of now).
//   (B) INFO: the PERSISTED ledger (gl_trial_balance) 1100/operating net vs that
//       same Σ residentBalance — a drift just means "rebuild needed", so it's
//       informational by default. Set VERIFY_GL_ASSERT_PERSISTED=1 (e.g. in a
//       post-rebuild acceptance gate) to make persisted drift a hard failure.
// Scope to one community with VERIFY_GL_COMMUNITY=<uuid> (the pilot).
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DB_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL || 'https://nozzfcxijdnllkiydhfi.supabase.co'

if (!SERVICE_KEY) {
  console.log('\nℹ real-DB checks skipped (set SUPABASE_SERVICE_ROLE_KEY to run them)')
} else {
  // lib/dues.monthsOwed = monthsSince(created_at) + 1, using LOCAL getFullYear/
  // getMonth (matched here so the tie-out is exact vs residentBalance()).
  const monthsSinceLocal = (input, now) => {
    if (!input) return 0
    const d = new Date(input); if (isNaN(d.getTime())) return 0
    return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()))
  }
  const monthsOwedOf = (created_at, now) => monthsSinceLocal(created_at, now) + 1
  const assertPersisted = process.env.VERIFY_GL_ASSERT_PERSISTED === '1'
  const onlyCommunity = process.env.VERIFY_GL_COMMUNITY || null

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(DB_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const now = new Date()

    let cq = db.from('communities').select('*')
    if (onlyCommunity) cq = cq.eq('id', onlyCommunity)
    const { data: comms, error: cErr } = await cq
    if (cErr) throw new Error(`communities query failed: ${cErr.message}`)

    console.log(`\nREAL-DB — ${comms.length} communit${comms.length === 1 ? 'y' : 'ies'} (live tie-out)`)
    let drifts = 0, noLedger = 0
    for (const c of comms) {
      const [{ data: resRows, error: rErr }, { data: payRows, error: pErr }] = await Promise.all([
        db.from('residents').select('id, created_at, opening_balance').eq('community_id', c.id),
        db.from('payments').select('id, resident_id, amount').eq('community_id', c.id),
      ])
      if (rErr || pErr) { failures++; console.log(`  ✗ ${c.id}: source query failed (${(rErr || pErr).message})`); continue }

      const paysByRes = new Map()
      for (const p of payRows || []) {
        const rid = p.resident_id ? String(p.resident_id) : null
        if (!rid) continue
        if (!paysByRes.has(rid)) paysByRes.set(rid, [])
        paysByRes.get(rid).push(Number(p.amount) || 0)
      }
      const residents = (resRows || []).map(r => ({
        id: String(r.id), monthsOwed: monthsOwedOf(r.created_at, now),
        opening: Number(r.opening_balance) || 0, payments: paysByRes.get(String(r.id)) || [],
      }))
      const payments = (payRows || []).map(p => ({
        id: String(p.id), resident_id: p.resident_id ? String(p.resident_id) : null, amount: Number(p.amount) || 0,
      }))

      // (A) in-memory tie-out on real data — HARD.
      const es = buildLedger({ community: c, residents, payments })
      const arNet = acctNet(es, '1100', 'operating')
      const expAR = round2(sum(residents.map(r => duesBalance(r, c))))
      if (arNet !== expAR) { failures++; console.log(`  ✗ ${c.name || c.id}: builder AR ${arNet} <> Σ residentBalance ${expAR}`) }
      else console.log(`  ✓ ${c.name || c.id}: builder AR == Σ residentBalance (${expAR}), ${residents.length} residents`)

      // (B) persisted ledger vs the same expectation — INFO (or HARD if asserting).
      // Read the MACHINE-only 1100/operating net (exclude manual_adjustment), exactly
      // as gl_rebuild_community's re-assert does. The gl_trial_balance VIEW sums ALL
      // lines, so it would show false drift on any community with a manual AR
      // adjustment (an intentional deviation, not staleness).
      const { data: lineRows, error: tErr } = await db.from('gl_entry_lines')
        .select('debit, credit, gl_journal_entries!inner(source_type), gl_accounts!inner(code)')
        .eq('community_id', c.id).eq('fund', 'operating')
        .eq('gl_accounts.code', '1100')
        .neq('gl_journal_entries.source_type', 'manual_adjustment')
      if (tErr) {
        // Under the acceptance gate, an UNREADABLE persisted ledger must fail — not
        // silently pass (it's an inability to verify, not a "not rebuilt yet" skip).
        if (assertPersisted) failures++
        console.log(`    ${assertPersisted ? '✗' : 'ℹ'} ${c.name || c.id}: persisted read failed (${tErr.message})`)
        continue
      }
      if (!lineRows || lineRows.length === 0) { noLedger++; console.log(`    ℹ no persisted ledger yet (run the rebuild writer)`); continue }
      const persisted = round2(lineRows.reduce((s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0))
      const drift = round2(persisted - expAR)
      if (drift !== 0) {
        drifts++
        const msg = `    ${assertPersisted ? '✗' : 'ℹ'} persisted AR ${persisted} vs Σ residentBalance ${expAR} (drift ${drift} — projection stale, rebuild)`
        console.log(msg)
        if (assertPersisted) failures++
      } else {
        console.log(`    ✓ persisted AR ties out (${persisted})`)
      }
    }
    if (drifts && !assertPersisted) console.log(`  ℹ ${drifts} communit${drifts === 1 ? 'y' : 'ies'} need a rebuild (set VERIFY_GL_ASSERT_PERSISTED=1 to fail on this)`)
    if (noLedger) console.log(`  ℹ ${noLedger} communit${noLedger === 1 ? 'y has' : 'ies have'} no persisted ledger yet`)
  } catch (err) {
    failures++
    console.log(`  ✗ real-DB checks errored: ${err.message}`)
  }
}

console.log('')
if (failures === 0) { console.log('PASS — GL projection balances and ties out to lib/dues.ts.'); process.exit(0) }
else { console.log(`FAIL — ${failures} discrepancy(ies) in the GL projection.`); process.exit(1) }
