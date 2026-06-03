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

    // Platform subscription (the community paying Residente). Flip the community
    // to active and store the Stripe ids. Idempotent: a retry re-runs the same
    // UPDATE harmlessly. This is separate from the resident dues flow below.
    if (session.mode === 'subscription') {
      const community_id = session.metadata?.community_id
      const plan = session.metadata?.plan
      if (!community_id) {
        console.error('subscription checkout missing community_id:', session.id)
        return new Response('Missing metadata', { status: 400 })
      }
      const { error } = await admin.from('communities').update({
        subscription_status: 'active',
        ...(plan ? { plan } : {}),
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
        stripe_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
      }).eq('id', community_id)
      if (error) {
        console.error('Failed to activate community subscription:', error)
        return new Response('Update failed', { status: 500 })
      }
      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // `setup` sessions (saving a card) carry no payment — ignore them here.
    if (session.mode !== 'payment') {
      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fine checkout (create-fine-checkout) carries a violation_id. Close the
    // violation as stripe-paid. Idempotent: a Stripe retry re-runs the same
    // UPDATE harmlessly, and an already-closed fine stays closed.
    const violation_id = session.metadata?.violation_id
    if (violation_id) {
      const { error } = await admin
        .from('ev_violations')
        .update({
          status: 'closed',
          resolution: 'stripe-paid',
          stripe_invoice_id: session.id,
          closed_at: new Date().toISOString().slice(0, 10),
        })
        .eq('id', violation_id)
      if (error) {
        console.error('Failed to close fine as paid:', error)
        return new Response('Update failed', { status: 500 })
      }
      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Amenity reservation checkout (create-amenity-checkout) carries a
    // reservation_id instead of a resident_id. Flip that reservation to paid.
    // Idempotent: a Stripe retry re-runs the same UPDATE harmlessly.
    const reservation_id = session.metadata?.reservation_id
    if (reservation_id) {
      const { error } = await admin
        .from('ev_amenity_reservations')
        .update({ payment_status: 'paid', stripe_session_id: session.id })
        .eq('id', reservation_id)
      if (error) {
        console.error('Failed to mark reservation paid:', error)
        return new Response('Update failed', { status: 500 })
      }
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

  // Platform subscription lifecycle — keep communities.subscription_status
  // current on renewals, failures, and cancellations. Keyed by the stored
  // stripe_subscription_id. (Requires these events on the webhook endpoint.)
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    await admin.from('communities')
      .update({ subscription_status: 'canceled' })
      .eq('stripe_subscription_id', sub.id)
  }
  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as Stripe.Invoice
    if (typeof inv.subscription === 'string') {
      await admin.from('communities')
        .update({ subscription_status: 'past_due' })
        .eq('stripe_subscription_id', inv.subscription)
    }
  }
  if (event.type === 'invoice.paid') {
    const inv = event.data.object as Stripe.Invoice
    if (typeof inv.subscription === 'string') {
      await admin.from('communities')
        .update({ subscription_status: 'active' })
        .eq('stripe_subscription_id', inv.subscription)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
