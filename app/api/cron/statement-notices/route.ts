// Monthly owner-statement notice — invoked DAILY by Vercel Cron (see vercel.json).
// Each community fires on the day AFTER its own payment cutoff (the resolved
// assessment_due_day), so the statement reflects the final paid/unpaid status
// for that cycle rather than going out before anyone's had a chance to pay.
//
// Statements themselves are derived on demand from each owner's ledger
// (lib/statements) and already carry the community name; this job is the "push"
// half: for the communities whose cutoff was YESTERDAY, it drops one in-app bell
// notice per resident with an app account, linking to their Statements list
// (noticeHref('statement_ready') -> /app/track#statements).
//
// channels=[] so the generic ev_notice_fanout skips it; we insert one recipient
// row (the owner) per notice. One notice per resident per cycle (idempotent on
// the month-specific subject), so a re-run or a late run never double-sends.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// Env: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, and a Supabase URL.
// Requires the 'statement_ready' notice kind — run supabase/statement-notices.sql.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveDueDay } from '@/lib/dues'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  // Optional ?community=<id> restricts the run to a single community (targeted
  // sends / safe local testing without blasting every community).
  const communityParam = new URL(req.url).searchParams.get('community')
  // A deployed run ALWAYS requires the Bearer CRON_SECRET. As a dev convenience,
  // from localhost we allow: any DRY RUN, and a REAL run only when scoped to a
  // single ?community (so a local test can't blast every community by accident).
  const host = new URL(req.url).hostname
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  const authed = !!secret && auth === `Bearer ${secret}`
  if (!authed) {
    if (!isLocal || (!dryRun && !communityParam)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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

  // Optional ?asOf=YYYY-MM-DD to simulate a run on another date (testing). Noon
  // UTC keeps the date stable across the day-subtraction below.
  const asOfParam = new URL(req.url).searchParams.get('asOf')
  const now = asOfParam ? new Date(`${asOfParam}T12:00:00Z`) : new Date()

  // We fire the day AFTER a community's cutoff, so "yesterday" (UTC) is the cutoff
  // day we're matching, and its month is the cycle the statement covers.
  const yest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  const cutoffY = yest.getUTCFullYear()
  const cutoffM = yest.getUTCMonth()
  const cutoffD = yest.getUTCDate()
  const monthLabel = yest.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const subject = `${monthLabel} statement ready`
  const body = `Your ${monthLabel} statement is ready. Open Easy Track to view or download it.`

  // Which communities had their payment cutoff YESTERDAY? assessment_due_day is
  // 1–28 literal or 29+ = last day of month (resolveDueDay handles both).
  const { data: communities, error: cErr } = await admin
    .from('communities')
    .select('id, name, assessment_due_day')
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const scoped = (communities ?? []).filter(c => !communityParam || c.id === communityParam)
  const firingIds = scoped
    .filter(c => resolveDueDay((c as any).assessment_due_day, cutoffY, cutoffM) === cutoffD)
    .map(c => c.id)

  // On a dry run, surface every (scoped) community's name + resolved cutoff day
  // so it's clear which date would fire it.
  const debugCutoffs = dryRun
    ? scoped.map(c => ({ id: c.id, name: (c as any).name, resolvedCutoffDay: resolveDueDay((c as any).assessment_due_day, cutoffY, cutoffM) }))
    : undefined

  if (firingIds.length === 0) {
    return NextResponse.json({ ok: true, dryRun, month: monthLabel, cutoffDay: cutoffD, totalNotified: 0, note: 'no community cutoff yesterday', ...(debugCutoffs ? { communityCutoffs: debugCutoffs } : {}) })
  }

  // Residents (with an app account) in the communities firing today — each owner's
  // own statement renders from their own ledger when they open the list.
  const { data: residents, error } = await admin
    .from('residents')
    .select('id, community_id, profile_id')
    .in('community_id', firingIds)
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

  return NextResponse.json({ ok: true, dryRun, month: monthLabel, cutoffDay: cutoffD, communitiesFiring: firingIds.length, totalNotified, residents: summary })
}
