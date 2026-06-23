// tenant-remove — fully remove a unit's tenant.
//
// Either the community BOARD (board_member/admin) OR the unit's OWNER (the
// residents row's profile_id) may call this for a given resident_id. It:
//   1. clears residents.tenant_profile_id + the tenant_name/email/phone +
//      tenant_request_state on the roster row,
//   2. removes the tenant's ev_membership for the community, and
//   3. clears the tenant's profiles.community_id IF it still points at this
//      community — so they are fully removed (their auth account survives; they
//      simply lose access to this community/unit).
//
// Service-role: a board member / owner cannot write another user's membership
// or profile under RLS, so this runs with the service key after authorizing the
// caller. Switching a tenant = remove (this) then invite the new one.
//
// Deploy:  supabase functions deploy tenant-remove
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { resident_id } = await req.json().catch(() => ({}))
    if (!resident_id || typeof resident_id !== 'string') return json({ error: 'resident_id is required' }, 400)
    if (!SERVICE_ROLE) return json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' }, 500)

    // Authenticate the caller.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Unauthorized' }, 401)
    const { data: callerProfile } = await callerClient
      .from('profiles').select('role, community_id').eq('id', caller.id).single()

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: resident, error: rErr } = await admin
      .from('residents')
      .select('id, community_id, profile_id, tenant_profile_id')
      .eq('id', resident_id).single()
    if (rErr || !resident) return json({ error: 'Resident not found' }, 404)

    // Authorize: board of the same community, OR the unit's owner.
    const isBoard = !!callerProfile
      && ['board_member', 'admin'].includes(callerProfile.role)
      && callerProfile.community_id === resident.community_id
    const isOwner = !!resident.profile_id && resident.profile_id === caller.id
    if (!isBoard && !isOwner) return json({ error: 'Forbidden' }, 403)

    const tenantPid = resident.tenant_profile_id as string | null

    // 1. Clear the roster row's tenant link + fields.
    const { error: upErr } = await admin.from('residents').update({
      tenant_profile_id: null, tenant_name: null, tenant_email: null,
      tenant_phone: null, tenant_request_state: null,
    }).eq('id', resident_id)
    if (upErr) throw upErr

    // 2 + 3. Remove the tenant's membership + active community (if it was this one).
    if (tenantPid) {
      await admin.from('ev_membership').delete()
        .eq('profile_id', tenantPid).eq('community_id', resident.community_id)
      await admin.from('profiles').update({ community_id: null })
        .eq('id', tenantPid).eq('community_id', resident.community_id)
    }

    return json({ ok: true, removed_profile: tenantPid })
  } catch (err) {
    console.error('tenant-remove failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
