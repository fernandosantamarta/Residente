// home-transfer — hand a unit off to the next buyer.
//
// Called from the browser (authenticated) when a home changes hands. Either the
// community board (board_member/admin) OR the current owner of the roster row
// may initiate. For a given resident_id + buyer email it:
//   1. invites/links the buyer's auth account (Supabase invite, else magic link),
//   2. reassigns residents.profile_id to the buyer (and resets their account
//      link state so they re-activate as the new owner),
//   3. transfers the home documents flagged `conveys = true` — both the DB row
//      (resident_id + profile_id -> buyer) and the underlying private storage
//      object, moved from the seller's {seller}/… folder into the buyer's
//      {buyer}/… folder so the per-owner storage RLS still grants the buyer read,
//   4. emails the buyer a branded invitation, and
//   5. writes an audit row to home_transfers.
//
// Non-conveying documents stay with the seller's account untouched (deed copies,
// the seller's own insurance, etc.). The seller keeps their auth account; they
// simply no longer own this roster row.
//
// Idempotent-ish: re-running with the same buyer re-points an already-transferred
// row to the same account and moves any docs not yet moved. Storage moves that
// have already happened are treated as non-fatal.
//
// Deploy:  supabase functions deploy home-transfer
// Secrets: RESEND_API_KEY, APP_URL, NOTIFY_FROM_VOICE (optional)
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (the SUPABASE_* trio is auto-injected; service-role is required for
//          auth.admin.generateLink, the RLS-bypassing writes, and storage move.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Inlined CORS so the function deploys cleanly from the dashboard editor.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? ''
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://residente.io'
const NOTIFY_FROM_VOICE = Deno.env.get('NOTIFY_FROM_VOICE')
                          ?? 'Residente <onboarding@resend.dev>'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const HOME_VAULT_BUCKET = 'home-vault'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Swap the leading "{profileId}/" segment of a storage path for the buyer's id.
// Path convention (home-vault.sql): {profile_id}/{uuid}.{ext}. If the path
// doesn't carry an owner segment we fall back to nesting under the buyer.
function repathToOwner(path: string, buyerId: string): string {
  const slash = path.indexOf('/')
  const tail = slash >= 0 ? path.slice(slash + 1) : path
  return `${buyerId}/${tail}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    if (!SERVICE_ROLE) {
      return json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const resident_id = body?.resident_id
    const buyerEmailRaw = body?.buyer_email
    const buyerNameRaw = body?.buyer_name
    if (!resident_id || typeof resident_id !== 'string') {
      return json({ error: 'resident_id is required' }, 400)
    }
    if (!buyerEmailRaw || typeof buyerEmailRaw !== 'string' || !buyerEmailRaw.includes('@')) {
      return json({ error: 'A valid buyer_email is required' }, 400)
    }
    const buyerEmail = buyerEmailRaw.trim().toLowerCase()
    // A display name keeps profiles.full_name populated (signup-provision always
    // sets it). Fall back to the email local-part for a brand-new invited buyer
    // who hasn't told us their name yet; they refine it at /onboard.
    const buyerName = (typeof buyerNameRaw === 'string' && buyerNameRaw.trim())
      ? buyerNameRaw.trim()
      : buyerEmail.split('@')[0]

    // 1. Authenticate the caller. Pass the JWT explicitly — getUser() with no
    //    argument reads a stored session a server client doesn't have.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser(token)
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role, community_id')
      .eq('id', caller.id)
      .single()
    if (!callerProfile) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 2. Fetch the roster row (service role; we re-check access below).
    const { data: resident, error: rErr } = await admin
      .from('residents')
      .select('id, community_id, full_name, first_name, last_name, email, profile_id, unit_number')
      .eq('id', resident_id)
      .single()
    if (rErr || !resident) return json({ error: 'Resident not found' }, 404)

    // 3. Authorize: the community board, OR the current owner of this row.
    const isBoard =
      ['board_member', 'admin'].includes(callerProfile.role) &&
      callerProfile.community_id === resident.community_id
    const isOwner = resident.profile_id && resident.profile_id === caller.id
    if (!isBoard && !isOwner) {
      return json({ error: 'Forbidden — board role or current owner required' }, 403)
    }

    if (buyerEmail === String(resident.email ?? '').toLowerCase()) {
      return json({ error: 'Buyer email matches the current owner — nothing to transfer' }, 400)
    }

    const sellerProfileId: string | null = resident.profile_id
    const now = new Date().toISOString()

    // 4. Community name for the email body.
    const { data: community } = await admin
      .from('communities')
      .select('name')
      .eq('id', resident.community_id)
      .single()
    const communityName = community?.name || 'your community'

    // 5. Invite/link the buyer's auth account → buyer profile id + action link.
    let action_link = ''
    let buyerId: string | null = null

    const inviteRes = await admin.auth.admin.generateLink({
      type: 'invite',
      email: buyerEmail,
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
        email: buyerEmail,
        options: { redirectTo: `${APP_URL}/onboard` },
      } as any)
      if (magic.error) {
        console.error('generateLink magiclink failed:', magic.error)
        return json({ error: magic.error.message }, 502)
      }
      action_link = (magic.data as any)?.properties?.action_link ?? ''
      buyerId = (magic.data as any)?.user?.id ?? null
    } else {
      action_link = (inviteRes.data as any)?.properties?.action_link ?? ''
      buyerId = (inviteRes.data as any)?.user?.id ?? null
    }

    if (!buyerId) return json({ error: 'Could not resolve the buyer account' }, 502)

    // 6. Ensure a profiles row exists for the buyer BEFORE we re-point any FK at
    //    it (residents.profile_id and home_documents.profile_id both reference
    //    profiles.id). insert-if-absent only: never clobber an existing buyer's
    //    community_id/role — they may already belong to another community, and
    //    ev_membership is the real multi-community source of truth. A brand-new
    //    invited buyer gets a minimal row here; they fill it in at /onboard.
    await admin.from('profiles').upsert({
      id: buyerId,
      email: buyerEmail,
      full_name: buyerName,
      community_id: resident.community_id,
      role: 'resident',
    }, { onConflict: 'id', ignoreDuplicates: true })

    // 7. Reassign the roster row to the buyer. Clear the prior owner's
    //    activation so the buyer re-activates as the new owner; keep the unit.
    //    residents has a unique (community_id, lower(email)) index, so setting
    //    the buyer's email can collide if a stale/duplicate row in this
    //    community already uses it. On that 23505 we retry the reassignment
    //    WITHOUT touching email (profile_id is the real link; the buyer can fix
    //    the address at /onboard) rather than failing the whole transfer.
    const reassign = (withEmail: boolean) => {
      const patch: Record<string, unknown> = {
        profile_id: buyerId, invited_at: now, activated_at: null,
      }
      if (withEmail) patch.email = buyerEmail
      return admin.from('residents').update(patch).eq('id', resident_id)
    }
    let { error: upErr } = await reassign(true)
    if (upErr && (upErr as any).code === '23505') {
      console.warn('email collision on roster reassignment; retrying without email')
      ;({ error: upErr } = await reassign(false))
    }
    if (upErr) {
      console.error('residents reassignment failed:', upErr)
      return json({ error: upErr.message }, 502)
    }

    // 8. Transfer the conveying documents. Match by the roster row AND, if we
    //    know the seller's account, their profile — covers docs keyed either
    //    way. Move the storage object into the buyer's folder so per-owner
    //    storage RLS keeps granting read, then re-point the DB row.
    let convQ = admin
      .from('home_documents')
      .select('id, storage_path, profile_id, resident_id')
      .eq('conveys', true)
    convQ = sellerProfileId
      ? convQ.or(`resident_id.eq.${resident_id},profile_id.eq.${sellerProfileId}`)
      : convQ.eq('resident_id', resident_id)
    const { data: convDocs, error: cErr } = await convQ
    if (cErr) console.error('conveying-docs query failed (non-fatal):', cErr)

    let docsConveyed = 0
    for (const doc of convDocs ?? []) {
      const oldPath = doc.storage_path as string
      const newPath = repathToOwner(oldPath, buyerId)

      if (oldPath && newPath !== oldPath) {
        const { error: mvErr } = await admin
          .storage.from(HOME_VAULT_BUCKET).move(oldPath, newPath)
        // A missing source (already moved on a prior run) shouldn't abort the
        // transfer — keep the DB row consistent with the new owner regardless.
        if (mvErr && !/not.*found|does not exist/i.test(mvErr.message || '')) {
          console.error(`storage move failed for ${oldPath}:`, mvErr)
          continue
        }
      }

      const { error: dErr } = await admin
        .from('home_documents')
        .update({ profile_id: buyerId, resident_id, storage_path: newPath })
        .eq('id', doc.id)
      if (dErr) {
        console.error(`home_documents update failed for ${doc.id}:`, dErr)
        continue
      }
      docsConveyed++
    }

    // 9. Audit row (service role; sellers/board read via RLS).
    await admin.from('home_transfers').insert({
      community_id: resident.community_id,
      resident_id,
      from_profile_id: sellerProfileId,
      to_email: buyerEmail,
      to_profile_id: buyerId,
      docs_conveyed: docsConveyed,
      initiated_by: caller.id,
    })

    // 10. Email the buyer. Non-fatal: if the send fails we still report success
    //     and return the action_link so the initiator can pass it on manually.
    let emailSent = false
    if (RESEND_API_KEY && action_link) {
      const subject = `Your new home on Residente — ${communityName}`
      const html = transferEmailHtml({
        communityName,
        unit: resident.unit_number ? String(resident.unit_number) : '',
        link: action_link,
        docsConveyed,
      })
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: NOTIFY_FROM_VOICE, to: [buyerEmail], subject, html }),
      })
      if (!sendRes.ok) {
        console.error('Resend send failed:', sendRes.status, await sendRes.text())
      } else {
        emailSent = true
      }
    }

    return json({
      ok: true,
      buyer_profile_id: buyerId,
      docs_conveyed: docsConveyed,
      email_sent: emailSent,
      action_link,
    })
  } catch (err) {
    console.error('home-transfer failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function transferEmailHtml(args: {
  communityName: string; unit: string; link: string; docsConveyed: number
}) {
  const unitLine = args.unit
    ? `<p>You're now the registered owner of <strong>Unit ${escapeHtml(args.unit)}</strong>.</p>`
    : ''
  const docsLine = args.docsConveyed > 0
    ? `<p>${args.docsConveyed} home document${args.docsConveyed === 1 ? '' : 's'} from the previous owner ${args.docsConveyed === 1 ? 'has' : 'have'} been transferred to your Home Vault.</p>`
    : ''
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #1F2233; line-height: 1.55; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 22px; margin: 0 0 16px;">Welcome to ${escapeHtml(args.communityName)}</h1>
      <p>Your home has been transferred to you on <strong>Residente</strong>, your community's resident platform. Set up your account to see dues, documents, meeting notices, and votes.</p>
      ${unitLine}
      ${docsLine}
      <p style="margin: 28px 0;">
        <a href="${args.link}" style="display: inline-block; background: #FF3B5F; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Set up your account</a>
      </p>
      <p style="font-size: 12px; color: #6b6f7d;">If the button doesn't work, paste this link into your browser:</p>
      <p style="font-size: 12px; color: #6b6f7d; word-break: break-all;">${args.link}</p>
      <p style="font-size: 12px; color: #8a8e9c; margin-top: 32px;">This link expires in 24 hours. If it expires, just go to <a href="${APP_URL}" style="color: #8a8e9c;">${APP_URL.replace(/^https?:\/\//, '')}</a> and sign in with this email address — your home is already set up and waiting for you.</p>
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
