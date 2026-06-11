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
// ACH (us_bank_account) dues are async: the card path records at completion
// (payment_status 'paid'); a bank debit completes 'unpaid' and is recorded ONLY
// when it settles, via `checkout.session.async_payment_succeeded`. A debit that
// returns AFTER settling (charge.refunded) or is charged back
// (charge.dispute.created) posts a NEGATIVE contra `payments` row that nets the
// resident's balance back. These run on each HOA's CONNECTED account (the events
// carry event.account) — we map by ids/metadata only, so no per-account API call.
//
// Stripe destinations must subscribe to: checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// charge.refunded, charge.dispute.created, payment_intent.succeeded, plus the
// platform subscription events.
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and (optional)
//          STRIPE_WEBHOOK_SECRET_CONNECT for the Connected-accounts destination
//          (see supabase/README.md)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
// Deno needs the async SubtleCrypto provider for signature verification.
const cryptoProvider = Stripe.createSubtleCryptoProvider()

// Two possible signing secrets: the platform-account destination, and a separate
// "Connected accounts" destination (Connect direct charges + account.updated fire
// on the connected account, signed with that destination's own secret). We try
// each; either valid signature is accepted. STRIPE_WEBHOOK_SECRET_CONNECT is
// optional — until the Connect destination exists, only the first is set.
const WEBHOOK_SECRETS = [
  Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '',
  Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT') ?? '',
].filter(Boolean)

// Service-role client — bypasses RLS so the webhook can insert payments.
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// Advance a payment plan after one installment is recorded: bump paid_count,
// roll next_due_at forward by frequency_days, and complete the plan (clearing
// the case's on_payment_plan flag) once every installment is paid. Called only
// inside a first-time payment insert so a Stripe retry can't double-advance.
async function advancePlan(planId: string) {
  const { data: plan } = await admin
    .from('ev_payment_plans')
    .select('id, case_id, status, paid_count, installment_count, frequency_days, next_due_at')
    .eq('id', planId)
    .maybeSingle()
  if (!plan || plan.status !== 'active') return

  const paid = (plan.paid_count ?? 0) + 1
  const done = plan.installment_count != null && paid >= plan.installment_count
  const base = plan.next_due_at ? new Date(`${plan.next_due_at}T00:00:00Z`) : new Date()
  base.setUTCDate(base.getUTCDate() + (plan.frequency_days || 30))
  const nextDue = base.toISOString().slice(0, 10)

  await admin.from('ev_payment_plans').update({
    paid_count: paid,
    next_due_at: done ? null : nextDue,
    status: done ? 'completed' : 'active',
  }).eq('id', plan.id)

  if (done && plan.case_id) {
    await admin.from('ev_collection_cases')
      .update({ on_payment_plan: false })
      .eq('id', plan.case_id)
  }
}

const received = () => new Response(JSON.stringify({ received: true }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
})

// Record a one-time dues / installment payment from a Checkout Session, ONLY once
// the money has moved. Called for instant card payments (checkout.session.completed
// with payment_status 'paid') and for settled ACH debits
// (checkout.session.async_payment_succeeded — fires after the bank transfer clears,
// never at authorization). Dedups on stripe_session_id so a Stripe retry can't
// double-record. Stores the PaymentIntent id too, so a later return / dispute /
// refund can map the charge back to this row (see recordReversal).
async function recordDuesPayment(session: Stripe.Checkout.Session): Promise<Response> {
  const resident_id = session.metadata?.resident_id
  const community_id = session.metadata?.community_id
  const amount = (session.amount_total ?? 0) / 100
  const plan_id = session.metadata?.plan_id || null
  const installment_no = session.metadata?.installment_no != null
    ? Number(session.metadata.installment_no) : null
  const charge_type = session.metadata?.charge_type || null
  const payment_intent_id = typeof session.payment_intent === 'string'
    ? session.payment_intent : null

  if (!resident_id || !community_id || amount <= 0) {
    console.error('dues session missing metadata:', session.id)
    return new Response('Missing metadata', { status: 400 })
  }

  const { data: existing } = await admin
    .from('payments').select('id').eq('stripe_session_id', session.id).maybeSingle()
  if (existing) return received()

  // For an installment, tag the payment to the plan's collection case too.
  let applied_to_case: string | null = null
  if (plan_id) {
    const { data: planRow } = await admin
      .from('ev_payment_plans').select('case_id').eq('id', plan_id).maybeSingle()
    applied_to_case = planRow?.case_id ?? null
  }

  const { error } = await admin.from('payments').insert({
    community_id,
    resident_id,
    amount,
    stripe_session_id: session.id,
    ...(payment_intent_id ? { stripe_payment_intent_id: payment_intent_id } : {}),
    ...(charge_type ? { charge_type } : {}),
    ...(plan_id ? { applied_to_plan: plan_id, installment_no } : {}),
    ...(applied_to_case ? { applied_to_case } : {}),
  })
  if (error) {
    console.error('Failed to insert payment:', error)
    return new Response('Insert failed', { status: 500 })
  }
  if (plan_id) await advancePlan(plan_id)
  return received()
}

// Post a contra `payments` row that nets out a settled dues charge which later
// reversed — an ACH return (charge.refunded) or a chargeback
// (charge.dispute.created). lib/dues.ts sums payments.amount, so a negative row
// restores the resident's balance automatically. Idempotent: keyed on
// `${pi}:reversal`, so a refund + dispute on the same charge (or a Stripe retry)
// reverses only once. `reversalCents` is the reversed amount in cents (0 ⇒ full).
async function recordReversal(pi: string | null, reversalCents: number) {
  if (!pi) return
  const { data: orig } = await admin
    .from('payments')
    .select('community_id, resident_id, amount, charge_type, applied_to_case')
    .eq('stripe_payment_intent_id', pi)
    .gt('amount', 0)
    .maybeSingle()
  if (!orig || !orig.resident_id) return // not one of our dues charges

  const reversalKey = `${pi}:reversal`
  const { data: already } = await admin
    .from('payments').select('id').eq('stripe_payment_intent_id', reversalKey).maybeSingle()
  if (already) return

  const original = Math.abs(Number(orig.amount) || 0)
  const reversed = reversalCents > 0 ? Math.min(reversalCents / 100, original) : original
  if (reversed <= 0) return

  const { error } = await admin.from('payments').insert({
    community_id: orig.community_id,
    resident_id: orig.resident_id,
    amount: -reversed,
    stripe_payment_intent_id: reversalKey,
    ...(orig.charge_type ? { charge_type: orig.charge_type } : {}),
    ...(orig.applied_to_case ? { applied_to_case: orig.applied_to_case } : {}),
  })
  if (error) console.error('Failed to record reversal for', pi, error)
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing stripe-signature', { status: 400 })

  const body = await req.text()
  let event: Stripe.Event | null = null
  let lastErr = 'no signing secret configured'
  for (const secret of WEBHOOK_SECRETS) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, secret, undefined, cryptoProvider)
      break
    } catch (err) {
      lastErr = (err as Error).message
    }
  }
  if (!event) {
    console.error('Signature verification failed:', lastErr)
    return new Response(`Bad signature: ${lastErr}`, { status: 400 })
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
        // payment_account_id = the connected account this was charged on (null on
        // the legacy platform), so refund-amenity later refunds on the same account.
        .update({ payment_status: 'paid', stripe_session_id: session.id, payment_account_id: event.account ?? null })
        .eq('id', reservation_id)
      if (error) {
        console.error('Failed to mark reservation paid:', error)
        return new Response('Update failed', { status: 500 })
      }
      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // One-time dues / installment payment. Record ONLY when the money has actually
    // moved. A card checkout completes with payment_status 'paid' → record now. An
    // ACH (us_bank_account) debit completes 'unpaid'/'processing' and settles days
    // later via checkout.session.async_payment_succeeded → skip here, record at
    // settlement. We never write a payments row for an in-flight ACH debit.
    if (session.payment_status === 'paid') {
      return await recordDuesPayment(session)
    }
    return received()
  }

  // Settled ACH (us_bank_account) Checkout debit — fires only after the bank
  // transfer clears, never at authorization. This is where an ACH dues payment is
  // FIRST recorded. Card checkouts never emit this event, so there is no
  // double-record with checkout.session.completed above.
  if (event.type === 'checkout.session.async_payment_succeeded') {
    return await recordDuesPayment(event.data.object as Stripe.Checkout.Session)
  }

  // ACH debit failed before it ever settled (account closed / insufficient funds
  // at submission). No payments row was written at authorization, so there is
  // nothing to reverse — just acknowledge. A LATE return, after a successful
  // settlement, arrives instead as charge.refunded / charge.dispute.created below.
  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object as Stripe.Checkout.Session
    console.log('ACH checkout failed before settlement:', session.id)
    return received()
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
    // Plan-installment autopay (charge-plan-installment) tags these too.
    const plan_id = pi.metadata?.plan_id || null
    const installment_no = pi.metadata?.installment_no != null
      ? Number(pi.metadata.installment_no) : null
    const charge_type = pi.metadata?.charge_type || null

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
      let applied_to_case: string | null = null
      if (plan_id) {
        const { data: planRow } = await admin
          .from('ev_payment_plans').select('case_id').eq('id', plan_id).maybeSingle()
        applied_to_case = planRow?.case_id ?? null
      }

      const { error } = await admin.from('payments').insert({
        community_id,
        resident_id,
        amount,
        stripe_payment_intent_id: pi.id,
        ...(charge_type ? { charge_type } : {}),
        ...(plan_id ? { applied_to_plan: plan_id, installment_no } : {}),
        ...(applied_to_case ? { applied_to_case } : {}),
      })
      if (error) {
        console.error('Failed to insert autopay payment:', error)
        return new Response('Insert failed', { status: 500 })
      }
      if (plan_id) await advancePlan(plan_id)
    }
  }

  // Platform subscription lifecycle — keep communities.subscription_status
  // current on renewals, failures, and cancellations. Keyed by the stored
  // stripe_subscription_id. (Requires these events on the webhook endpoint.)
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    await admin.from('communities')
      .update({ subscription_status: 'cancelled' })
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

  // Amenity refund reconciliation — keeps the reservation in sync when a refund
  // is issued from the Stripe dashboard (the refund-amenity function already
  // records its own refunds, so we skip rows already marked refunded). Map the
  // charge → checkout session → reservation via stripe_session_id.
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    const pi = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id
    if (pi) {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 })
      const sid = sessions.data[0]?.id
      if (sid) {
        await admin.from('ev_amenity_reservations')
          .update({
            status: 'cancelled',
            refund_status: 'refunded',
            stripe_refund_id: charge.refunds?.data?.[0]?.id ?? null,
            refunded_at: new Date().toISOString(),
            refund_amount_cents: charge.amount_refunded ?? null,
          })
          .eq('stripe_session_id', sid)
          .neq('refund_status', 'refunded')
      }
    }

    // Dues ACH return / refund — if this charge maps to a recorded dues payment,
    // post a contra row for the refunded amount. Amenity charges (handled above)
    // have no payments row, so this no-ops for them.
    await recordReversal(pi ?? null, charge.amount_refunded ?? 0)
  }

  // Chargeback on a dues payment (incl. an ACH "unauthorized" late return). Post a
  // contra row so the balance reflects the clawed-back funds. dispute.amount is in
  // cents; the `${pi}:reversal` key is shared with charge.refunded, so a charge
  // that both refunds and disputes is reversed only once.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute
    const pi = typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? null
    await recordReversal(pi, dispute.amount ?? 0)
  }

  // Connect Standard onboarding — a community's OWN linked account finished setup.
  // Flip it to 'active' once Stripe will accept charges; back to 'pending' if not.
  // Delivered to this endpoint only when "Listen to Connect events" is enabled.
  // Keyed by the account id (event.account on connected events, or the object id).
  if (event.type === 'account.updated') {
    const acct = event.data.object as Stripe.Account
    const acctId = acct.id ?? event.account
    if (acctId) {
      await admin.from('communities')
        .update({ stripe_connect_status: acct.charges_enabled ? 'active' : 'pending' })
        .eq('stripe_account_id', acctId)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
