// extract-doc — the universal AI document reader (budget + insurance kinds).
//
// One auth-gated endpoint that reads an uploaded PDF *or image* (printed,
// scanned, or photographed — any layout, via Claude vision) and returns the
// structured fields for a given `kind`. The board reviews/edits the result
// before anything is written (the confirm step lives on the client). Siblings:
//   - extract-roster  → owner roster / account ledger
//   - extract-setup   → governing-doc rules + billing settings (PDF only)
// This function adds:
//   - kind 'budget'    → operating-budget categories {name, budget, spent}
//   - kind 'insurance' → one policy's fields (carrier, dates, amounts)
//
// SECURITY: requires a valid Supabase JWT (the authenticated board member) — NOT
// an open endpoint, so it can't be hit anonymously to burn API credits. We never
// write to the DB here; we only return extracted fields to the client to review.
//
// Deploy:  supabase functions deploy extract-doc
// Secrets: ANTHROPIC_API_KEY (required — returns 503 "not configured" until set),
//          SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected). Optional:
//          EXTRACT_DOC_MODEL (defaults to claude-haiku-4-5 — cheap and plenty for
//          structured extraction; set to claude-opus-4-8 for max accuracy).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { communityOf, checkCap, recordUsage } from '../_shared/ai-metering.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL = Deno.env.get('EXTRACT_DOC_MODEL') ?? 'claude-haiku-4-5'

// Forced tool — Claude must return the operating budget as this exact shape.
const BUDGET_TOOL = {
  name: 'budget',
  description: "Return the association's operating-budget line items found in the document.",
  input_schema: {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        description: 'One entry per operating-budget line item / category found anywhere in the document.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Category / line-item name, e.g. "Landscaping", "Insurance", "Management".' },
            budget: { type: 'number', description: 'Annual budgeted amount for this line in US dollars. Omit if not shown.' },
            spent: { type: 'number', description: 'Actual / year-to-date spent for this line in US dollars, if the document shows a separate actuals column. Omit otherwise.' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    required: ['categories'],
    additionalProperties: false,
  },
}

// Forced tool — Claude must return one insurance policy as this exact shape.
const INSURANCE_TOOL = {
  name: 'insurance_policy',
  description: "Return the insurance policy / fidelity bond details found in the declaration or certificate.",
  input_schema: {
    type: 'object',
    properties: {
      insurance_kind: { type: 'string', enum: ['property', 'fidelity_bond'], description: 'property = building/property/hazard coverage; fidelity_bond = fidelity bond / crime / employee-dishonesty coverage. Choose the one this document is for.' },
      carrier: { type: 'string', description: 'Insurance carrier / company name. Omit if not shown.' },
      policy_number: { type: 'string', description: 'Policy or bond number. Omit if not shown.' },
      amount: { type: 'number', description: 'Coverage limit / bond amount in US dollars. Omit if not shown.' },
      effective_date: { type: 'string', description: 'Policy effective date as YYYY-MM-DD. Omit if not shown.' },
      expiration_date: { type: 'string', description: 'Policy expiration date as YYYY-MM-DD. Omit if not shown.' },
      replacement_cost_value: { type: 'number', description: 'Property replacement cost value (RCV) in US dollars, if stated (property policies). Omit otherwise.' },
      last_appraisal_date: { type: 'string', description: 'Date of the most recent insurance/replacement-cost appraisal as YYYY-MM-DD, if stated. Omit otherwise.' },
    },
    required: ['insurance_kind'],
    additionalProperties: false,
  },
}

const BUDGET_PROMPT =
  'You are migrating a Florida HOA/condo association\'s operating budget into a management ' +
  'platform. The attached document may be a clean export, a printed/scanned budget, or a photo ' +
  'of a spreadsheet — column order is not fixed. Using the budget tool, extract EVERY operating ' +
  'line item across all rows and pages: the category name, its annual budgeted amount, and the ' +
  'actual/year-to-date spent if a separate column shows it. Skip pure total/subtotal rows. Report ' +
  'only values actually shown — omit any field you are unsure about rather than guessing, and ' +
  'never invent categories or amounts.'

const INSURANCE_PROMPT =
  'You are recording a Florida HOA/condo association\'s insurance into a management platform. The ' +
  'attached document is an insurance declaration page, certificate, or fidelity-bond binder (PDF, ' +
  'scan, or photo). Using the insurance_policy tool, extract: whether it is property coverage or a ' +
  'fidelity bond, the carrier, policy/bond number, coverage limit / bond amount, effective and ' +
  'expiration dates (as YYYY-MM-DD), and for property policies the replacement cost value and most ' +
  'recent appraisal date if shown. Report only values the document actually states — omit any field ' +
  'you are unsure about rather than guessing.'

const KINDS: Record<string, { tool: any; prompt: string }> = {
  budget: { tool: BUDGET_TOOL, prompt: BUDGET_PROMPT },
  insurance: { tool: INSURANCE_TOOL, prompt: INSURANCE_PROMPT },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // AI is optional infra — until the key is set, fail soft so the client treats
  // it as "AI unavailable" and falls back to manual / CSV entry.
  if (!ANTHROPIC_API_KEY) return json({ error: 'AI extraction is not configured.', code: 'not_configured' }, 503)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not authenticated.' }, 401)
  let userId = ''
  try {
    const admin = createClient(SUPABASE_URL, ANON_KEY)
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) return json({ error: 'Not authenticated.' }, 401)
    userId = user.id
  } catch {
    return json({ error: 'Auth check failed.' }, 401)
  }

  // Per-community monthly AI cap — refuse once a community is over its limit
  // (fails open if metering infra isn't set up yet).
  const communityId = await communityOf(userId)
  const cap = await checkCap(communityId)
  if (!cap.allowed) return json({ error: 'Monthly AI limit reached.', code: 'limit_reached', cap_cents: cap.capCents, spent_cents: cap.spentCents }, 429)

  let fileBase64 = ''
  let mediaType = ''
  let kind = ''
  let subhint = ''
  try {
    const body = await req.json()
    fileBase64 = String(body?.file_base64 || '')
    mediaType = String(body?.media_type || '')
    kind = String(body?.kind || '')
    subhint = String(body?.subhint || '')
  } catch { return json({ error: 'Bad request body.' }, 400) }
  if (!fileBase64) return json({ error: 'No document provided.' }, 400)
  const spec = KINDS[kind]
  if (!spec) return json({ error: 'Unknown document kind.' }, 400)

  // PDFs go in a document block; images (png/jpg/webp/gif) in an image block.
  const isPdf = mediaType === 'application/pdf'
  const source = { type: 'base64', media_type: isPdf ? 'application/pdf' : (mediaType || 'image/png'), data: fileBase64 }
  const docBlock = isPdf ? { type: 'document', source } : { type: 'image', source }
  // A caller-supplied hint (e.g. the insurance section the upload sits under)
  // focuses the read without changing the output shape.
  const promptText = subhint ? `${spec.prompt} This document is specifically a ${subhint}.` : spec.prompt

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
        tools: [spec.tool],
        tool_choice: { type: 'tool', name: spec.tool.name },
        messages: [{ role: 'user', content: [docBlock, { type: 'text', text: promptText }] }],
      }),
    })
    if (!res.ok) {
      const detail = await res.text()
      console.error('anthropic error', res.status, detail)
      return json({ error: 'Extraction failed.', status: res.status }, 502)
    }
    const data = await res.json()
    const toolUse = (data?.content || []).find((b: any) => b.type === 'tool_use' && b.name === spec.tool.name)
    if (!toolUse?.input) return json({ error: 'No structured result.' }, 502)
    await recordUsage({ communityId, userId, fn: 'extract-doc', kind, model: MODEL, usage: data?.usage })
    return json({ ok: true, kind, data: toolUse.input })
  } catch (e) {
    console.error('extract-doc failed', e)
    return json({ error: 'Extraction failed.' }, 500)
  }
})
