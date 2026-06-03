// signup-provision — finishes a self-serve sign-up after supabase.auth.signUp.
//
// Called from /signup (browser, authenticated as the brand-new user). Two modes:
//   create  → a board member / property manager creates a NEW community, becomes
//             its admin, and the community starts on a free trial.
//   join    → a resident attaches to an EXISTING community, resolved by join code
//             or by matching their email to a row the board already imported.
//
// Everything is written with the service role: RLS gates by profiles.community_id,
// there is no INSERT policy on communities, and a new user has no community yet —
// so provisioning can't run as the caller. We DO verify the caller's JWT first and
// only ever write rows keyed to *their* auth id.
//
// Deploy:  supabase functions deploy signup-provision
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (auto-injected; service-role required to bypass RLS for provisioning).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Inlined CORS so the function deploys cleanly from the dashboard editor.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Split "Jane Q Doe" → { first: "Jane", last: "Q Doe" }. Best-effort; the roster
// keeps full_name as the source of truth, first/last are conveniences.
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { first: full.trim(), last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function randomCode(): string {
  // 6 chars, no ambiguous 0/O/1/I, upper-case. Matches the SQL backfill shape.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

// Generate a join code not already used (case-insensitive). A handful of tries
// is plenty given the keyspace; give up loudly rather than loop forever.
async function uniqueJoinCode(admin: ReturnType<typeof createClient>): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const { data } = await admin
      .from('communities').select('id').ilike('join_code', code).limit(1)
    if (!data || data.length === 0) return code
  }
  throw new Error('Could not allocate a unique join code')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    if (!SERVICE_ROLE) {
      return json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' }, 500)
    }
    const body = await req.json().catch(() => ({}))
    const mode = body?.mode

    // 1. Authenticate the caller — must be the freshly-signed-up user.
    //    Pass the JWT explicitly: getUser() with no argument reads from a
    //    stored session, which a server-side client doesn't have, so it
    //    returns null even with the global Authorization header.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser(token)
    if (!caller) return json({ error: 'Unauthorized' }, 401)
    const email = (caller.email ?? '').toLowerCase()
    if (!email) return json({ error: 'Account has no email' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const fullName = String(body?.full_name ?? '').trim()
    const unitNumber = body?.unit_number ? String(body.unit_number).trim() : null
    const { first, last } = splitName(fullName)
    const now = new Date().toISOString()

    // ---------------------------------------------------------------
    // CREATE — board / management spins up a new community on a trial.
    // ---------------------------------------------------------------
    if (mode === 'create') {
      const association_type = body?.association_type
      const community_name = String(body?.community_name ?? '').trim()
      const role = body?.role === 'admin' ? 'admin' : 'board_member'
      const location = body?.location ? String(body.location).trim() : null
      const unit_count =
        body?.unit_count != null && !Number.isNaN(Number(body.unit_count))
          ? Number(body.unit_count)
          : null

      if (!['condo', 'hoa'].includes(association_type)) {
        return json({ error: 'association_type must be "condo" or "hoa"' }, 400)
      }
      if (!community_name) return json({ error: 'community_name is required' }, 400)
      if (!fullName) return json({ error: 'full_name is required' }, 400)

      // Pricing band from home count (mirror of lib/plan.ts — keep in sync).
      // ≤25 (or unknown) = free + active forever; 26+ = a paid plan that starts
      // 'pending' until the on-the-spot Stripe subscription checkout completes.
      const homes = unit_count ?? 0
      const plan =
        homes <= 25  ? 'free' :
        homes <= 100 ? 'pro' :
        homes <= 500 ? 'premium' : 'enterprise'
      const needs_payment = plan !== 'free'
      const subscription_status = needs_payment ? 'pending' : 'free'

      const join_code = await uniqueJoinCode(admin)

      const { data: community, error: cErr } = await admin
        .from('communities')
        .insert({
          name: community_name,
          location,
          unit_count,
          home_count: unit_count,
          plan,
          association_type,
          subscription_status,
          join_code,
        })
        .select('id')
        .single()
      if (cErr || !community) {
        console.error('community insert failed:', cErr)
        return json({ error: cErr?.message || 'Could not create community' }, 502)
      }
      const community_id = community.id

      // Profile must carry the role BEFORE the residents row is written, because
      // the ev_membership_upsert trigger copies profiles.role into the membership.
      const { error: pErr } = await admin.from('profiles').upsert({
        id: caller.id,
        email,
        full_name: fullName,
        role,
        community_id,
      }, { onConflict: 'id' })
      if (pErr) {
        console.error('profile upsert failed:', pErr)
        return json({ error: pErr.message }, 502)
      }

      // Membership is the multi-community source of truth (CommunitySwitcher).
      await admin.from('ev_membership').upsert(
        { profile_id: caller.id, community_id, role, last_active_at: now },
        { onConflict: 'profile_id,community_id' },
      )

      // Seed a starter budget so the dashboard renders real numbers (not the
      // demo fallback) the moment they finish signup. Keyed to the association
      // type. They edit these on /admin/community. Best-effort: a failure here
      // shouldn't fail the whole signup.
      const SHARED_CATS = [
        'Landscaping', 'Insurance', 'Reserves', 'Utilities',
        'Repairs & Maintenance', 'Management',
      ]
      const EXTRA_CATS = association_type === 'condo'
        ? ['Building Reserve', 'Roof & Structural']
        : ['Common Areas', 'Roads & Sidewalks']
      const seededCats = [...SHARED_CATS, ...EXTRA_CATS].map((name, i) => ({
        community_id, name, budget: 0, spent: 0, sort_order: i,
      }))
      const { error: seedErr } = await admin.from('budget_categories').insert(seededCats)
      if (seedErr) console.error('budget seed failed (non-fatal):', seedErr)

      // A board member is an owner (voting). A pure manager (admin) only gets a
      // roster row if they gave a unit — otherwise they're staff, not an owner.
      if (role === 'board_member' || unitNumber) {
        await admin.from('residents').insert({
          community_id,
          profile_id: caller.id,
          full_name: fullName,
          first_name: first,
          last_name: last,
          email,
          unit_number: unitNumber,
          voting_eligible: role === 'board_member',
          activated_at: now,
          invited_at: now,
          board_position: role === 'board_member' ? 'Board member' : null,
        })
      }

      return json({ ok: true, community_id, join_code, role, plan, needs_payment })
    }

    // ---------------------------------------------------------------
    // JOIN — resident attaches to an existing community.
    // ---------------------------------------------------------------
    if (mode === 'join') {
      if (!fullName) return json({ error: 'full_name is required' }, 400)
      const rawCode = body?.join_code ? String(body.join_code).trim() : ''

      let community_id: string | null = null

      if (rawCode) {
        const { data: comm } = await admin
          .from('communities').select('id').ilike('join_code', rawCode).limit(1)
        if (!comm || comm.length === 0) {
          return json({ error: 'That join code didn’t match any community.', code: 'bad_code' }, 404)
        }
        community_id = comm[0].id
      } else {
        // No code — try to match the caller's email to an unclaimed roster row.
        const { data: rows } = await admin
          .from('residents')
          .select('id, community_id')
          .is('profile_id', null)
          .ilike('email', email)
        if (!rows || rows.length === 0) {
          return json({ error: 'No community found for your email. Ask your board for a join code.', code: 'no_match' }, 404)
        }
        if (rows.length > 1) {
          return json({ error: 'Your email is on more than one community. Enter a join code to pick one.', code: 'ambiguous' }, 409)
        }
        community_id = rows[0].community_id
      }

      // Resident profile, pointed at the resolved community.
      const { error: pErr } = await admin.from('profiles').upsert({
        id: caller.id,
        email,
        full_name: fullName,
        role: 'resident',
        community_id,
      }, { onConflict: 'id' })
      if (pErr) {
        console.error('profile upsert failed:', pErr)
        return json({ error: pErr.message }, 502)
      }

      await admin.from('ev_membership').upsert(
        { profile_id: caller.id, community_id, role: 'resident', last_active_at: now },
        { onConflict: 'profile_id,community_id' },
      )

      // Claim a pre-imported roster row by email if one exists; otherwise
      // self-register a new roster row from what they typed.
      const { data: claimed } = await admin
        .from('residents')
        .update({ profile_id: caller.id, activated_at: now })
        .eq('community_id', community_id)
        .is('profile_id', null)
        .ilike('email', email)
        .select('id')
      if (!claimed || claimed.length === 0) {
        await admin.from('residents').insert({
          community_id,
          profile_id: caller.id,
          full_name: fullName,
          first_name: first,
          last_name: last,
          email,
          unit_number: unitNumber,
          voting_eligible: true,
          activated_at: now,
        })
      }

      return json({ ok: true, community_id, role: 'resident' })
    }

    return json({ error: 'mode must be "create" or "join"' }, 400)
  } catch (err) {
    console.error('signup-provision failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})
