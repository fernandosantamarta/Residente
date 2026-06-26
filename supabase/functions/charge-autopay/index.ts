// charge-autopay — the recurring-payment engine. Charges every autopay-enabled
// resident their community's monthly dues off-session (no resident present),
// against the default card set by set-autopay. Driven DAILY by Vercel Cron
// (/api/cron/charge-autopay → here), NOT by the browser — it runs with the
// service-role key and bypasses RLS, so it is gated behind a shared CRON_SECRET.
//
// COLLECT ONCE PER MONTH, then RETRY/PAUSE on decline. The daily cadence powers a
// dunning loop without ever double-charging:
//   • autopay_last_charged_period — CLAIMED ATOMICALLY to 'YYYY-MM' BEFORE the charge
//     (a conditional update that wins only if the month isn't already claimed). Set the
//     instant we claim — long before an ACH settles into `payments` — so it holds across
//     a multi-day ACH settlement window AND the daily cron, with no reliance on Stripe's
//     ~24h idempotency-key TTL. On a decline we RELEASE the claim so the next day retries.
//     FAIL-CLOSED: if the marker can't be persisted (column missing pre-migration, or a
//     DB error) we REFUSE to charge that resident — so before payment-failures.sql is run
//     this collects $0 (the safe status quo) rather than risk a daily ACH re-debit.
//   • a per-month, any-method "already paid" check skips residents who paid manually.
//   • autopay_fail_count — bumped on each off-session decline; at MAX_AUTOPAY_RETRIES
//     we PAUSE (autopay_enabled=false) so we stop hitting a dead card. The decline is
//     surfaced on the resident's Pay screen; stripe-webhook / set-autopay reset the
//     streak on recovery.
//
// ⚠ DEPLOY ORDER: run supabase/payment-failures.sql (the marker + fail-count columns)
// BEFORE enabling the daily /api/cron/charge-autopay cron. Until then this charges no one.
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
import { acctOpts, customerMatchesAccount } from '../_shared/connect.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// Decline this many times in a month → pause autopay (autopay_enabled=false) so we
// stop hammering a dead card. The resident sees the banner and re-enables once their
// card is fixed. Runs daily (vercel.json), so this is ~the first 4 days of the month.
const MAX_AUTOPAY_RETRIES = 4

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  let community_id: string | undefined
  try { community_id = (await req.json())?.community_id } catch { /* no body is fine */ }

  // Billing-month identity (UTC). `period` stamps the once-a-month guard;
  // `monthStartMs` bounds the "already paid this month" check below.
  const now = new Date()
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)

  // Autopay-enabled residents with a customer + saved method. select('*') so the
  // dunning columns (autopay_fail_count / autopay_last_charged_period) resolve
  // whether or not payment-failures.sql has run yet — pre-migration they read as
  // undefined and the atomic claim below fails closed (charges no one) until the
  // migration is applied, rather than risk an unguarded daily re-charge.
  let q = admin.from('residents')
    .select('*')
    .eq('autopay_enabled', true)
    .not('stripe_customer_id', 'is', null)
    .not('autopay_pm_id', 'is', null)
  if (community_id) q = q.eq('community_id', community_id)
  const { data: residents, error } = await q
  if (error) return new Response(`Query failed: ${error.message}`, { status: 500 })

  // Cache monthly_dues + the charge account per community. "Link, don't hold":
  // dues charge ON the community's connected account so they land with the HOA.
  const byCommunity = new Map<string, { dues: number; account: string | null }>()
  const results: { resident_id: string; status: string; detail?: string }[] = []

  for (const r of residents ?? []) {
    try {
      if (!byCommunity.has(r.community_id)) {
        const { data: c } = await admin.from('communities')
          .select('monthly_dues, stripe_account_id, stripe_connect_status').eq('id', r.community_id).single()
        const account = c?.stripe_connect_status === 'active' && c?.stripe_account_id
          ? String(c.stripe_account_id) : null
        byCommunity.set(r.community_id, { dues: Number(c?.monthly_dues) || 0, account })
      }
      const { dues, account } = byCommunity.get(r.community_id)!
      const cents = Math.round(dues * 100)
      if (cents <= 0) { results.push({ resident_id: r.id, status: 'skipped', detail: 'no dues' }); continue }

      // Cheap pre-skip from our snapshot: this month already accepted. Saves the
      // claim write below for the common already-done case. Undefined pre-migration.
      if (r.autopay_last_charged_period === period) {
        results.push({ resident_id: r.id, status: 'skipped', detail: 'already charged this month' }); continue
      }

      // Only charge when the saved method is on the SAME account we'd route dues to.
      // A method saved before the community linked Connect lives on the platform;
      // charging it there would send dues to Residente, not the HOA — skip until the
      // resident re-saves on the connected account.
      if (!customerMatchesAccount(r.stripe_customer_account, account)) {
        results.push({ resident_id: r.id, status: 'skipped', detail: 'method on different account' }); continue
      }

      // Paused: too many declines this month (autopay_enabled was flipped off when
      // we hit the cap, so this is belt-and-suspenders for an in-flight batch).
      const failCount = Number(r.autopay_fail_count) || 0
      if (failCount >= MAX_AUTOPAY_RETRIES) {
        results.push({ resident_id: r.id, status: 'skipped', detail: 'paused after repeated declines' }); continue
      }

      // Don't double-collect: the resident already covered this month's dues by ANY
      // means — a manual checkout or a settled autopay charge already in `payments`.
      // Conservative: skip only once dues are fully met for the month.
      const { data: pays } = await admin.from('payments')
        .select('amount, paid_on, created_at').eq('resident_id', r.id)
      const collectedThisMonth = (pays ?? []).reduce((s: number, p: any) => {
        const when = p?.paid_on || p?.created_at
        const ms = when ? Date.parse(when) : NaN
        return !isNaN(ms) && ms >= monthStartMs ? s + (Number(p.amount) || 0) : s
      }, 0)
      if (collectedThisMonth + 0.01 >= dues) {
        results.push({ resident_id: r.id, status: 'skipped', detail: 'dues already paid this month' }); continue
      }

      // CLAIM the month atomically BEFORE charging (claim-first, fail-closed). Flip the
      // marker to `period` only where it isn't already — the returned row proves WE won
      // the claim. This is the once-a-month idempotency guard, and because it's set the
      // instant we claim (long before an ACH settles into `payments`) it holds across a
      // multi-day ACH settlement window AND a daily cron, with no reliance on Stripe's
      // ~24h idempotency-key TTL.
      //   • claim error → the marker column isn't there yet (pre-migration) or a transient
      //     DB failure: REFUSE to charge. Without a working cross-day guard a daily ACH
      //     sweep could re-debit, so we collect nobody until payment-failures.sql is run.
      //   • no row back → another run (or an earlier accepted charge) already claimed this
      //     month → skip.
      // A lost write therefore fails toward UNDER-collection (retried tomorrow), never a
      // duplicate debit.
      const { data: claim, error: claimErr } = await admin.from('residents')
        .update({ autopay_last_charged_period: period })
        .eq('id', r.id)
        .or(`autopay_last_charged_period.is.null,autopay_last_charged_period.neq.${period}`)
        .select('id')
        .maybeSingle()
      if (claimErr) {
        results.push({ resident_id: r.id, status: 'skipped', detail: 'idempotency marker unavailable — run payment-failures.sql' }); continue
      }
      if (!claim) {
        results.push({ resident_id: r.id, status: 'skipped', detail: 'already charged this month' }); continue
      }

      // Charge. A declined off-session charge THROWS here (it never reaches the
      // webhook). The idempotency key carries the attempt (failCount) as a second
      // layer against a same-day double-fire; the month claim above is the primary
      // cross-day guard. ACH (us_bank_account) returns 'processing' and is recorded
      // by stripe-webhook on payment_intent.succeeded at settlement.
      let pi: { status?: string }
      try {
        pi = await stripe.paymentIntents.create({
          amount: cents,
          currency: 'usd',
          customer: r.stripe_customer_id,
          payment_method: r.autopay_pm_id,
          off_session: true,
          confirm: true,
          description: 'HOA dues (autopay)',
          metadata: { resident_id: r.id, community_id: r.community_id, autopay: 'true' },
        }, { idempotencyKey: `autopay-${r.id}-${period}-${failCount}`, ...acctOpts(account) })
      } catch (chargeErr) {
        // Genuine decline — surface it (the Pay screen shows a banner), RELEASE the
        // month claim so tomorrow retries, and bump the streak / PAUSE at the cap.
        const reason = (chargeErr as { raw?: { message?: string }; message?: string })?.raw?.message
          || (chargeErr as Error)?.message || 'Payment was declined'
        const nextCount = failCount + 1
        const paused = nextCount >= MAX_AUTOPAY_RETRIES
        results.push({ resident_id: r.id, status: paused ? 'failed-paused' : 'failed', detail: reason })
        // Banner (original payment-failures.sql columns) — separate write so a newer
        // missing column can't swallow it.
        try {
          await admin.from('residents').update({
            last_charge_failed_at: new Date().toISOString(),
            last_charge_fail_reason: paused
              ? `Autopay was paused after ${MAX_AUTOPAY_RETRIES} failed attempts. Update your card, then turn autopay back on.`
              : String(reason).slice(0, 300),
            last_charge_fail_kind: paused ? 'autopay_paused' : 'autopay',
          }).eq('id', r.id)
        } catch { /* shouldn't happen post-claim, but never abort the batch */ }
        // Release the claim + bump the streak + pause at the cap.
        try {
          await admin.from('residents').update({
            autopay_last_charged_period: null,
            autopay_fail_count: nextCount,
            ...(paused ? { autopay_enabled: false } : {}),
          }).eq('id', r.id)
        } catch { /* never abort the batch */ }
        continue
      }

      // Accepted — the month is already claimed; just clear any prior decline streak.
      // Best-effort so a transient write can't be mistaken for a decline.
      try {
        await admin.from('residents').update({ autopay_fail_count: 0 }).eq('id', r.id)
      } catch { /* harmless — the webhook also clears on payment_intent.succeeded */ }
      results.push({ resident_id: r.id, status: pi.status ?? 'unknown' })
    } catch (err) {
      // Operational error (a lookup, or the claim query) — NOT a charge decline, so we
      // touch no dunning state. Never let one bad row abort the batch.
      const reason = (err as { raw?: { message?: string }; message?: string })?.raw?.message
        || (err as Error)?.message || 'autopay run error'
      results.push({ resident_id: r.id, status: 'error', detail: reason })
    }
  }

  return new Response(JSON.stringify({ charged: results.length, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
