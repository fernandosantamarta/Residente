// Trial reminder emails — invoked daily by Vercel Cron (see vercel.json).
//
// Every new community gets 3 months free (subscription_status 'trial'); billing
// only starts once they add payment. Boards meet monthly and need lead time to
// approve the spend, so we email them BEFORE the free months end (21 / 7 / 1
// days out) and once on the day it ends. The in-app TrialBanner only nudges on
// login; this reaches the board even when they are not in the app.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Anything else 401s.
// Env (Vercel): CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, a Supabase URL,
//   RESEND_API_KEY, and optionally NOTIFY_FROM + APP_URL.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { FREE_TRIAL_DAYS } from '@/lib/trial'

export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000
const FROM = process.env.NOTIFY_FROM || 'Residente <onboarding@resend.dev>'
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://residente.io'

// Reminder milestones, keyed by exact whole-days-left. The daily cron makes
// each fire on exactly one day, so no per-community sent-tracking is needed.
function milestone(daysLeft: number): { subject: string; lead: string } | null {
  if (daysLeft === 21) return { subject: 'Your free Residente months end in 3 weeks', lead: 'about 3 weeks away' }
  if (daysLeft === 7)  return { subject: 'One week left on your free Residente months', lead: 'one week away' }
  if (daysLeft === 1)  return { subject: 'Your free Residente months end tomorrow', lead: 'tomorrow' }
  return null
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function emailHtml(name: string, body: string) {
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1F2233">
    <div style="font-size:13px;font-weight:800;letter-spacing:1.2px;color:#E14909">RESIDENTE</div>
    <h1 style="font-size:22px;margin:12px 0 14px">${name}</h1>
    <p style="font-size:15px;line-height:1.5;color:#5C5747;margin:0 0 22px">${body}</p>
    <a href="${APP_URL}/admin/billing" style="display:inline-block;background:#E14909;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:700;font-size:15px">Add payment</a>
    <p style="font-size:12px;color:#9a8f80;margin:26px 0 0">Your community and all its data are safe. Cancel anytime.</p>
  </div>`
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL || 'https://nozzfcxijdnllkiydhfi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  const resendKey = process.env.RESEND_API_KEY
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'

  const { data: comms, error } = await admin
    .from('communities')
    .select('id, name, created_at, subscription_status')
    .eq('subscription_status', 'trial')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = Date.now()
  const summary: Array<Record<string, unknown>> = []
  let sent = 0

  for (const c of comms ?? []) {
    const created = c.created_at ? new Date(c.created_at).getTime() : now
    const endsAt = new Date(created + FREE_TRIAL_DAYS * DAY)
    const msLeft = endsAt.getTime() - now
    const daysLeft = Math.ceil(msLeft / DAY)

    const expiredToday = msLeft <= 0 && msLeft > -DAY
    const m = expiredToday
      ? { subject: 'Your free Residente months have ended', lead: 'over' }
      : milestone(daysLeft)
    if (!m) continue

    const body = expiredToday
      ? `Your 3 free months for ${c.name || 'your community'} have ended. Add payment to keep everything running, right where you left off.`
      : `Your 3 free months for ${c.name || 'your community'} end on ${fmtDate(endsAt)}, ${m.lead}. Add a bank account or card so billing starts smoothly and your community is never interrupted.`

    // Board recipients: admins / board members with an email on file.
    const { data: people } = await admin
      .from('profiles')
      .select('email')
      .eq('community_id', c.id)
      .in('role', ['admin', 'board_member'])
    const to = [...new Set((people ?? []).map(p => p.email).filter((e): e is string => !!e))]
    if (!to.length) { summary.push({ community: c.id, daysLeft, skipped: 'no recipients' }); continue }

    if (dryRun) { summary.push({ community: c.id, daysLeft, wouldEmail: to.length, subject: m.subject }); continue }
    if (!resendKey) { summary.push({ community: c.id, error: 'RESEND_API_KEY not configured' }); continue }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject: m.subject, html: emailHtml(c.name || 'Your community', body) }),
    })
    if (!res.ok) { summary.push({ community: c.id, error: `resend ${res.status}` }); continue }
    sent += to.length
    summary.push({ community: c.id, daysLeft, emailed: to.length })
  }

  return NextResponse.json({ ok: true, dryRun, sent, communities: summary })
}
