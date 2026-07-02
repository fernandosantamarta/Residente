// notice-push-fanout — delivers a new notice as a Web Push to every in-app
// recipient who has enabled browser notifications, honouring push_pref.
//
// Triggered by a Supabase Database Webhook on INSERT to public.ev_notices
// (add a SECOND webhook alongside notice-email-fanout, same event/secret).
// The ev_notice_fanout / targeted-notice DB triggers have already materialised
// the ev_notice_recipients rows by the time this fires, so push simply mirrors
// the in-app bell: whoever got a recipient row gets a push (if subscribed and
// not opted out). That means it covers EVERY notice kind automatically — no
// per-kind wiring.
//
// Idempotent enough to re-run: a duplicate webhook just re-sends the push.
// Dead endpoints (404/410) are pruned from push_subscriptions.
//
// Deploy:  supabase functions deploy notice-push-fanout --no-verify-jwt
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@…),
//          NOTICE_WEBHOOK_SECRET, APP_URL
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injected)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC   = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE  = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT  = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@residente.io'
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://residente.io'
const WEBHOOK_SECRET = Deno.env.get('NOTICE_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// push_pref = 'important' delivers ONLY these kinds. Mirror of the email gate
// in resident-notification-prefs.sql — keep the two lists in sync.
const IMPORTANT_KINDS = new Set([
  'dues_due', 'vote_opened', 'vote_reminder', 'vote_results', 'custom_broadcast',
])

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (WEBHOOK_SECRET && req.headers.get('X-Webhook-Secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SERVICE_ROLE) {
    console.error('Missing VAPID keys or service role')
    return json({ error: 'Server not configured' }, 500)
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const notice = payload?.record
    if (!notice?.id) return json({ error: 'No record in payload' }, 400)

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 1. Who got this notice in their bell (the in_app recipient rows).
    const { data: recips, error: rErr } = await admin
      .from('ev_notice_recipients')
      .select('profile_id')
      .eq('notice_id', notice.id)
      .eq('channel', 'in_app')
    if (rErr) throw rErr
    if (!recips?.length) return json({ ok: true, sent: 0, skipped: 'no in_app recipients' })

    const profileIds = [...new Set(recips.map((r) => r.profile_id as string))]

    // 2. push_pref gate (default 'all' when the resident has no prefs row).
    const { data: prefs } = await admin
      .from('resident_preferences')
      .select('profile_id, push_pref')
      .in('profile_id', profileIds)
    const prefById = new Map((prefs || []).map((p: any) => [p.profile_id, p.push_pref]))
    const isImportant = IMPORTANT_KINDS.has(notice.kind)
    const eligible = profileIds.filter((pid) => {
      const pref = prefById.get(pid) ?? 'all'
      if (pref === 'none') return false
      if (pref === 'important') return isImportant
      return true
    })
    if (!eligible.length) return json({ ok: true, sent: 0, skipped: 'no push-eligible recipients' })

    // 3. Their device subscriptions.
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('profile_id', eligible)
    if (!subs?.length) return json({ ok: true, sent: 0, skipped: 'no subscriptions' })

    const body = JSON.stringify({
      title: notice.subject || 'Residente',
      body: notice.body || '',
      url: APP_URL + noticeHref(notice),
      tag: String(notice.id),
    })

    // 4. Send to every endpoint; prune the dead ones.
    let sent = 0, removed = 0, failed = 0
    const dead: string[] = []
    await Promise.all(
      subs.map(async (s: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body
          )
          sent++
        } catch (err: any) {
          const code = err?.statusCode
          if (code === 404 || code === 410) { dead.push(s.id); removed++ }
          else { failed++; console.error('push send failed:', code, err?.body || err?.message) }
        }
      })
    )
    if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)

    return json({ ok: true, sent, removed, failed })
  } catch (err) {
    console.error('notice-push-fanout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

// Mirror of lib/voice.ts noticeHref() — keep in sync. The push click opens
// APP_URL + this path (handled by public/sw.js notificationclick).
function noticeHref(n: any): string {
  if (n.kind === 'amenity_booked') return '/admin/schedule#amenities'
  if (n.kind === 'dues_due') return '/app/track#pay'
  if (n.kind === 'compliance_alert') return '/admin/compliance'
  if (n.kind === 'estoppel_update') return '/app/track#pay'
  if (n.kind === 'collections_deadline') return '/admin/collections'
  if (n.kind === 'collections_update') return '/app/track#pay'
  if (n.kind === 'request_new') return '/admin/requests'
  if (n.kind === 'request_update') return '/app/voice#contact'
  if (n.kind === 'payment_received') return '/app/track#pay'
  if (n.kind === 'rule_published') return '/app/documents#rules'
  if (n.kind === 'violation') return '/app/track#violations'
  if (n.meeting_id) return `/app/voice/${n.meeting_id}`
  if (n.kind === 'document_uploaded') return '/app/documents'
  return '/app/voice'
}
