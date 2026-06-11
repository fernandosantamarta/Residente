// set-autopay — toggles a resident's autopay preference and records which saved
// card it should charge. Persists autopay_enabled / autopay_pm_id on the roster
// row and sets the customer's default payment method in Stripe so charge-autopay
// (and one-click pay) use the right card.
//
// Body: { resident_id, enabled, payment_method_id? }
//   - enabled true  → turn autopay on (payment_method_id required if no default yet)
//   - enabled false → turn autopay off (card stays saved)
//
// Deploy:  supabase functions deploy set-autopay
// Secrets: STRIPE_SECRET_KEY   (see supabase/README.md)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'
import { acctOpts } from '../_shared/connect.ts'

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
    const { resident_id, enabled, payment_method_id } = await req.json()
    if (!resident_id || typeof resident_id !== 'string') {
      return json({ error: 'resident_id is required' }, 400)
    }
    if (typeof enabled !== 'boolean') {
      return json({ error: 'enabled must be a boolean' }, 400)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    // Authorize: a resident may only change autopay for a roster row they own.
    // The `residents` SELECT policy is community-wide, so without this check a
    // neighbor could pass another resident_id and repoint their default card /
    // toggle their autopay via the Stripe + roster writes below.
    const { data: { user: caller } } = await supabase.auth.getUser(token)
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const { data: resident, error } = await supabase
      .from('residents')
      .select('id, profile_id, stripe_customer_id, stripe_customer_account, autopay_pm_id')
      .eq('id', resident_id)
      .single()
    if (error || !resident) return json({ error: 'Resident not found' }, 404)
    if (resident.profile_id !== caller.id) return json({ error: 'Forbidden' }, 403)

    const pmId: string | null = payment_method_id || resident.autopay_pm_id || null

    if (enabled && !resident.stripe_customer_id) {
      return json({ error: 'Save a payment method before enabling autopay.' }, 400)
    }
    if (enabled && !pmId) {
      return json({ error: 'A payment method is required to enable autopay.' }, 400)
    }
    // Whenever a method is named, make it the customer's default for off-session
    // charges — this also backs the "Set as default" action, independent of the
    // autopay toggle. The customer lives on stripe_customer_account (null = platform).
    if (pmId && resident.stripe_customer_id) {
      await stripe.customers.update(resident.stripe_customer_id, {
        invoice_settings: { default_payment_method: pmId },
      }, acctOpts(resident.stripe_customer_account || null))
    }

    const { error: upErr } = await supabase.from('residents')
      .update({ autopay_enabled: enabled, autopay_pm_id: pmId })
      .eq('id', resident.id)
    if (upErr) throw upErr

    return json({ autopay_enabled: enabled, autopay_pm_id: pmId })
  } catch (err) {
    console.error('set-autopay failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
