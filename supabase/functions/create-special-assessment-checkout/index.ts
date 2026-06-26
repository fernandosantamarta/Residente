// create-special-assessment-checkout — starts a Stripe Checkout session for a
// resident to pay one of their special-assessment charges.
//
// Called from the resident's "Special assessments" panel on Easy Track (browser,
// authenticated). Returns { url } (or an embedded client_secret). On success the
// stripe-webhook flips ev_special_assessment_charges.status to 'paid' by reading
// special_assessment_charge_id back from metadata — exactly like create-fine-
// checkout closes a violation. The charge never touches public.payments, so it
// can't move the formula-based dues balance.
//
// Runs under the caller's JWT so RLS only lets a resident start checkout for a
// charge they actually own (ev_special_assessment_charges is profile-scoped).
//
// Deploy:  supabase functions deploy create-special-assessment-checkout
// Secrets: STRIPE_SECRET_KEY, APP_URL   (same as create-fine-checkout)

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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { charge_id, embedded } = await req.json()
    if (!charge_id || typeof charge_id !== 'string') {
      return json({ error: 'charge_id is required' }, 400)
    }

    // Caller's JWT → RLS decides visibility. A resident only sees (and can pay)
    // their own charge; a cross-community caller simply won't find it.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )

    const { data: c, error } = await supabase
      .from('ev_special_assessment_charges')
      .select('id, community_id, amount, status, installment_no, assessment_id, ev_special_assessments(title)')
      .eq('id', charge_id)
      .single()
    if (error || !c) return json({ error: 'Charge not found' }, 404)
    if (c.status !== 'pending') return json({ error: 'This charge is already settled' }, 400)

    const cents = Math.round(Number(c.amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0 || cents > 5_000_000) {
      return json({ error: 'This charge has no payable amount' }, 400)
    }

    const title = (c as any).ev_special_assessments?.title || 'Special assessment'
    const connectedAccount = await connectedAccountFor(supabase, c.community_id)

    const params: any = {
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: 'Special assessment',
            description: c.installment_no > 1 || (c as any).installments > 1
              ? `${title} — installment ${c.installment_no}`
              : title,
          },
        },
      }],
      success_url: `${APP_URL}/app/track?sa_paid=1#pay`,
      cancel_url: `${APP_URL}/app/track#pay`,
      // stripe-webhook reads special_assessment_charge_id back to mark this
      // charge paid. community_id distinguishes it from a dues / fine checkout.
      metadata: {
        special_assessment_charge_id: c.id,
        community_id: c.community_id,
      },
      payment_intent_data: {
        metadata: { special_assessment_charge_id: c.id, community_id: c.community_id },
      },
    }
    if (embedded) {
      params.ui_mode = 'embedded'
      params.redirect_on_completion = 'never'
      delete params.success_url
      delete params.cancel_url
    }
    const session = await stripe.checkout.sessions.create(params, acctOpts(connectedAccount))

    return json(embedded ? { client_secret: session.client_secret, account: connectedAccount ?? null } : { url: session.url })
  } catch (err) {
    console.error('create-special-assessment-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
