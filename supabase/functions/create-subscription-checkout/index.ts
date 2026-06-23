// create-subscription-checkout — starts the Stripe subscription Checkout for a
// community's platform plan (the association paying Residente, priced per home).
//
// Called from /signup (right after the community is provisioned) and from the
// "Activate" banner in /admin. Runs under the caller's JWT, finds the community
// they admin, derives the band from home_count, and opens a recurring Checkout
// with quantity = home count. Uses inline price_data (recurring), so there are
// NO Stripe products/prices to pre-create — only STRIPE_SECRET_KEY is needed.
//
// Deploy:  supabase functions deploy create-subscription-checkout
// Secrets: STRIPE_SECRET_KEY, APP_URL  (already set for the dues flow)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Inlined CORS so the function deploys cleanly from the dashboard editor.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

// Pricing bands — mirror of lib/plan.ts. Keep in sync.
function bandForHomes(homes: number): { plan: string; perHomeCents: number; flatCents: number; label: string } {
  if (homes <= 25)  return { plan: 'free',       perHomeCents: 0,    flatCents: 2500, label: 'Starter' }
  if (homes <= 100) return { plan: 'pro',        perHomeCents: 200,  flatCents: 0,    label: 'Pro' }
  if (homes <= 500) return { plan: 'premium',    perHomeCents: 400,  flatCents: 0,    label: 'Premium' }
  return              { plan: 'enterprise', perHomeCents: 800,  flatCents: 0,    label: 'Enterprise' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const embedded = body?.embedded === true
    // Caller's JWT → RLS scopes them to their own community row.
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { data: profile } = await supabase
      .from('profiles').select('community_id, role').eq('id', user.id).single()
    if (!profile?.community_id) return json({ error: 'No community' }, 400)

    const { data: community } = await supabase
      .from('communities')
      .select('id, name, home_count, unit_count, plan, subscription_status, stripe_customer_id, created_at')
      .eq('id', profile.community_id)
      .single()
    if (!community) return json({ error: 'Community not found' }, 404)

    const homes = Number(community.home_count ?? community.unit_count ?? 0)
    const band = bandForHomes(homes)
    const flat = band.flatCents > 0
    if (community.subscription_status === 'active') {
      return json({ error: 'Subscription is already active.' }, 400)
    }

    // Reuse the customer if one already exists (e.g. a retried activation).
    let customer = community.stripe_customer_id as string | undefined
    if (!customer) {
      const c = await stripe.customers.create({
        email: user.email ?? undefined,
        name: community.name ?? undefined,
        metadata: { community_id: community.id },
      })
      customer = c.id
    }

    // Charge only when the community's 3 free months end. trial_end is derived
    // from signup time, so adding a card mid-trial does NOT charge early.
    const createdMs = community.created_at ? new Date(community.created_at).getTime() : Date.now()
    const trialEndsSec = Math.floor((createdMs + 90 * 24 * 60 * 60 * 1000) / 1000)
    const nowSec = Math.floor(Date.now() / 1000)
    const subData: Record<string, unknown> = { metadata: { community_id: community.id, plan: band.plan } }
    if (trialEndsSec > nowSec + 60) subData.trial_end = trialEndsSec   // else the free months are over: bill now

    // Bank (ACH) first, card as the fallback — an association pays from its
    // operating bank account, and ACH has far lower fees + far lower failed-
    // payment churn on a recurring plan. Same us_bank_account method the dues
    // flow uses. verification_method 'automatic' = instant (Financial Connections).
    const params: any = {
      mode: 'subscription',
      customer,
      payment_method_types: ['us_bank_account', 'card'],
      payment_method_options: { us_bank_account: { verification_method: 'automatic' } },
      line_items: [{
        quantity: flat ? 1 : homes,
        price_data: {
          currency: 'usd',
          unit_amount: flat ? band.flatCents : band.perHomeCents,
          recurring: { interval: 'month' },
          product_data: {
            name: `Residente — ${band.label} plan`,
            description: flat
              ? `Flat $${(band.flatCents / 100).toFixed(0)}/mo · up to 25 homes`
              : `${homes} homes · $${(band.perHomeCents / 100).toFixed(2)}/home/mo`,
          },
        },
      }],
      success_url: `${APP_URL}/admin?activated=1`,
      cancel_url: `${APP_URL}/admin?checkout=cancelled`,
      // stripe-webhook reads these back to flip the community to active.
      subscription_data: subData,
      metadata: { community_id: community.id, plan: band.plan },
    }
    // Embedded mode renders Checkout inside the app (no redirect). With
    // redirect_on_completion:'never' the modal closes + refreshes in place
    // (success_url/cancel_url are hosted-only, so drop them).
    if (embedded) {
      params.ui_mode = 'embedded'
      params.redirect_on_completion = 'never'
      delete params.success_url
      delete params.cancel_url
    }

    let session
    try {
      session = await stripe.checkout.sessions.create(params)
    } catch (err) {
      // If this Stripe account hasn't enabled ACH yet, fall back to card-only
      // so checkout still works (mirror of the dues create-checkout flow).
      if (params.payment_method_types.includes('us_bank_account')) {
        console.warn('us_bank_account unavailable; retrying card-only:', (err as Error).message)
        params.payment_method_types = ['card']
        delete params.payment_method_options
        session = await stripe.checkout.sessions.create(params)
      } else {
        throw err
      }
    }

    return json(embedded ? { client_secret: session.client_secret } : { url: session.url })
  } catch (err) {
    console.error('create-subscription-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
