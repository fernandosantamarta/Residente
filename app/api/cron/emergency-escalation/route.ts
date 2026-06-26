// Emergency escalation sweep — pages the NEXT on-call contact for any open
// emergency whose ack window has lapsed. Service-role only, CRON_SECRET-gated
// (same posture as the other /api/cron/* jobs). All the logic lives in the
// emergency_escalate_due() RPC (supabase/emergency-dispatch.sql) so the timing
// state + targeted paging stay in one Postgres transaction; this route just
// invokes it on a schedule.
//
// NOT yet wired into vercel.json on purpose: timed laddering needs a sub-daily
// cadence (every 5-15 min), which requires a Vercel plan that allows it. The
// FIRST page already fires immediately at report time with no cron, so the
// feature works without this; add a vercel.json cron entry pointing here once
// you've confirmed the plan. Safe to re-run: emergency_page() resets the ack
// window per rung, so a double-fire can at most advance one extra rung.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; a manual curl
// may pass `x-cron-secret: <CRON_SECRET>` instead.
// Env (Vercel): CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, a Supabase URL.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = () =>
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  'https://nozzfcxijdnllkiydhfi.supabase.co'

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
      || req.headers.get('x-cron-secret') === secret
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }
  try {
    const admin = createClient(supabaseUrl(), key, { auth: { persistSession: false } })
    const { data, error } = await admin.rpc('emergency_escalate_due')
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 })
    }
    return NextResponse.json({ ok: true, ...(data || {}) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'escalation sweep failed' }, { status: 500 })
  }
}
