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

// ---- categorize: file a governing document under one official-records category ----
// The category list is sent by the client (single source of truth = DOC_CATEGORIES
// in lib/compliance/official-records.ts); this hardcoded set is only a fallback.
const DEFAULT_DOC_CATEGORIES = [
  'Governing Documents', 'Financial Documents', 'Rules & Policies', 'Reports & Meeting Minutes',
  'Notices & Announcements', 'Insurance', 'Vendor & Contracts', 'Director Records',
  'Election & Voting Records', 'Inspection Reports', 'Bank Records & Ledgers', 'Building Permits',
  'Forms & Applications', 'Maps & Layouts', 'Other',
]
function categorizeTool(categories: string[]) {
  return {
    name: 'categorize_document',
    description: "Classify the document into exactly one of the association's official-records categories.",
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: categories, description: 'The single best-fit category for this document.' },
      },
      required: ['category'],
      additionalProperties: false,
    },
  }
}
const CATEGORIZE_PROMPT =
  'You are filing a document into a Florida HOA/condo association\'s official records. Read the ' +
  'attached document (PDF, scan, or photo) and, using the categorize_document tool, classify it ' +
  'into the SINGLE best-fit category from the provided list. Base it on what the document actually ' +
  'is — a declaration/bylaws/amendment is "Governing Documents"; a budget/statement/audit/reserve ' +
  'study is "Financial Documents"; board or member meeting minutes are "Reports & Meeting Minutes"; ' +
  'a meeting notice/agenda is "Notices & Announcements"; an insurance policy/certificate is ' +
  '"Insurance"; a service contract or bid is "Vendor & Contracts"; a bank statement or ledger is ' +
  '"Bank Records & Ledgers"; a building permit is "Building Permits"; a structural/milestone/SIRS ' +
  'report is "Inspection Reports". If nothing fits, choose "Other".'

// ---- minutes: motions, votes, and action items from meeting minutes ----
const MINUTES_TOOL = {
  name: 'meeting_minutes',
  description: 'Return the motions, votes, and action items found in the meeting minutes.',
  input_schema: {
    type: 'object',
    properties: {
      motions: {
        type: 'array',
        description: 'Each formal motion made during the meeting.',
        items: {
          type: 'object',
          properties: {
            motion: { type: 'string', description: 'The text of the motion.' },
            moved_by: { type: 'string', description: 'Who made the motion. Omit if not stated.' },
            seconded_by: { type: 'string', description: 'Who seconded it. Omit if not stated.' },
            votes_for: { type: 'number', description: 'Count voting in favor. Omit if not stated.' },
            votes_against: { type: 'number', description: 'Count voting against. Omit if not stated.' },
            votes_abstain: { type: 'number', description: 'Count abstaining. Omit if not stated.' },
            outcome: { type: 'string', enum: ['passed', 'failed', 'tabled', 'withdrawn'], description: 'The result. Omit if unclear.' },
          },
          required: ['motion'],
          additionalProperties: false,
        },
      },
      action_items: {
        type: 'array',
        description: 'Each follow-up task / action item assigned during the meeting.',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'The task / action item.' },
            owner: { type: 'string', description: 'Who is responsible. Omit if not stated.' },
            due: { type: 'string', description: 'Due date as YYYY-MM-DD if stated. Omit otherwise.' },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    },
    required: ['motions'],
    additionalProperties: false,
  },
}
const MINUTES_PROMPT =
  'You are reading the minutes of a Florida HOA/condo association meeting (PDF, scan, or photo). ' +
  'Using the meeting_minutes tool, extract: every formal MOTION (its text, who moved/seconded it, ' +
  'the vote tally for/against/abstain, and the outcome), and every ACTION ITEM / follow-up task ' +
  '(what, who owns it, any due date). Report only what the minutes actually state — omit any field ' +
  'you are unsure about rather than guessing, and never invent motions or tallies.'

// ---- violation: read a violation photo, match a rule, draft the notice ----
const VIOLATION_TOOL = {
  name: 'violation_extract',
  description: 'Describe the violation in the photo, match it to a community rule, and draft the notice text.',
  input_schema: {
    type: 'object',
    properties: {
      observed_text: { type: 'string', description: 'A factual description of what the photo shows (the apparent violation).' },
      suggested_rule_id: { type: 'string', description: 'The id of the single best-matching rule from the provided rule list. Omit if none clearly matches.' },
      suggested_rule_title: { type: 'string', description: 'The title of that matched rule (or a short label if no rule matched).' },
      draft_description: { type: 'string', description: 'A concise, neutral, professional draft violation notice: what was observed and which rule it appears to breach.' },
      suggested_fine: { type: 'number', description: "The matched rule's fine amount in US dollars, if the rule states one. Omit otherwise." },
    },
    required: ['observed_text', 'draft_description'],
    additionalProperties: false,
  },
}
function violationPrompt(rules: any[]): string {
  const list = (rules || [])
    .filter(r => r && (r.title || r.id))
    .map(r => `- id=${r.id || ''} | ${[r.section, r.title].filter(Boolean).join(' — ')}${typeof r.fine === 'number' ? ` (fine $${r.fine})` : ''}`)
    .join('\n')
  return (
    'You are helping a Florida HOA/condo board document a rule violation from a photo. Look at the ' +
    'attached image and, using the violation_extract tool: (1) describe factually what the photo ' +
    'shows; (2) match it to the SINGLE best-fitting rule from the community rule book below by its ' +
    'id; (3) draft a concise, neutral, professional violation-notice description referencing that ' +
    'rule; (4) report the rule\'s fine amount if it has one. Only match a rule if the photo plausibly ' +
    'shows a breach of it — if nothing fits, omit the rule fields and still describe what you see. ' +
    'Do not invent facts about who is responsible.\n\nCommunity rule book:\n' +
    (list || '(no rules provided)')
  )
}

// Resolve the tool + prompt for a request. Most kinds are static; `categorize`
// builds its enum from the client-sent category list and `violation` injects the
// community rule book into its prompt.
function specFor(kind: string, body: any): { tool: any; prompt: string } | null {
  switch (kind) {
    case 'budget': return { tool: BUDGET_TOOL, prompt: BUDGET_PROMPT }
    case 'insurance': return { tool: INSURANCE_TOOL, prompt: INSURANCE_PROMPT }
    case 'minutes': return { tool: MINUTES_TOOL, prompt: MINUTES_PROMPT }
    case 'categorize': {
      const cats = Array.isArray(body?.categories) && body.categories.length ? body.categories.map(String) : DEFAULT_DOC_CATEGORIES
      return { tool: categorizeTool(cats), prompt: CATEGORIZE_PROMPT }
    }
    case 'violation': return { tool: VIOLATION_TOOL, prompt: violationPrompt(body?.context_rules) }
    default: return null
  }
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

  let body: any = null
  try { body = await req.json() } catch { return json({ error: 'Bad request body.' }, 400) }
  const fileBase64 = String(body?.file_base64 || '')
  const mediaType = String(body?.media_type || '')
  const kind = String(body?.kind || '')
  const subhint = String(body?.subhint || '')
  if (!fileBase64) return json({ error: 'No document provided.' }, 400)
  const spec = specFor(kind, body)
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
