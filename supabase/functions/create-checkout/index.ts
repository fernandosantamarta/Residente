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
    // plan_id / installment_no / charge_type are optional — present when the
    // resident is paying a payment-plan installment rather than ad-hoc dues.
    const { resident_id, amount, plan_id, installment_no, charge_type, embedded } = await req.json()

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
      .select('id, community_id, full_name, unit_number')
      .eq('id', resident_id)
      .single()
    if (error || !resident) return json({ error: 'Resident not found' }, 404)

    // If this is an installment payment, confirm the caller actually owns an
    // ACTIVE plan with this id (RLS only returns plans on the caller's own case
    // — or any in their community for the board). Prevents tagging a payment to
    // someone else's plan via a forged plan_id.
    let planId: string | null = null
    if (plan_id) {
      const { data: plan } = await supabase
        .from('ev_payment_plans')
        .select('id, status')
        .eq('id', plan_id)
        .maybeSingle()
      if (!plan || plan.status !== 'active') {
        return json({ error: 'Payment plan not found or not active' }, 404)
      }
      planId = plan.id
    }

    // "Link, don't hold": if the community has linked its OWN Stripe (Connect
    // Standard) and finished onboarding, the dues charge is created ON that
    // account so funds land with the HOA and never touch Residente's balance.
    // Until a community links, this falls back to the legacy single-account flow.
    const { data: community } = await supabase
      .from('communities')
      .select('stripe_account_id, stripe_connect_status')
      .eq('id', resident.community_id)
      .single()
    const connectedAccount =
      community?.stripe_connect_status === 'active' && community?.stripe_account_id
        ? (community.stripe_account_id as string)
        : null

    // ACH (us_bank_account) is offered ONLY when the community charges on its OWN
    // connected account — the bank debit then lands with the HOA, never with
    // Residente. On the legacy single-account fallback we stay card-only. ACH is
    // async: the payment is recorded only once it SETTLES (see stripe-webhook's
    // checkout.session.async_payment_succeeded handler), never at authorization.
    const paymentMethodTypes = connectedAccount
      ? ['card', 'us_bank_account']
      : ['card']

    const params: any = {
      mode: 'payment',
      payment_method_types: paymentMethodTypes,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: planId ? 'HOA payment plan installment' : 'HOA dues',
            description: resident.unit_number
              ? `Unit ${resident.unit_number}`
              : (resident.full_name || 'HOA dues'),
          },
        },
      }],
      // Neutral copy: a card posts instantly, an ACH debit takes a few business
      // days, and we don't know which the resident picked at redirect time. The
      // Pay screen reads ?submitted=1 and explains both (it never claims "Paid").
      success_url: `${APP_URL}/app/track?submitted=1#pay`,
      cancel_url: `${APP_URL}/app/track#pay`,
      // stripe-webhook reads these back to record the payment against the
      // right household. The charged amount comes from Stripe itself. Stripe
      // metadata values must be strings, so only include the plan keys when set.
      metadata: {
        resident_id: resident.id,
        community_id: resident.community_id,
        ...(planId ? { plan_id: planId } : {}),
        ...(installment_no != null ? { installment_no: String(installment_no) } : {}),
        ...(charge_type ? { charge_type: String(charge_type) } : {}),
      },
      // Mirror the household tags onto the PaymentIntent too, so a connected
      // account's own Stripe dashboard (and later reconciliation) can see what
      // each charge was for. Recording still keys off the session metadata above.
      payment_intent_data: {
        metadata: {
          resident_id: resident.id,
          community_id: resident.community_id,
          ...(planId ? { plan_id: planId } : {}),
          ...(charge_type ? { charge_type: String(charge_type) } : {}),
        },
      },
    }

    if (embedded) {
      params.ui_mode = 'embedded'
      params.redirect_on_completion = 'never'
      delete params.success_url
      delete params.cancel_url
    }

    const acctOpts = connectedAccount ? { stripeAccount: connectedAccount } : undefined
    let session
    try {
      session = await stripe.checkout.sessions.create(params, acctOpts)
    } catch (err) {
      // A connected account that hasn't activated ACH (us_bank_account) rejects the
      // session. Don't break dues entirely — retry card-only so the resident can
      // still pay; ACH simply isn't offered until that account enables it.
      if (params.payment_method_types.includes('us_bank_account')) {
        console.warn('us_bank_account unavailable; retrying card-only:', (err as Error).message)
        params.payment_method_types = ['card']
        session = await stripe.checkout.sessions.create(params, acctOpts)
      } else {
        throw err
      }
    }

    return json(embedded ? { client_secret: session.client_secret, account: connectedAccount ?? null } : { url: session.url })
  } catch (err) {
    console.error('create-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
