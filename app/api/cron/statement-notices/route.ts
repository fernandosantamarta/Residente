// Monthly owner-statement notice — invoked by Vercel Cron (see vercel.json) on
// the 1st of each month. Statements themselves are derived on demand from each
// owner's ledger (lib/statements) and already carry the community name; this job
// is the "push" half: it drops one in-app bell notice per resident with an app
// account, telling them last month's statement is ready and linking to their
// Statements list (noticeHref('statement_ready') -> /app/track#statements).
//
// channels=[] so the generic ev_notice_fanout skips it; we insert one recipient
// row (the owner) per notice. One notice per resident per month (idempotent on
// the month-specific subject), so a re-run or a late run never double-sends.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// Env: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, and a Supabase URL.
// Requires the 'statement_ready' notice kind — run supabase/statement-notices.sql.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    'https://nozzfcxijdnllkiydhfi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'

  // The statement that just closed: on the 1st of month M, that's month M-1.
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const monthLabel = lastMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const subject = `${monthLabel} statement ready`
  const body = `Your ${monthLabel} statement is ready. Open Easy Track to view or download it.`

  // Every resident with an app account (a linked profile) gets a notice — their
  // own statement renders from their own ledger when they open the list.
  const { data: residents, error } = await admin
    .from('residents')
    .select('id, community_id, profile_id')
    .not('profile_id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const summary: Array<Record<string, unknown>> = []
  let totalNotified = 0

  for (const r of residents ?? []) {
    if (!r.community_id || !r.profile_id) { summary.push({ resident: r.id, skipped: 'no community/profile' }); continue }
    if (dryRun) { summary.push({ resident: r.id, wouldNotify: r.profile_id }); continue }

    // Idempotency: one statement notice per owner per month (match the
    // month-specific subject, so next month is a fresh send).
    const { data: existing } = await admin
      .from('ev_notices')
      .select('id, ev_notice_recipients!inner(profile_id)')
      .eq('community_id', r.community_id)
      .eq('kind', 'statement_ready')
      .eq('subject', subject)
      .eq('ev_notice_recipients.profile_id', r.profile_id)
      .limit(1)
    if (existing?.length) { summary.push({ resident: r.id, skipped: 'already sent' }); continue }

    const { data: notice, error: nErr } = await admin
      .from('ev_notices')
      .insert({
        community_id: r.community_id,
        kind: 'statement_ready',
        channels: [],
        subject,
        body,
        sent_by: null,
      })
      .select('id')
      .single()
    if (nErr || !notice) { summary.push({ resident: r.id, error: nErr?.message }); continue }

    const { error: rErr } = await admin.from('ev_notice_recipients').insert({
      notice_id: notice.id,
      community_id: r.community_id,
      profile_id: r.profile_id,
      channel: 'in_app',
    })
    if (rErr) { summary.push({ resident: r.id, error: rErr.message }); continue }

    totalNotified += 1
    summary.push({ resident: r.id, notified: r.profile_id })
  }

  return NextResponse.json({ ok: true, dryRun, month: monthLabel, totalNotified, residents: summary })
}
