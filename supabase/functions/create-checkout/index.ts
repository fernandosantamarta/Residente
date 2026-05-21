// create-checkout — starts a Stripe Checkout session for a resident's dues.
//
// Called from the Pay page (browser, authenticated). Returns { url } pointing
// at Stripe's hosted checkout page. The Stripe SECRET key lives only here, as
// a Supabase function secret — it never reaches the frontend.
//
// Deploy:  supabase functions deploy create-checkout
// Secrets: STRIPE_SECRET_KEY, APP_URL   (see supabase/README.md)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

// Where Stripe returns the resident after checkout.
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
    const { resident_id, amount } = await req.json()

    // Validate inputs before touching Stripe.
    if (!resident_id || typeof resident_id !== 'string') {
      return json({ error: 'resident_id is required' }, 400)
    }
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0 || cents > 1_000_000) {
      return json({ error: 'amount must be between $0 and $10,000' }, 400)
    }

    // Run under the caller's JWT so RLS decides what they can see — an
    // anonymous or cross-community caller simply won't find the resident.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )

    const { data: resident, error } = await supabase
      .from('residents')
      .select('id, community_id, full_name, address')
      .eq('id', resident_id)
      .single()
    if (error || !resident) return json({ error: 'Resident not found' }, 404)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: 'HOA dues',
            description: resident.address || resident.full_name,
          },
        },
      }],
      success_url: `${APP_URL}/pay?paid=1`,
      cancel_url: `${APP_URL}/pay`,
      // stripe-webhook reads these back to record the payment against the
      // right household. The charged amount comes from Stripe itself.
      metadata: {
        resident_id: resident.id,
        community_id: resident.community_id,
      },
    })

    return json({ url: session.url })
  } catch (err) {
    console.error('create-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
