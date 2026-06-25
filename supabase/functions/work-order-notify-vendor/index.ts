// work-order-notify-vendor — emails the assigned vendor the details of a newly
// created work order (the job, location, priority, target date, budget, and how
// to reach the association), turning "create work order" into a real dispatch.
//
// Called from /admin/requests (browser, board) right after a work order is
// created. Best-effort: if the vendor has no email on file it returns
// email_sent:false (NOT an error), so work-order creation is never blocked.
//
// Deploy:  supabase functions deploy work-order-notify-vendor
// Secrets: RESEND_API_KEY, NOTIFY_FROM_VOICE (optional),
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (the SUPABASE_* trio is auto-injected; service-role reads the vendor
//          email + job context.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? ''
const NOTIFY_FROM_VOICE = Deno.env.get('NOTIFY_FROM_VOICE') ?? 'Residente <onboarding@resend.dev>'
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
    const { work_order_id } = await req.json().catch(() => ({}))
    if (!work_order_id || typeof work_order_id !== 'string') {
      return json({ error: 'work_order_id is required' }, 400)
    }
    if (!SERVICE_ROLE) return json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' }, 500)
    if (!RESEND_API_KEY) return json({ error: 'Email not configured — missing RESEND_API_KEY' }, 500)

    // 1. Authenticate the caller and verify board role.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role, community_id, email, full_name')
      .eq('id', caller.id)
      .single()
    if (!callerProfile || !['board_member', 'admin'].includes(callerProfile.role)) {
      return json({ error: 'Forbidden — board role required' }, 403)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 2. The work order (service role; board access for the caller's community
    //    is already proven above).
    const { data: wo, error: woErr } = await admin
      .from('work_orders')
      .select('id, community_id, request_id, vendor_id, title, description, priority, sla_due_at, estimated_cost')
      .eq('id', work_order_id)
      .single()
    if (woErr || !wo) return json({ error: 'Work order not found' }, 404)
    if (wo.community_id !== callerProfile.community_id) {
      return json({ error: 'Forbidden — different community' }, 403)
    }

    // 3. The assigned vendor — we need an email to dispatch to.
    if (!wo.vendor_id) return json({ ok: true, email_sent: false, reason: 'no vendor assigned' })
    const { data: vendor } = await admin
      .from('vendors')
      .select('name, email, category')
      .eq('id', wo.vendor_id)
      .single()
    if (!vendor?.email) return json({ ok: true, email_sent: false, reason: 'vendor has no email on file' })
    const vendorEmail = String(vendor.email).toLowerCase()

    // 4. Location (from the linked request) + community name.
    let location = ''
    if (wo.request_id) {
      const { data: rq } = await admin
        .from('resident_requests')
        .select('submitter_name, submitter_unit')
        .eq('id', wo.request_id)
        .single()
      location = [rq?.submitter_name, rq?.submitter_unit].filter(Boolean).join(' · ')
    }
    const { data: community } = await admin
      .from('communities')
      .select('name')
      .eq('id', wo.community_id)
      .single()
    const communityName = community?.name || 'the community'

    // 5. Send via Resend; let the vendor reply straight to the board member.
    const subject = `New work order: ${wo.title || 'maintenance job'} — ${communityName}`
    const html = vendorEmailHtml({
      vendorName: String(vendor.name || 'there'),
      communityName,
      title: String(wo.title || 'Maintenance job'),
      description: wo.description ? String(wo.description) : '',
      location,
      priority: String(wo.priority || 'normal'),
      slaDueAt: wo.sla_due_at ? String(wo.sla_due_at) : '',
      estimatedCost: wo.estimated_cost != null ? Number(wo.estimated_cost) : null,
      boardName: String(callerProfile.full_name || ''),
      boardEmail: String(callerProfile.email || ''),
    })
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFY_FROM_VOICE,
        to: [vendorEmail],
        subject,
        html,
        ...(callerProfile.email ? { reply_to: [String(callerProfile.email)] } : {}),
      }),
    })
    if (!sendRes.ok) {
      const text = await sendRes.text()
      console.error('Resend send failed:', sendRes.status, text)
      return json({ error: `Email send failed (${sendRes.status})` }, 502)
    }

    return json({ ok: true, email_sent: true, vendor_email: vendorEmail })
  } catch (err) {
    console.error('work-order-notify-vendor failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function fmtDate(iso: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

function vendorEmailHtml(a: {
  vendorName: string; communityName: string; title: string; description: string;
  location: string; priority: string; slaDueAt: string; estimatedCost: number | null;
  boardName: string; boardEmail: string;
}): string {
  const row = (label: string, value: string) => value
    ? `<tr><td style="padding:6px 0;color:#8a8e9c;font-size:12px;width:120px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#1F2233;font-size:13px;font-weight:600;">${value}</td></tr>`
    : ''
  const prettyPriority = a.priority.charAt(0).toUpperCase() + a.priority.slice(1)
  const budget = a.estimatedCost != null ? `$${a.estimatedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
  const contact = [a.boardName, a.boardEmail].filter(Boolean).join(' · ')
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#1F2233;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">
      <div style="display:inline-block;padding:4px 10px;background:#E14909;color:white;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">New work order</div>
      <h1 style="font-size:20px;margin:0 0 6px;">Hi ${escapeHtml(a.vendorName)},</h1>
      <p style="margin:0 0 16px;color:#6b6f7d;font-size:13px;"><strong>${escapeHtml(a.communityName)}</strong> has assigned you a work order through Residente. Details below — reply to this email to coordinate.</p>
      <div style="background:#F6F7F9;border-radius:10px;padding:14px 18px;margin-bottom:20px;">
        <div style="font-size:15px;font-weight:700;margin-bottom:6px;">${escapeHtml(a.title)}</div>
        ${a.description ? `<div style="font-size:13px;color:#444;margin-bottom:10px;">${escapeHtml(a.description).replace(/\n/g, '<br/>')}</div>` : ''}
        <table style="border-collapse:collapse;width:100%;">
          ${row('Location', escapeHtml(a.location))}
          ${row('Priority', escapeHtml(prettyPriority))}
          ${row('Target date', escapeHtml(fmtDate(a.slaDueAt)))}
          ${row('Est. budget', escapeHtml(budget))}
        </table>
      </div>
      ${contact ? `<p style="margin:0 0 22px;font-size:13px;">Questions? Contact ${escapeHtml(contact)} — or just reply to this email.</p>` : ''}
      <p style="font-size:12px;color:#8a8e9c;margin-top:28px;">You're receiving this because ${escapeHtml(a.communityName)} listed you as a vendor on Residente and assigned you this job.</p>
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
