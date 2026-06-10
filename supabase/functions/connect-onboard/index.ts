// connect-onboard — starts (or resumes) Stripe Connect *Standard* onboarding for
// a community, then returns a hosted onboarding URL.
//
// "HOA links their Stripe": the HOA gets/creates its OWN Stripe account; Residente
// only stores its id and later charges dues/fines ON that account. Funds never
// touch Residente's balance. See MONEY_FLOW_PLAN.md.
//
// Admin/board only (a platform operator may pass any community_id). The account id
// is written with the service-role key (linkage columns are service-role-write only).
// The 'active' flag is set later by stripe-webhook on account.updated (charges_enabled).
//
// Deploy:  supabase functions deploy connect-onboard
// Secrets: STRIPE_SECRET_KEY, APP_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const APP_URL = Deno.env.get('APP_URL') ?? 'https://residente.io'

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await caller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({})) as { community_id?: string }
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Target community: a platform operator may link any community; otherwise the
    // caller's own community, and only a board/admin (non-resident) may link it.
    let targetId: string
    if (body.community_id) {
      const { data: isAdmin } = await admin.rpc('is_platform_admin', { uid: user.id })
      if (isAdmin !== true) return json({ error: 'Only a platform operator can link another community.' }, 403)
      targetId = body.community_id
    } else {
      const { data: profile } = await admin.from('profiles').select('community_id, role').eq('id', user.id).single()
      if (!profile?.community_id) return json({ error: 'No community to link.' }, 400)
      if (profile.role === 'resident') return json({ error: 'Only an admin can link the community Stripe account.' }, 403)
      targetId = profile.community_id
    }

    const { data: comm } = await admin.from('communities')
      .select('id, name, stripe_account_id, stripe_connect_status').eq('id', targetId).single()
    if (!comm) return json({ error: 'Community not found.' }, 404)

    // Reuse an existing connected account, or create a fresh Standard one.
    let accountId = comm.stripe_account_id as string | null
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        metadata: { community_id: comm.id, community_name: comm.name ?? '' },
      })
      accountId = account.id
      await admin.from('communities')
        .update({ stripe_account_id: accountId, stripe_connect_status: 'pending' })
        .eq('id', comm.id)
    }

    // Hosted onboarding link. refresh_url is hit if the link expires before
    // completion; return_url is where Stripe sends them when done.
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${APP_URL}/admin?connect=refresh`,
      return_url: `${APP_URL}/admin?connect=done`,
      type: 'account_onboarding',
    })

    return json({ url: link.url })
  } catch (err) {
    console.error('connect-onboard failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
