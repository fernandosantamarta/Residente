// Collect autopay dues — invoked DAILY by Vercel Cron (see vercel.json). This is a
// thin driver: it forwards to the charge-autopay Supabase edge function, which holds
// the money logic (off-session charges on each resident's saved card, the once-a-
// month idempotency guard, and the retry/pause dunning loop). Daily cadence is what
// powers the retry — the edge function itself ensures a resident is collected only
// once per month and pauses after repeated declines.
//
// WHY a driver and not the work inline (cf. charge-monthly-dues, which DOES mint
// charges itself): the charge engine needs the Stripe secret key + Connect routing,
// which live only as Supabase function secrets. We drive the already-shipped,
// CRON_SECRET-gated edge function rather than re-implement (and risk drift in) a
// money path. Mirrors the cron/reconcile → plaid-sync invocation pattern.
//
// SAFETY: re-running is safe (the edge function CLAIMS the month atomically before
// charging, so a daily run / double-fire never double-debits). ⚠ DEPLOY ORDER: apply
// supabase/payment-failures.sql BEFORE enabling this cron — the edge function is
// fail-closed and collects $0 until the marker column exists. ?community_id=<uuid>
// scopes the run to one community.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// Env (Vercel): CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, a Supabase URL.

import { NextResponse } from 'next/server'

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

  // ?community_id=<uuid> → scope to one community (passed through to the edge fn).
  const onlyCommunity = new URL(req.url).searchParams.get('community_id') || undefined
  const body = onlyCommunity ? JSON.stringify({ community_id: onlyCommunity }) : '{}'

  try {
    const r = await fetch(`${supabaseUrl()}/functions/v1/charge-autopay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': secret,
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body,
    })
    const out = await r.json().catch(() => ({ status: r.status }))
    return NextResponse.json({ ok: r.ok, status: r.status, ...out }, { status: r.ok ? 200 : 502 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'charge-autopay invoke failed' }, { status: 500 })
  }
}
