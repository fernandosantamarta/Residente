// GL rebuild — persists the regenerable general-ledger projection for ONE
// community. Service-role only, gated by CRON_SECRET (same posture as the
// /api/cron/* jobs). Not on a Vercel cron schedule: this is an on-demand
// backfill/rebuild you invoke per community, dry-run first.
//
// WHY a Next route (and not a Deno edge function): the privileged jobs in this
// app are already Next API routes that createClient(service-role) and import the
// canonical logic straight from @/lib (see app/api/cron/dues-reminders). That
// lets this route reuse the REAL buildLedger() from @/lib/gl/project — zero
// drift from what `npm run verify:gl` proves — with no second runtime and no
// re-port of the builder. The *atomic persist + tie-out guard* lives in one
// Postgres transaction (the gl_rebuild_community RPC in supabase/gl-writer.sql);
// this route just computes the entries + the expected Σ residentBalance and hands
// them over. See [[eliminate-back-office-plan]].
//
// SAFETY:
//   • GET  is ALWAYS a dry run — you can never write the ledger with a GET.
//   • POST writes only with ?commit=1 (or JSON body {"commit":true}); otherwise
//     it also dry-runs. Defaulting to dry-run honors "dry-run first".
//   • community_id is REQUIRED. There is no fleet-wide path — backfill is one
//     community at a time, per the plan ("never a blanket fleet rebuild").
//   • The RPC re-verifies the tie-out from the persisted rows and rolls the whole
//     rebuild back on any mismatch, so a wrong number here cannot be committed.
//
// Env (Vercel project settings): CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, and a
// Supabase URL (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / REACT_APP_SUPABASE_URL).
//
// Invoke:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "$BASE/api/admin/gl/rebuild?community_id=<uuid>"           # dry run
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "$BASE/api/admin/gl/rebuild?community_id=<uuid>&commit=1"  # write

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { buildLedger, trialBalance } from '@/lib/gl/project'
import { residentBalance, communityDuesConfig } from '@/lib/dues'

export const dynamic = 'force-dynamic'

const round2 = (x: number) => Math.round((Number(x) || 0) * 100) / 100

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
    return NextResponse.json({ error: 'community_id is required (no fleet-wide rebuild)' }, { status: 400 })
  }
  const commit = allowCommit && (u.searchParams.get('commit') === '1' || body.commit === true)

  try {
    // ---- Load source events (the same tables the live statements read) ----
    const [{ data: community, error: cErr }, residentsR, paymentsR, expensesR, violationsR, reservesR] =
      await Promise.all([
        admin.from('communities').select('*').eq('id', communityId).single(),
        admin.from('residents').select('id, created_at, opening_balance').eq('community_id', communityId),
        admin.from('payments').select('id, resident_id, amount, paid_on').eq('community_id', communityId),
        admin.from('ev_expenses').select('id, amount, spent_on, category_id').eq('community_id', communityId),
        admin.from('ev_violations').select('id, amount, status, resolution, closed_at').eq('community_id', communityId),
        admin.from('ev_reserve_components').select('id, current_balance, created_at').eq('community_id', communityId),
      ])
    if (cErr || !community) {
      return NextResponse.json({ error: `community not found: ${cErr?.message || communityId}` }, { status: 404 })
    }
    // Fail CLOSED on any source-query error. A partial load (e.g. payments=[] from a
    // transient/RLS error) would still pass every tie-out guard — both sides of the
    // check consume the same empty set — and then the RPC's orphan-GC would wipe the
    // now-"absent" entries. Never project from an incomplete source read.
    const srcErr =
      residentsR.error || paymentsR.error || expensesR.error || violationsR.error || reservesR.error
    if (srcErr) {
      return NextResponse.json({ error: `source load failed: ${srcErr.message}` }, { status: 502 })
    }
    const residents = residentsR.data || []
    const payments = paymentsR.data || []

    // ---- Project (reuse the canonical, verify:gl-proven builder) ----
    // Pin ONE instant so the builder's monthly accrual and the residentBalance
    // tie-out below cannot straddle a calendar-month boundary (deterministic check).
    const asOf = new Date()
    const entries = buildLedger({
      community,
      residents,
      payments,
      expenses: expensesR.data || [],
      violations: violationsR.data || [],
      reserveComponents: reservesR.data || [],
      asOf,
    })

    // ---- Expected tie-out: Σ residentBalance() over the roster (NOT clamped to
    //      positives — the GL's 1100 net carries prepaid credits as negatives). ----
    const cfg = communityDuesConfig(community)
    const monthly = Number((community as any).monthly_dues) || 0
    const paysBy = new Map<string, any[]>()
    for (const p of payments) {
      const rid = p.resident_id ? String(p.resident_id) : null
      if (!rid) continue
      if (!paysBy.has(rid)) paysBy.set(rid, [])
      paysBy.get(rid)!.push(p)
    }
    let expectedAr = 0
    for (const res of residents) {
      expectedAr += residentBalance(res as any, monthly, (paysBy.get(String(res.id)) || []) as any, cfg, asOf)
    }
    expectedAr = round2(expectedAr)

    // ---- Trial balance (for the response) + a JS tie-out pre-check ----
    const tb = trialBalance(entries)
    const ar1100 = tb.find((r) => r.account === '1100' && r.fund === 'operating')
    const arNet = round2(ar1100 ? ar1100.balance : 0)
    const tiesOut = round2(arNet - expectedAr) === 0

    if (!tiesOut) {
      // Don't even ask the DB to write a ledger that doesn't tie out locally.
      return NextResponse.json({
        ok: false,
        community_id: communityId,
        dryRun: !commit,
        error: 'local tie-out FAILED',
        operating_ar_net: arNet,
        expected_ar: expectedAr,
        entries: entries.length,
        trial_balance: tb,
      }, { status: 422 })
    }

    // ---- Hand the entries to the atomic persist RPC ----
    const { data: rpc, error: rErr } = await admin.rpc('gl_rebuild_community', {
      p_community: communityId,
      p_entries: entries,
      p_expected_ar: expectedAr,
      p_dry_run: !commit,
    })
    if (rErr) {
      return NextResponse.json({
        ok: false, community_id: communityId, dryRun: !commit,
        error: rErr.message, operating_ar_net: arNet, expected_ar: expectedAr,
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      community_id: communityId,
      community: (community as any).name || null,
      dryRun: !commit,
      committed: !!commit,
      entries: entries.length,
      operating_ar_net: arNet,
      expected_ar: expectedAr,
      ties_out: tiesOut,
      counts: {
        residents: residents.length,
        payments: payments.length,
        expenses: (expensesR.data || []).length,
        violations: (violationsR.data || []).length,
        reserve_components: (reservesR.data || []).length,
      },
      rpc,
      trial_balance: tb,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'rebuild failed' }, { status: 500 })
  }
}

// GET is structurally incapable of writing — always a dry run.
export async function GET(req: Request) { return handle(req, false) }
// POST honors ?commit=1 / {"commit":true}; otherwise also dry-runs.
export async function POST(req: Request) { return handle(req, true) }
