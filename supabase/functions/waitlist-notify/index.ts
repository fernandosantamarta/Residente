// waitlist-notify — emails Fernando whenever a new row lands in waitlist.
//
// Triggered by a Supabase Database Webhook on INSERT to public.waitlist,
// not by the browser — so no CORS, and it runs unauthenticated. We still
// verify a shared secret in the X-Webhook-Secret header to keep randoms
// out (DB webhooks let you set custom headers in the dashboard).
//
// Deploy:  supabase functions deploy waitlist-notify --no-verify-jwt
// Secrets: RESEND_API_KEY, NOTIFY_EMAIL, WAITLIST_WEBHOOK_SECRET
//          NOTIFY_FROM (optional — defaults to onboarding@resend.dev)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const NOTIFY_EMAIL   = Deno.env.get('NOTIFY_EMAIL') ?? ''
const NOTIFY_FROM    = Deno.env.get('NOTIFY_FROM') ?? 'Residente <onboarding@resend.dev>'
const WEBHOOK_SECRET = Deno.env.get('WAITLIST_WEBHOOK_SECRET') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Reject anything that doesn't come from the DB webhook with the right secret.
  if (WEBHOOK_SECRET && req.headers.get('X-Webhook-Secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    console.error('Missing RESEND_API_KEY or NOTIFY_EMAIL secret')
    return json({ error: 'Server not configured' }, 500)
  }

  try {
    const payload = await req.json()
    // Supabase DB webhook shape: { type, table, record, old_record, schema }
    const row = payload?.record
    if (!row?.email) return json({ error: 'No record in payload' }, 400)

    const email     = String(row.email)
    const community = row.community ? String(row.community) : '—'
    const source    = row.source    ? String(row.source)    : '—'
    const createdAt = row.created_at ? new Date(row.created_at).toUTCString() : ''

    const subject = `New waitlist signup — ${email}`
    const html = `
      <div style="font-family: -apple-system, system-ui, sans-serif; color: #1F2233; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">New Residente waitlist signup</h2>
        <table style="border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 4px 12px 4px 0; color: #6b6f7d;">Email</td><td><strong>${escapeHtml(email)}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b6f7d;">Community / city</td><td>${escapeHtml(community)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b6f7d;">Source</td><td>${escapeHtml(source)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b6f7d;">When</td><td>${escapeHtml(createdAt)}</td></tr>
        </table>
        <p style="margin-top: 20px; font-size: 12px; color: #8a8e9c;">
          Full list: Supabase dashboard → Table editor → waitlist.
        </p>
      </div>
    `.trim()

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_EMAIL],
        subject,
        html,
        reply_to: email,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('Resend send failed:', res.status, errText)
      return json({ error: 'Email send failed', detail: errText }, 502)
    }

    return json({ ok: true })
  } catch (err) {
    console.error('waitlist-notify failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
