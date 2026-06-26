// Auto-generate monthly dues charges — invoked by Vercel Cron (see vercel.json,
// schedule '0 0 1 * *': 00:00 UTC on the 1st of each month).
//
// For every community with a positive monthly_dues, this mints ONE
// ev_monthly_charges row per active household for the CURRENT billing month, at
// the community's monthly_dues amount, due on its assessment_due_day. Writes are
// idempotent: a unique index on (community_id, resident_id, billing_period_start)
// plus ON CONFLICT DO NOTHING means re-running (or a double-fire) never
// double-mints. "Active" = approval_state IS DISTINCT FROM 'pending' (approved or
// legacy null); pending/rejected applicants are skipped.
//
// ⚠ AUDIT LEDGER ONLY. The app's resident balance stays FORMULA-based in
// lib/dues.ts; this table is intentionally NOT read by residentBalance(), so it
// can't double-count. See supabase/monthly-charges.sql.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
// is set. We reject anything else, so the endpoint can't be triggered publicly.
//
// Env required (Vercel project settings):
//   CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, and a Supabase URL
//   (SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveDueDay } from '@/lib/dues'

export const dynamic = 'force-dynamic'

// YYYY-MM-DD for a UTC date — the cron runs at 00:00 UTC, so plain UTC math
// keeps the billing period unambiguous regardless of the runner's locale.
const ymd = (d: Date): string => d.toISOString().slice(0, 10)

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Match lib/supabase / dues-reminders URL resolution: prod may set the URL
  // under the legacy REACT_APP_ name. The project URL is public (it ships in the
  // client bundle), so a hardcoded fallback is safe — unlike the service-role KEY.
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    'https://nozzfcxijdnllkiydhfi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' },
      { status: 500 },
    )
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  // ?dryRun=1 — report what WOULD be minted and prove the service-role key
  // works, without writing a single charge row.
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'

  try {
    // Current billing period (UTC). period_start = first of this month;
    // period_end = last day of this month; due_date = period_start + (due_day-1).
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    const periodStart = new Date(Date.UTC(y, m, 1))
    const periodEnd = new Date(Date.UTC(y, m + 1, 0)) // day 0 of next month = last day of this month
    const periodStartStr = ymd(periodStart)
    const periodEndStr = ymd(periodEnd)

    const { data: comms, error: cErr } = await admin
      .from('communities')
      .select('id, monthly_dues, assessment_due_day')
      .not('monthly_dues', 'is', null)
      .gt('monthly_dues', 0)
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

    let minted = 0
    let skipped = 0
    const summary: Array<Record<string, unknown>> = []

    for (const c of comms ?? []) {
      const amount = Number(c.monthly_dues) || 0
      if (amount <= 0) continue

      // Resolve the due day for this billing month (1–28, or the last day of the
      // month when set to the "last day" sentinel).
      const dueDay = resolveDueDay(c.assessment_due_day, y, m)
      const dueDate = ymd(new Date(Date.UTC(y, m, dueDay)))

      // Active households only: approved or legacy-null. Pending/rejected skip.
      const { data: residents, error: rErr } = await admin
        .from('residents')
        .select('id')
        .eq('community_id', c.id)
        .or('approval_state.is.null,approval_state.neq.pending')
      if (rErr) { summary.push({ community: c.id, error: rErr.message }); continue }
      if (!residents?.length) { summary.push({ community: c.id, minted: 0 }); continue }

      if (dryRun) {
        summary.push({ community: c.id, wouldMint: residents.length })
        continue
      }

      // One INSERT ... ON CONFLICT DO NOTHING per community: atomic idempotency
      // via ev_monthly_charges_idem. ignoreDuplicates returns only the rows
      // actually inserted, so its length is the freshly-minted count.
      const rows = residents.map((r) => ({
        community_id: c.id,
        resident_id: r.id,
        billing_period_start: periodStartStr,
        billing_period_end: periodEndStr,
        due_date: dueDate,
        amount,
        status: 'pending',
      }))
      const { data: ins, error: iErr } = await admin
        .from('ev_monthly_charges')
        .upsert(rows, { onConflict: 'community_id,resident_id,billing_period_start', ignoreDuplicates: true })
        .select('id')
      if (iErr) { summary.push({ community: c.id, error: iErr.message }); continue }

      const mintedHere = ins?.length ?? 0
      const skippedHere = residents.length - mintedHere
      minted += mintedHere
      skipped += skippedHere
      summary.push({ community: c.id, minted: mintedHere, skipped: skippedHere })
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      billingPeriod: { start: periodStartStr, end: periodEndStr },
      communities: (comms ?? []).length,
      minted,
      skipped,
      detail: summary,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'charge run failed' }, { status: 500 })
  }
}
