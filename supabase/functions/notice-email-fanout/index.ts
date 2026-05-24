// notice-email-fanout — sends a queued notice to its email recipients.
//
// Triggered by a Supabase Database Webhook on INSERT to public.ev_notices.
// The ev_notice_fanout DB trigger has already materialised one
// ev_notice_recipients row per email-eligible profile with email_status
// = 'queued'. This function picks them up, batches sends through Resend,
// flips email_status to 'sent' or 'bounced', and merges per-profile
// statuses into ev_notices.delivery_report.
//
// Idempotent: only acts on rows that are still 'queued'. Safe to re-run
// the webhook manually if delivery hangs.
//
// Deploy:  supabase functions deploy notice-email-fanout --no-verify-jwt
// Secrets: RESEND_API_KEY, APP_URL, NOTIFY_FROM_VOICE (optional),
//          NOTICE_WEBHOOK_SECRET
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injected)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? ''
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://residente.io'
const NOTIFY_FROM_VOICE = Deno.env.get('NOTIFY_FROM_VOICE')
                          ?? 'Residente <onboarding@resend.dev>'
const WEBHOOK_SECRET    = Deno.env.get('NOTICE_WEBHOOK_SECRET') ?? ''

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const RESEND_BATCH_SIZE = 100   // Resend /emails/batch hard limit

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (WEBHOOK_SECRET && req.headers.get('X-Webhook-Secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!RESEND_API_KEY || !SERVICE_ROLE) {
    console.error('Missing RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'Server not configured' }, 500)
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const notice = payload?.record
    if (!notice?.id) return json({ error: 'No record in payload' }, 400)
    if (!Array.isArray(notice.channels) || !notice.channels.includes('email')) {
      return json({ ok: true, skipped: 'email channel not requested' })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 1. Queued email recipients for this notice.
    const { data: recipients, error: rErr } = await admin
      .from('ev_notice_recipients')
      .select('id, profile_id')
      .eq('notice_id', notice.id)
      .eq('channel', 'email')
      .eq('email_status', 'queued')
    if (rErr) throw rErr
    if (!recipients?.length) return json({ ok: true, sent: 0, skipped: 'no queued rows' })

    // 2. Their email addresses (and names for personalisation).
    const profileIds = recipients.map(r => r.profile_id)
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', profileIds)
    const profileById = new Map(
      (profiles || []).map(p => [p.id as string, p as any])
    )

    // 3. Render once — every recipient gets the same body.
    const link    = noticeLink(notice)
    const html    = renderNoticeHtml({ notice, link })
    const subject = notice.subject || 'Notice from your community'

    // 4. Send in batches. Resend's /emails/batch accepts up to 100
    //    distinct messages per call.
    const deliveryReport: Record<string, string> = {}
    let sent = 0, failed = 0

    const batches = chunk(recipients, RESEND_BATCH_SIZE)
    for (const batch of batches) {
      const emails = batch
        .map(r => {
          const p = profileById.get(r.profile_id)
          if (!p?.email) return null
          return {
            from: NOTIFY_FROM_VOICE,
            to: [p.email],
            subject,
            html,
            tags: [{ name: 'notice_id', value: String(notice.id) }],
          }
        })
        .filter(Boolean) as Array<Record<string, unknown>>

      if (!emails.length) {
        // Mark these rows bounced — we have nothing to send to.
        const ids = batch.map(r => r.id)
        await admin.from('ev_notice_recipients')
          .update({ email_status: 'bounced' })
          .in('id', ids)
        for (const r of batch) deliveryReport[r.profile_id] = 'bounced:no_email'
        failed += batch.length
        continue
      }

      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emails),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('Resend batch failed:', res.status, errText)
        const ids = batch.map(r => r.id)
        await admin.from('ev_notice_recipients')
          .update({ email_status: 'bounced' })
          .in('id', ids)
        for (const r of batch) {
          deliveryReport[r.profile_id] = `bounced:${res.status}`
        }
        failed += batch.length
        continue
      }

      // Resend returns a list of created email IDs in send-order. We don't
      // need them here — we just know the API accepted them.
      const ids = batch.map(r => r.id)
      await admin.from('ev_notice_recipients')
        .update({ email_status: 'sent' })
        .in('id', ids)
      for (const r of batch) deliveryReport[r.profile_id] = 'sent'
      sent += batch.length
    }

    // 5. Merge per-profile statuses into ev_notices.delivery_report.
    const { data: existing } = await admin
      .from('ev_notices')
      .select('delivery_report')
      .eq('id', notice.id)
      .single()
    const merged = { ...((existing as any)?.delivery_report || {}), ...deliveryReport }
    await admin.from('ev_notices')
      .update({ delivery_report: merged })
      .eq('id', notice.id)

    return json({ ok: true, sent, failed })
  } catch (err) {
    console.error('notice-email-fanout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function noticeLink(notice: any): string {
  if (notice?.meeting_id) return `${APP_URL}/app/voice/${notice.meeting_id}`
  return `${APP_URL}/app/voice`
}

function renderNoticeHtml({ notice, link }: { notice: any; link: string }) {
  const subject = escapeHtml(notice?.subject || '')
  const body    = escapeHtml(notice?.body || '').replace(/\n/g, '<br/>')
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #1F2233; line-height: 1.6; max-width: 520px; margin: 0 auto; padding: 24px;">
      <div style="display: inline-block; padding: 4px 10px; background: #FF3B5F; color: white; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px;">Notice</div>
      <h1 style="font-size: 22px; margin: 0 0 14px; line-height: 1.3;">${subject}</h1>
      <div style="margin-bottom: 22px;">${body}</div>
      <p style="margin: 0 0 22px;">
        <a href="${link}" style="display: inline-block; background: #FF3B5F; color: white; padding: 11px 22px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in Residente</a>
      </p>
      <p style="font-size: 12px; color: #8a8e9c; margin-top: 32px;">You're receiving this email because you're an owner in your community on Residente.</p>
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
