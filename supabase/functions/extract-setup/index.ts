// extract-setup — Phase 1 of ONBOARDING_SETUP_PLAN.md.
//
// Reads an uploaded governing document (CC&Rs / declaration / bylaws, as a
// base64 PDF) with Claude and returns structured setup fields the board can
// review: late-fee / interest settings, a list of rules, and reserve targets.
// The deterministic roster + budget import (Phase 0) needs no AI and does not
// go through here.
//
// SECURITY: requires a valid Supabase JWT (the authenticated board member) —
// this is NOT an open endpoint, so it can't be hit anonymously to burn API
// credits. Called AFTER signup provisioning (or from /admin), never pre-auth.
//
// Deploy:  supabase functions deploy extract-setup
// Secrets: ANTHROPIC_API_KEY (required — set this in Supabase; the function
//          returns 503 "not configured" until it exists), SUPABASE_URL,
//          SUPABASE_ANON_KEY (auto-injected). Optional: EXTRACT_MODEL
//          (defaults to claude-opus-4-8; set to claude-haiku-4-5 for cheaper
//          extraction).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL = Deno.env.get('EXTRACT_MODEL') ?? 'claude-opus-4-8'

// Forced tool — Claude must return its findings as this exact shape. Fields the
// document doesn't state are simply omitted; the board fills/edits them on review.
const TOOL = {
  name: 'community_setup',
  description: "Return the HOA/condo association's billing settings, rules, and reserve targets found in the document.",
  input_schema: {
    type: 'object',
    properties: {
      late_fee_flat: { type: 'number', description: 'Flat administrative late fee in US dollars. Omit if the document does not state one.' },
      late_fee_pct: { type: 'number', description: 'Administrative late fee as a percent of the installment (e.g. 5 for 5%). Omit if not stated.' },
      interest_apr: { type: 'number', description: 'Late-payment interest rate as percent per year (e.g. 18 for 18%/yr). Omit if not stated.' },
      rules: {
        type: 'array',
        description: 'Individual rules / covenants found in the document.',
        items: {
          type: 'object',
          properties: {
            section: { type: 'string', description: 'Short category, e.g. "Architectural", "Pets", "Parking".' },
            title: { type: 'string', description: 'Short rule title.' },
            body: { type: 'string', description: 'The rule text, paraphrased concisely.' },
            fine: { type: 'number', description: 'Fine amount in dollars if the rule states one. Omit otherwise.' },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      reserves: {
        type: 'array',
        description: 'Reserve fund components and their funding targets if stated.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Reserve component, e.g. "Roof", "Paving".' },
            target: { type: 'number', description: 'Target / fully-funded balance in dollars. Omit if not stated.' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    required: ['rules'],
    additionalProperties: false,
  },
}

const PROMPT =
  'You are setting up a Florida HOA/condo association in a management platform. ' +
  'Read the attached governing document and extract, using the community_setup tool: ' +
  'the administrative late fee (flat and/or percent), the late-payment interest rate, ' +
  'the individual rules/covenants (architectural, pets, parking, leasing, etc.), and any ' +
  'reserve-fund components with their funding targets. Only report values the document ' +
  'actually states — omit any field you are unsure about rather than guessing. Keep rule ' +
  'bodies concise.'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // AI is optional infra — until the key is set, fail soft so callers treat it
  // as "extraction unavailable" and fall back to manual entry.
  if (!ANTHROPIC_API_KEY) return json({ error: 'AI extraction is not configured.', code: 'not_configured' }, 503)

  // Verify the caller is a signed-in user (board member). No community check —
  // we never write to the DB here; we only return extracted fields to the client.
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

  let pdfBase64 = ''
  try {
    const body = await req.json()
    pdfBase64 = String(body?.pdf_base64 || '')
  } catch { return json({ error: 'Bad request body.' }, 400) }
  if (!pdfBase64) return json({ error: 'No document provided.' }, 400)

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
        max_tokens: 4096,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'community_setup' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      const detail = await res.text()
      console.error('anthropic error', res.status, detail)
      return json({ error: 'Extraction failed.', status: res.status }, 502)
    }
    const data = await res.json()
    const toolUse = (data?.content || []).find((b: any) => b.type === 'tool_use' && b.name === 'community_setup')
    if (!toolUse?.input) return json({ error: 'No structured result.' }, 502)
    return json({ ok: true, extracted: toolUse.input })
  } catch (e) {
    console.error('extract-setup failed', e)
    return json({ error: 'Extraction failed.' }, 500)
  }
})
