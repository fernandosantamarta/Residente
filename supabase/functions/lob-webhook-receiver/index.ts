// lob-webhook-receiver — delivery tracking write-back for the certified-mail rail.
//
// Lob posts a letter lifecycle event (letter.processed_for_delivery,
// letter.in_transit, letter.delivered, letter.certified.delivered,
// letter.returned_to_sender, ...) for each piece mailed by collection-notice-mail.
// We match it to the ev_collection_notices row by lob_letter_id (service role,
// bypassing RLS) and stamp lob_status — and, when the certified piece is
// delivered, return_receipt_at — so the collections UI shows real delivery
// status next to the notice. Idempotent: a replayed event just re-writes the
// same fields.
//
// PUBLIC endpoint (Lob calls it server-to-server, no Supabase JWT). Deploy with
//   supabase functions deploy lob-webhook-receiver --no-verify-jwt
// and set the URL as a webhook in the Lob dashboard. If LOB_WEBHOOK_SECRET is
// set, we verify Lob's HMAC signature; otherwise we accept (dev / pre-config).
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//          LOB_WEBHOOK_SECRET (optional — enables signature verification).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('LOB_WEBHOOK_SECRET') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Verify Lob's webhook signature: HMAC-SHA256 over `${timestamp}.${rawBody}`
// keyed by the webhook secret, hex-compared to the lob-signature header.
async function verifyLob(raw: string, sig: string, ts: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true // verification disabled until the secret is set
  if (!sig || !ts) return false
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`))
    const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
    // constant-time-ish compare
    if (hex.length !== sig.length) return false
    let diff = 0
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i)
    return diff === 0
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!SERVICE_KEY) return json({ error: 'not configured' }, 503)

  const raw = await req.text()
  const sig = req.headers.get('lob-signature') ?? ''
  const ts = req.headers.get('lob-signature-timestamp') ?? ''
  if (!(await verifyLob(raw, sig, ts))) return json({ error: 'bad signature' }, 401)

  let evt: any = null
  try { evt = JSON.parse(raw) } catch { return json({ error: 'bad body' }, 400) }

  // Event shape: { event_type: { id: 'letter.delivered', ... }, body: { id: 'ltr_...', ... } }
  const eventType: string = String(evt?.event_type?.id || evt?.event_type || '')
  const letterId: string = String(evt?.body?.id || evt?.reference_id || '')
  if (!letterId || !eventType.startsWith('letter.')) {
    return json({ ok: true, ignored: true }) // ack non-letter events so Lob stops retrying
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const patch: Record<string, unknown> = { lob_status: eventType }

  // The legal evidence we care about: the certified piece was delivered.
  const delivered = eventType === 'letter.delivered' || eventType.includes('certified.delivered')
  if (delivered) {
    const when = String(evt?.date_created || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    patch.return_receipt_at = when
  }

  try {
    await admin.from('ev_collection_notices').update(patch).eq('lob_letter_id', letterId)
  } catch (e) {
    console.error('lob webhook update failed', e)
    return json({ error: 'update failed' }, 500)
  }
  return json({ ok: true })
})
