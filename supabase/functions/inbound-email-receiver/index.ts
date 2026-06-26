// inbound-email-receiver — the AI front desk's inbound rail.
//
// Resend Inbound (https://resend.com/docs/dashboard/inbound) posts an event here
// for every email sent to the association's front-desk address. We:
//   1. dedup on the Message-ID (ev_inbound_emails),
//   2. route to a community by the address token (communities.inbound_email_token),
//   3. match the sender to a resident account (residents.email → profile_id),
//   4. open it as a resident_request thread (origin='email'), and
//   5. when AI is configured, triage it — category + priority + a DRAFT reply the
//      board reviews before sending (it NEVER auto-replies).
// Everything is logged to ev_inbound_emails so unmatched mail is never lost.
//
// PUBLIC endpoint (Resend calls it server-to-server). Deploy with
//   supabase functions deploy inbound-email-receiver --no-verify-jwt
// If RESEND_INBOUND_SECRET (the Svix signing secret, whsec_…) is set we verify
// the signature; otherwise we accept (dev / pre-config).
//
// DARK UNTIL CONFIGURED: with no inbound DNS wired nothing ever calls this; with
// ANTHROPIC_API_KEY unset the triage is skipped and the request is still created
// (just without a category/priority/draft). Fails soft at every step.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//          RESEND_INBOUND_SECRET (optional — Svix signing secret),
//          ANTHROPIC_API_KEY (optional — enables triage),
//          INBOUND_TRIAGE_MODEL (optional — defaults to claude-haiku-4-5).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { checkCap, recordUsage } from '../_shared/ai-metering.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SIGNING_SECRET = Deno.env.get('RESEND_INBOUND_SECRET') ?? ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const TRIAGE_MODEL = Deno.env.get('INBOUND_TRIAGE_MODEL') ?? 'claude-haiku-4-5'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Svix webhook verification (Resend uses Svix): signature = base64(HMAC-SHA256(
// secret, `${id}.${timestamp}.${body}`)). The header is a space-separated list of
// `v1,<sig>` entries; any match passes. No secret set → verification disabled.
async function verifySvix(raw: string, headers: Headers): Promise<boolean> {
  if (!SIGNING_SECRET) return true
  const id = headers.get('svix-id') || headers.get('webhook-id') || ''
  const ts = headers.get('svix-timestamp') || headers.get('webhook-timestamp') || ''
  const sigHeader = headers.get('svix-signature') || headers.get('webhook-signature') || ''
  if (!id || !ts || !sigHeader) return false
  try {
    const secretB64 = SIGNING_SECRET.replace(/^whsec_/, '')
    const keyBytes = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`))
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
    return sigHeader.split(' ').some(part => {
      const sig = part.includes(',') ? part.split(',')[1] : part
      return sig === expected
    })
  } catch { return false }
}

// Pull a usable shape out of whatever Resend posts (defensive across versions).
function readEmail(evt: any) {
  const d = evt?.data ?? evt ?? {}
  const fromRaw = d.from ?? d.sender ?? ''
  const from = typeof fromRaw === 'object' ? (fromRaw.address || fromRaw.email || '') : String(fromRaw)
  const fromName = typeof fromRaw === 'object' ? (fromRaw.name || '') : ''
  const toList: string[] = []
  const pushAddr = (x: any) => {
    if (!x) return
    if (typeof x === 'string') toList.push(x)
    else if (typeof x === 'object') toList.push(x.address || x.email || '')
  }
  const to = d.to ?? d.recipient ?? d.recipients
  if (Array.isArray(to)) to.forEach(pushAddr); else pushAddr(to)
  // Message-ID for dedup: explicit field, headers, or a synthetic fallback.
  const headers = d.headers || {}
  const messageId = d.message_id || d.email_id || d.id ||
    headers['message-id'] || headers['Message-ID'] || headers['Message-Id'] || ''
  return {
    from: String(from || '').trim().toLowerCase(),
    fromName: String(fromName || '').trim(),
    to: toList.map(s => String(s || '').trim().toLowerCase()).filter(Boolean),
    subject: String(d.subject || '').trim(),
    text: String(d.text || d.body || d.stripped_text || d.html || '').trim(),
    messageId: String(messageId || '').trim(),
  }
}

// Candidate routing tokens from an inbound address local-part: the full local
// part, the part after a '+', and the part after an 'fd-' prefix.
function tokensFromAddress(addr: string): string[] {
  const local = String(addr || '').split('@')[0] || ''
  const out = new Set<string>()
  if (local) out.add(local)
  if (local.includes('+')) out.add(local.split('+').slice(1).join('+'))
  if (local.startsWith('fd-')) out.add(local.slice(3))
  return Array.from(out).filter(Boolean)
}

// Forced-tool triage (dark until ANTHROPIC_API_KEY). Returns null on any failure.
async function triage(subject: string, body: string): Promise<{ category: string; priority: string; draft_reply: string } | null> {
  if (!ANTHROPIC_API_KEY) return null
  const tool = {
    name: 'triage_email',
    description: 'Categorize a resident email to an HOA/condo board and draft a reply for the board to review.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['maintenance', 'appeal', 'account', 'other'], description: 'Best-fit category for the request.' },
        priority: { type: 'string', enum: ['low', 'normal', 'urgent'], description: 'urgent only for safety/flooding/no-AC-in-heat/security or legal-deadline issues.' },
        draft_reply: { type: 'string', description: 'A warm, concise, professional draft reply for the BOARD to review and send. Acknowledge the issue and suggest the next step; do not promise specific timelines or outcomes as final, and never invent facts or policies.' },
      },
      required: ['category', 'priority', 'draft_reply'],
      additionalProperties: false,
    },
  }
  const prompt =
    'You are the front desk for a Florida HOA/condo association. A resident sent the email below. Using the ' +
    'triage_email tool, classify it and draft a reply for the board to review and send. Be helpful and neutral; ' +
    'suggest the next step but do not commit to specific timelines or outcomes as if final, and never invent ' +
    'rules or facts.\n\n' +
    `SUBJECT: ${subject || '(no subject)'}\n\nEMAIL:\n${body.slice(0, 16000)}`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: TRIAGE_MODEL, max_tokens: 1500,
        tools: [tool], tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const use = (data?.content || []).find((b: any) => b.type === 'tool_use' && b.name === tool.name)
    if (!use?.input) return null
    return { ...use.input, _usage: data?.usage } as any
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!SERVICE_KEY) return json({ error: 'not configured', code: 'not_configured' }, 503)

  const raw = await req.text()
  if (!(await verifySvix(raw, req.headers))) return json({ error: 'bad signature' }, 401)

  let evt: any = null
  try { evt = JSON.parse(raw) } catch { return json({ error: 'bad body' }, 400) }
  const mail = readEmail(evt)
  if (!mail.from || !mail.to.length) return json({ ok: true, ignored: true })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1) Dedup + log. Unique message_id guards Resend replays.
  const logRow: Record<string, unknown> = {
    message_id: mail.messageId || null,
    from_email: mail.from, from_name: mail.fromName || null,
    to_address: mail.to[0] || null, subject: mail.subject || null, body_text: mail.text || null,
    status: 'received',
  }
  const ins = await admin.from('ev_inbound_emails').insert(logRow).select('id').single()
  if (ins.error) {
    if ((ins.error as any)?.code === '23505') return json({ ok: true, duplicate: true })
    console.error('inbound log insert failed', ins.error)
    return json({ error: 'log failed' }, 500)
  }
  const inboundId = ins.data!.id as string
  const finish = async (patch: Record<string, unknown>) => {
    try { await admin.from('ev_inbound_emails').update(patch).eq('id', inboundId) } catch { /* best effort */ }
  }

  // 2) Route to a community by the inbound address token.
  const candidates = mail.to.flatMap(tokensFromAddress)
  let communityId: string | null = null
  if (candidates.length) {
    const { data: comm } = await admin.from('communities')
      .select('id, inbound_email_token').in('inbound_email_token', candidates).limit(1).maybeSingle()
    communityId = comm?.id || null
  }
  if (!communityId) { await finish({ status: 'unmatched_community' }); return json({ ok: true, routed: false }) }
  await finish({ community_id: communityId })

  // 3) Match the sender to a resident account (residents.email → profile).
  const { data: resident } = await admin.from('residents')
    .select('id, profile_id, full_name, unit_number')
    .eq('community_id', communityId).ilike('email', mail.from).limit(1).maybeSingle()

  if (!resident) {
    await finish({ status: 'unmatched_sender', community_id: communityId })
    return json({ ok: true, matched: false })
  }
  if (!resident.profile_id) {
    // Known resident but no linked account → can't open a thread (profile_id is
    // required). Keep it in the inbound log for the board to action manually.
    await finish({ status: 'unmatched_no_account', community_id: communityId, matched_resident_id: resident.id })
    return json({ ok: true, matched: 'no_account' })
  }

  // 4) Open the request thread (origin='email' → seeded as a resident message).
  const reqIns = await admin.from('resident_requests').insert({
    community_id: communityId,
    profile_id: resident.profile_id,
    submitter_name: resident.full_name || mail.fromName || null,
    submitter_unit: resident.unit_number || null,
    category: 'other',
    subject: mail.subject || '(no subject)',
    body: mail.text || '',
    status: 'new',
    origin: 'email',
    inbound_email_id: inboundId,
  }).select('id').single()
  if (reqIns.error) {
    await finish({ status: 'error', community_id: communityId, matched_profile_id: resident.profile_id, matched_resident_id: resident.id, error_detail: reqIns.error.message })
    return json({ error: 'request create failed' }, 500)
  }
  const requestId = reqIns.data!.id as string

  // 5) AI triage (dark until ANTHROPIC_API_KEY; metered + capped per community).
  let ai: any = null
  try {
    const cap = await checkCap(communityId)
    if (cap.allowed) {
      ai = await triage(mail.subject, mail.text)
      if (ai) {
        await admin.from('resident_requests').update({
          category: ['maintenance', 'appeal', 'account', 'other'].includes(ai.category) ? ai.category : 'other',
          priority: ['low', 'normal', 'urgent'].includes(ai.priority) ? ai.priority : 'normal',
          ai_draft_reply: ai.draft_reply || null,
        }).eq('id', requestId)
        try { await recordUsage({ communityId, userId: resident.profile_id, fn: 'inbound-email-receiver', kind: 'triage', model: TRIAGE_MODEL, usage: ai._usage }) } catch { /* metering best-effort */ }
      }
    }
  } catch (e) { console.error('triage failed', e) }

  await finish({
    status: 'matched', community_id: communityId, request_id: requestId,
    matched_profile_id: resident.profile_id, matched_resident_id: resident.id,
    ...(ai ? { ai_category: ai.category, ai_priority: ai.priority, ai_draft_reply: ai.draft_reply } : {}),
  })

  return json({ ok: true, matched: true, request_id: requestId, triaged: !!ai })
})
