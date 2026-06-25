// release-amenity-holds — frees amenity reservations whose Stripe checkout was
// abandoned. When a resident clicks "pay", the slot is held with
// payment_status='pending'; if they never finish, it used to stay pending
// FOREVER, blocking the slot until the board manually cancelled it. This cron
// cancels any pending hold older than the grace window so the slot reopens.
//
// Safe: only touches reservations that are still BOTH status='confirmed' AND
// payment_status='pending' (a held-but-unpaid slot) past the cutoff. A paid or
// already-cancelled reservation is never affected. Idempotent.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// Env (Vercel): CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, a Supabase URL.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// How long a checkout hold may sit unpaid before the slot is released.
const GRACE_MINUTES = 60

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
  const admin = createClient(supabaseUrl(), key, { auth: { persistSession: false } })

  const cutoff = new Date(Date.now() - GRACE_MINUTES * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('ev_amenity_reservations')
    .update({ status: 'cancelled', payment_status: 'none' })
    .eq('status', 'confirmed')
    .eq('payment_status', 'pending')
    .lt('created_at', cutoff)
    .select('id')
  if (error) {
    return NextResponse.json({ error: `release failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, released: (data ?? []).length, cutoff, grace_minutes: GRACE_MINUTES })
}
