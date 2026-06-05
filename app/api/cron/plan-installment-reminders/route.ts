// Payment-plan installment reminder — invoked by Vercel Cron (see vercel.json).
//
// For every approved plan that did NOT opt into autopay and has an installment
// due within ~3 days (or past due), drop a 'collections_update' bell notice to
// the owner. channels=[] so the generic ev_notice_fanout skips it; we insert a
// single recipient row for the owner. Autopay plans are charged by
// charge-plan-installment instead, so they're excluded here.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// Env: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, and a Supabase URL.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// One reminder per plan per ~cycle. Shorter than the 30-day default frequency so
// each cycle gets exactly one nudge even though the cron runs daily.
const RECENT_DAYS = 20
const REMINDER_SUBJECT = 'Payment plan installment due'

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

  const today = new Date()
  const horizon = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const sinceISO = new Date(today.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Approved, manual-pay (non-autopay) plans with an installment due soon/overdue
  // and an owner who has an app account to notify.
  const { data: plans, error } = await admin
    .from('ev_payment_plans')
    .select('id, community_id, profile_id, next_due_at, installment_amount, request_status, status, autopay_opt_in')
    .eq('status', 'active')
    .eq('autopay_opt_in', false)
    .in('request_status', ['approved', 'modified'])
    .not('profile_id', 'is', null)
    .not('next_due_at', 'is', null)
    .lte('next_due_at', horizon)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const summary: Array<Record<string, unknown>> = []
  let totalNotified = 0

  for (const p of plans ?? []) {
    if (dryRun) { summary.push({ plan: p.id, wouldNotify: p.profile_id }); continue }

    // Idempotency: skip if this owner already got a plan reminder recently.
    const { data: recent } = await admin
      .from('ev_notices')
      .select('id, ev_notice_recipients!inner(profile_id)')
      .eq('community_id', p.community_id)
      .eq('kind', 'collections_update')
      .eq('subject', REMINDER_SUBJECT)
      .eq('ev_notice_recipients.profile_id', p.profile_id)
      .gte('sent_at', sinceISO)
      .limit(1)
    if (recent?.length) { summary.push({ plan: p.id, skipped: 'recent' }); continue }

    const { data: notice, error: nErr } = await admin
      .from('ev_notices')
      .insert({
        community_id: p.community_id,
        kind: 'collections_update',
        channels: [],
        subject: REMINDER_SUBJECT,
        body: 'Your next payment-plan installment is coming up. Open Easy Track to pay it.',
        sent_by: null,
      })
      .select('id')
      .single()
    if (nErr || !notice) { summary.push({ plan: p.id, error: nErr?.message }); continue }

    const { error: rErr } = await admin.from('ev_notice_recipients').insert({
      notice_id: notice.id,
      community_id: p.community_id,
      profile_id: p.profile_id,
      channel: 'in_app',
    })
    if (rErr) { summary.push({ plan: p.id, error: rErr.message }); continue }

    totalNotified += 1
    summary.push({ plan: p.id, notified: p.profile_id })
  }

  return NextResponse.json({ ok: true, dryRun, totalNotified, plans: summary })
}
