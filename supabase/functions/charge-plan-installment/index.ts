// charge-plan-installment — charges the next installment for every payment plan
// that opted into autopay and is due. Runs off-session against the resident's
// saved card (set by set-autopay). Meant to be called on a schedule (e.g. daily)
// by cron, NOT the browser — service-role key, gated behind CRON_SECRET.
//
// The resulting payment is recorded AND the plan advanced by stripe-webhook on
// payment_intent.succeeded (it reads plan_id/installment_no from metadata), so
// this function does not touch `payments` or `ev_payment_plans` itself.
//
// Double-charge safety: the PaymentIntent uses an idempotency key derived from
// (plan, installment_no). A same-day re-run before the webhook advances the plan
// reuses the same key → Stripe returns the existing intent, never a 2nd charge.
//
// Deploy:  supabase functions deploy charge-plan-installment --no-verify-jwt
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

  const today = new Date().toISOString().slice(0, 10)

  // Active, approved, autopay-opted plans whose next installment is due.
  let q = admin.from('ev_payment_plans')
    .select('id, community_id, case_id, installment_amount, installment_count, paid_count, next_due_at, request_status, status, autopay_opt_in')
    .eq('autopay_opt_in', true)
    .eq('status', 'active')
    .in('request_status', ['approved', 'modified'])
    .not('next_due_at', 'is', null)
    .lte('next_due_at', today)
  if (community_id) q = q.eq('community_id', community_id)
  const { data: plans, error } = await q
  if (error) return new Response(`Query failed: ${error.message}`, { status: 500 })

  const results: { plan_id: string; status: string; detail?: string }[] = []

  for (const p of plans ?? []) {
    try {
      const cents = Math.round((Number(p.installment_amount) || 0) * 100)
      if (cents <= 0) { results.push({ plan_id: p.id, status: 'skipped', detail: 'no amount' }); continue }

      // Resolve the owner's saved card via the case → resident.
      const { data: kase } = await admin.from('ev_collection_cases')
        .select('resident_id, profile_id, community_id').eq('id', p.case_id).single()
      if (!kase) { results.push({ plan_id: p.id, status: 'skipped', detail: 'no case' }); continue }

      let resQ = admin.from('residents').select('id, stripe_customer_id, autopay_pm_id')
      resQ = kase.resident_id ? resQ.eq('id', kase.resident_id) : resQ.eq('profile_id', kase.profile_id)
      const { data: resident } = await resQ.maybeSingle()
      if (!resident?.stripe_customer_id || !resident?.autopay_pm_id) {
        results.push({ plan_id: p.id, status: 'skipped', detail: 'no saved card' }); continue
      }

      const installmentNo = (Number(p.paid_count) || 0) + 1
      const pi = await stripe.paymentIntents.create({
        amount: cents,
        currency: 'usd',
        customer: resident.stripe_customer_id,
        payment_method: resident.autopay_pm_id,
        off_session: true,
        confirm: true,
        description: 'HOA payment plan installment (autopay)',
        metadata: {
          resident_id: resident.id,
          community_id: p.community_id,
          autopay: 'true',
          plan_id: p.id,
          installment_no: String(installmentNo),
          charge_type: 'assessment',
        },
      }, { idempotencyKey: `plan-${p.id}-${installmentNo}` })
      results.push({ plan_id: p.id, status: pi.status })
    } catch (err) {
      // A declined off-session charge throws; log and continue with the rest.
      results.push({ plan_id: p.id, status: 'failed', detail: (err as Error).message })
    }
  }

  return new Response(JSON.stringify({ charged: results.length, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
