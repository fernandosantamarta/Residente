// violation-notify-email — emails the targeted owner when the board records a
// violation / fine, so the notice reaches their inbox (the in-app personal
// notice fired by the ev_violation_notify trigger is in-app only; the broadcast
// email fanout deliberately skips personal notices).
//
// Called best-effort from /admin/enforcement after a fine is proposed (the fine
// is already saved — an email hiccup must never read as a failure). Given a
// violation_id it verifies the caller is a board member of the violation's
// community, looks up the owner's email, and sends a neutral notice via Resend
// with a deep link to their Violations page.
//
// FAIL-SOFT by design: missing RESEND_API_KEY, no owner email, or no linked
// profile all return 200 { ok: true, email_sent: false } rather than an error,
// so the caller can fire-and-forget. Mirrors request-reply-email's Resend flow.
//
// Deploy:  supabase functions deploy violation-notify-email
// Secrets: RESEND_API_KEY, APP_URL, NOTIFY_FROM_VOICE (optional),
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
const APP_URL          = Deno.env.get('APP_URL') ?? 'https://residente.io'
const NOTIFY_FROM_VOICE = Deno.env.get('NOTIFY_FROM_VOICE') ?? 'Residente <onboarding@resend.dev>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { violation_id } = await req.json().catch(() => ({}))
    if (!violation_id || typeof violation_id !== 'string') return json({ error: 'violation_id is required' }, 400)
    if (!SERVICE_ROLE) return json({ ok: true, email_sent: false, reason: 'no_service_role' })

    // Authenticate the caller and confirm a board role.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Unauthorized' }, 401)
    const { data: callerProfile } = await callerClient
      .from('profiles').select('role, community_id').eq('id', caller.id).single()
    if (!callerProfile || !['board_member', 'admin'].includes(callerProfile.role)) {
      return json({ error: 'Forbidden — board role required' }, 403)
    }

    // Load the violation (service role; board access already proven above).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: v, error: vErr } = await admin
      .from('ev_violations')
      .select('id, community_id, profile_id, kind, rule_title, amount, fine_per_day, fine_continuing, notes, cure_by')
      .eq('id', violation_id).single()
    if (vErr || !v) return json({ error: 'Violation not found' }, 404)
    if (v.community_id !== callerProfile.community_id) return json({ error: 'Forbidden — different community' }, 403)
    if (!v.profile_id) return json({ ok: true, email_sent: false, reason: 'no_linked_owner' })

    const { data: owner } = await admin
      .from('profiles').select('email, full_name').eq('id', v.profile_id).single()
    if (!owner?.email) return json({ ok: true, email_sent: false, reason: 'no_email' })

    const { data: community } = await admin
      .from('communities').select('name').eq('id', v.community_id).single()
    const communityName = community?.name || 'your community'

    if (!RESEND_API_KEY) return json({ ok: true, email_sent: false, reason: 'email_not_configured' })

    const isFine = v.kind === 'fine'
    const ruleTitle = String(v.rule_title || (isFine ? 'a rule violation' : 'a rule reminder'))
    const amountLine = v.fine_continuing && v.fine_per_day
      ? `$${v.fine_per_day}/day (continuing)`
      : (v.amount != null ? `$${v.amount}` : '')
    const subject = `${isFine ? 'New fine' : 'Notice'}: ${ruleTitle} — ${communityName}`
    const html = noticeEmailHtml({
      firstName: String(owner.full_name || 'neighbor'),
      communityName, isFine, ruleTitle,
      amountLine,
      cureBy: v.cure_by ? String(v.cure_by) : '',
      notes: String(v.notes || ''),
      link: `${APP_URL}/app/documents#violations`,
    })

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: NOTIFY_FROM_VOICE, to: [String(owner.email).toLowerCase()], subject, html }),
    })
    if (!sendRes.ok) {
      const text = await sendRes.text()
      console.error('Resend send failed:', sendRes.status, text)
      return json({ ok: true, email_sent: false, reason: `send_failed_${sendRes.status}` })
    }
    return json({ ok: true, email_sent: true })
  } catch (err) {
    console.error('violation-notify-email failed:', err)
    return json({ ok: true, email_sent: false, reason: 'exception' })
  }
})

function noticeEmailHtml(a: {
  firstName: string; communityName: string; isFine: boolean; ruleTitle: string
  amountLine: string; cureBy: string; notes: string; link: string
}) {
  const notes = a.notes ? `<div style="background:#F6F7F9;border-radius:10px;padding:14px 16px;margin:0 0 18px;">${escapeHtml(a.notes).replace(/\n/g, '<br/>')}</div>` : ''
  const amount = a.amountLine ? `<p style="margin:0 0 6px;"><strong>Amount:</strong> ${escapeHtml(a.amountLine)}</p>` : ''
  const cure = a.cureBy ? `<p style="margin:0 0 6px;"><strong>Please correct by:</strong> ${escapeHtml(a.cureBy)}</p>` : ''
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#1F2233;line-height:1.55;max-width:520px;margin:0 auto;padding:24px;">
      <div style="display:inline-block;padding:4px 10px;background:#B54708;color:white;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">${a.isFine ? 'Fine notice' : 'Rule notice'} from your board</div>
      <h1 style="font-size:20px;margin:0 0 6px;">Hi ${escapeHtml(a.firstName)},</h1>
      <p style="margin:0 0 14px;color:#6b6f7d;font-size:13px;">${a.communityName ? escapeHtml(a.communityName) + ' has recorded ' : 'Your board has recorded '}${a.isFine ? 'a fine' : 'a notice'} regarding: <strong>${escapeHtml(a.ruleTitle)}</strong></p>
      ${amount}${cure}${notes}
      <p style="margin:0 0 22px;">
        <a href="${a.link}" style="display:inline-block;background:#B54708;color:white;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;">View details in Residente</a>
      </p>
      <p style="font-size:12px;color:#8a8e9c;margin-top:32px;">You're receiving this because you're a resident of ${escapeHtml(a.communityName)} on Residente. Open the app to see the full notice, your options, and any hearing date.</p>
    </div>
  `.trim()
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
