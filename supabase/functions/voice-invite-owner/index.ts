// voice-invite-owner — sends an Easy Voice invitation to a single owner.
//
// Called from /admin/voice/roster (browser, authenticated as board). For a
// given resident_id, generates a Supabase auth invite/magic link and emails
// it via Resend with a branded body. Idempotent — re-inviting an activated
// owner falls through to a magic link, never duplicates the account.
//
// Deploy:  supabase functions deploy voice-invite-owner
// Secrets: RESEND_API_KEY, APP_URL, NOTIFY_FROM_VOICE (optional),
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (the SUPABASE_* trio is auto-injected; service-role is required
//          for auth.admin.generateLink).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Inlined from ../_shared/cors.ts so the function deploys cleanly from
// the Supabase dashboard editor (which doesn't follow relative imports
// to sibling function folders the way the CLI does).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RESEND_API_KEY     = Deno.env.get('RESEND_API_KEY') ?? ''
const APP_URL            = Deno.env.get('APP_URL') ?? 'https://residente.io'
const NOTIFY_FROM_VOICE  = Deno.env.get('NOTIFY_FROM_VOICE')
                          ?? 'Residente <onboarding@resend.dev>'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { resident_id, tenant } = await req.json().catch(() => ({}))
    // tenant=true invites the unit's TENANT (leased home) instead of the owner:
    // links residents.tenant_profile_id (never profile_id) and never sets a
    // unit_number, so the tenant is a non-voting member. The owner keeps the vote.
    const isTenant = tenant === true
    if (!resident_id || typeof resident_id !== 'string') {
      return json({ error: 'resident_id is required' }, 400)
    }
    if (!SERVICE_ROLE) {
      return json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' }, 500)
    }

    // 1. Authenticate the caller and verify board role.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role, community_id')
      .eq('id', caller.id)
      .single()
    if (!callerProfile || !['board_member', 'admin'].includes(callerProfile.role)) {
      return json({ error: 'Forbidden — board role required' }, 403)
    }

    // 2. Fetch the resident with service role (RLS is bypassed; we already
    //    proved board access for the caller's community above).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: resident, error: rErr } = await admin
      .from('residents')
      .select('id, community_id, full_name, first_name, last_name, email, profile_id, tenant_name, tenant_email, tenant_profile_id')
      .eq('id', resident_id)
      .single()
    if (rErr || !resident) return json({ error: 'Resident not found' }, 404)
    if (resident.community_id !== callerProfile.community_id) {
      return json({ error: 'Forbidden — different community' }, 403)
    }
    const inviteAddr = isTenant ? resident.tenant_email : resident.email
    if (!inviteAddr) return json({ error: isTenant ? 'No tenant email on file' : 'Resident has no email on file' }, 400)

    const email = String(inviteAddr).toLowerCase()

    // 3. Community name for the email body.
    const { data: community } = await admin
      .from('communities')
      .select('name')
      .eq('id', resident.community_id)
      .single()
    const communityName = community?.name || 'your community'

    // 4. Generate the action link. Try invite first (creates the auth user);
    //    if the user already exists, fall back to magiclink (re-invite).
    let action_link = ''
    let user_id: string | null = isTenant ? resident.tenant_profile_id : resident.profile_id

    const inviteRes = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: `${APP_URL}/onboard` },
    } as any)

    if (inviteRes.error) {
      const msg = inviteRes.error.message || ''
      const userExists =
        /already.*registered/i.test(msg) ||
        /already.*exists/i.test(msg) ||
        /user_already/i.test(msg)
      if (!userExists) {
        console.error('generateLink invite failed:', inviteRes.error)
        return json({ error: inviteRes.error.message }, 502)
      }
      const magic = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${APP_URL}/onboard` },
      } as any)
      if (magic.error) {
        console.error('generateLink magiclink failed:', magic.error)
        return json({ error: magic.error.message }, 502)
      }
      action_link = (magic.data as any)?.properties?.action_link ?? ''
      user_id = (magic.data as any)?.user?.id ?? user_id
    } else {
      action_link = (inviteRes.data as any)?.properties?.action_link ?? ''
      user_id = (inviteRes.data as any)?.user?.id ?? user_id
    }

    if (!action_link) {
      return json({ error: 'No action link returned by Supabase Auth' }, 502)
    }

    // 5. Send branded email via Resend. If the send fails we still report
    //    success and surface the action_link — the admin can copy and send
    //    it manually rather than locking out a single owner.
    let emailSent = false
    if (RESEND_API_KEY) {
      const firstName = isTenant
        ? (resident.tenant_name || 'neighbor')
        : (resident.first_name || resident.full_name || 'neighbor')
      const subject = `You're invited to ${communityName} on Residente`
      const html = inviteEmailHtml({
        firstName: String(firstName),
        communityName,
        link: action_link,
      })
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: NOTIFY_FROM_VOICE,
          to: [email],
          subject,
          html,
        }),
      })
      if (!sendRes.ok) {
        const text = await sendRes.text()
        console.error('Resend send failed:', sendRes.status, text)
      } else {
        emailSent = true
      }
    }

    // 6. Link the new auth profile. Tenant → tenant_profile_id (never the owner
    //    link, never a unit_number → stays non-voting). Owner → profile_id + invited_at.
    const patch: Record<string, unknown> = {}
    if (isTenant) {
      if (user_id) patch.tenant_profile_id = user_id
    } else {
      patch.invited_at = new Date().toISOString()
      if (user_id) patch.profile_id = user_id
    }
    if (Object.keys(patch).length) {
      const { error: upErr } = await admin
        .from('residents').update(patch).eq('id', resident_id)
      if (upErr) console.error('Failed to link invited account:', upErr)
    }

    return json({ ok: true, email_sent: emailSent, action_link })
  } catch (err) {
    console.error('voice-invite-owner failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function inviteEmailHtml(args: { firstName: string; communityName: string; link: string }) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #1F2233; line-height: 1.55; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 22px; margin: 0 0 16px;">Hi ${escapeHtml(args.firstName)},</h1>
      <p>Your community, <strong>${escapeHtml(args.communityName)}</strong>, has invited you to join its new resident platform, <strong>Residente</strong>. From there you'll see meeting notices, documents, and cast votes electronically.</p>
      <p style="margin: 28px 0;">
        <a href="${args.link}" style="display: inline-block; background: #FF3B5F; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Accept invitation</a>
      </p>
      <p style="font-size: 12px; color: #6b6f7d;">If the button doesn't work, paste this link into your browser:</p>
      <p style="font-size: 12px; color: #6b6f7d; word-break: break-all;">${args.link}</p>
      <p style="font-size: 12px; color: #8a8e9c; margin-top: 32px;">This link expires in 24 hours. If it expires, ask your board to send a new one.</p>
    </div>
  `.trim()
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
