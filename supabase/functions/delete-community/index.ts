// delete-community — permanently deletes the caller's community and everything
// in it. Admin/board only. Cancels the Stripe subscription, then deletes the
// communities row; every community_id FK is ON DELETE CASCADE, so child data
// (residents, documents, violations, meetings, …) and member profiles go with
// it in one atomic statement. If some FK is restrictive it errors atomically
// with zero partial deletion, so this is safe to retry.
//
// Member auth logins are left intact (orphaned) — they can sign up fresh. The
// caller's own login survives too; the client signs them out afterward.
//
// Deploy:  supabase functions deploy delete-community
// Secrets: STRIPE_SECRET_KEY

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

    const body = await req.json().catch(() => ({})) as { community_id?: string }
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Target community: a platform owner/operator can pass any community_id
    // (Platform Console) — support/billing staff cannot delete communities.
    // platform_roles returns the operator's full team set (primary + extras);
    // before operator-multi-role.sql it doesn't exist, so fall back to the
    // single primary role. Otherwise it's the caller's own community.
    let targetId: string
    if (body.community_id) {
      let roles: string[] = []
      const { data: set, error: setErr } = await admin.rpc('platform_roles', { uid: user.id })
      if (!setErr && Array.isArray(set)) roles = set
      else {
        const { data: role } = await admin.rpc('platform_role', { uid: user.id })
        if (role) roles = [role]
      }
      if (!roles.includes('owner') && !roles.includes('operator')) return json({ error: 'Only a platform owner/operator can delete another community.' }, 403)
      targetId = body.community_id
    } else {
      const { data: profile } = await admin.from('profiles').select('community_id, role').eq('id', user.id).single()
      if (!profile?.community_id) return json({ error: 'No community to delete.' }, 400)
      if (profile.role === 'resident') return json({ error: 'Only an admin can delete the community.' }, 403)
      targetId = profile.community_id
    }

    const { data: comm } = await admin.from('communities')
      .select('id, stripe_subscription_id').eq('id', targetId).single()
    if (comm?.stripe_subscription_id) {
      try { await stripe.subscriptions.cancel(comm.stripe_subscription_id as string) } catch (e) { console.error('sub cancel failed:', e) }
    }

    const { error } = await admin.from('communities').delete().eq('id', targetId)
    if (error) { console.error('community delete failed:', error); return json({ error: 'Could not delete the community. ' + error.message }, 500) }
    return json({ ok: true })
  } catch (err) {
    console.error('delete-community failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
