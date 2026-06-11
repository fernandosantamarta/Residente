// create-setup-checkout — starts a Stripe Checkout session in `setup` mode so a
// resident can save a card on file (no charge). On completion Stripe attaches
// the payment method to the resident's Customer; we set it as the default so
// autopay and one-click payments can use it.
//
// Mirrors create-checkout: called from the browser with the resident's JWT,
// returns { url } to Stripe's hosted page. The Stripe SECRET key lives only here.
//
// Deploy:  supabase functions deploy create-setup-checkout
// Secrets: STRIPE_SECRET_KEY, APP_URL   (see supabase/README.md)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'
import { connectedAccountFor, acctOpts, customerMatchesAccount } from '../_shared/connect.ts'

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
    const { resident_id } = await req.json()
    if (!resident_id || typeof resident_id !== 'string') {
      return json({ error: 'resident_id is required' }, 400)
    }

    // Caller's JWT → RLS scopes the resident lookup + the customer-id write.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    // Authorize: a resident may only save a card against a roster row they own.
    // The `residents` SELECT policy is community-wide, so without this check a
    // neighbor could pass another resident_id and create a Stripe customer /
    // setup session bound to that household.
    const { data: { user: caller } } = await supabase.auth.getUser(token)
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const { data: resident, error } = await supabase
      .from('residents')
      .select('id, profile_id, community_id, full_name, email, stripe_customer_id, stripe_customer_account')
      .eq('id', resident_id)
      .single()
    if (error || !resident) return json({ error: 'Resident not found' }, 404)
    if (resident.profile_id !== caller.id) return json({ error: 'Forbidden' }, 403)

    // "Link, don't hold": save the method ON the community's connected account when
    // it has one, so autopay later charges land with the HOA. Customers are
    // per-account, so if the saved customer is on a different account than today's
    // (e.g. a card saved before the community linked Connect) we create a fresh one.
    const account = await connectedAccountFor(supabase, resident.community_id)
    const opts = acctOpts(account)

    let customerId = resident.stripe_customer_id as string | null
    if (!customerId || !customerMatchesAccount(resident.stripe_customer_account, account)) {
      const customer = await stripe.customers.create({
        email: resident.email || undefined,
        name: resident.full_name || undefined,
        metadata: { resident_id: resident.id, community_id: resident.community_id },
      }, opts)
      customerId = customer.id
      await supabase.from('residents')
        .update({ stripe_customer_id: customerId, stripe_customer_account: account })
        .eq('id', resident.id)
    }

    // Offer bank-account (ACH) save only on a connected account — its off-session
    // debits land with the HOA. us_bank_account in setup mode collects a mandate
    // for future off-session charges.
    const params: any = {
      mode: 'setup',
      customer: customerId,
      payment_method_types: account ? ['card', 'us_bank_account'] : ['card'],
      success_url: `${APP_URL}/app/track?card=saved#pay`,
      cancel_url: `${APP_URL}/app/track#pay`,
      metadata: { resident_id: resident.id, community_id: resident.community_id },
    }
    if (account) {
      params.payment_method_options = { us_bank_account: { verification_method: 'automatic' } }
    }

    let session
    try {
      session = await stripe.checkout.sessions.create(params, opts)
    } catch (err) {
      // A connected account that hasn't activated ACH rejects us_bank_account —
      // fall back to card-only so saving a card still works.
      if (params.payment_method_types.includes('us_bank_account')) {
        console.warn('us_bank_account unavailable; retrying card-only:', (err as Error).message)
        params.payment_method_types = ['card']
        delete params.payment_method_options
        session = await stripe.checkout.sessions.create(params, opts)
      } else {
        throw err
      }
    }

    return json({ url: session.url })
  } catch (err) {
    console.error('create-setup-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
