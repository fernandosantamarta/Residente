// collection-notice-mail — the certified-mail rail for statutory collection notices.
//
// One auth-gated endpoint a board member calls to GENERATE + MAIL a statutory
// collection notice through Lob (https://lob.com): Lob renders the letter HTML to
// PDF, mails it USPS — certified with return receipt for the intent-to-lien
// notice — and posts delivery events back to lob-webhook-receiver. We then log
// the notice on the case ledger (ev_collection_notices) with the Lob metadata, so
// the existing collections UI shows tracking + delivery exactly like a hand-typed
// certified mailing, only automatic.
//
// SINGLE SOURCE OF TRUTH: the CLIENT composes the legal letter (title, citation,
// body paragraphs) from lib/certifiedMail.ts using the same payoff math + statute
// citations the printable /document page uses. This function only does layout
// (a Lob-compliant letter shell) + transport (certified routing) + logging. It
// never recomputes the money or the legal text.
//
// SECURITY: requires a valid Supabase JWT whose profile is a board_member/admin
// of the case's community. Not an open endpoint.
//
// DARK UNTIL CONFIGURED: returns 503 { code: 'not_configured' } until LOB_API_KEY
// is set, so the client falls back to print-and-mail-by-hand.
//
// Deploy:  supabase functions deploy collection-notice-mail
// Secrets: LOB_API_KEY (required — 503 until set), SUPABASE_URL,
//          SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected).
//          Optional: LOB_LETTER_COLOR ('true' to print in color).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const LOB_API_KEY = Deno.env.get('LOB_API_KEY') ?? ''
const LOB_COLOR = (Deno.env.get('LOB_LETTER_COLOR') ?? '') === 'true'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Tolerant US-address parser: the app stores mailing addresses as free text
// (resident.last_known_address / .address, communities.association_address), but
// Lob needs structured components. Pull a trailing ", City, ST 12345(-6789)" off
// the end; everything before is line1 (+ line2). Returns null when no ZIP is
// present — the caller then refuses with a clear "needs a full mailing address".
function parseUsAddress(raw: string): {
  address_line1: string
  address_line2?: string
  address_city: string
  address_state: string
  address_zip: string
} | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const m = text.match(/^(.*?)[,\s]+([A-Za-z][A-Za-z .'-]+?)[,\s]+([A-Za-z]{2})\.?[,\s]+(\d{5}(?:-\d{4})?)\s*$/)
  if (!m) return null
  const [, street, city, state, zip] = m
  const streetParts = street.split(',').map(s => s.trim()).filter(Boolean)
  const line1 = streetParts[0] || street.trim()
  const line2 = streetParts.length > 1 ? streetParts.slice(1).join(', ') : undefined
  if (!line1 || !city || !state) return null
  return {
    address_line1: line1,
    ...(line2 ? { address_line2: line2 } : {}),
    address_city: city.trim(),
    address_state: state.toUpperCase(),
    address_zip: zip,
  }
}

// Build the Lob-compliant letter HTML. Lob overlays the to/from addresses onto
// the top of page 1 (address_placement: 'top_first_page'), so we reserve that
// region and start the letter body below it.
function letterHtml(opts: {
  dateStr: string
  title: string
  paragraphs: string[]
  officer: string
  associationName: string
  footer: string
}): string {
  const paras = (opts.paragraphs || [])
    .map(p => `<p>${esc(p)}</p>`)
    .join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 8.5in 11in; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; }
    .pg { width: 8.5in; min-height: 11in; box-sizing: border-box; padding: 0.75in 0.9in 0.9in; }
    .addrspace { height: 2.0in; }
    .date { font-size: 10.5pt; color: #444; margin-bottom: 6pt; }
    h1 { font-size: 15pt; margin: 0 0 10pt; }
    p { font-size: 11pt; line-height: 1.5; margin: 0 0 9pt; }
    .sig { margin-top: 34pt; font-size: 11pt; }
    .sig .line { border-top: 1px solid #111; width: 280px; padding-top: 5pt; }
    .sig .org { font-size: 10pt; color: #555; }
    .footer { margin-top: 20pt; font-size: 9pt; color: #666; line-height: 1.4; }
  </style></head><body><div class="pg">
    <div class="addrspace"></div>
    <div class="date">${esc(opts.dateStr)}</div>
    <h1>${esc(opts.title)}</h1>
    ${paras}
    <div class="sig">
      <div class="line">${esc(opts.officer)}</div>
      <div class="org">${esc(opts.associationName)}</div>
    </div>
    <div class="footer">${esc(opts.footer)}</div>
  </div></body></html>`
}

// One Lob letter. extra_service null = ordinary first-class; otherwise certified.
async function sendLobLetter(args: {
  description: string
  to: Record<string, string>
  from: Record<string, string>
  html: string
  extraService: string | null
}): Promise<{ ok: boolean; status: number; data: any }> {
  const auth = 'Basic ' + btoa(`${LOB_API_KEY}:`)
  const body: Record<string, unknown> = {
    description: args.description,
    to: args.to,
    from: args.from,
    file: args.html,
    color: LOB_COLOR,
    address_placement: 'top_first_page',
  }
  if (args.extraService) body.extra_service = args.extraService
  const res = await fetch('https://api.lob.com/v1/letters', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Dark until the key is set — the client falls back to manual print + mail.
  if (!LOB_API_KEY) return json({ error: 'Certified mail is not configured.', code: 'not_configured' }, 503)
  if (!SERVICE_KEY) return json({ error: 'Server is not configured.', code: 'not_configured' }, 503)

  // --- auth: a board member / admin of the case's community ---
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not authenticated.' }, 401)
  let userId = ''
  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY)
    const { data: { user }, error } = await anon.auth.getUser(token)
    if (error || !user) return json({ error: 'Not authenticated.' }, 401)
    userId = user.id
  } catch { return json({ error: 'Auth check failed.' }, 401) }

  let body: any = null
  try { body = await req.json() } catch { return json({ error: 'Bad request body.' }, 400) }

  const caseId = String(body?.case_id || '')
  const kind = String(body?.kind || '')
  const recipientName = String(body?.recipient_name || '').trim()
  const title = String(body?.title || '').trim()
  const footer = String(body?.footer || '').trim()
  const paragraphs: string[] = Array.isArray(body?.paragraphs) ? body.paragraphs.map((p: any) => String(p)) : []
  const recordAddress = String(body?.record_address || '').trim()
  const unitAddress = String(body?.unit_address || '').trim()
  const dualRequired = !!body?.dual_required
  const dateStr = String(body?.date_str || '').trim() || new Date().toISOString().slice(0, 10)

  const MAILED_KINDS = new Set(['late_assessment_30', 'intent_to_lien_45', 'intent_to_foreclose_45'])
  if (!caseId || !MAILED_KINDS.has(kind) || !title || !paragraphs.length) {
    return json({ error: 'Missing or invalid letter fields.' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // Verify the caller governs this case's community.
  const { data: prof } = await admin.from('profiles').select('community_id, role').eq('id', userId).single()
  const { data: kase } = await admin.from('ev_collection_cases').select('community_id').eq('id', caseId).single()
  if (!prof || !kase || prof.community_id !== kase.community_id || !['board_member', 'admin'].includes(String(prof.role))) {
    return json({ error: 'Not allowed for this case.' }, 403)
  }
  const communityId = kase.community_id

  const { data: comm } = await admin.from('communities')
    .select('name, association_address, association_officer_name')
    .eq('id', communityId).single()
  const associationName = String(comm?.name || 'Association')
  const officer = String(comm?.association_officer_name || 'Authorized officer / agent')

  // From = the association's return address (required for certified mail).
  const fromParsed = parseUsAddress(String(comm?.association_address || ''))
  if (!fromParsed) {
    return json({ error: 'Add the association mailing address (street, city, state ZIP) in Community settings before mailing.', code: 'needs_from_address' }, 422)
  }
  const from = { name: associationName.slice(0, 40), ...fromParsed }

  // The address(es) the notice must go to (record, + unit/parcel when it differs).
  const recordParsed = parseUsAddress(recordAddress)
  if (!recordParsed) {
    return json({ error: 'This owner has no full mailing address on file (need street, city, state ZIP). Add it to the roster, then mail.', code: 'needs_to_address' }, 422)
  }
  const unitParsed = dualRequired && unitAddress ? parseUsAddress(unitAddress) : null

  // Per-address service: certified (return-receipt for the lien notice) to the
  // address of record; a first-class copy to the unit/parcel address when dual.
  const certService =
    kind === 'intent_to_lien_45' ? 'certified_return_receipt'
    : kind === 'intent_to_foreclose_45' ? 'certified'
    : null // late_assessment_30 → first-class

  const html = letterHtml({ dateStr, title, paragraphs, officer, associationName, footer })

  const sends: { role: 'record' | 'unit'; to: Record<string, string>; extraService: string | null }[] = [
    { role: 'record', to: { name: recipientName.slice(0, 40) || 'Owner of record', ...recordParsed }, extraService: certService },
  ]
  if (unitParsed) sends.push({ role: 'unit', to: { name: recipientName.slice(0, 40) || 'Owner of record', ...unitParsed }, extraService: null })

  // Fire the letters. The PRIMARY (record-address, certified) piece drives the
  // notice row's tracking + delivery; any unit-address copy is recorded in notes.
  const results: any[] = []
  for (const s of sends) {
    const r = await sendLobLetter({
      description: `${kind} → ${s.role} (${caseId.slice(0, 8)})`,
      to: s.to, from, html, extraService: s.extraService,
    })
    if (!r.ok) {
      console.error('lob letter failed', r.status, JSON.stringify(r.data))
      // If the very first (primary) letter fails, surface it; nothing was logged.
      if (s.role === 'record') {
        const detail = r.data?.error?.message || 'Lob rejected the letter.'
        return json({ error: detail, code: 'lob_error', status: r.status }, 502)
      }
    }
    results.push({ role: s.role, ...r.data })
  }

  const primary = results.find(r => r.role === 'record') || results[0]
  const totalCost = results.reduce((sum, r) => sum + (Number(r?.price) || 0), 0)

  const method = kind === 'late_assessment_30' ? 'first_class' : 'both'
  const { data: inserted, error: insErr } = await admin.from('ev_collection_notices').insert({
    community_id: communityId,
    case_id: caseId,
    kind,
    sent_at: dateStr,
    method,
    tracking_number: primary?.tracking_number || null,
    recipient_name: recipientName || null,
    mailed_to_record_address: recordAddress || null,
    mailed_to_unit_address: dualRequired && unitAddress ? unitAddress : null,
    dual_address_required: dualRequired,
    mail_provider: 'lob',
    lob_letter_id: primary?.id || null,
    lob_status: 'letter.created',
    lob_cost: totalCost || null,
    lob_expected_delivery: primary?.expected_delivery_date || null,
    lob_url: primary?.url || null,
    notes: JSON.stringify({ lob_letters: results.map(r => ({ role: r.role, id: r.id, tracking: r.tracking_number, price: r.price })) }),
    created_by: userId,
  }).select('id').single()

  if (insErr) {
    // The mail went out; we just couldn't log it. Tell the client so the board
    // can log it manually rather than re-mailing (which would double-charge).
    console.error('notice insert failed after mailing', insErr)
    return json({ ok: true, logged: false, letters: results.length, warn: 'Mailed, but the case ledger could not be updated — log it manually.', lob_letter_id: primary?.id || null }, 200)
  }

  return json({
    ok: true,
    logged: true,
    notice_id: inserted?.id || null,
    letters: results.length,
    lob_letter_id: primary?.id || null,
    tracking_number: primary?.tracking_number || null,
    expected_delivery: primary?.expected_delivery_date || null,
    cost: totalCost || null,
  })
})
