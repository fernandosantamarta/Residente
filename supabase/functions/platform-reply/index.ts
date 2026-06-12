// platform-reply — an operator answers a platform support ticket in-app.
//
// Called from /platform (the support inbox, authenticated as a Residente
// operator). Inserts an 'operator' message on the ticket's thread, optionally
// uploads a photo to the private platform-attachments bucket, emails the board
// member who opened the ticket (with the photo as a real attachment), and moves
// the ticket to 'in_progress'.
//
// Deploy:  supabase functions deploy platform-reply
// Secrets: RESEND_API_KEY, APP_URL, NOTIFY_FROM_VOICE (optional),
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

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

const BUCKET = 'platform-attachments'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const extFromName = (name: string | null): string => {
  const m = (name || '').match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : 'jpg'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { request_id, body, photo_base64, photo_name } = await req.json().catch(() => ({}))
    if (!request_id || typeof request_id !== 'string') {
      return json({ error: 'request_id is required' }, 400)
    }
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text && !photo_base64) return json({ error: 'Nothing to send' }, 400)
    if (!SERVICE_ROLE) return json({ error: 'Server not configured' }, 500)

    // 1. Authenticate the caller and verify they're a platform operator.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Unauthorized: no Authorization token reached the function' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    // Pass the token explicitly — the no-arg form relies on a stored session,
    // which an edge function doesn't have.
    const { data: { user: caller }, error: userErr } = await callerClient.auth.getUser(token)
    if (!caller) return json({ error: `Unauthorized: ${userErr?.message || 'token did not resolve to a user'}` }, 401)

    const { data: isAdmin, error: adminErr } = await callerClient.rpc('is_platform_admin', { uid: caller.id })
    if (isAdmin !== true) return json({ error: `Forbidden — operators only${adminErr ? ' (' + adminErr.message + ')' : ''}` }, 403)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 2. Load the ticket (for the recipient email + subject).
    const { data: ticket, error: tErr } = await admin
      .from('platform_requests')
      .select('id, from_email, from_name, subject, status')
      .eq('id', request_id)
      .single()
    if (tErr || !ticket) return json({ error: 'Ticket not found' }, 404)

    // Operator display name (best-effort; falls back to a generic label).
    let authorName = 'Residente Support'
    try {
      const { data: prof } = await admin.from('profiles').select('full_name').eq('id', caller.id).single()
      if (prof?.full_name) authorName = prof.full_name as string
    } catch { /* keep the fallback */ }

    // 3. Optional photo → private bucket.
    let attachmentPath: string | null = null
    let attachmentName: string | null = null
    if (photo_base64 && typeof photo_base64 === 'string') {
      const ext = extFromName(photo_name ?? null)
      const path = `${request_id}/${crypto.randomUUID()}.${ext}`
      const bytes = Uint8Array.from(atob(photo_base64), (c) => c.charCodeAt(0))
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false,
      })
      if (upErr) return json({ error: `Photo upload failed: ${upErr.message}` }, 502)
      attachmentPath = path
      attachmentName = photo_name || `photo.${ext}`
    }

    // 4. Insert the operator's message.
    const { data: msg, error: mErr } = await admin
      .from('platform_request_messages')
      .insert({
        request_id, author_profile_id: caller.id, author_role: 'operator',
        author_name: authorName, body: text || '(photo)',
        attachment_path: attachmentPath, attachment_name: attachmentName,
      })
      .select('*')
      .single()
    if (mErr) return json({ error: mErr.message }, 502)

    // 5. Email the board member (best-effort — reply already saved in-app).
    let emailSent = false
    if (RESEND_API_KEY && ticket.from_email) {
      const subject = `Re: ${ticket.subject}`
      const html = replyEmailHtml({
        firstName: (ticket.from_name || 'there').split(/\s+/)[0],
        operatorName: authorName, body: text, appUrl: APP_URL,
      })
      const payload: Record<string, unknown> = {
        from: NOTIFY_FROM_VOICE, to: [String(ticket.from_email)], subject, html,
      }
      if (photo_base64 && attachmentName) {
        payload.attachments = [{ filename: attachmentName, content: photo_base64 }]
      }
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (sendRes.ok) emailSent = true
      else console.error('Resend send failed:', sendRes.status, await sendRes.text())
    }

    // 6. Move the ticket to in_progress (operator has engaged).
    if (ticket.status === 'open') {
      await admin.from('platform_requests').update({ status: 'in_progress' }).eq('id', request_id)
    }

    return json({ ok: true, email_sent: emailSent, message: msg })
  } catch (err) {
    console.error('platform-reply failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function replyEmailHtml(args: { firstName: string; operatorName: string; body: string; appUrl: string }) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #1F2233; line-height: 1.55; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">Hi ${escapeHtml(args.firstName)},</h1>
      <p><strong>${escapeHtml(args.operatorName)}</strong> from Residente replied to your support message:</p>
      <div style="background: #F6F3EF; border-radius: 10px; padding: 14px 16px; margin: 16px 0; white-space: pre-wrap;">${escapeHtml(args.body) || '(see attached)'}</div>
      <p style="margin: 24px 0;">
        <a href="${args.appUrl}/admin/support" style="display: inline-block; background: #E14909; color: white; padding: 11px 22px; border-radius: 8px; text-decoration: none; font-weight: 600;">View &amp; reply in Residente</a>
      </p>
      <p style="font-size: 12px; color: #8a8e9c; margin-top: 28px;">You can reply right here or in the app — both keep the conversation in one thread.</p>
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
