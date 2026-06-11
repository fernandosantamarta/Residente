// create-amenity-checkout — starts a Stripe Checkout session for a priced
// amenity reservation.
//
// Called from the Amenities tab after a reservation row is created with
// payment_status='pending'. Returns { url } to Stripe's hosted checkout. On
// success the stripe-webhook flips that reservation to payment_status='paid'.
// The Stripe SECRET key lives only here as a Supabase function secret.
//
// Deploy:  supabase functions deploy create-amenity-checkout
// Secrets: STRIPE_SECRET_KEY, APP_URL   (same as create-checkout)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'
import { connectedAccountFor, acctOpts } from '../_shared/connect.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const APP_URL = Deno.env.get('APP_URL') ?? 'https://residente.io'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { reservation_id } = await req.json()
    if (!reservation_id || typeof reservation_id !== 'string') {
      return json({ error: 'reservation_id is required' }, 400)
    }

    // Caller's JWT → RLS decides visibility. A resident sees their own
    // reservation; the board sees any in their community.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )

    const { data: res, error } = await supabase
      .from('ev_amenity_reservations')
      .select('id, community_id, amenity_id, reserved_date, start_time, payment_status')
      .eq('id', reservation_id)
      .single()
    if (error || !res) return json({ error: 'Reservation not found' }, 404)
    if (res.payment_status === 'paid') return json({ error: 'Already paid' }, 400)

    const { data: amenity, error: aErr } = await supabase
      .from('ev_amenities')
      .select('name, price_cents')
      .eq('id', res.amenity_id)
      .single()
    if (aErr || !amenity) return json({ error: 'Amenity not found' }, 404)

    const cents = Number(amenity.price_cents) || 0
    if (cents <= 0) return json({ error: 'This amenity is free' }, 400)

    // "Link, don't hold": charge the reservation ON the community's connected
    // account when linked. The webhook records event.account onto the reservation
    // so the later refund targets the same account it was charged on.
    const connectedAccount = await connectedAccountFor(supabase, res.community_id)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: `${amenity.name} reservation`,
            description: `${res.reserved_date}${res.start_time ? ` · ${res.start_time}` : ''}`,
          },
        },
      }],
      success_url: `${APP_URL}/app/schedule?amenity_paid=1#amenities`,
      cancel_url: `${APP_URL}/app/schedule?amenity_cancel=1#amenities`,
      // stripe-webhook reads reservation_id back to flip this reservation to
      // paid. community_id distinguishes it from a dues checkout (resident_id).
      metadata: {
        reservation_id: res.id,
        community_id: res.community_id,
      },
      // Mirror onto the PaymentIntent for the connected account's own dashboard.
      payment_intent_data: {
        metadata: { reservation_id: res.id, community_id: res.community_id },
      },
    }, acctOpts(connectedAccount))

    return json({ url: session.url })
  } catch (err) {
    console.error('create-amenity-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
