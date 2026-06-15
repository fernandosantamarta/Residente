// request-reply-notify-board — emails the board when a resident replies on a
// Contact thread, so they don't have to keep checking the queue.
//
// Called from /app/voice#contact (browser, authenticated as the resident) right
// after the resident posts a message. Verifies the caller owns the request,
// then emails every board member / admin of the community (with an email on
// file) a short notice linking to /admin/requests.
//
// Best-effort: a failed send never blocks the resident's reply (the message is
// already saved); the client ignores the result.
//
// Deploy:  supabase functions deploy request-reply-notify-board
// Secrets: RESEND_API_KEY, APP_URL, NOTIFY_FROM_VOICE (optional),
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { request_id, preview } = await req.json().catch(() => ({}))
    if (!request_id || typeof request_id !== 'string') return json({ error: 'request_id is required' }, 400)
    if (!SERVICE_ROLE) return json({ error: 'Server not configured' }, 500)
    if (!RESEND_API_KEY) return json({ ok: true, email_sent: false, skipped: 'no RESEND_API_KEY' })

    // Authenticate the resident caller.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // The request must belong to the caller.
    const { data: request, error: reqErr } = await admin
      .from('resident_requests')
      .select('id, community_id, profile_id, subject, submitter_name')
      .eq('id', request_id)
      .single()
    if (reqErr || !request) return json({ error: 'Request not found' }, 404)
    if (request.profile_id !== caller.id) return json({ error: 'Forbidden' }, 403)

    // Board recipients: board members / admins of the community with an email.
    const { data: board } = await admin
      .from('profiles')
      .select('email, role')
      .eq('community_id', request.community_id)
      .in('role', ['board_member', 'admin'])
    const emails = Array.from(new Set(
      (board || []).map((p: any) => p.email).filter((e: any): e is string => !!e).map((e: string) => e.toLowerCase()),
    ))
    if (!emails.length) return json({ ok: true, email_sent: false, skipped: 'no board emails' })

    const who = String(request.submitter_name || 'A resident')
    const subject = `New reply from ${who} — ${request.subject || 'Contact request'}`
    const html = boardNotifyHtml({
      who,
      requestSubject: String(request.subject || 'Contact request'),
      preview: typeof preview === 'string' ? preview : '',
      link: `${APP_URL}/admin/requests`,
    })

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: NOTIFY_FROM_VOICE, to: emails, subject, html }),
    })
    if (!sendRes.ok) {
      const text = await sendRes.text()
      console.error('Resend send failed:', sendRes.status, text)
      return json({ ok: true, email_sent: false })
    }
    return json({ ok: true, email_sent: true, recipients: emails.length })
  } catch (err) {
    console.error('request-reply-notify-board failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function boardNotifyHtml(args: { who: string; requestSubject: string; preview: string; link: string }) {
  const preview = args.preview ? escapeHtml(args.preview).replace(/\n/g, '<br/>') : ''
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #1F2233; line-height: 1.55; max-width: 520px; margin: 0 auto; padding: 24px;">
      <div style="display: inline-block; padding: 4px 10px; background: #0A2440; color: white; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px;">New reply</div>
      <h1 style="font-size: 20px; margin: 0 0 6px;">${escapeHtml(args.who)} replied</h1>
      <p style="margin: 0 0 14px; color: #6b6f7d; font-size: 13px;">On their request: <strong>${escapeHtml(args.requestSubject)}</strong></p>
      ${preview ? `<div style="background: #F6F7F9; border-radius: 10px; padding: 14px 16px; margin-bottom: 22px;">${preview}</div>` : ''}
      <p style="margin: 0 0 22px;">
        <a href="${args.link}" style="display: inline-block; background: #E14909; color: white; padding: 11px 22px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open in the admin</a>
      </p>
      <p style="font-size: 12px; color: #8a8e9c; margin-top: 32px;">You're receiving this because you're on the board for this community on Residente.</p>
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
