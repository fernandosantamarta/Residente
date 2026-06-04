// create-billing-portal — opens the Stripe Billing Customer Portal for a
// community's platform subscription. The portal is where the admin updates the
// card, sees invoices, and CANCELS anytime — Stripe hosts it, so we don't build
// a cancel flow ourselves.
//
// Runs under the caller's JWT. Only a community admin/board member may manage
// billing (a resident must not be able to cancel the community's subscription).
//
// Deploy:  supabase functions deploy create-billing-portal
// Secrets: STRIPE_SECRET_KEY, APP_URL  (already set for the dues/subscription flow)
//
// One-time Stripe setup: enable the Customer Portal at
// dashboard.stripe.com/settings/billing/portal and allow "Cancel subscriptions".

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
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
    // Billing is admin/board only — residents can't open the portal and cancel.
    if (profile.role === 'resident') return json({ error: 'Only an admin can manage billing.' }, 403)

    const { data: community } = await supabase
      .from('communities').select('id, stripe_customer_id').eq('id', profile.community_id).single()
    if (!community?.stripe_customer_id) {
      return json({ error: 'No subscription to manage yet.' }, 400)
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: community.stripe_customer_id as string,
      return_url: `${APP_URL}/admin`,
    })
    return json({ url: portal.url })
  } catch (err) {
    console.error('create-billing-portal failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
