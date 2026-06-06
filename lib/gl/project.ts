// General-ledger projection (Phase 3 / Workstream B).
//
// buildLedger() is a PURE function: it turns data the app already holds
// (residents + payments + expenses + paid fines + reserve balances) into a set
// of balanced double-entry journal entries. It is the single source of GL truth
// — re-runnable and idempotent (each entry carries a stable source_key). The
// SQL spine (supabase/gl-spine.sql) stores what this returns.
//
// It reuses the canonical dues math in lib/dues.ts (monthsOwed, lateInterest,
// adminLateFees, communityDuesConfig), so the operating "Assessments receivable"
// (1100) net balance equals Σ residentBalance() over the roster BY CONSTRUCTION.
// scripts/verify-gl.mjs proves that tie-out (npm run verify:gl).
//
// SCOPE (Workstream B): single-fund entries only. Dues/fines/expenses → operating
// fund; the reserve fund is seeded from ev_reserve_components (board-stated). True
// inter-fund reserve transfers + reserve-expense classification land with the bank
// feed (Plaid, Workstream C/D).
//
// NOTE on rebuild semantics: 'interest'/'late_fee' entries are recomputed SNAPSHOTS
// (their source_key has no date), so a later rebuild overwrites them with the
// current figure — intended for a regenerable projection. Each line is round2()'d
// and amounts ≤ 0 are dropped, so there is no sub-cent drift relative to the
// identically-rounded residentBalance() the ledger ties out to.

import { monthsOwed, lateInterest, adminLateFees, communityDuesConfig } from '@/lib/dues'
import { currentFiscalYear } from '@/lib/fiscal'

export type Fund = 'operating' | 'reserve'

export interface GLLine {
  account: string            // gl_accounts.code
  fund: Fund
  debit: number
  credit: number
  resident_id?: string | null
  category_id?: string | null
}

export interface GLEntry {
  source_type: string
  source_key: string         // unique per community; drives idempotent rebuild
  source_id?: string | null
  entry_date: string         // 'YYYY-MM-DD'
  fiscal_year: number
  fund: Fund
  resident_id?: string | null
  memo?: string
  lines: GLLine[]
}

export interface LedgerSources {
  community: Record<string, any> | null | undefined
  residents: Array<Record<string, any>>
  payments: Array<Record<string, any>>            // { id, resident_id, amount, paid_on }
  expenses: Array<Record<string, any>>            // { id, amount, spent_on, category_id }
  violations?: Array<Record<string, any>>         // { id, amount, status, resolution, closed_at }
  reserveComponents?: Array<Record<string, any>>  // { id, current_balance, created_at }
  asOf?: Date
}

const round2 = (x: number) => Math.round((Number(x) || 0) * 100) / 100
const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
const toDate = (v: any): Date | null => {
  if (!v) return null
  const d = new Date(typeof v === 'string' && v.length === 10 ? v + 'T12:00:00Z' : v)
  return isNaN(d.getTime()) ? null : d
}
const firstOfMonthUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
const addMonthsUTC = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))

/** Build the full set of journal entries for one community. */
export function buildLedger(src: LedgerSources): GLEntry[] {
  const entries: GLEntry[] = []
  const community = src.community || {}
  const fyStart = Number((community as any).fiscal_year_start_month) || 1
  const monthly = Number((community as any).monthly_dues) || 0
  const cfg = communityDuesConfig(community as any)
  const apr = cfg.apr || 0
  const asOf = src.asOf || new Date()
  const asOfISO = ymd(asOf)
  const asOfFy = currentFiscalYear(fyStart, asOf).year
  const fyOf = (dateISO: string) => {
    const d = toDate(dateISO)
    return d ? currentFiscalYear(fyStart, d).year : asOfFy
  }

  // Two-line balanced helper (single fund).
  const post = (e: {
    source_type: string; source_key: string; source_id?: string | null
    entry_date: string; fund: Fund; resident_id?: string | null; memo?: string
    debitAccount: string; creditAccount: string; amount: number
    resident?: string | null; category_id?: string | null
  }) => {
    const amt = round2(e.amount)
    if (amt <= 0) return
    entries.push({
      source_type: e.source_type, source_key: e.source_key, source_id: e.source_id ?? null,
      entry_date: e.entry_date, fiscal_year: fyOf(e.entry_date), fund: e.fund,
      resident_id: e.resident_id ?? null, memo: e.memo,
      lines: [
        { account: e.debitAccount, fund: e.fund, debit: amt, credit: 0, resident_id: e.resident ?? null, category_id: e.category_id ?? null },
        { account: e.creditAccount, fund: e.fund, debit: 0, credit: amt, resident_id: e.resident ?? null, category_id: e.category_id ?? null },
      ],
    })
  }

  // ---- dues: per-resident accrual, opening, interest, fees (operating fund) ----
  const paysByResident = new Map<string, Array<Record<string, any>>>()
  for (const p of src.payments || []) {
    const rid = String(p.resident_id || '')
    if (!rid) continue
    if (!paysByResident.has(rid)) paysByResident.set(rid, [])
    paysByResident.get(rid)!.push(p)
  }

  for (const res of src.residents || []) {
    const rid = String(res.id || '')
    if (!rid) continue
    const resPays = paysByResident.get(rid) || []
    const opening = round2(Number(res.opening_balance) || 0)
    const created = toDate(res.created_at)
    const mo = monthsOwed(res as any, asOf)

    // Opening balance (carried-forward receivable, or a prepaid credit).
    if (opening !== 0) {
      const dateISO = ymd(created || asOf)
      if (opening > 0) {
        post({ source_type: 'opening_balance', source_key: `opening:${rid}`, entry_date: dateISO, fund: 'operating',
          resident_id: rid, resident: rid, memo: 'Opening balance', debitAccount: '1100', creditAccount: '3000', amount: opening })
      } else {
        post({ source_type: 'opening_balance', source_key: `opening:${rid}`, entry_date: dateISO, fund: 'operating',
          resident_id: rid, resident: rid, memo: 'Opening credit', debitAccount: '3000', creditAccount: '1100', amount: -opening })
      }
    }

    // Monthly assessment accrual: one balanced entry per owed month.
    if (monthly > 0 && mo > 0) {
      const base = firstOfMonthUTC(created || asOf)
      for (let i = 0; i < mo; i++) {
        const d = addMonthsUTC(base, i)
        const dISO = ymd(d)
        post({ source_type: 'accrual', source_key: `accrual:${rid}:${dISO.slice(0, 7)}`, entry_date: dISO, fund: 'operating',
          resident_id: rid, resident: rid, memo: 'Monthly assessment', debitAccount: '1100', creditAccount: '4000', amount: monthly })
      }
    }

    // Late interest + admin fee (snapshot, matching residentBalance()). asOf is
    // threaded so accrual + interest/fee are all evaluated at the SAME instant.
    const interest = lateInterest(res as any, monthly, resPays as any, apr, asOf)
    if (interest > 0) {
      post({ source_type: 'interest', source_key: `interest:${rid}`, entry_date: asOfISO, fund: 'operating',
        resident_id: rid, resident: rid, memo: 'Late interest', debitAccount: '1100', creditAccount: '4300', amount: interest })
    }
    const fee = adminLateFees(res as any, monthly, resPays as any, cfg, asOf)
    if (fee > 0) {
      post({ source_type: 'late_fee', source_key: `fee:${rid}`, entry_date: asOfISO, fund: 'operating',
        resident_id: rid, resident: rid, memo: 'Administrative late fee', debitAccount: '1100', creditAccount: '4310', amount: fee })
    }
  }

  // ---- payments: cash in ----
  // A payment whose resident is in the roster we accrued (above) pays down AR
  // (1100); a payment with no/unknown resident is real cash we can't attribute, so
  // it lands in "unapplied" (2000) — cash stays correct AND AR still ties to
  // Σ residentBalance() (which only sees roster residents' payments). resident_id is
  // `on delete set null`, and a deactivated resident may be off the roster, so both
  // are real states. NB: paid fines never create payments rows (the Stripe webhook
  // closes ev_violations and returns before any payments insert), so every payments
  // row is a dues payment — crediting AR for all roster payments is correct and
  // required for tie-out; do NOT filter by charge_type here.
  const roster = new Set((src.residents || []).map((r: any) => String(r.id)).filter(Boolean))
  for (const p of src.payments || []) {
    const amt = round2(Number(p.amount) || 0)
    if (amt <= 0) continue
    const rid = p.resident_id ? String(p.resident_id) : null
    const applied = rid !== null && roster.has(rid)
    post({ source_type: 'payment', source_key: `payment:${p.id}`, source_id: p.id, entry_date: String(p.paid_on || asOfISO).slice(0, 10),
      fund: 'operating', resident_id: rid, resident: rid,
      memo: applied ? 'Dues payment' : 'Unapplied payment (no resident)',
      debitAccount: '1000', creditAccount: applied ? '1100' : '2000', amount: amt })
  }

  // ---- fines: revenue only when actually collected (ev_violations) ----
  for (const v of src.violations || []) {
    const collected = v.status === 'closed' && (v.resolution === 'stripe-paid' || v.resolution === 'manual-paid')
    const amt = round2(Number(v.amount) || 0)
    if (!collected || amt <= 0) continue
    post({ source_type: 'fine', source_key: `fine:${v.id}`, source_id: v.id, entry_date: String(v.closed_at || asOfISO).slice(0, 10),
      fund: 'operating', memo: 'Fine collected', debitAccount: '1000', creditAccount: '4100', amount: amt })
  }

  // ---- expenses: cash out by category (all operating fund in this phase) ----
  for (const e of src.expenses || []) {
    const amt = round2(Number(e.amount) || 0)
    if (amt <= 0) continue
    post({ source_type: 'expense', source_key: `expense:${e.id}`, source_id: e.id, entry_date: String(e.spent_on || asOfISO).slice(0, 10),
      fund: 'operating', memo: 'Expense', debitAccount: '5000', creditAccount: '1000', amount: amt, category_id: e.category_id ?? null })
  }

  // ---- reserve fund: seed cash from board-stated component balances ----
  for (const rc of src.reserveComponents || []) {
    const amt = round2(Number(rc.current_balance) || 0)
    if (amt <= 0) continue
    post({ source_type: 'reserve_open', source_key: `reserve_open:${rc.id}`, source_id: rc.id,
      entry_date: ymd(toDate(rc.created_at) || asOf), fund: 'reserve', memo: 'Reserve opening balance',
      debitAccount: '1010', creditAccount: '3010', amount: amt })
  }

  return entries
}

/** Roll entries up into a trial balance by account code + fund (for reports/checks). */
export function trialBalance(entries: GLEntry[]): Array<{ account: string; fund: Fund; debit: number; credit: number; balance: number }> {
  const map = new Map<string, { account: string; fund: Fund; debit: number; credit: number }>()
  for (const e of entries) {
    for (const l of e.lines) {
      const k = `${l.fund}:${l.account}`
      const row = map.get(k) || { account: l.account, fund: l.fund, debit: 0, credit: 0 }
      row.debit += l.debit; row.credit += l.credit
      map.set(k, row)
    }
  }
  return [...map.values()].map(r => ({ ...r, debit: round2(r.debit), credit: round2(r.credit), balance: round2(r.debit - r.credit) }))
}
