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
import { residentBalance, duesStatus, daysPastDue, communityDuesConfig } from '@/lib/dues'

export const dynamic = 'force-dynamic'

// Default re-notify window when a community hasn't set its own cadence.
const DEFAULT_CADENCE_DAYS = 25

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

  // select('*') so the dues config (interest_apr / late_fee_* if present, else
  // the legacy late_interest_rate fallback) resolves whether or not the
  // compliance-foundation migration has run yet. communities is a tiny table.
  const { data: comms, error: cErr } = await admin
    .from('communities')
    .select('*')
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const summary: Array<Record<string, unknown>> = []
  let totalNotified = 0

  for (const c of comms ?? []) {
    // Opt-out: a community can disable auto-reminders entirely.
    if (c.dues_reminder_enabled === false) { summary.push({ community: c.id, skipped: 'disabled' }); continue }
    const monthlyDues = Number(c.monthly_dues) || 0
    const duesCfg = communityDuesConfig(c)
    const minDays = Math.max(0, Number(c.dues_reminder_min_days) || 0)
    const cadenceDays = Math.max(1, Number(c.dues_reminder_cadence_days) || DEFAULT_CADENCE_DAYS)
    const wantEmail = c.dues_reminder_email === true
    const sinceISO = new Date(Date.now() - cadenceDays * 24 * 60 * 60 * 1000).toISOString()

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
      const bal = residentBalance(r, monthlyDues, payByResident[r.id] || [], duesCfg)
      if (duesStatus(bal, monthlyDues) === 'paid') return false
      // Days-past-due threshold (0 = anyone behind).
      if (minDays > 0) {
        const dpd = daysPastDue(r, monthlyDues, payByResident[r.id] || [], { dueDay: Number(c.assessment_due_day) || 1 })
        if (dpd < minDays) return false
      }
      return true
    })
    if (!owing.length) { summary.push({ community: c.id, owing: 0 }); continue }

    // Dry run: report the count, touch nothing.
    if (dryRun) { summary.push({ community: c.id, wouldNotify: owing.length, email: wantEmail }); continue }

    // Idempotency: skip if this community already got a dues reminder within its cadence window.
    const { data: recent } = await admin
      .from('ev_notices')
      .select('id')
      .eq('community_id', c.id)
      .eq('kind', 'dues_due')
      .gte('sent_at', sinceISO)
      .limit(1)
    if (recent?.length) { summary.push({ community: c.id, skipped: 'recent' }); continue }

    const subject = 'Your HOA dues are due'
    const body = 'You have a balance on your account. Open Easy Track to review and pay.'

    if (wantEmail) {
      // Email path: one TARGETED notice per owing owner (target_profile_id +
      // email channel) so the notice fanout emails only that owner — the same
      // path the Reports "Notify" button uses. in_app is included too.
      let n = 0
      for (const r of owing) {
        const { error: nErr } = await admin.from('ev_notices').insert({
          community_id: c.id,
          kind: 'dues_due',
          channels: ['in_app', 'email'],
          target_profile_id: r.profile_id,
          subject, body, sent_by: null,
        })
        if (!nErr) n++
      }
      totalNotified += n
      summary.push({ community: c.id, notified: n, email: true })
      continue
    }

    // In-app only (default): ONE notice + manual recipient rows for the owing
    // owners (channels:[] → the broadcast fanout skips it).
    const { data: notice, error: nErr } = await admin
      .from('ev_notices')
      .insert({ community_id: c.id, kind: 'dues_due', channels: [], subject, body, sent_by: null })
      .select('id')
      .single()
    if (nErr || !notice) { summary.push({ community: c.id, error: nErr?.message }); continue }

    const rows = owing.map((r) => ({ notice_id: notice.id, community_id: c.id, profile_id: r.profile_id, channel: 'in_app' }))
    const { error: rErr } = await admin.from('ev_notice_recipients').insert(rows)
    if (rErr) { summary.push({ community: c.id, error: rErr.message }); continue }

    totalNotified += rows.length
    summary.push({ community: c.id, notified: rows.length })
  }

  return NextResponse.json({ ok: true, dryRun, totalNotified, communities: summary })
}
