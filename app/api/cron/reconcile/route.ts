// Auto-reconcile — the scheduled job that makes the bank-reconciliation queue
// fill itself. Invoked by Vercel Cron (see vercel.json). For every community
// that has linked its bank (plaid_status='active') it runs the chain the master
// plan calls for: Plaid sync → GL rebuild → reconcile, each guarded per community
// so one bad community can't abort the batch. It NEVER moves money.
//
// WHY chain all three: bank_transactions must be fresh (Plaid), the GL must be
// current (rebuild) so the matcher compares against today's books, and only then
// does reconcile propose matches. The three building blocks already exist and are
// money-critical; rather than re-implement (and risk drift) we drive the EXACT,
// already-shipped logic:
//   • Plaid sync   — the plaid-sync-transactions edge function's cron mode
//                    (x-cron-secret → syncs every plaid-active community in one call).
//   • GL rebuild   — POST /api/admin/gl/rebuild?community_id&commit=1 (per community).
//   • Reconcile    — POST /api/admin/reconcile?community_id&commit=1 (per community).
// All three are CRON_SECRET-gated + service-role + idempotent + fail-closed, so a
// re-run is safe and a transient error just leaves that community for next tick.
//
// SCOPE: only plaid-active communities (the ones actually using the bank feed) get
// the auto rebuild+reconcile — never a blanket fleet rebuild of every community.
//
// SAFETY: ?dryRun=1 previews the whole chain without writing (Plaid sync is skipped,
// rebuild + reconcile run in dry-run). ?community_id=<uuid> limits to one community.
// If a community's GL rebuild doesn't tie out / errors, we record it and SKIP its
// reconcile (don't reconcile against books we just flagged as inconsistent).
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// Env (Vercel): CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, a Supabase URL.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = () =>
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  'https://nozzfcxijdnllkiydhfi.supabase.co'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }
  const admin = createClient(supabaseUrl(), key, { auth: { persistSession: false } })

  const u = new URL(req.url)
  const dryRun = u.searchParams.get('dryRun') === '1'
  const onlyCommunity = u.searchParams.get('community_id') || null
  const origin = u.origin // this deployment — used to drive the existing admin routes

  // ---- 1) Plaid sync (fleet) — refresh the bank feed before matching ----
  // Tolerant: a Plaid outage shouldn't stop us reconciling existing data. Skipped
  // on a dry run (it's a real external write to bank_transactions).
  let plaidSync: any = dryRun ? { skipped: 'dryRun' } : null
  if (!dryRun) {
    try {
      const r = await fetch(`${supabaseUrl()}/functions/v1/plaid-sync-transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': secret,
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: '{}',
      })
      plaidSync = await r.json().catch(() => ({ status: r.status }))
    } catch (e: any) {
      plaidSync = { error: e?.message || 'plaid sync failed' }
    }
  }

  // ---- 2) Target set: communities that have linked their bank ----
  let targets: string[] = []
  if (onlyCommunity) {
    targets = [onlyCommunity]
  } else {
    const { data: comms, error } = await admin
      .from('communities')
      .select('id')
      .eq('plaid_status', 'active')
    if (error) {
      return NextResponse.json({ error: `communities query failed: ${error.message}`, plaid_sync: plaidSync }, { status: 500 })
    }
    targets = (comms ?? []).map((c: any) => String(c.id))
  }

  // Drive an existing CRON_SECRET-gated admin route for one community.
  const drive = async (path: string) => {
    const commit = dryRun ? '' : '&commit=1'
    const r = await fetch(`${origin}${path}${commit}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    })
    const body = await r.json().catch(() => ({}))
    return { status: r.status, ...body }
  }

  // ---- 3) Per community (guarded): rebuild GL, then reconcile ----
  const results: Array<Record<string, unknown>> = []
  let reconciled = 0
  for (const id of targets) {
    try {
      const rebuild = await drive(`/api/admin/gl/rebuild?community_id=${id}`)
      // Only reconcile against books we just confirmed tie out. A hard error
      // (5xx) or a tie-out failure (ok:false) means don't trust the ledger now.
      if (rebuild?.ok === false || (rebuild?.status && Number(rebuild.status) >= 500)) {
        results.push({ community_id: id, rebuild, reconcile: { skipped: 'rebuild not ok' } })
        continue
      }
      const reconcile = await drive(`/api/admin/reconcile?community_id=${id}`)
      if (reconcile?.ok !== false) reconciled += 1
      results.push({
        community_id: id,
        rebuild: { ok: rebuild?.ok, entries: rebuild?.entries, ties_out: rebuild?.ties_out },
        reconcile: dryRun
          ? { proposed: reconcile?.proposed, would_change: reconcile?.would_change }
          : { proposed: reconcile?.proposed, rows_changed: reconcile?.rows_changed, rows_written: reconcile?.rows_written },
      })
    } catch (e: any) {
      results.push({ community_id: id, error: e?.message || 'failed' })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    plaid_sync: plaidSync,
    communities_processed: targets.length,
    reconciled,
    results,
  })
}
