// create-estoppel-checkout — the PUBLIC estoppel front door for title/closing
// companies (no Residente login).
//
// Two actions, selected by the request body:
//   { token, action: 'info' }                 → returns community name/type + fees
//   { token, requestor_name, requestor_email,  → creates a Stripe Checkout session
//     requestor_type, unit_label, expedited }     and returns { url }
//
// UNAUTHENTICATED by design: the title company has no account. Safety comes from
// (1) the opaque per-community token (estoppel_public_token) + an on/off switch
// (estoppel_public_enabled), validated here with the SERVICE ROLE key, and
// (2) money only ever flows TO the community's connected Stripe account. We never
// create the ev_estoppel_requests row here — the stripe-webhook does, only after
// the fee is actually paid, so an unpaid POST can't spam the board's worklist.
//
// Statutory fee (FS 718.116(8)(d) / 720.30851; 2022 CPI): base $299 + expedited
// $119. The delinquency add-on ($179) is the board's call at issuance, so it is
// NOT charged at the public front door. ⚠ Confirm current DBPR figures.
//
// Deploy:  supabase functions deploy create-estoppel-checkout --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, APP_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'
import { connectedAccountFor, acctOpts } from '../_shared/connect.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const APP_URL = Deno.env.get('APP_URL') ?? 'https://residente.io'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Statutory fee constants (mirror lib/compliance/estoppel.ts; 2022 CPI).
const FEE_BASE = 299
const FEE_EXPEDITED = 119

const REQUESTOR_TYPES = ['owner', 'owner_designee', 'mortgagee', 'mortgagee_designee']

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!SERVICE_ROLE) return json({ error: 'Server not configured' }, 500)

  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body?.token || '').trim()
    if (!token) return json({ error: 'Missing link token' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: community } = await admin
      .from('communities')
      .select('id, name, association_type, estoppel_public_enabled')
      .eq('estoppel_public_token', token)
      .maybeSingle()
    if (!community) return json({ error: 'This estoppel request link is not valid.' }, 404)
    if (!community.estoppel_public_enabled) {
      return json({ error: 'This community is not accepting estoppel requests online right now.', code: 'disabled' }, 403)
    }

    // --- action: info (drives the public form) ---
    if (body?.action === 'info') {
      return json({
        ok: true,
        community_name: community.name,
        association_type: community.association_type || 'condo',
        base_fee: FEE_BASE,
        expedited_fee: FEE_EXPEDITED,
      })
    }

    // --- action: checkout ---
    const requestor_name = String(body?.requestor_name || '').trim()
    const requestor_email = String(body?.requestor_email || '').trim()
    const requestor_type = String(body?.requestor_type || 'mortgagee').trim()
    const unit_label = String(body?.unit_label || '').trim()
    const expedited = !!body?.expedited
    if (!requestor_name) return json({ error: 'Please enter the requesting party name.' }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(requestor_email)) return json({ error: 'Please enter a valid email.' }, 400)
    if (!unit_label) return json({ error: 'Please enter the unit / parcel.' }, 400)
    const rType = REQUESTOR_TYPES.includes(requestor_type) ? requestor_type : 'mortgagee'

    const feeBase = FEE_BASE
    const feeExpedited = expedited ? FEE_EXPEDITED : 0
    const feeTotal = feeBase + feeExpedited
    const cents = Math.round(feeTotal * 100)

    const connectedAccount = await connectedAccountFor(admin, community.id)

    const meta: Record<string, string> = {
      estoppel_token: token,
      community_id: community.id,
      requestor_name,
      requestor_email,
      requestor_type: rType,
      unit_label,
      expedited: expedited ? '1' : '0',
      fee_base: String(feeBase),
      fee_expedited: String(feeExpedited),
      fee_total: String(feeTotal),
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: requestor_email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: `Estoppel certificate${expedited ? ' (expedited)' : ''}`,
            description: `${community.name} — ${unit_label}`,
          },
        },
      }],
      success_url: `${APP_URL}/estoppel-request/${token}/success`,
      cancel_url: `${APP_URL}/estoppel-request/${token}`,
      metadata: meta,
      payment_intent_data: { metadata: meta },
    }, acctOpts(connectedAccount))

    return json({ url: session.url })
  } catch (err) {
    console.error('create-estoppel-checkout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
