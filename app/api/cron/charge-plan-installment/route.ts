// Collect due payment-plan installments — invoked DAILY by Vercel Cron (see
// vercel.json). Thin driver for the charge-plan-installment Supabase edge function,
// which charges the next installment off-session for every autopay-opted plan whose
// next_due_at has arrived. The edge function is idempotent per (plan, installment_no)
// — Stripe returns the existing intent on a same-day re-run — so a daily sweep that
// picks up any newly-due installment is safe to repeat. A declined installment leaves
// next_due_at unadvanced, so it naturally retries on the following day's run.
//
// WHY a driver (cf. cron/charge-autopay): the charge logic needs the Stripe secret +
// Connect routing held only as Supabase secrets; we drive the shipped, CRON_SECRET-
// gated edge function rather than duplicate a money path. Mirrors cron/reconcile.
//
// SAFETY: re-running is safe (idempotency key per installment). ?community_id=<uuid>
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

  const onlyCommunity = new URL(req.url).searchParams.get('community_id') || undefined
  const body = onlyCommunity ? JSON.stringify({ community_id: onlyCommunity }) : '{}'

  try {
    const r = await fetch(`${supabaseUrl()}/functions/v1/charge-plan-installment`, {
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
    return NextResponse.json({ error: e?.message || 'charge-plan-installment invoke failed' }, { status: 500 })
  }
}
