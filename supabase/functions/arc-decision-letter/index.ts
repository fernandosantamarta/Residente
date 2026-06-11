// arc-decision-letter — render the ARC decision letter to a PDF and deliver it
// to the owner who submitted the request.
//
// Called from /admin/arc (browser, authenticated as a board member / admin)
// when the board clicks "Send letter to resident" on a decided request. It:
//   1. verifies the caller is board_member/admin of the request's community,
//   2. renders the decision letter to a PDF — the body language comes from the
//      SHARED lib/compliance/arc-letter module, the same source the on-screen
//      /admin/arc/[id]/document page uses, so the letters can never drift,
//   3. uploads the PDF with the service role into the existing private
//      request-attachments bucket under <community_id>/<owner_profile_id>/<uuid>.pdf
//      — the owner's own folder, so the existing "residents read own request
//      files" storage policy already grants the owner the download (no new RLS),
//   4. records decision_letter_path / _name / _sent_at on the request, and
//   5. files a PERSONAL in-app notice to the owner that the letter is available
//      (mirrors the arc.sql decision->owner notice).
//
// The letter is a DRAFT aid — the board confirms the language with counsel
// before sending (the UI keeps that warning on the confirm step).
//
// Deploy:  supabase functions deploy arc-decision-letter
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (the SUPABASE_* trio is auto-injected; service-role is required for
//          the RLS-bypassing storage upload into the owner's folder + the notice.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import {
  arcLetterIntro,
  arcLetterFactRows,
  arcLetterDecisionBlocks,
  arcLetterClosing,
  arcLetterFilename,
  splitEmphasis,
  type ArcLetterInput,
  type LetterBlock,
} from '../../../lib/compliance/arc-letter.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const BUCKET = 'request-attachments'

// Display labels — kept tiny + inline (cosmetic, low-drift) so this function
// needs no extensionless sibling import from arc.ts. The legally load-bearing
// letter language lives only in the shared arc-letter module above.
const TYPE_LABELS: Record<string, string> = {
  exterior_alteration: 'Exterior alteration',
  new_construction:    'New construction',
  landscaping:         'Landscaping',
  other:               'Other',
}
const STATUS_LABELS: Record<string, string> = {
  submitted:                'Submitted',
  under_review:             'Under review',
  approved:                 'Approved',
  approved_with_conditions: 'Approved with conditions',
  denied:                   'Denied',
  withdrawn:                'Withdrawn',
}
const DECIDED = ['approved', 'approved_with_conditions', 'denied']

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { request_id } = await req.json().catch(() => ({}))
    if (!request_id || typeof request_id !== 'string') return json({ error: 'request_id is required' }, 400)
    if (!SERVICE_ROLE) return json({ error: 'Server not configured' }, 500)

    // Authenticate the board caller.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // Load the request.
    const { data: request, error: reqErr } = await admin
      .from('ev_arc_requests')
      .select('id, community_id, profile_id, unit_label, request_type, description, attachment_name, submitted_at, decided_at, status, decision_reason, is_material_alteration')
      .eq('id', request_id)
      .single()
    if (reqErr || !request) return json({ error: 'Request not found' }, 404)
    if (!DECIDED.includes(String(request.status))) {
      return json({ error: 'This request has no recorded decision to send.' }, 400)
    }
    if (!request.profile_id) {
      return json({ error: 'This request has no linked owner account to deliver the letter to.' }, 400)
    }

    // The caller must be board/admin of the request's community.
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, community_id')
      .eq('id', caller.id)
      .single()
    const isBoard = callerProfile
      && callerProfile.community_id === request.community_id
      && ['board_member', 'admin'].includes(String(callerProfile.role))
    if (!isBoard) return json({ error: 'Forbidden' }, 403)

    // Community context for the letterhead + statute regime.
    const { data: community } = await admin
      .from('communities')
      .select('name, association_type, association_address, association_officer_name, material_alteration_threshold_pct')
      .eq('id', request.community_id)
      .single()

    const isCondo = community?.association_type !== 'hoa'
    const decidedAt = String(request.decided_at || new Date().toISOString().slice(0, 10))
    const letter: ArcLetterInput = {
      associationName: community?.name || 'the association',
      isCondo,
      unitLabel: request.unit_label || '',
      typeLabel: TYPE_LABELS[String(request.request_type)] || String(request.request_type || 'Other'),
      status: String(request.status),
      statusLabel: STATUS_LABELS[String(request.status)] || String(request.status),
      description: request.description || '',
      attachmentName: request.attachment_name || '',
      submittedAt: request.submitted_at || '',
      decidedAt,
      decisionReason: request.decision_reason || '',
      isMaterialAlteration: !!request.is_material_alteration,
      materialPct: Number(community?.material_alteration_threshold_pct) || 75,
    }

    const pdfBytes = await renderLetterPdf(letter, {
      associationAddress: community?.association_address || '',
      officerName: community?.association_officer_name || 'Authorized officer / ARC chair',
    })

    // Upload into the OWNER's folder so the resident-read storage policy covers
    // the download. Service role bypasses the board storage-INSERT gap.
    const path = `${request.community_id}/${request.profile_id}/${crypto.randomUUID()}.pdf`
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: false,
    })
    if (upErr) {
      console.error('arc-decision-letter upload failed:', upErr)
      return json({ error: 'Could not store the letter.' }, 500)
    }

    const name = arcLetterFilename(letter)
    const { error: updErr } = await admin
      .from('ev_arc_requests')
      .update({
        decision_letter_path: path,
        decision_letter_name: name,
        decision_letter_sent_at: new Date().toISOString(),
      })
      .eq('id', request.id)
    if (updErr) {
      console.error('arc-decision-letter row update failed:', updErr)
      // The file is stored; surface the failure so the board can retry.
      return json({ error: 'Stored the letter but could not record it on the request.' }, 500)
    }

    // Personal in-app notice to the owner (best-effort — mirrors arc.sql).
    try {
      const { data: notice } = await admin
        .from('ev_notices')
        .insert({
          community_id: request.community_id,
          kind: 'custom_broadcast',
          channels: ['personal'],
          subject: 'Architectural review decision letter',
          body: `The board has sent you the official decision letter for your architectural review request `
            + `(${letter.typeLabel}). Open the Architectural review page to download it.`,
          sent_by: caller.id,
        })
        .select('id')
        .single()
      if (notice?.id) {
        await admin.from('ev_notice_recipients').insert({
          notice_id: notice.id,
          community_id: request.community_id,
          profile_id: request.profile_id,
          channel: 'in_app',
        })
      }
    } catch (e) {
      console.error('arc-decision-letter notice failed (non-fatal):', e)
    }

    return json({ ok: true, path, name })
  } catch (err) {
    console.error('arc-decision-letter failed:', err)
    return json({ error: (err as Error).message }, 400)
  }
})

// ----------------------------------------------------------------------------
// PDF rendering — a small text engine over pdf-lib. The letter body comes from
// the shared arc-letter blocks; this only handles layout (letterhead, the fact
// table, word-wrapped paragraphs honoring **emphasis** runs, signature).
// ----------------------------------------------------------------------------

// Standard fonts use WinAnsi encoding — swap the few non-WinAnsi typographic
// characters a community name or reason text might contain so a draw never throws.
function winAnsi(s: string): string {
  return String(s ?? '')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–]/g, '-')
    .replace(/[…]/g, '...')
}

async function renderLetterPdf(
  letter: ArcLetterInput,
  opts: { associationAddress: string; officerName: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 64
  const MAX_W = PAGE_W - MARGIN * 2
  const INK = rgb(0.07, 0.07, 0.07)
  const GREY = rgb(0.33, 0.33, 0.33)
  const AMBER = rgb(0.71, 0.28, 0.03)

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN }
  const ensure = (h: number) => { if (y - h < MARGIN) newPage() }

  const wordsFromRuns = (runs: Array<{ text: string; bold: boolean }>) => {
    const words: Array<{ w: string; bold: boolean }> = []
    for (const r of runs) {
      for (const w of winAnsi(r.text).split(/\s+/)) {
        if (w !== '') words.push({ w, bold: r.bold })
      }
    }
    return words
  }

  // Draw a paragraph of (possibly bold-emphasized) runs, word-wrapped.
  const para = (
    runs: Array<{ text: string; bold: boolean }>,
    o: { size?: number; color?: any; baseBold?: boolean; baseItalic?: boolean; indent?: number; gap?: number } = {},
  ) => {
    const size = o.size ?? 11
    const color = o.color ?? INK
    const lh = size * 1.4
    const indent = o.indent ?? 0
    const maxW = MAX_W - indent
    const space = font.widthOfTextAtSize(' ', size)
    const pick = (b: boolean) => (o.baseItalic ? italic : (b || o.baseBold) ? bold : font)
    const wordW = (w: string, b: boolean) => pick(b).widthOfTextAtSize(w, size)

    let line: Array<{ w: string; bold: boolean }> = []
    const flush = () => {
      ensure(lh)
      let x = MARGIN + indent
      for (let i = 0; i < line.length; i++) {
        const tok = line[i]
        page.drawText(tok.w, { x, y, size, font: pick(tok.bold), color })
        x += wordW(tok.w, tok.bold) + space
      }
      y -= lh
      line = []
    }
    let lineW = 0
    for (const tok of wordsFromRuns(runs)) {
      const w = wordW(tok.w, tok.bold)
      const add = (line.length ? space : 0) + w
      if (line.length && lineW + add > maxW) { flush(); lineW = 0 }
      line.push(tok); lineW += (line.length > 1 ? space : 0) + w
    }
    if (line.length) flush()
    if (o.gap) y -= o.gap
  }

  const plain = (text: string, o: Parameters<typeof para>[1] = {}) =>
    para([{ text, bold: false }], o)

  // ---- Letterhead ----
  const center = (text: string, size: number, f = font, color = INK) => {
    const t = winAnsi(text)
    const w = f.widthOfTextAtSize(t, size)
    ensure(size * 1.4)
    page.drawText(t, { x: (PAGE_W - w) / 2, y, size, font: f, color })
    y -= size * 1.5
  }
  center(letter.associationName || 'Association', 16, bold)
  if (opts.associationAddress) center(opts.associationAddress, 10.5, font, GREY)
  y -= 6
  plain(letter.decidedAt, { size: 10.5, color: GREY, gap: 4 })
  para([{ text: 'Architectural Review Decision', bold: false }], { size: 15, baseBold: true, gap: 8 })

  // ---- Addressee ----
  plain(letter.unitLabel || 'owner name / unit', { size: 11.5, baseBold: true })
  plain(`Re: ARC Request — ${letter.typeLabel}`, { size: 11 })
  if (letter.submittedAt) plain(`Submitted: ${letter.submittedAt}`, { size: 11 })
  y -= 10

  // ---- Intro ----
  plain(arcLetterIntro(letter), { gap: 8 })

  // ---- Fact table ----
  const rows = arcLetterFactRows(letter)
  const labelW = 150
  for (const [label, value] of rows) {
    const lh = 11 * 1.4
    // value wraps in the right column; label sits on the first line.
    const valWords = winAnsi(value).split(/\s+/).filter(Boolean)
    const valX = MARGIN + labelW
    const valMaxW = MAX_W - labelW
    const space = font.widthOfTextAtSize(' ', 11)
    let first = true
    let line: string[] = []
    let lineW = 0
    const flushVal = () => {
      ensure(lh)
      if (first) {
        page.drawText(winAnsi(label), { x: MARGIN, y, size: 11, font: bold, color: INK })
        first = false
      }
      page.drawText(line.join(' '), { x: valX, y, size: 11, font, color: INK })
      y -= lh
      line = []
    }
    for (const w of valWords) {
      const ww = font.widthOfTextAtSize(w, 11)
      const add = (line.length ? space : 0) + ww
      if (line.length && lineW + add > valMaxW) { flushVal(); lineW = 0 }
      line.push(w); lineW += (line.length > 1 ? space : 0) + ww
    }
    if (line.length || first) flushVal()
    y -= 3
  }
  y -= 8

  // ---- Decision blocks ----
  const blocks: LetterBlock[] = arcLetterDecisionBlocks(letter)
  for (const b of blocks) {
    const runs = splitEmphasis(b.text)
    if (b.kind === 'box') {
      para(runs, { size: 11, baseBold: !!b.bold, indent: 14, gap: 8, color: INK })
    } else if (b.tone === 'fine') {
      para(runs, { size: 10, color: GREY, gap: 8 })
    } else if (b.tone === 'warn') {
      para(runs, { size: 10.5, color: AMBER, indent: 10, gap: 8 })
    } else {
      para(runs, { size: 11, gap: 8 })
    }
  }

  // ---- Closing ----
  plain(arcLetterClosing(letter), { size: 10, color: GREY, gap: 28 })

  // ---- Signature ----
  ensure(60)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 240, y }, thickness: 0.8, color: INK })
  y -= 14
  plain(opts.officerName, { size: 11 })
  plain(letter.associationName || 'Association', { size: 10, color: GREY })
  plain(`Date: ${letter.decidedAt}`, { size: 10, color: GREY })

  return await doc.save()
}
