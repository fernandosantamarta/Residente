#!/usr/bin/env node
// ============================================================================
// verify-reconcile.mjs  —  run:  npm run verify:reconcile  (and in npm run verify)
//
// Guards the bank-reconciliation matcher (lib/gl/reconcile.ts + the contract in
// supabase/reconciliation.sql). Proves, WITHOUT a database, the invariants the
// matcher must always hold:
//   1. AUTO TIES: every auto-matched bank row's amount ties to its GL entry's cash
//      movement within tolerance — in fact exactly (round2(cashDelta + amount)==0).
//   2. NO DOUBLE-MATCH: no GL entry is auto-matched to two bank rows, and an auto
//      match never reuses an entry already pinned by a confirmed match.
//   3. RESERVE NEVER AUTO: a reserve-fund entry is never auto-matched.
//   4. IDEMPOTENT: feeding the proposed statuses back in and re-running yields the
//      identical proposal for every non-confirmed row (re-run is stable).
//   5. CONFIRMED STICKY: confirmed rows are honored (never re-proposed) and their
//      entry is claimed.
//
// Ported (kept in sync, do NOT "fix" a port to mask a real divergence) from
// lib/gl/reconcile.ts. If you change the matcher, change this port too.
// ============================================================================

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100
const CASH_CODES = new Set(['1000', '1010'])
const RESERVE_SOURCE_TYPES = new Set(['reserve_transfer', 'reserve_open'])
const DEFAULT_TOLERANCE = 0.01
const DEFAULT_WINDOW_DAYS = 5

function cashDeltaOf(entry) {
  let d = 0
  for (const l of entry.lines || []) {
    if (CASH_CODES.has(String(l.account))) d += (Number(l.debit) || 0) - (Number(l.credit) || 0)
  }
  return round2(d)
}
function isReserveEntry(entry) {
  if (entry.fund === 'reserve') return true
  if (entry.source_type && RESERVE_SOURCE_TYPES.has(entry.source_type)) return true
  for (const l of entry.lines || []) {
    if (String(l.account) === '1010' && ((Number(l.debit) || 0) !== 0 || (Number(l.credit) || 0) !== 0)) return true
  }
  return false
}
const MS_PER_DAY = 86400000
const parseYmd = (s) => {
  if (!s) return null
  const str = String(s).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)
  if (!m) { const d = new Date(str); return isNaN(d.getTime()) ? null : d.getTime() }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
const dayGap = (a, b) => {
  const ta = parseYmd(a), tb = parseYmd(b)
  if (ta === null || tb === null) return null
  return Math.abs(Math.round((ta - tb) / MS_PER_DAY))
}
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function proposeMatches(bankTxns, entries, opts = {}) {
  const tol = Math.max(0, Number(opts.toleranceCents ?? DEFAULT_TOLERANCE))
  const win = Math.max(0, Number(opts.windowDays ?? DEFAULT_WINDOW_DAYS))

  const cands = []
  const candById = new Map()
  for (const e of entries || []) {
    const cashDelta = cashDeltaOf(e)
    if (cashDelta === 0) continue
    const c = { id: String(e.id), date: e.entry_date ?? null, cashDelta, reserve: isReserveEntry(e) }
    cands.push(c); candById.set(c.id, c)
  }

  const claimed = new Set()
  for (const b of bankTxns || []) {
    if (b.match_status === 'confirmed' && b.matched_entry_id) claimed.add(String(b.matched_entry_id))
  }

  const work = (bankTxns || [])
    .filter(b => b.match_status !== 'confirmed')
    .slice()
    .sort((a, b) => {
      const da = a.posted_date || '', db = b.posted_date || ''
      return da !== db ? cmpStr(da, db) : cmpStr(String(a.id), String(b.id))
    })

  const withinWindow = (cDate, bDate) => { const g = dayGap(cDate, bDate); return g !== null && g <= win }
  const isExact = (c, amt) => round2(c.cashDelta + amt) === 0

  const exactCands = new Map()
  for (const b of work) {
    if (b.pending) { exactCands.set(b.id, []); continue }
    exactCands.set(b.id, cands.filter(c => !claimed.has(c.id) && isExact(c, b.amount) && withinWindow(c.date, b.posted_date)).map(c => c.id))
  }
  const wantedBy = new Map()
  for (const [bid, ids] of exactCands) for (const eid of ids) { const arr = wantedBy.get(eid) || []; arr.push(bid); wantedBy.set(eid, arr) }

  const result = new Map()
  const autoClaimed = new Set()
  for (const b of work) {
    const ids = exactCands.get(b.id) || []
    if (ids.length !== 1) continue
    const eid = ids[0]; const c = candById.get(eid)
    if ((wantedBy.get(eid) || []).length === 1 && !c.reserve) {
      result.set(b.id, { bank_tx: b.id, matched_entry_id: eid, match_status: 'auto', match_confidence: 1, reason: 'exact amount, in window, unique match' })
      autoClaimed.add(eid)
    }
  }

  const taken = new Set([...claimed, ...autoClaimed])
  const bestByDate = (list, bDate) => list.slice().sort((x, y) => {
    const gx = dayGap(x.date, bDate) ?? Number.MAX_SAFE_INTEGER, gy = dayGap(y.date, bDate) ?? Number.MAX_SAFE_INTEGER
    return gx !== gy ? gx - gy : cmpStr(x.id, y.id)
  })[0]
  const bestByAmountThenDate = (list, b) => list.slice().sort((x, y) => {
    const dx = Math.abs(round2(x.cashDelta + b.amount)), dy = Math.abs(round2(y.cashDelta + b.amount))
    if (dx !== dy) return dx - dy
    const gx = dayGap(x.date, b.posted_date) ?? Number.MAX_SAFE_INTEGER, gy = dayGap(y.date, b.posted_date) ?? Number.MAX_SAFE_INTEGER
    return gx !== gy ? gx - gy : cmpStr(x.id, y.id)
  })[0]

  for (const b of work) {
    if (result.has(b.id)) continue
    const avail = cands.filter(c => !taken.has(c.id) && withinWindow(c.date, b.posted_date))
    const exact = avail.filter(c => isExact(c, b.amount))
    const fuzzy = tol > 0 ? avail.filter(c => { const d = Math.abs(round2(c.cashDelta + b.amount)); return d > 0 && d <= tol }) : []
    let suggestion = null, conf = null, statusV = 'unmatched', reason = 'no GL counterpart found'
    if (exact.length >= 1) {
      const best = bestByDate(exact, b.posted_date)
      suggestion = best.id; statusV = 'exception'; conf = exact.length === 1 ? 0.9 : 0.6
      reason = b.pending ? 'pending' : best.reserve ? 'reserve' : exact.length > 1 ? 'multiple exact' : 'exact'
    } else if (fuzzy.length >= 1) {
      const best = bestByAmountThenDate(fuzzy, b)
      suggestion = best.id; statusV = 'exception'; conf = fuzzy.length === 1 ? 0.5 : 0.3; reason = 'tolerance'
    }
    result.set(b.id, { bank_tx: b.id, matched_entry_id: suggestion, match_status: statusV, match_confidence: conf, reason })
  }
  return work.map(b => result.get(b.id)).filter(Boolean)
}

// ---------------------------------------------------------------------------
let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`) }
}
// helpers to build entries/bank rows tersely
const expenseEntry = (id, amt, date) => ({ id, entry_date: date, fund: 'operating', source_type: 'expense', lines: [{ account: '5000', debit: amt, credit: 0 }, { account: '1000', debit: 0, credit: amt }] })
const paymentEntry = (id, amt, date) => ({ id, entry_date: date, fund: 'operating', source_type: 'payment', lines: [{ account: '1000', debit: amt, credit: 0 }, { account: '1100', debit: 0, credit: amt }] })
const reserveSeed = (id, amt, date) => ({ id, entry_date: date, fund: 'reserve', source_type: 'reserve_open', lines: [{ account: '1010', debit: amt, credit: 0 }, { account: '3010', debit: 0, credit: amt }] })
const accrualEntry = (id, amt, date) => ({ id, entry_date: date, fund: 'operating', source_type: 'accrual', lines: [{ account: '1100', debit: amt, credit: 0 }, { account: '4000', debit: 0, credit: amt }] }) // no cash → never a candidate
const bank = (id, amount, date, extra = {}) => ({ id, amount, posted_date: date, pending: false, match_status: 'unmatched', matched_entry_id: null, ...extra })
const statusOf = (res, id) => (res.find(r => r.bank_tx === id) || {}).match_status
const matchOf = (res, id) => (res.find(r => r.bank_tx === id) || {}).matched_entry_id

console.log('GOLDEN — reconciliation scenarios')

// G1: expense out → exact singleton → auto
{
  const res = proposeMatches([bank('B1', 100, '2026-03-11')], [expenseEntry('E1', 100, '2026-03-10')])
  check('G1 expense exact singleton → auto', [statusOf(res, 'B1'), matchOf(res, 'B1')], ['auto', 'E1'])
}
// G2: deposit in (negative Plaid amount) → exact singleton → auto
{
  const res = proposeMatches([bank('B1', -100, '2026-03-11')], [paymentEntry('E1', 100, '2026-03-10')])
  check('G2 deposit exact singleton → auto', [statusOf(res, 'B1'), matchOf(res, 'B1')], ['auto', 'E1'])
}
// G3: ambiguous (two exact candidates) → exception, not auto
{
  const res = proposeMatches([bank('B1', 100, '2026-03-11')], [expenseEntry('E1', 100, '2026-03-10'), expenseEntry('E2', 100, '2026-03-12')])
  check('G3 two exact candidates → exception', statusOf(res, 'B1'), 'exception')
  check('G3 suggests the closest by date (E1, gap 1 < E2 gap 1 → tiebreak id)', matchOf(res, 'B1'), 'E1')
}
// G4: reserve seed exact singleton → exception (never auto)
{
  const res = proposeMatches([bank('B1', -500, '2026-03-11')], [reserveSeed('E1', 500, '2026-03-10')])
  check('G4 reserve exact singleton → exception (never auto)', [statusOf(res, 'B1'), matchOf(res, 'B1')], ['exception', 'E1'])
}
// G5: confirmed entry is claimed → a second bank row for it goes unmatched
{
  const txns = [
    { id: 'Bc', amount: 100, posted_date: '2026-03-10', pending: false, match_status: 'confirmed', matched_entry_id: 'E1' },
    bank('B2', 100, '2026-03-11'),
  ]
  const res = proposeMatches(txns, [expenseEntry('E1', 100, '2026-03-10')])
  check('G5 confirmed row is not re-proposed', res.find(r => r.bank_tx === 'Bc'), undefined)
  check('G5 second row finds the entry claimed → unmatched', statusOf(res, 'B2'), 'unmatched')
}
// G6: one-cent off → tolerance → exception (not auto)
{
  const res = proposeMatches([bank('B1', 100.01, '2026-03-11')], [expenseEntry('E1', 100, '2026-03-10')])
  check('G6 within tolerance → exception (not auto)', [statusOf(res, 'B1'), matchOf(res, 'B1')], ['exception', 'E1'])
}
// G7: out of date window → unmatched
{
  const res = proposeMatches([bank('B1', 100, '2026-03-30')], [expenseEntry('E1', 100, '2026-03-10')])
  check('G7 outside window → unmatched', [statusOf(res, 'B1'), matchOf(res, 'B1')], ['unmatched', null])
}
// G8: pending → never auto, exception with suggestion
{
  const res = proposeMatches([bank('B1', 100, '2026-03-11', { pending: true })], [expenseEntry('E1', 100, '2026-03-10')])
  check('G8 pending exact → exception (never auto)', [statusOf(res, 'B1'), matchOf(res, 'B1')], ['exception', 'E1'])
}
// G9: accrual (no cash line) is never a candidate
{
  const res = proposeMatches([bank('B1', 100, '2026-03-11')], [accrualEntry('E1', 100, '2026-03-10')])
  check('G9 accrual (no cash) is not matchable → unmatched', statusOf(res, 'B1'), 'unmatched')
}
// G10: mutual-singleton requirement — two bank rows both want the one entry → neither auto
{
  const res = proposeMatches([bank('B1', 100, '2026-03-10'), bank('B2', 100, '2026-03-11')], [expenseEntry('E1', 100, '2026-03-10')])
  check('G10 entry wanted by two rows → neither auto', [statusOf(res, 'B1'), statusOf(res, 'B2')].filter(s => s === 'auto').length, 0)
}

// ---- FUZZ: invariants over random books ----
console.log('\nFUZZ — 5,000 random reconciliation scenarios (invariants must always hold)')
let seed = 20260610
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const money = () => round2(50 + rnd() * 1950)
const dateAt = (dayOffset) => { const d = new Date(Date.UTC(2026, 2, 1) + dayOffset * MS_PER_DAY); return d.toISOString().slice(0, 10) }

let fuzzFails = 0
for (let t = 0; t < 5000; t++) {
  // Build a pool of GL entries (mix of expense/payment/reserve/accrual).
  const entries = []
  const nE = 1 + Math.floor(rnd() * 6)
  for (let i = 0; i < nE; i++) {
    const amt = money(), date = dateAt(Math.floor(rnd() * 20)), id = `E${t}_${i}`
    const kind = rnd()
    if (kind < 0.35) entries.push(expenseEntry(id, amt, date))
    else if (kind < 0.65) entries.push(paymentEntry(id, amt, date))
    else if (kind < 0.82) entries.push(reserveSeed(id, amt, date))
    else entries.push(accrualEntry(id, amt, date)) // never a candidate
  }
  // Build bank rows: some exact to an entry, some random, some duplicates, pending, off-date.
  const txns = []
  const nB = 1 + Math.floor(rnd() * 7)
  for (let i = 0; i < nB; i++) {
    const id = `B${t}_${i}`
    let amount, date, pending = rnd() < 0.12
    if (rnd() < 0.6 && entries.length) {
      const e = pick(entries)
      const cd = cashDeltaOf(e)
      amount = cd !== 0 ? round2(-cd) : money()       // exact to e's cash movement
      date = dateAt(Math.floor(rnd() * 20))
      if (rnd() < 0.2) amount = round2(amount + (rnd() < 0.5 ? 0.01 : 5)) // perturb: tolerance or miss
    } else { amount = round2((rnd() < 0.5 ? 1 : -1) * money()); date = dateAt(Math.floor(rnd() * 30)) }
    txns.push(bank(id, amount, date, { pending }))
  }
  // Pre-confirm a couple of rows against random cash entries (stickiness).
  const cashEntries = entries.filter(e => cashDeltaOf(e) !== 0)
  if (cashEntries.length && rnd() < 0.4) {
    const e = pick(cashEntries)
    txns.push({ id: `Bc${t}`, amount: round2(-cashDeltaOf(e)), posted_date: dateAt(5), pending: false, match_status: 'confirmed', matched_entry_id: e.id })
  }

  const res = proposeMatches(txns, entries)
  const entryById = new Map(entries.map(e => [e.id, e]))
  const confirmedClaims = new Set(txns.filter(b => b.match_status === 'confirmed' && b.matched_entry_id).map(b => String(b.matched_entry_id)))

  let bad = ''
  // (1) every non-confirmed row proposed exactly once; confirmed never proposed.
  const nonConfirmed = txns.filter(b => b.match_status !== 'confirmed')
  if (res.length !== nonConfirmed.length) bad = `result count ${res.length} != work ${nonConfirmed.length}`
  if (res.some(r => txns.find(b => b.id === r.bank_tx)?.match_status === 'confirmed')) bad = 'a confirmed row was proposed'

  const autoEntries = []
  for (const r of res) {
    const bt = txns.find(b => b.id === r.bank_tx)
    if (r.match_status === 'auto') {
      autoEntries.push(r.matched_entry_id)
      const e = entryById.get(r.matched_entry_id)
      // (1) auto ties exactly
      if (!e || round2(cashDeltaOf(e) + bt.amount) !== 0) bad = `auto ${r.bank_tx} does not tie`
      // (3) reserve never auto
      if (e && isReserveEntry(e)) bad = `auto matched a reserve entry ${r.matched_entry_id}`
      // pending never auto
      if (bt.pending) bad = `auto matched a pending row ${r.bank_tx}`
    }
  }
  // (2) no double-match among auto, and auto never reuses a confirmed entry
  const seenAuto = new Set()
  for (const eid of autoEntries) {
    if (seenAuto.has(eid)) bad = `entry ${eid} auto-matched twice`
    seenAuto.add(eid)
    if (confirmedClaims.has(eid)) bad = `auto reused a confirmed entry ${eid}`
  }

  // (4) idempotent: apply results, re-run, expect identical proposals.
  const applied = txns.map(b => {
    if (b.match_status === 'confirmed') return { ...b }
    const r = res.find(x => x.bank_tx === b.id)
    return { ...b, match_status: r.match_status, matched_entry_id: r.matched_entry_id, match_confidence: r.match_confidence }
  })
  const res2 = proposeMatches(applied, entries)
  const key = (arr) => arr.map(r => `${r.bank_tx}:${r.match_status}:${r.matched_entry_id}:${r.match_confidence}`).sort().join('|')
  if (key(res) !== key(res2)) bad = 'not idempotent on re-run'

  if (bad) { fuzzFails++; if (fuzzFails <= 5) console.log(`  ✗ case ${t}: ${bad}`) }
}
if (fuzzFails === 0) console.log('  ✓ 5,000/5,000 scenarios hold all invariants')
else { failures += fuzzFails; console.log(`  ✗ ${fuzzFails} scenarios violated an invariant`) }

console.log('')
if (failures === 0) { console.log('PASS — reconciliation matcher holds its invariants.'); process.exit(0) }
else { console.log(`FAIL — ${failures} discrepancy(ies) in the reconciliation matcher.`); process.exit(1) }
