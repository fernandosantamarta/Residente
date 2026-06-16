// apns-push-fanout — delivers a new notice as a native iOS push (APNs) to every
// in-app recipient who has registered a device in the Residente app, honouring
// push_pref. The native twin of notice-push-fanout (web push); both are wired
// to the SAME ev_notices INSERT webhook so a single notice fans out to browsers
// AND iOS devices in parallel.
//
// The ev_notice_fanout / targeted-notice DB triggers have already materialised
// the ev_notice_recipients rows by the time this fires, so push simply mirrors
// the in-app bell — covering EVERY notice kind automatically, no per-kind wiring.
//
// Idempotent enough to re-run: a duplicate webhook just re-sends. Dead tokens
// (APNs 410 Unregistered / 400 BadDeviceToken) are pruned from device_tokens.
//
// Deploy:  supabase functions deploy apns-push-fanout --no-verify-jwt
// Secrets: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY (.p8
//          contents, full PEM), NOTICE_WEBHOOK_SECRET, APP_URL
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injected)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const KEY_ID         = Deno.env.get('APNS_KEY_ID') ?? ''
const TEAM_ID        = Deno.env.get('APNS_TEAM_ID') ?? ''
const BUNDLE_ID      = Deno.env.get('APNS_BUNDLE_ID') ?? 'com.residente.app'
const PRIVATE_KEY    = Deno.env.get('APNS_PRIVATE_KEY') ?? ''
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://residente.io'
const WEBHOOK_SECRET = Deno.env.get('NOTICE_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// APNs hosts. We send to production first and fall back to sandbox on
// BadDeviceToken, so the one function serves both App Store / TestFlight
// builds (production) and Xcode debug builds (sandbox) without the client
// having to know which environment its token belongs to.
const APNS_PROD    = 'https://api.push.apple.com'
const APNS_SANDBOX = 'https://api.sandbox.push.apple.com'

// push_pref = 'important' delivers ONLY these kinds. Mirror of the web-push and
// email gates — keep the three lists in sync.
const IMPORTANT_KINDS = new Set([
  'dues_due', 'vote_opened', 'vote_reminder', 'vote_results', 'custom_broadcast',
])

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const b64url = (data: ArrayBuffer | Uint8Array | string): string => {
  let bin = ''
  if (typeof data === 'string') bin = data
  else {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  }
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// PEM (.p8 PKCS#8) → CryptoKey for ES256 signing.
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

// APNs provider JWT (ES256, kid = Key ID, iss = Team ID). Generated once per
// invocation and reused across every token in this fan-out — Apple rejects
// provider tokens regenerated more than once per ~20 min at volume.
async function makeProviderToken(): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }))
  const claims = b64url(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }))
  const signingInput = `${header}.${claims}`
  const key = await importPrivateKey(PRIVATE_KEY)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  )
  return `${signingInput}.${b64url(sig)}`
}

type SendResult = 'sent' | 'dead' | 'failed'

async function sendToHost(host: string, token: string, jwt: string, payload: string): Promise<Response> {
  return fetch(`${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    },
    body: payload,
  })
}

async function sendOne(token: string, jwt: string, payload: string): Promise<SendResult> {
  try {
    let res = await sendToHost(APNS_PROD, token, jwt, payload)
    // A production host rejects sandbox tokens with 400 BadDeviceToken; retry
    // sandbox once before giving up on the token.
    if (res.status === 400) {
      const reason = await res.clone().json().then((b) => b?.reason).catch(() => '')
      if (reason === 'BadDeviceToken') res = await sendToHost(APNS_SANDBOX, token, jwt, payload)
    }
    if (res.status === 200) return 'sent'
    const reason = await res.json().then((b) => b?.reason).catch(() => '')
    if (res.status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken') return 'dead'
    console.error('apns send failed:', res.status, reason)
    return 'failed'
  } catch (err) {
    console.error('apns send error:', (err as Error).message)
    return 'failed'
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (WEBHOOK_SECRET && req.headers.get('X-Webhook-Secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (!KEY_ID || !TEAM_ID || !PRIVATE_KEY || !SERVICE_ROLE) {
    console.error('Missing APNs config or service role')
    return json({ error: 'Server not configured' }, 500)
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const notice = payload?.record
    if (!notice?.id) return json({ error: 'No record in payload' }, 400)

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

    // 3. Their registered iOS devices.
    const { data: devices } = await admin
      .from('device_tokens')
      .select('id, token')
      .in('profile_id', eligible)
    if (!devices?.length) return json({ ok: true, sent: 0, skipped: 'no devices' })

    // 4. Build the APNs payload + provider token, send to every device.
    const body = JSON.stringify({
      aps: {
        alert: { title: notice.subject || 'Residente', body: notice.body || '' },
        sound: 'default',
        'thread-id': String(notice.id),
      },
      url: APP_URL + noticeHref(notice),
    })
    const jwt = await makeProviderToken()

    let sent = 0, removed = 0, failed = 0
    const dead: string[] = []
    await Promise.all(
      devices.map(async (d: any) => {
        const r = await sendOne(d.token, jwt, body)
        if (r === 'sent') sent++
        else if (r === 'dead') { dead.push(d.id); removed++ }
        else failed++
      })
    )
    if (dead.length) await admin.from('device_tokens').delete().in('id', dead)

    return json({ ok: true, sent, removed, failed })
  } catch (err) {
    console.error('apns-push-fanout failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

// Mirror of lib/voice.ts noticeHref() and notice-push-fanout — keep in sync.
// The push tap opens APP_URL + this path (handled in lib/nativePush.ts).
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
  if (n.kind === 'violation') return '/app/documents#violations'
  if (n.meeting_id) return `/app/voice/${n.meeting_id}`
  if (n.kind === 'document_uploaded') return '/app/documents'
  return '/app/voice'
}
