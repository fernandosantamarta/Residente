// manage-subscription — in-app subscription management (no Stripe portal redirect).
// Actions: status | cancel | resume | change_plan. Admin/board only.
//
//   status       → current plan, homes, status, cancel_at_period_end, period end
//   cancel       → cancel at period end (reversible until then)
//   resume       → undo a pending cancel
//   change_plan  → set home_count and/or tier; updates the Stripe subscription
//                  item (quantity + inline price_data) with proration, and the
//                  community row. Downgrading to Free isn't a plan change — use
//                  cancel (a Free community has no subscription).
//
// Deploy:  supabase functions deploy manage-subscription
// Secrets: STRIPE_SECRET_KEY  (already set)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Optional add-ons billed as flat monthly subscription items alongside the
// per-home plan. ONLY list add-ons that are actually built — anything here can be
// purchased and charged. 'api' (public API & webhooks) and 'sso' (SSO/SAML) are
// NOT built yet, so they are intentionally absent and cannot be billed. Keep in
// sync with the ADDONS list in app/admin/billing/page.tsx.
const ADDONS: Record<string, { name: string; cents: number }> = {
  accounting: { name: 'Accounting & bank reconciliation', cents: 4900 },
}

// Bands mirror lib/plan.ts + create-subscription-checkout. A plan override lets
// the admin sit on a higher tier than their home count implies ("both" model).
function bandFor(homes: number, planOverride?: string): { plan: string; perHomeCents: number; label: string } {
  const byHomes =
    homes <= 25  ? { plan: 'free',       perHomeCents: 0,    label: 'Free' } :
    homes <= 100 ? { plan: 'pro',        perHomeCents: 200,  label: 'Village' } :
    homes <= 500 ? { plan: 'premium',    perHomeCents: 400,  label: 'Town' } :
                   { plan: 'enterprise', perHomeCents: 600,  label: 'City' }
  if (!planOverride || planOverride === byHomes.plan) return byHomes
  const rates: Record<string, { perHomeCents: number; label: string }> = {
    pro:        { perHomeCents: 200,  label: 'Village' },
    premium:    { perHomeCents: 400,  label: 'Town' },
    enterprise: { perHomeCents: 600,  label: 'City' },
  }
  const r = rates[planOverride]
  return r ? { plan: planOverride, perHomeCents: r.perHomeCents, label: r.label } : byHomes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({})) as { action?: string; home_count?: number; plan?: string; addons?: string[] }
    const action = body.action || 'status'

    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { data: profile } = await supabase
      .from('profiles').select('community_id, role').eq('id', user.id).single()
    if (!profile?.community_id) return json({ error: 'No community' }, 400)
    if (profile.role === 'resident') return json({ error: 'Only an admin can manage billing.' }, 403)

    const { data: community } = await supabase
      .from('communities')
      .select('id, home_count, unit_count, plan, subscription_status, stripe_subscription_id')
      .eq('id', profile.community_id).single()
    if (!community) return json({ error: 'Community not found' }, 404)

    const subId = community.stripe_subscription_id as string | null
    const homes = Number(community.home_count ?? community.unit_count ?? 0)

    if (action === 'status') {
      let cancelAtPeriodEnd = false
      let periodEnd: number | null = null
      let addons: string[] = []
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId)
          cancelAtPeriodEnd = sub.cancel_at_period_end
          periodEnd = sub.current_period_end
          addons = sub.items.data.map((i) => i.metadata?.addon).filter((k): k is string => !!k && !!ADDONS[k])
        } catch { /* sub may be gone — treat as none */ }
      }
      // Mirror the accounting entitlement onto the community row so the app can
      // gate the /admin/accounting workspace cheaply. Best-effort; never blocks.
      try {
        const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
        await admin.from('communities').update({ accounting_addon: addons.includes('accounting') }).eq('id', community.id)
      } catch { /* cache refresh is best-effort */ }
      return json({
        plan: community.plan, homes, status: community.subscription_status,
        cancel_at_period_end: cancelAtPeriodEnd, current_period_end: periodEnd,
        has_subscription: Boolean(subId), addons,
      })
    }

    if (action === 'cancel' || action === 'resume') {
      if (!subId) return json({ error: 'No active subscription.' }, 400)
      const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: action === 'cancel' })
      return json({ ok: true, cancel_at_period_end: sub.cancel_at_period_end, current_period_end: sub.current_period_end })
    }

    if (action === 'change_plan') {
      const newHomes = body.home_count != null && !Number.isNaN(Number(body.home_count))
        ? Math.max(1, Math.floor(Number(body.home_count))) : homes
      const band = bandFor(newHomes, body.plan)
      if (band.perHomeCents === 0) {
        return json({ error: 'That size is on the Free plan — cancel your subscription instead of changing plans.' }, 400)
      }
      if (!subId) return json({ error: 'No active subscription to change. Subscribe first.' }, 400)

      const wantAddons = Array.isArray(body.addons)
        ? [...new Set(body.addons.filter((a): a is string => typeof a === 'string' && !!ADDONS[a]))]
        : []

      const sub = await stripe.subscriptions.retrieve(subId)
      // Base = the one item not tagged as an add-on (the per-home plan).
      const baseItem = sub.items.data.find((i) => !i.metadata?.addon) || sub.items.data[0]
      if (!baseItem) return json({ error: 'Subscription has no line item.' }, 400)

      // Subscription-item price_data only accepts an existing `product` id (not
      // inline product_data, which is Checkout-only). prices.create DOES accept
      // product_data, so we mint a recurring price first and attach it by id.
      const basePrice = await stripe.prices.create({
        currency: 'usd', unit_amount: band.perHomeCents, recurring: { interval: 'month' },
        product_data: { name: `Residente — ${band.label} plan` },
      })

      const items: Record<string, unknown>[] = [{ id: baseItem.id, price: basePrice.id, quantity: newHomes }]
      // Reconcile add-on items: keep selected, delete deselected, add new.
      const stillWanted = new Set(wantAddons)
      for (const it of sub.items.data) {
        const key = it.metadata?.addon
        if (!key || !ADDONS[key]) continue
        if (stillWanted.has(key)) { stillWanted.delete(key) }
        else { items.push({ id: it.id, deleted: true }) }
      }
      for (const key of stillWanted) {
        const a = ADDONS[key]
        const addonPrice = await stripe.prices.create({
          currency: 'usd', unit_amount: a.cents, recurring: { interval: 'month' },
          product_data: { name: `Residente — ${a.name}` },
        })
        items.push({ price: addonPrice.id, quantity: 1, metadata: { addon: key } })
      }

      await stripe.subscriptions.update(subId, {
        items: items as unknown as Stripe.SubscriptionUpdateParams.Item[],
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false,
      })

      // Billing columns are service-role only (RLS) — use the admin client.
      const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      const { error } = await admin.from('communities').update({
        home_count: newHomes, unit_count: newHomes, plan: band.plan, subscription_status: 'active',
        accounting_addon: wantAddons.includes('accounting'),
      }).eq('id', community.id)
      if (error) { console.error('community update failed:', error); return json({ error: 'Plan updated in Stripe but the community record failed to save.' }, 500) }

      return json({ ok: true, plan: band.plan, label: band.label, homes: newHomes, monthly_cents: band.perHomeCents * newHomes })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    console.error('manage-subscription failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
