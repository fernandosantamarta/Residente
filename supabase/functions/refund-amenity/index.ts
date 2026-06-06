// refund-amenity — issues a Stripe refund for a cancelled, paid amenity
// reservation, with a board-configurable cancellation window.
//
// Body: { reservation_id, override? }
//   - resident self-cancel: refunded in full ONLY if now is still before the
//     community's cutoff (amenity_refund_cutoff_hours before the slot);
//   - board override (override:true): a board member may refund any of their
//     community's paid reservations at any time (post-cutoff goodwill refund).
//
// The caller's JWT scopes what they can see (RLS: a resident sees their own
// reservation, the board sees any in their community) — so a stranger's
// reservation_id simply 404s. The refund_* columns are written with the
// service-role key (bypasses RLS) after the refund succeeds.
//
// Deploy:  supabase functions deploy refund-amenity
// Secrets: STRIPE_SECRET_KEY   (see supabase/README.md)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

// Service-role client — writes the refund_* columns regardless of RLS.
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Whether `now` is still before the refund cutoff: the slot start minus the
// community's cutoff window. Computed the same way on the client
// (withinRefundWindow in lib/amenities.ts); the function recomputes here so a
// resident can never refund past the window by editing the request.
function withinWindow(reservedDate: string, startTime: string, cutoffHours: number, now: Date): boolean {
  const t = /^\d{1,2}:\d{2}/.test(startTime || '') ? startTime : '00:00'
  const slot = new Date(`${reservedDate}T${t}:00`)
  if (isNaN(slot.getTime())) return false
  const cutoff = slot.getTime() - cutoffHours * 3600_000
  return now.getTime() <= cutoff
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { reservation_id, override } = await req.json()
    if (!reservation_id || typeof reservation_id !== 'string') {
      return json({ error: 'reservation_id is required' }, 400)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user: caller } } = await supabase.auth.getUser(token)
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    // Resolve the reservation under the caller's JWT — RLS is the IDOR guard:
    // a stranger's id is invisible and 404s.
    const { data: res, error } = await supabase
      .from('ev_amenity_reservations')
      .select('id, community_id, profile_id, reserved_date, start_time, payment_status, stripe_session_id, refund_status')
      .eq('id', reservation_id)
      .single()
    if (error || !res) return json({ error: 'Reservation not found' }, 404)

    if (res.payment_status !== 'paid' || !res.stripe_session_id) {
      return json({ error: 'This reservation was not paid by card.' }, 400)
    }
    // Idempotent: a refund already issued (or in flight) is a no-op success.
    if (res.refund_status === 'refunded' || res.refund_status === 'pending') {
      return json({ refunded: true, already: true })
    }

    // Authority + window. A board member of the same community may override the
    // cutoff; a resident may refund only their own booking, only within the
    // window.
    const { data: me } = await supabase
      .from('profiles')
      .select('role, community_id')
      .eq('id', caller.id)
      .single()
    const isBoard = !!me && me.community_id === res.community_id &&
      (me.role === 'board_member' || me.role === 'admin')

    if (override === true) {
      if (!isBoard) return json({ error: 'Only the board can override the refund window.' }, 403)
    } else {
      if (res.profile_id !== caller.id) {
        return json({ error: 'You can only refund your own reservation.' }, 403)
      }
      const { data: community } = await supabase
        .from('communities')
        .select('amenity_refund_cutoff_hours')
        .eq('id', res.community_id)
        .single()
      const cutoffHours = Number(community?.amenity_refund_cutoff_hours ?? 24)
      if (!withinWindow(res.reserved_date, res.start_time, cutoffHours, new Date())) {
        return json({ error: `Past the free-cancellation window (${cutoffHours}h before the slot).`, pastWindow: true }, 400)
      }
    }

    // Find the PaymentIntent behind the checkout session, then refund it in
    // full. The idempotency key keeps a double-click / retry from issuing two
    // refunds (the DB unique index on stripe_refund_id is the second guard).
    const session = await stripe.checkout.sessions.retrieve(res.stripe_session_id)
    const paymentIntent = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
    if (!paymentIntent) return json({ error: 'No charge found to refund.' }, 400)

    let refund: Stripe.Refund
    try {
      refund = await stripe.refunds.create(
        { payment_intent: paymentIntent },
        { idempotencyKey: `refund-amenity-${res.id}` },
      )
    } catch (stripeErr) {
      console.error('refund-amenity stripe error:', stripeErr)
      await admin.from('ev_amenity_reservations')
        .update({ refund_status: 'failed' })
        .eq('id', res.id)
      return json({ error: (stripeErr as Error).message || 'Refund failed at Stripe.' }, 400)
    }

    const nowIso = new Date().toISOString()
    const { error: upErr } = await admin.from('ev_amenity_reservations')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        refund_status: 'refunded',
        stripe_refund_id: refund.id,
        refunded_at: nowIso,
        refund_amount_cents: refund.amount ?? null,
      })
      .eq('id', res.id)
    if (upErr) {
      console.error('refund-amenity failed to record refund:', upErr)
      // The Stripe refund succeeded; surface success but flag the bookkeeping
      // miss. The optional charge.refunded webhook reconciles state.
      return json({ refunded: true, recorded: false, refund_id: refund.id })
    }

    return json({ refunded: true, refund_id: refund.id, refund_amount_cents: refund.amount ?? null })
  } catch (err) {
    console.error('refund-amenity failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
