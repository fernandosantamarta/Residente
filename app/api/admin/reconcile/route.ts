// Bank reconciliation — auto-matches a community's Plaid bank transactions to the
// stored GL journal entries that moved the same cash. Service-role only, gated by
// CRON_SECRET (same posture as /api/admin/gl/rebuild and the /api/cron/* jobs).
// On-demand per community; dry-run first.
//
// WHY a Next route (mirrors app/api/admin/gl/rebuild): the privileged jobs in this
// app are Next API routes that createClient(service-role) and import the canonical
// logic from @/lib. This route reuses the REAL pure matcher proposeMatches() from
// @/lib/gl/reconcile (proven by `npm run verify:reconcile`) — no second runtime, no
// re-port. It reads bank_transactions + the persisted GL (gl_journal_entries /
// gl_entry_lines), proposes a status for every NON-confirmed bank row, and (on
// commit) writes match_status / matched_entry_id / match_confidence. It NEVER
// moves money and NEVER touches 'confirmed' rows (a human decision). See
// supabase/reconciliation.sql and [[eliminate-back-office-plan]].
//
// SAFETY:
//   • GET  is ALWAYS a dry run — it can never write.
//   • POST writes only with ?commit=1 (or JSON body {"commit":true}); else dry-runs.
//   • community_id is REQUIRED — no fleet-wide path (reconcile one community at a time).
//   • FAILS CLOSED on any source-query error (a partial read could mis-mark rows).
//   • Only rows whose (match_status, matched_entry_id) actually CHANGE are written,
//     so a re-run with no new data is a no-op (idempotent).
//
// Env (Vercel project settings): CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, and a
// Supabase URL (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / REACT_APP_SUPABASE_URL).
//
// Invoke:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "$BASE/api/admin/reconcile?community_id=<uuid>"            # dry-run preview
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "$BASE/api/admin/reconcile?community_id=<uuid>&commit=1"   # persist

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  proposeMatches, CASH_CODES, DEFAULT_TOLERANCE, DEFAULT_WINDOW_DAYS,
  type BankTxn, type MatchableEntry,
} from '@/lib/gl/reconcile'

export const dynamic = 'force-dynamic'

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const bearer = req.headers.get('authorization') === `Bearer ${secret}`
  const header = req.headers.get('x-cron-secret') === secret
  return bearer || header
}

function adminClient(): SupabaseClient | null {
  // The project URL is public (it ships in the client bundle); only the
  // service-role KEY is a secret. Mirror lib/supabase's URL resolution.
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    'https://nozzfcxijdnllkiydhfi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

const numParam = (v: string | null, fallback: number) => {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

async function handle(req: Request, allowCommit: boolean) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = adminClient()
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }

  const u = new URL(req.url)
  let body: any = {}
  if (allowCommit) { try { body = (await req.json()) || {} } catch { /* no body is fine */ } }
  const communityId = u.searchParams.get('community_id') || body.community_id
  if (!communityId) {
    return NextResponse.json({ error: 'community_id is required (no fleet-wide reconcile)' }, { status: 400 })
  }
  const commit = allowCommit && (u.searchParams.get('commit') === '1' || body.commit === true)
  const toleranceCents = numParam(u.searchParams.get('tolerance'), DEFAULT_TOLERANCE)
  const windowDays = numParam(u.searchParams.get('window'), DEFAULT_WINDOW_DAYS)

  try {
    // ---- Load the bank feed + the cash lines of the persisted GL ----
    // We only need GL entries that MOVED CASH (a 1000/1010 line); accrual/interest/
    // fee entries have no bank counterpart. Fetch each cash line with its parent
    // entry header and account code in one query.
    const [bankR, linesR] = await Promise.all([
      admin
        .from('bank_transactions')
        .select('id, posted_date, amount, pending, match_status, matched_entry_id, name, merchant_name')
        .eq('community_id', communityId),
      admin
        .from('gl_entry_lines')
        .select('debit, credit, fund, gl_accounts!inner(code), gl_journal_entries!inner(id, entry_date, fund, source_type)')
        .eq('community_id', communityId)
        .in('gl_accounts.code', [...CASH_CODES]),
    ])
    // Fail CLOSED: a partial/failed source read could mark real matches as unmatched
    // or auto-link the wrong entry. Never reconcile from an incomplete read.
    if (bankR.error) {
      return NextResponse.json({ error: `bank_transactions load failed: ${bankR.error.message}` }, { status: 502 })
    }
    if (linesR.error) {
      return NextResponse.json({ error: `GL load failed: ${linesR.error.message}` }, { status: 502 })
    }

    const bankRows = (bankR.data || []) as any[]
    const bankTxns: BankTxn[] = bankRows.map(b => ({
      id: String(b.id),
      posted_date: b.posted_date ?? null,
      amount: Number(b.amount) || 0,
      pending: !!b.pending,
      match_status: b.match_status ?? 'unmatched',
      matched_entry_id: b.matched_entry_id ?? null,
    }))

    // ---- Reduce GL cash lines → MatchableEntry[] (one per entry that moved cash) ----
    const byEntry = new Map<string, MatchableEntry>()
    for (const row of (linesR.data || []) as any[]) {
      const e = row.gl_journal_entries
      const a = row.gl_accounts
      if (!e || !a) continue
      const id = String(e.id)
      let me = byEntry.get(id)
      if (!me) {
        me = { id, entry_date: e.entry_date ?? null, fund: e.fund, source_type: e.source_type, lines: [] }
        byEntry.set(id, me)
      }
      me.lines.push({ account: String(a.code), fund: row.fund, debit: Number(row.debit) || 0, credit: Number(row.credit) || 0 })
    }
    const entries = [...byEntry.values()]

    // ---- Propose (pure matcher) ----
    const proposals = proposeMatches(bankTxns, entries, { toleranceCents, windowDays })

    // ---- Diff against current state; only changed rows are written ----
    const curById = new Map(bankRows.map(b => [String(b.id), b]))
    const nameById = new Map(bankRows.map(b => [String(b.id), (b.merchant_name || b.name || '') as string]))
    const changes = proposals.filter(p => {
      const cur = curById.get(p.bank_tx)
      const curEntry = cur?.matched_entry_id ? String(cur.matched_entry_id) : null
      return (cur?.match_status ?? 'unmatched') !== p.match_status || curEntry !== (p.matched_entry_id ?? null)
    })

    const tally = (rows: { match_status: string }[]) => {
      const t = { auto: 0, exception: 0, unmatched: 0, confirmed: 0 } as Record<string, number>
      for (const r of rows) t[r.match_status] = (t[r.match_status] || 0) + 1
      return t
    }
    const confirmedCount = bankTxns.filter(b => b.match_status === 'confirmed').length
    const proposed_tally = { ...tally(proposals), confirmed: confirmedCount }

    // Compact, human-readable preview of the proposals (sorted: changed first).
    const preview = proposals.map(p => ({
      bank_tx: p.bank_tx,
      who: nameById.get(p.bank_tx) || null,
      amount: Number(curById.get(p.bank_tx)?.amount) || 0,
      status: p.match_status,
      matched_entry_id: p.matched_entry_id,
      confidence: p.match_confidence,
      reason: p.reason,
      changed: changes.some(c => c.bank_tx === p.bank_tx),
    }))

    if (!commit) {
      return NextResponse.json({
        ok: true, community_id: communityId, dryRun: true,
        bank_transactions: bankTxns.length, gl_cash_entries: entries.length,
        confirmed_locked: confirmedCount,
        proposed: proposed_tally,
        would_change: changes.length,
        tolerance: toleranceCents, window_days: windowDays,
        preview,
      })
    }

    // ---- Commit: write only the changed, non-confirmed rows ----
    const matchedAt = new Date().toISOString()
    const writeErrors: string[] = []
    let written = 0
    for (const p of changes) {
      const { error } = await admin
        .from('bank_transactions')
        .update({
          match_status: p.match_status,
          matched_entry_id: p.matched_entry_id,
          match_confidence: p.match_confidence,
          matched_at: matchedAt,
          matched_by: null, // machine match
        })
        .eq('id', p.bank_tx)
        .eq('community_id', communityId)
        .neq('match_status', 'confirmed') // belt-and-suspenders: never overwrite a human confirm
      if (error) writeErrors.push(`${p.bank_tx}: ${error.message}`)
      else written += 1
    }

    return NextResponse.json({
      ok: writeErrors.length === 0,
      community_id: communityId, dryRun: false, committed: true,
      bank_transactions: bankTxns.length, gl_cash_entries: entries.length,
      confirmed_locked: confirmedCount,
      proposed: proposed_tally,
      rows_changed: changes.length, rows_written: written,
      write_errors: writeErrors.length ? writeErrors : undefined,
      tolerance: toleranceCents, window_days: windowDays,
    }, { status: writeErrors.length ? 207 : 200 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'reconcile failed' }, { status: 500 })
  }
}

// GET is structurally incapable of writing — always a dry run.
export async function GET(req: Request) { return handle(req, false) }
// POST honors ?commit=1 / {"commit":true}; otherwise also dry-runs.
export async function POST(req: Request) { return handle(req, true) }
