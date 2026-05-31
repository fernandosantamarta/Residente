// list-payment-methods — returns the cards a resident has saved on their Stripe
// Customer, so the Pay section can show real saved methods (brand/last4/exp)
// instead of the localStorage placeholder list. The default card (used by
// autopay) is flagged.
//
// Deploy:  supabase functions deploy list-payment-methods
// Secrets: STRIPE_SECRET_KEY   (see supabase/README.md)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

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

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    // Authorize: a resident may only list payment methods for a roster row they
    // own. The `residents` SELECT policy (members read residents) is
    // community-wide, so without this check any neighbor could pass another
    // resident_id and read their saved-card brand/last4/expiry below.
    const { data: { user: caller } } = await supabase.auth.getUser(token)
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const { data: resident, error } = await supabase
      .from('residents')
      .select('id, profile_id, stripe_customer_id, autopay_pm_id')
      .eq('id', resident_id)
      .single()
    if (error || !resident) return json({ error: 'Resident not found' }, 404)
    if (resident.profile_id !== caller.id) return json({ error: 'Forbidden' }, 403)
    if (!resident.stripe_customer_id) return json({ methods: [] })

    const customer = await stripe.customers.retrieve(resident.stripe_customer_id) as Stripe.Customer
    const defaultPm = (customer.invoice_settings?.default_payment_method as string) || resident.autopay_pm_id || null

    const pms = await stripe.paymentMethods.list({
      customer: resident.stripe_customer_id,
      type: 'card',
    })

    const methods = pms.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'card',
      last4: pm.card?.last4 ?? '••••',
      exp_month: pm.card?.exp_month ?? null,
      exp_year: pm.card?.exp_year ?? null,
      is_default: pm.id === defaultPm,
    }))

    return json({ methods })
  } catch (err) {
    console.error('list-payment-methods failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
