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
function bandForHomes(homes: number): { plan: string; perHomeCents: number; label: string } {
  if (homes <= 25)  return { plan: 'free',       perHomeCents: 0,    label: 'Free' }
  if (homes <= 100) return { plan: 'pro',        perHomeCents: 200,  label: 'Pro' }
  if (homes <= 500) return { plan: 'premium',    perHomeCents: 500,  label: 'Premium' }
  return              { plan: 'enterprise', perHomeCents: 1000, label: 'Enterprise' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
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
      .select('id, name, home_count, unit_count, plan, subscription_status, stripe_customer_id')
      .eq('id', profile.community_id)
      .single()
    if (!community) return json({ error: 'Community not found' }, 404)

    const homes = Number(community.home_count ?? community.unit_count ?? 0)
    const band = bandForHomes(homes)
    if (band.perHomeCents === 0) {
      return json({ error: 'This community is on the Free plan — no payment needed.' }, 400)
    }
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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{
        quantity: homes,
        price_data: {
          currency: 'usd',
          unit_amount: band.perHomeCents,
          recurring: { interval: 'month' },
          product_data: {
            name: `Residente — ${band.label} plan`,
            description: `${homes} homes · $${(band.perHomeCents / 100).toFixed(2)}/home/mo`,
          },
        },
      }],
      success_url: `${APP_URL}/admin?activated=1`,
      cancel_url: `${APP_URL}/admin?checkout=cancelled`,
      // stripe-webhook reads these back to flip the community to active.
      subscription_data: { metadata: { community_id: community.id, plan: band.plan } },
      metadata: { community_id: community.id, plan: band.plan },
    })

    return json({ url: session.url })
  } catch (err) {
    console.error('create-subscription-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
