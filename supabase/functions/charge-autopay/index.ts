// charge-autopay — the recurring-payment engine. Charges every autopay-enabled
// resident their community's monthly dues off-session (no resident present),
// against the default card set by set-autopay. Meant to be called on a schedule
// (e.g. the 1st of each month) by a Supabase scheduled function / external cron,
// NOT by the browser — it runs with the service-role key and bypasses RLS, so it
// is gated behind a shared CRON_SECRET.
//
// The resulting payment is recorded by stripe-webhook on payment_intent.succeeded
// (dedup on the PaymentIntent id), so this function does not touch `payments`.
//
// Deploy:  supabase functions deploy charge-autopay --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Invoke:  POST with header  x-cron-secret: <CRON_SECRET>
//          optional body { community_id } to scope to one community.

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  let community_id: string | undefined
  try { community_id = (await req.json())?.community_id } catch { /* no body is fine */ }

  // Autopay-enabled residents with a customer + saved card.
  let q = admin.from('residents')
    .select('id, community_id, stripe_customer_id, autopay_pm_id')
    .eq('autopay_enabled', true)
    .not('stripe_customer_id', 'is', null)
    .not('autopay_pm_id', 'is', null)
  if (community_id) q = q.eq('community_id', community_id)
  const { data: residents, error } = await q
  if (error) return new Response(`Query failed: ${error.message}`, { status: 500 })

  // Cache monthly_dues per community.
  const duesByCommunity = new Map<string, number>()
  const results: { resident_id: string; status: string; detail?: string }[] = []

  for (const r of residents ?? []) {
    try {
      if (!duesByCommunity.has(r.community_id)) {
        const { data: c } = await admin.from('communities')
          .select('monthly_dues').eq('id', r.community_id).single()
        duesByCommunity.set(r.community_id, Number(c?.monthly_dues) || 0)
      }
      const dues = duesByCommunity.get(r.community_id) || 0
      const cents = Math.round(dues * 100)
      if (cents <= 0) { results.push({ resident_id: r.id, status: 'skipped', detail: 'no dues' }); continue }

      const pi = await stripe.paymentIntents.create({
        amount: cents,
        currency: 'usd',
        customer: r.stripe_customer_id,
        payment_method: r.autopay_pm_id,
        off_session: true,
        confirm: true,
        description: 'HOA dues (autopay)',
        metadata: { resident_id: r.id, community_id: r.community_id, autopay: 'true' },
      })
      results.push({ resident_id: r.id, status: pi.status })
    } catch (err) {
      // A declined off-session charge throws; log and continue with the rest.
      results.push({ resident_id: r.id, status: 'failed', detail: (err as Error).message })
    }
  }

  return new Response(JSON.stringify({ charged: results.length, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
