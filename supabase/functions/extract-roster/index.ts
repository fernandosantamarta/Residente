// extract-roster — Slice 1 of the universal AI document reader.
//
// Reads an uploaded owner roster / account ledger (a base64 PDF *or image* —
// including printed/scanned pages and arbitrary layouts, via Claude vision) and
// returns the owners it finds: name, unit, and current balance owed. The board
// reviews the result before it imports (the certificate of the read is the
// confirm step on the client). Complements the deterministic CSV import — CSV for
// clean exports, this for messy/scanned/untemplated documents.
//
// SECURITY: requires a valid Supabase JWT (the authenticated board member) — NOT
// an open endpoint, so it can't be hit anonymously to burn API credits. We never
// write to the DB here; we only return extracted rows to the client to review.
//
// Deploy:  supabase functions deploy extract-roster
// Secrets: ANTHROPIC_API_KEY (required — returns 503 "not configured" until set),
//          SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected). Optional:
//          EXTRACT_ROSTER_MODEL (defaults to claude-haiku-4-5 — cheap and plenty
//          for structured extraction; set to claude-opus-4-8 for max accuracy).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL = Deno.env.get('EXTRACT_ROSTER_MODEL') ?? 'claude-haiku-4-5'

// Forced tool — Claude must return the roster as this exact shape. Fields the
// document doesn't show are omitted; the board fixes anything on review.
const TOOL = {
  name: 'roster',
  description: "Return the association's owner roster extracted from the document.",
  input_schema: {
    type: 'object',
    properties: {
      owners: {
        type: 'array',
        description: 'One entry per owner/household found anywhere in the document.',
        items: {
          type: 'object',
          properties: {
            full_name: { type: 'string', description: "The owner's full name." },
            unit_number: { type: 'string', description: 'Unit or parcel number / label. Omit if not shown.' },
            opening_balance: { type: 'number', description: 'Current balance for this owner in US dollars — POSITIVE if they OWE money, NEGATIVE if they have a credit/overpayment. Omit if the document shows no balance for them.' },
            email: { type: 'string', description: 'Email if shown.' },
            phone: { type: 'string', description: 'Phone if shown.' },
            address: { type: 'string', description: 'Mailing/property address if shown and different from the unit.' },
          },
          required: ['full_name'],
          additionalProperties: false,
        },
      },
    },
    required: ['owners'],
    additionalProperties: false,
  },
}

const PROMPT =
  'You are migrating a Florida HOA/condo association\'s owner roster into a management ' +
  'platform. The attached document may be a clean export, a printed or scanned ledger, a ' +
  'photo of a spreadsheet, or an arbitrary layout — column order is not fixed. Using the ' +
  'roster tool, extract EVERY owner/household across all rows and pages: full name, unit/' +
  'parcel, and current balance (POSITIVE if they owe, NEGATIVE for a credit), plus email/' +
  'phone/address when shown. Read the entire document. Report only values actually shown — ' +
  'omit any field you are unsure about rather than guessing, and never invent owners or balances.'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // AI is optional infra — until the key is set, fail soft so the client treats
  // it as "AI unavailable" and falls back to CSV.
  if (!ANTHROPIC_API_KEY) return json({ error: 'AI extraction is not configured.', code: 'not_configured' }, 503)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not authenticated.' }, 401)
  try {
    const admin = createClient(SUPABASE_URL, ANON_KEY)
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) return json({ error: 'Not authenticated.' }, 401)
  } catch {
    return json({ error: 'Auth check failed.' }, 401)
  }

  let fileBase64 = ''
  let mediaType = ''
  try {
    const body = await req.json()
    fileBase64 = String(body?.file_base64 || '')
    mediaType = String(body?.media_type || '')
  } catch { return json({ error: 'Bad request body.' }, 400) }
  if (!fileBase64) return json({ error: 'No document provided.' }, 400)

  // PDFs go in a document block; images (png/jpg/webp/gif) in an image block.
  const isPdf = mediaType === 'application/pdf'
  const source = { type: 'base64', media_type: isPdf ? 'application/pdf' : (mediaType || 'image/png'), data: fileBase64 }
  const docBlock = isPdf
    ? { type: 'document', source }
    : { type: 'image', source }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'roster' },
        messages: [{ role: 'user', content: [docBlock, { type: 'text', text: PROMPT }] }],
      }),
    })
    if (!res.ok) {
      const detail = await res.text()
      console.error('anthropic error', res.status, detail)
      return json({ error: 'Extraction failed.', status: res.status }, 502)
    }
    const data = await res.json()
    const toolUse = (data?.content || []).find((b: any) => b.type === 'tool_use' && b.name === 'roster')
    const owners = toolUse?.input?.owners
    if (!Array.isArray(owners)) return json({ error: 'No structured result.' }, 502)
    return json({ ok: true, owners })
  } catch (e) {
    console.error('extract-roster failed', e)
    return json({ error: 'Extraction failed.' }, 500)
  }
})
