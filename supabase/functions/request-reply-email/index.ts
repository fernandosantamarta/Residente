// request-reply-email — emails the board's reply to the resident who submitted
// a Contact request.
//
// Called from /admin/requests (browser, authenticated as board). Given a
// request_id (and optionally the note text), it verifies the caller is a board
// member of the request's community, looks up the submitting resident's email,
// sends the reply via Resend with a link back to their Contact page, and stamps
// resident_requests.emailed_at so the queue can show when they were last emailed.
//
// The in-app note (board_note) is the source of truth — the client saves it
// first, then invokes this. If `note` is passed it wins; otherwise the saved
// board_note is sent.
//
// Deploy:  supabase functions deploy request-reply-email
// Secrets: RESEND_API_KEY, APP_URL, NOTIFY_FROM_VOICE (optional),
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (the SUPABASE_* trio is auto-injected; service-role is required to
//          read the resident's email and stamp emailed_at.)

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
const NOTIFY_FROM_VOICE  = Deno.env.get('NOTIFY_FROM_VOICE')
                          ?? 'Residente <onboarding@resend.dev>'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { request_id, note } = await req.json().catch(() => ({}))
    if (!request_id || typeof request_id !== 'string') {
      return json({ error: 'request_id is required' }, 400)
    }
    if (!SERVICE_ROLE) {
      return json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' }, 500)
    }
    if (!RESEND_API_KEY) {
      return json({ error: 'Email not configured — missing RESEND_API_KEY' }, 500)
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

    // 2. Fetch the request with service role (RLS bypassed; board access for the
    //    caller's community is already proven above).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: request, error: reqErr } = await admin
      .from('resident_requests')
      .select('id, community_id, profile_id, subject, board_note')
      .eq('id', request_id)
      .single()
    if (reqErr || !request) return json({ error: 'Request not found' }, 404)
    if (request.community_id !== callerProfile.community_id) {
      return json({ error: 'Forbidden — different community' }, 403)
    }

    const message = (typeof note === 'string' && note.trim())
      ? note.trim()
      : String(request.board_note || '').trim()
    if (!message) return json({ error: 'No note to send' }, 400)

    // 3. The submitting resident's email.
    const { data: resident } = await admin
      .from('profiles')
      .select('email, full_name')
      .eq('id', request.profile_id)
      .single()
    if (!resident?.email) return json({ error: 'Resident has no email on file' }, 400)
    const email = String(resident.email).toLowerCase()

    // 4. Community name for the email body.
    const { data: community } = await admin
      .from('communities')
      .select('name')
      .eq('id', request.community_id)
      .single()
    const communityName = community?.name || 'your community'

    // 5. Send via Resend.
    const subject = `Re: ${request.subject || 'your request'} — ${communityName}`
    const html = replyEmailHtml({
      firstName: String(resident.full_name || 'neighbor'),
      communityName,
      requestSubject: String(request.subject || 'your request'),
      message,
      link: `${APP_URL}/app/voice#contact`,
    })
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: NOTIFY_FROM_VOICE, to: [email], subject, html }),
    })
    if (!sendRes.ok) {
      const text = await sendRes.text()
      console.error('Resend send failed:', sendRes.status, text)
      return json({ error: `Email send failed (${sendRes.status})` }, 502)
    }

    // 6. Stamp emailed_at so the queue can show when the resident was emailed.
    const emailedAt = new Date().toISOString()
    const { error: upErr } = await admin
      .from('resident_requests')
      .update({ emailed_at: emailedAt })
      .eq('id', request_id)
    if (upErr) console.error('Failed to stamp emailed_at:', upErr)

    return json({ ok: true, email_sent: true, emailed_at: emailedAt })
  } catch (err) {
    console.error('request-reply-email failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function replyEmailHtml(args: {
  firstName: string
  communityName: string
  requestSubject: string
  message: string
  link: string
}) {
  const message = escapeHtml(args.message).replace(/\n/g, '<br/>')
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #1F2233; line-height: 1.55; max-width: 520px; margin: 0 auto; padding: 24px;">
      <div style="display: inline-block; padding: 4px 10px; background: #E14909; color: white; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px;">Reply from your board</div>
      <h1 style="font-size: 20px; margin: 0 0 6px;">Hi ${escapeHtml(args.firstName)},</h1>
      <p style="margin: 0 0 14px; color: #6b6f7d; font-size: 13px;">Regarding your request: <strong>${escapeHtml(args.requestSubject)}</strong></p>
      <div style="background: #F6F7F9; border-radius: 10px; padding: 14px 16px; margin-bottom: 22px;">${message}</div>
      <p style="margin: 0 0 22px;">
        <a href="${args.link}" style="display: inline-block; background: #E14909; color: white; padding: 11px 22px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in Residente</a>
      </p>
      <p style="font-size: 12px; color: #8a8e9c; margin-top: 32px;">You're receiving this because you submitted a request to ${escapeHtml(args.communityName)} on Residente. Reply to it from your Contact page.</p>
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
