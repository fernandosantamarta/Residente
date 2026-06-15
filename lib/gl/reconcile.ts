// Bank reconciliation matcher (Phase 3 / Workstream D).
//
// proposeMatches() is a PURE, deterministic function: given a community's bank
// transactions (from Plaid → public.bank_transactions) and its stored GL journal
// entries (gl_journal_entries / gl_entry_lines, the regenerable projection from
// lib/gl/project.ts), it proposes how each bank row reconciles to the GL entry
// that moved the same cash. It writes nothing — app/api/admin/reconcile persists
// the result; supabase/reconciliation.sql holds the columns + the board confirm
// RPC. scripts/verify-reconcile.mjs proves the invariants below without a DB.
//
// SIGN CONVENTION (the crux):
//   • Plaid amount: POSITIVE = money OUT of the bank account (a payment/expense),
//     NEGATIVE = money IN (a deposit). (Same convention bank_transactions uses for
//     budget-vs-actual on /admin/budget.)
//   • GL cash line: a DEBIT to a cash account (1000/1010) is money IN; a CREDIT is
//     money OUT. So an entry's "cash delta" = Σ(cash debit) − Σ(cash credit) is
//     POSITIVE when cash entered the bank and NEGATIVE when it left.
//   • A bank row b reconciles to entry e iff  round2(e.cashDelta + b.amount) == 0
//     (e.g. an expense: GL Cr 1000 → cashDelta −100; Plaid +100 money out → 0). ✓
//
// MATCH POSTURE (locked decision #4 — auto-match, board confirms exceptions):
//   • AUTO (machine, high confidence) requires ALL of: exact amount (delta 0),
//     within the date window, and a MUTUAL SINGLETON — the bank row's only exact
//     candidate entry, and that entry is wanted by only this bank row. Mutual
//     singletons never share an entry, so no GL entry is ever matched twice.
//   • Reserve-fund entries are NEVER auto-matched (Rule 61B-22.005(2): a transfer
//     that may not have physically happened must not be silently posted) → exception.
//   • PENDING bank rows are never auto-matched (amount/date can still change) →
//     exception once a candidate exists.
//   • Everything else with a candidate → 'exception' (carrying the best suggestion);
//     nothing plausible → 'unmatched'.
//   • 'confirmed' rows are a human decision and are LEFT UNTOUCHED — they are not
//     returned, and their entry is claimed so the matcher can't reuse it.
//
// IDEMPOTENT: the proposal for a non-confirmed row depends only on the bank row's
// (amount, posted_date, pending), the entries' (cashDelta, date, reserve), and the
// set of confirmed claims — never on a row's own prior auto/exception/unmatched
// status. Re-running on the same data yields the same result.

export type MatchStatus = 'unmatched' | 'auto' | 'confirmed' | 'exception'

// Cash accounts the bank feed reconciles against (operating + reserve cash).
export const CASH_CODES = new Set(['1000', '1010'])
// Source types / funds that are reserve movements — never auto-matched.
const RESERVE_SOURCE_TYPES = new Set(['reserve_transfer', 'reserve_open'])

export const DEFAULT_TOLERANCE = 0.01 // "small tolerance" fuzzy tier (cents of rounding)
export const DEFAULT_WINDOW_DAYS = 5  // entry_date ↔ posted_date gap (ACH ~4 business days)

export interface MatchableLine {
  account: string            // gl_accounts.code
  fund?: string
  debit: number
  credit: number
}

export interface MatchableEntry {
  id: string                 // stored gl_journal_entries.id → matched_entry_id target
  entry_date: string | null  // 'YYYY-MM-DD'
  fund?: string
  source_type?: string
  lines: MatchableLine[]
}

export interface BankTxn {
  id: string
  posted_date: string | null
  amount: number             // Plaid sign: positive = money OUT of the account
  pending?: boolean | null
  match_status?: string | null
  matched_entry_id?: string | null
}

export interface ProposedMatch {
  bank_tx: string
  matched_entry_id: string | null
  match_status: MatchStatus
  match_confidence: number | null
  reason: string
}

export interface MatchOptions {
  toleranceCents?: number
  windowDays?: number
}

const round2 = (x: any) => Math.round((Number(x) || 0) * 100) / 100

// Net cash movement of an entry, in "bank space": + = money into the account,
// − = money out. Only cash accounts (1000/1010) count — accrual/interest/fee
// entries (no cash line) have delta 0 and are never bank-matchable.
export function cashDeltaOf(entry: MatchableEntry): number {
  let d = 0
  for (const l of entry.lines || []) {
    if (CASH_CODES.has(String(l.account))) d += (Number(l.debit) || 0) - (Number(l.credit) || 0)
  }
  return round2(d)
}

// A reserve movement: by fund, by source_type, or because it touches reserve cash.
export function isReserveEntry(entry: MatchableEntry): boolean {
  if (entry.fund === 'reserve') return true
  if (entry.source_type && RESERVE_SOURCE_TYPES.has(entry.source_type)) return true
  for (const l of entry.lines || []) {
    if (String(l.account) === '1010' && ((Number(l.debit) || 0) !== 0 || (Number(l.credit) || 0) !== 0)) return true
  }
  return false
}

const MS_PER_DAY = 86400000
const parseYmd = (s: string | null | undefined): number | null => {
  if (!s) return null
  const str = String(s).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)
  if (!m) {
    const d = new Date(str)
    return isNaN(d.getTime()) ? null : d.getTime()
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
// |days| between two YYYY-MM-DD dates; null if either is missing/unparseable.
const dayGap = (a: string | null | undefined, b: string | null | undefined): number | null => {
  const ta = parseYmd(a), tb = parseYmd(b)
  if (ta === null || tb === null) return null
  return Math.abs(Math.round((ta - tb) / MS_PER_DAY))
}
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

interface Cand { id: string; date: string | null; cashDelta: number; reserve: boolean }

/**
 * Propose a reconciliation status for every NON-confirmed bank transaction.
 * Confirmed rows are honored (their entry is claimed) but not returned.
 */
export function proposeMatches(
  bankTxns: BankTxn[],
  entries: MatchableEntry[],
  opts: MatchOptions = {},
): ProposedMatch[] {
  const tol = Math.max(0, Number(opts.toleranceCents ?? DEFAULT_TOLERANCE))
  const win = Math.max(0, Number(opts.windowDays ?? DEFAULT_WINDOW_DAYS))

  // Candidates = entries that actually moved cash (delta ≠ 0).
  const cands: Cand[] = []
  const candById = new Map<string, Cand>()
  for (const e of entries || []) {
    const cashDelta = cashDeltaOf(e)
    if (cashDelta === 0) continue
    const c: Cand = { id: String(e.id), date: e.entry_date ?? null, cashDelta, reserve: isReserveEntry(e) }
    cands.push(c)
    candById.set(c.id, c)
  }

  // Entries pinned by an existing confirmed match are off the table (sticky).
  const claimed = new Set<string>()
  for (const b of bankTxns || []) {
    if (b.match_status === 'confirmed' && b.matched_entry_id) claimed.add(String(b.matched_entry_id))
  }

  // Non-confirmed rows, in a deterministic order (posted_date, then id).
  const work = (bankTxns || [])
    .filter(b => b.match_status !== 'confirmed')
    .slice()
    .sort((a, b) => {
      const da = a.posted_date || '', db = b.posted_date || ''
      return da !== db ? cmpStr(da, db) : cmpStr(String(a.id), String(b.id))
    })

  const withinWindow = (cDate: string | null, bDate: string | null) => {
    const g = dayGap(cDate, bDate)
    return g !== null && g <= win
  }
  const isExact = (c: Cand, amt: number) => round2(c.cashDelta + amt) === 0

  // ---- Step A: exact, in-window candidates per row (over UNCLAIMED entries).
  // Pending rows are excluded from the auto path entirely (empty candidate list).
  const exactCands = new Map<string, string[]>()
  for (const b of work) {
    if (b.pending) { exactCands.set(b.id, []); continue }
    const ids = cands
      .filter(c => !claimed.has(c.id) && isExact(c, b.amount) && withinWindow(c.date, b.posted_date))
      .map(c => c.id)
    exactCands.set(b.id, ids)
  }
  // Reverse index: entry → bank rows that have it as an exact candidate.
  const wantedBy = new Map<string, string[]>()
  for (const [bid, ids] of exactCands) {
    for (const eid of ids) {
      const arr = wantedBy.get(eid) || []
      arr.push(bid); wantedBy.set(eid, arr)
    }
  }

  // ---- Step B: MUTUAL SINGLETONS → auto (never reserve). Auto entries are
  // pairwise distinct by construction, so this can never double-match an entry.
  const result = new Map<string, ProposedMatch>()
  const autoClaimed = new Set<string>()
  for (const b of work) {
    const ids = exactCands.get(b.id) || []
    if (ids.length !== 1) continue
    const eid = ids[0]
    const c = candById.get(eid)!
    if ((wantedBy.get(eid) || []).length === 1 && !c.reserve) {
      result.set(b.id, {
        bank_tx: b.id, matched_entry_id: eid, match_status: 'auto',
        match_confidence: 1, reason: 'exact amount, in window, unique match',
      })
      autoClaimed.add(eid)
    }
  }

  // ---- Step C: the rest → exception (best suggestion) or unmatched.
  const taken = new Set<string>([...claimed, ...autoClaimed])
  const bestByDate = (list: Cand[], bDate: string | null) =>
    list.slice().sort((x, y) => {
      const gx = dayGap(x.date, bDate) ?? Number.MAX_SAFE_INTEGER
      const gy = dayGap(y.date, bDate) ?? Number.MAX_SAFE_INTEGER
      return gx !== gy ? gx - gy : cmpStr(x.id, y.id)
    })[0]
  const bestByAmountThenDate = (list: Cand[], b: BankTxn) =>
    list.slice().sort((x, y) => {
      const dx = Math.abs(round2(x.cashDelta + b.amount)), dy = Math.abs(round2(y.cashDelta + b.amount))
      if (dx !== dy) return dx - dy
      const gx = dayGap(x.date, b.posted_date) ?? Number.MAX_SAFE_INTEGER
      const gy = dayGap(y.date, b.posted_date) ?? Number.MAX_SAFE_INTEGER
      return gx !== gy ? gx - gy : cmpStr(x.id, y.id)
    })[0]

  for (const b of work) {
    if (result.has(b.id)) continue
    const avail = cands.filter(c => !taken.has(c.id) && withinWindow(c.date, b.posted_date))
    const exact = avail.filter(c => isExact(c, b.amount))
    const fuzzy = tol > 0
      ? avail.filter(c => { const d = Math.abs(round2(c.cashDelta + b.amount)); return d > 0 && d <= tol })
      : []

    let suggestion: string | null = null
    let conf: number | null = null
    let status: MatchStatus = 'unmatched'
    let reason = 'no GL counterpart found'

    if (exact.length >= 1) {
      const best = bestByDate(exact, b.posted_date)
      suggestion = best.id; status = 'exception'
      conf = exact.length === 1 ? 0.9 : 0.6
      reason = b.pending ? 'pending — confirm after it settles'
        : best.reserve ? 'reserve transfer — confirm manually'
        : exact.length > 1 ? `${exact.length} exact candidates — pick one`
        : 'exact match — confirm'
    } else if (fuzzy.length >= 1) {
      const best = bestByAmountThenDate(fuzzy, b)
      suggestion = best.id; status = 'exception'
      conf = fuzzy.length === 1 ? 0.5 : 0.3
      reason = 'amount within tolerance — confirm'
    }

    result.set(b.id, { bank_tx: b.id, matched_entry_id: suggestion, match_status: status, match_confidence: conf, reason })
  }

  // Return in the deterministic work order.
  return work.map(b => result.get(b.id)!).filter(Boolean)
}
