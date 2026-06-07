// plaid-link-token — mints a short-lived link_token that the admin's browser
// uses to open Plaid Link ("link your bank"). Board/admin only. Read-only:
// the products requested are transactions only; no money movement.
//
// Deploy:  supabase functions deploy plaid-link-token
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

    const data = await plaid('/link/token/create', {
      user: { client_user_id: profile.community_id },
      client_name: 'Residente',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    })

    return json({ link_token: data.link_token })
  } catch (err) {
    console.error('plaid-link-token failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
