// Monthly dues reminder — invoked by Vercel Cron (see vercel.json).
//
// Scans every community's balances and drops a 'dues_due' bell notice for any
// resident who is behind AND has an app account (residents.profile_id). The
// notice goes out with channels=[] so the generic ev_notice_fanout skips it;
// we insert recipient rows only for the owing residents — not the whole
// community. The Home dot already surfaces "pay" off the live balance; this
// adds the explicit bell entry + history.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the
// CRON_SECRET env var is set. We reject anything else, so the endpoint can't
// be triggered by the public.
//
// Env required (Vercel project settings):
//   CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, and a Supabase URL
//   (SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { residentBalance, duesStatus } from '@/lib/dues'

export const dynamic = 'force-dynamic'

// Don't re-notify a community more than once per ~month, even if the cron
// double-fires or the schedule changes.
const RECENT_DAYS = 25

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Match lib/supabase's URL resolution: prod sets the URL under the legacy
  // REACT_APP_ name (or relies on the project fallback), not SUPABASE_URL /
  // NEXT_PUBLIC_. The project URL is public (it ships in the client bundle and
  // package.json), so a hardcoded fallback is safe — unlike the service-role
  // KEY, which stays in env only.
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

  // ?dryRun=1 — compute who WOULD be reminded and prove the service-role key
  // works, without inserting any notices or pinging a single resident.
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'

  const { data: comms, error: cErr } = await admin
    .from('communities')
    .select('id, monthly_dues, late_interest_rate')
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const sinceISO = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const summary: Array<Record<string, unknown>> = []
  let totalNotified = 0

  for (const c of comms ?? []) {
    const monthlyDues = Number(c.monthly_dues) || 0
    const rate = Number(c.late_interest_rate) || 0

    // Only residents with a linked app account can receive an in-app notice.
    const { data: residents } = await admin
      .from('residents')
      .select('id, profile_id, opening_balance, created_at')
      .eq('community_id', c.id)
      .not('profile_id', 'is', null)
    if (!residents?.length) continue

    const { data: pays } = await admin
      .from('payments')
      .select('resident_id, amount')
      .eq('community_id', c.id)
    const payByResident: Record<string, { amount: number }[]> = {}
    for (const p of pays ?? []) {
      (payByResident[p.resident_id] ||= []).push({ amount: Number(p.amount) || 0 })
    }

    const owing = residents.filter((r) => {
      const bal = residentBalance(r, monthlyDues, payByResident[r.id] || [], rate)
      return duesStatus(bal, monthlyDues) !== 'paid'
    })
    if (!owing.length) { summary.push({ community: c.id, owing: 0 }); continue }

    // Dry run: report the count, touch nothing.
    if (dryRun) { summary.push({ community: c.id, wouldNotify: owing.length }); continue }

    // Idempotency: skip if this community already got a dues reminder recently.
    const { data: recent } = await admin
      .from('ev_notices')
      .select('id')
      .eq('community_id', c.id)
      .eq('kind', 'dues_due')
      .gte('sent_at', sinceISO)
      .limit(1)
    if (recent?.length) { summary.push({ community: c.id, skipped: 'recent' }); continue }

    const { data: notice, error: nErr } = await admin
      .from('ev_notices')
      .insert({
        community_id: c.id,
        kind: 'dues_due',
        channels: [],                       // empty → generic fanout skips it
        subject: 'Your HOA dues are due',
        body: 'You have a balance on your account. Open Easy Track to review and pay.',
        sent_by: null,
      })
      .select('id')
      .single()
    if (nErr || !notice) { summary.push({ community: c.id, error: nErr?.message }); continue }

    const rows = owing.map((r) => ({
      notice_id: notice.id,
      community_id: c.id,
      profile_id: r.profile_id,
      channel: 'in_app',
    }))
    const { error: rErr } = await admin.from('ev_notice_recipients').insert(rows)
    if (rErr) { summary.push({ community: c.id, error: rErr.message }); continue }

    totalNotified += rows.length
    summary.push({ community: c.id, notified: rows.length })
  }

  return NextResponse.json({ ok: true, dryRun, totalNotified, communities: summary })
}
