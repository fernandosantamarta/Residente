// delete-account — lets a signed-in user permanently delete their own account.
// Service-role deletes the auth user, which cascades their profile + resident row.
//
// Owner guard (Option B — a community is owned COLLECTIVELY by its board, not by
// one person): the community survives one board member leaving as long as ANOTHER
// board member / admin remains. We only refuse when deleting would remove the LAST
// one from a community that still has other members (tell them to promote someone
// first). If they're the SOLE member, we tear the community down too (cancel the
// subscription + delete the community) so nothing keeps billing after they're gone.
// If the departing user was the named owner, the owner pointer is handed to
// another board member/admin so the community always has one.
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

    // Community board member: keep a live community from being orphaned, but the
    // community is owned collectively — one board member leaving is fine if another
    // remains.
    if (profile?.community_id && profile.role !== 'resident') {
      const cid = profile.community_id
      const { count: others } = await admin.from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('community_id', cid).neq('id', user.id)

      if (others && others > 0) {
        // The community lives on — but it must always keep at least one board
        // member / admin. Block only if this is the last one.
        const { count: otherBoard } = await admin.from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('community_id', cid).neq('id', user.id)
          .in('role', ['board_member', 'admin'])
        if (!otherBoard || otherBoard === 0) {
          return json({
            error: 'You’re the only admin of this community. Make another member a board member or admin (Easy Voice → Board) before deleting your account, so it isn’t left without one — or delete the community from Management.',
            code: 'last_admin_with_members',
          }, 400)
        }
        // Another board member remains. If the owner pointer was us, hand it off
        // so the community always has a named owner.
        const { data: comm } = await admin.from('communities')
          .select('owner_profile_id').eq('id', cid).single()
        if (comm?.owner_profile_id === user.id) {
          const { data: next } = await admin.from('profiles')
            .select('id').eq('community_id', cid).neq('id', user.id)
            .in('role', ['board_member', 'admin']).limit(1).maybeSingle()
          await admin.from('communities').update({ owner_profile_id: next?.id ?? null }).eq('id', cid)
        }
        // Fall through: deleting the auth user cascades away just this membership.
      } else {
        // Sole member → tear the community down so billing stops and nothing's left.
        const { data: comm } = await admin.from('communities')
          .select('id, stripe_subscription_id').eq('id', cid).single()
        if (comm?.stripe_subscription_id) {
          try { await stripe.subscriptions.cancel(comm.stripe_subscription_id as string) } catch (e) { console.error('sub cancel failed:', e) }
        }
        const { error: cErr } = await admin.from('communities').delete().eq('id', cid)
        if (cErr) { console.error('community delete failed:', cErr); return json({ error: 'Could not remove your community. ' + cErr.message }, 500) }
      }
    }

    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) { console.error('deleteUser failed:', error); return json({ error: error.message }, 400) }
    return json({ ok: true })
  } catch (err) {
    console.error('delete-account failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
