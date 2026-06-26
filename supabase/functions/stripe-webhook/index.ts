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

// Add N business days (skips Sat/Sun) — the estoppel statutory delivery clock.
// Holidays are not modeled here; the board can adjust the due date in the
// worklist. Mirrors lib/compliance/rules-core businessDayDeadline (weekday-only).
function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  let added = 0
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return d
}

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
  // A successful payment clears any prior off-session failure banner. Best-effort.
  await clearChargeFailure(resident_id)
  if (plan_id) await advancePlan(plan_id)
  return received()
}

// Clears the off-session failure flag on a resident once any payment lands
// (manual or autopay), so the "payment didn't go through" banner disappears and
// the dunning retry streak resets. Best-effort: a missing column (payment-
// failures.sql not run yet) is ignored.
async function clearChargeFailure(residentId: string | null | undefined) {
  if (!residentId) return
  try {
    await admin.from('residents').update({
      last_charge_failed_at: null, last_charge_fail_reason: null, last_charge_fail_kind: null,
    }).eq('id', residentId)
  } catch { /* column may not exist yet */ }
  // Reset the autopay decline streak separately so a not-yet-migrated column
  // can't keep the banner above from clearing.
  try {
    await admin.from('residents').update({ autopay_fail_count: 0 }).eq('id', residentId)
  } catch { /* autopay_fail_count not migrated yet */ }
}

const escapeHtml = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Email the board when their platform subscription payment fails, so they can
// fix it before service is interrupted. Best-effort: no RESEND_API_KEY (or no
// board emails) just skips silently. Mirrors the work-order-notify-vendor send.
async function emailBoardSubscriptionFailed(subscriptionId: string) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) return
  const FROM = Deno.env.get('NOTIFY_FROM') || 'Residente <onboarding@resend.dev>'
  const APP_URL = Deno.env.get('APP_URL') || 'https://residente.io'

  const { data: community } = await admin.from('communities')
    .select('id, name').eq('stripe_subscription_id', subscriptionId).single()
  if (!community) return
  const { data: board } = await admin.from('profiles')
    .select('email').eq('community_id', community.id).in('role', ['board_member', 'admin'])
  const emails = [...new Set((board ?? []).map((b: { email?: string }) => b.email).filter(Boolean))] as string[]
  if (!emails.length) return

  const name = String(community.name || 'your community')
  const safe = escapeHtml(name)
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#1F2233;line-height:1.55;max-width:520px;margin:0 auto;padding:24px;">
      <div style="display:inline-block;padding:4px 10px;background:#E14909;color:#fff;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Payment failed</div>
      <h1 style="font-size:19px;margin:0 0 8px;">Your Residente payment didn't go through</h1>
      <p style="font-size:14px;color:#555;margin:0 0 18px;">The latest subscription payment for <strong>${safe}</strong> was declined. Update your payment method to keep ${safe} running — there's no interruption if you update it soon.</p>
      <p style="margin:0 0 8px;"><a href="${APP_URL}/admin/billing" style="display:inline-block;background:#E14909;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Update payment method</a></p>
      <p style="font-size:12px;color:#8a8e9c;margin-top:24px;">You're receiving this because you're listed as a board member or admin for ${safe} on Residente.</p>
    </div>`.trim()

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: emails, subject: `Payment failed — ${name}`, html }),
  })
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
        // Add-on selected at checkout → unlock the accounting workspace now (it
        // bills with the plan when the trial ends). Only ever set true here so a
        // plain subscribe never clobbers an add-on toggled elsewhere.
        ...(session.metadata?.accounting_addon === 'true' ? { accounting_addon: true } : {}),
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

    // Estoppel public front door (create-estoppel-checkout) carries an
    // estoppel_token. The fee is now paid, so CREATE the estoppel request in the
    // board's worklist (service role). The statutory delivery clock starts at
    // receipt = payment time. Idempotent: stripe_session_id is unique, so a Stripe
    // retry that hits the dedup constraint is swallowed.
    const estoppel_token = session.metadata?.estoppel_token
    if (estoppel_token) {
      const expedited = session.metadata?.expedited === '1'
      const feeBase = Number(session.metadata?.fee_base) || 0
      const feeExpedited = Number(session.metadata?.fee_expedited) || 0
      const feeTotal = Number(session.metadata?.fee_total) || ((session.amount_total ?? 0) / 100)
      const receivedAt = new Date()
      const dueAt = addBusinessDays(receivedAt, expedited ? 3 : 10)
      const { error } = await admin.from('ev_estoppel_requests').insert({
        community_id: session.metadata?.community_id,
        requestor_name: session.metadata?.requestor_name || null,
        requestor_email: session.metadata?.requestor_email || null,
        requestor_type: session.metadata?.requestor_type || 'mortgagee',
        unit_label: session.metadata?.unit_label || null,
        request_method: 'electronic',
        received_at: receivedAt.toISOString().slice(0, 10),
        due_at: dueAt.toISOString().slice(0, 10),
        expedited,
        status: 'new',
        fee_base: feeBase,
        fee_expedited: feeExpedited,
        fee_total: feeTotal,
        fee_paid: true,
        paid_via_stripe: true,
        stripe_session_id: session.id,
      })
      // 23505 = unique violation on stripe_session_id (a retry) → treat as success.
      if (error && (error as any).code !== '23505') {
        console.error('Failed to create paid estoppel request:', error)
        return new Response('Insert failed', { status: 500 })
      }
      return received()
    }

    // Special-assessment checkout (create-special-assessment-checkout) carries a
    // special_assessment_charge_id. Flip that per-unit charge to paid on its own
    // row (it never lands in public.payments, mirroring fines, so the dues
    // balance stays clean). Idempotent: the status='pending' guard makes a Stripe
    // retry a no-op, and an already-paid charge stays paid.
    const sa_charge_id = session.metadata?.special_assessment_charge_id
    if (sa_charge_id) {
      const { error } = await admin
        .from('ev_special_assessment_charges')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_session_id: session.id,
          payment_account_id: event.account ?? null,
        })
        .eq('id', sa_charge_id)
        .eq('status', 'pending')
      if (error) {
        console.error('Failed to mark special assessment charge paid:', error)
        return new Response('Update failed', { status: 500 })
      }
      return received()
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
      await clearChargeFailure(resident_id)
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
      // Proactively email the board — past_due was previously only discoverable
      // by opening /admin/billing. Best-effort: never fail the webhook on email.
      try { await emailBoardSubscriptionFailed(inv.subscription) } catch (e) { console.error('board payment-failed email:', e) }
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
