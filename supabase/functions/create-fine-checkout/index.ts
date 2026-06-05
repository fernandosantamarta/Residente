// create-fine-checkout — starts a Stripe Checkout session for a resident to
// pay an open violation fine.
//
// Called from the resident's "Your violations" panel (browser, authenticated).
// Returns { url } pointing at Stripe's hosted checkout. On success the
// stripe-webhook closes the violation as resolution='stripe-paid'. The Stripe
// SECRET key lives only here as a Supabase function secret.
//
// Runs under the caller's JWT so RLS only lets a resident start checkout for a
// fine they actually own (ev_violations is profile-scoped). The board issues
// fines; residents pay their own — mirrors the dues flow in create-checkout.
//
// Deploy:  supabase functions deploy create-fine-checkout
// Secrets: STRIPE_SECRET_KEY, APP_URL   (same as create-checkout)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

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
    const { violation_id } = await req.json()
    if (!violation_id || typeof violation_id !== 'string') {
      return json({ error: 'violation_id is required' }, 400)
    }

    // Caller's JWT → RLS decides visibility. A resident only sees (and can pay)
    // their own violation; a cross-community caller simply won't find it.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )

    const { data: v, error } = await supabase
      .from('ev_violations')
      .select('id, community_id, kind, amount, status, rule_title, resident_label')
      .eq('id', violation_id)
      .single()
    if (error || !v) return json({ error: 'Violation not found' }, 404)
    if (v.kind !== 'fine') return json({ error: 'Only fines can be paid' }, 400)
    if (v.status === 'closed') return json({ error: 'This fine is already settled' }, 400)

    const cents = Math.round(Number(v.amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0 || cents > 1_000_000) {
      return json({ error: 'This fine has no payable amount' }, 400)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: 'HOA fine',
            description: v.rule_title || v.resident_label || 'Violation fine',
          },
        },
      }],
      // #violations so the resident lands back on My Violations, not Rules.
      success_url: `${APP_URL}/app/documents?fine_paid=1#violations`,
      cancel_url: `${APP_URL}/app/documents#violations`,
      // stripe-webhook reads violation_id back to close this fine as
      // stripe-paid. community_id distinguishes it from a dues / amenity checkout.
      metadata: {
        violation_id: v.id,
        community_id: v.community_id,
      },
    })

    return json({ url: session.url })
  } catch (err) {
    console.error('create-fine-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
