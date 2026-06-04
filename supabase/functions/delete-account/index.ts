// delete-account — lets a signed-in user permanently delete their own account.
// Service-role deletes the auth user, which cascades their profile + resident row.
//
// Owner guard: if the caller owns a community that still has OTHER members, we
// refuse and tell them to delete/hand off the community first (so we never
// orphan a live community). If they're the SOLE member, we tear the community
// down too (cancel the subscription + delete the community) so nothing keeps
// billing after they're gone.
//
// Deploy:  supabase functions deploy delete-account
// Secrets: STRIPE_SECRET_KEY (for the sole-owner subscription cancel)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient(),
})
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    const { data: profile } = await admin.from('profiles').select('community_id, role').eq('id', user.id).single()

    // Community owner / board member: protect a live community from orphaning.
    if (profile?.community_id && profile.role !== 'resident') {
      const { count } = await admin.from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('community_id', profile.community_id).neq('id', user.id)
      if (count && count > 0) {
        return json({
          error: 'You own this community. Delete the community (Management → Delete community) or hand it off before deleting your account.',
          code: 'owner_with_members',
        }, 400)
      }
      // Sole member → tear the community down so billing stops and nothing is left behind.
      const { data: comm } = await admin.from('communities')
        .select('id, stripe_subscription_id').eq('id', profile.community_id).single()
      if (comm?.stripe_subscription_id) {
        try { await stripe.subscriptions.cancel(comm.stripe_subscription_id as string) } catch (e) { console.error('sub cancel failed:', e) }
      }
      const { error: cErr } = await admin.from('communities').delete().eq('id', profile.community_id)
      if (cErr) { console.error('community delete failed:', cErr); return json({ error: 'Could not remove your community. ' + cErr.message }, 500) }
    }

    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) { console.error('deleteUser failed:', error); return json({ error: error.message }, 400) }
    return json({ ok: true })
  } catch (err) {
    console.error('delete-account failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
