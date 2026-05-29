// stripe-webhook — records a dues payment after Stripe confirms checkout.
//
// Stripe calls this directly with no Supabase JWT, so it MUST be deployed
// with JWT verification OFF:
//     supabase functions deploy stripe-webhook --no-verify-jwt
// (also set in supabase/config.toml). Authenticity comes from the Stripe
// signature check below, not from a Supabase token.
//
// On `checkout.session.completed` it inserts one row into `payments` using
// the service-role key (bypasses RLS). It dedups on stripe_session_id so a
// Stripe retry can't double-record a payment.
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET   (see supabase/README.md)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
// Deno needs the async SubtleCrypto provider for signature verification.
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

// Service-role client — bypasses RLS so the webhook can insert payments.
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing stripe-signature', { status: 400 })

  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature, WEBHOOK_SECRET, undefined, cryptoProvider,
    )
  } catch (err) {
    console.error('Signature verification failed:', (err as Error).message)
    return new Response(`Bad signature: ${(err as Error).message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    // `setup` sessions (saving a card) carry no payment — ignore them here.
    if (session.mode !== 'payment') {
      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    const resident_id = session.metadata?.resident_id
    const community_id = session.metadata?.community_id
    // Trust Stripe's own figure for what was actually charged.
    const amount = (session.amount_total ?? 0) / 100

    if (!resident_id || !community_id || amount <= 0) {
      console.error('checkout.session.completed missing metadata:', session.id)
      return new Response('Missing metadata', { status: 400 })
    }

    // Idempotency: a Stripe retry resends the same session id.
    const { data: existing } = await admin
      .from('payments')
      .select('id')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (!existing) {
      const { error } = await admin.from('payments').insert({
        community_id,
        resident_id,
        amount,
        stripe_session_id: session.id,
      })
      if (error) {
        console.error('Failed to insert payment:', error)
        return new Response('Insert failed', { status: 500 })
      }
    }
  }

  // Off-session autopay charges (created by charge-autopay) arrive as
  // payment_intent.succeeded. Record them the same way, dedup on the
  // PaymentIntent id. One-time hosted-checkout payments also emit this event,
  // but they're already recorded above and carry no resident_id metadata here,
  // so we only act on intents tagged autopay=true.
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    if (pi.metadata?.autopay !== 'true') {
      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    const resident_id = pi.metadata?.resident_id
    const community_id = pi.metadata?.community_id
    const amount = (pi.amount_received ?? pi.amount ?? 0) / 100

    if (!resident_id || !community_id || amount <= 0) {
      console.error('payment_intent.succeeded missing metadata:', pi.id)
      return new Response('Missing metadata', { status: 400 })
    }

    const { data: existing } = await admin
      .from('payments')
      .select('id')
      .eq('stripe_payment_intent_id', pi.id)
      .maybeSingle()

    if (!existing) {
      const { error } = await admin.from('payments').insert({
        community_id,
        resident_id,
        amount,
        stripe_payment_intent_id: pi.id,
      })
      if (error) {
        console.error('Failed to insert autopay payment:', error)
        return new Response('Insert failed', { status: 500 })
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
