// plaid-link-exchange — swaps the Plaid public_token (from Link) for a long-lived
// access_token and stores it in plaid_items (service-role-only table; the token is
// never exposed to any client). Marks the community plaid_status='active'.
// Board/admin only. Read-only relationship: we never move money.
//
// Deploy:  supabase functions deploy plaid-link-exchange
// Secrets: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'
import { plaid } from '../_shared/plaid.ts'

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { public_token, institution_name } = await req.json().catch(() => ({}))
    if (!public_token || typeof public_token !== 'string') {
      return json({ error: 'public_token is required' }, 400)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await caller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: profile } = await admin.from('profiles').select('community_id, role').eq('id', user.id).single()
    if (!profile?.community_id) return json({ error: 'No community to link.' }, 400)
    if (profile.role === 'resident') return json({ error: 'Only an admin can link the community bank.' }, 403)
    const communityId = profile.community_id as string

    const exchange = await plaid('/item/public_token/exchange', { public_token })
    const accessToken = exchange.access_token as string
    const itemId = exchange.item_id as string

    // Store the token in the service-role-only vault. Upsert on plaid_item_id so a
    // re-link of the same Item refreshes the token instead of duplicating.
    const { data: item, error: itemErr } = await admin.from('plaid_items')
      .upsert({
        community_id: communityId,
        plaid_item_id: itemId,
        access_token: accessToken,
        institution_name: institution_name ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'plaid_item_id' })
      .select('id').single()
    if (itemErr) { console.error('plaid_items upsert failed:', itemErr); return json({ error: 'Could not save link' }, 500) }

    await admin.from('communities').update({
      plaid_item_id: itemId,
      plaid_access_token_ref: item.id,   // pointer into the vault, NOT the token
      plaid_status: 'active',
    }).eq('id', communityId)

    return json({ ok: true })
  } catch (err) {
    console.error('plaid-link-exchange failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
