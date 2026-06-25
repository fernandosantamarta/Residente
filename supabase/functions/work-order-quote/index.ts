// work-order-quote — the vendor-facing, NO-LOGIN endpoint behind the secure
// quote link. The quote_token is the credential; there is no auth. Backs the
// public /wo-quote/[token] page.
//
//   POST { token, action: 'get' }            -> job context for the page
//   POST { token, action: 'submit', cost, note } -> save the vendor's price
//
// Service-role only (work_orders RLS is never opened to anon). Deploy with JWT
// verification OFF since vendors have no account:
//   supabase functions deploy work-order-quote --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { token, action, cost, note } = await req.json().catch(() => ({}))
    if (!token || typeof token !== 'string') return json({ error: 'token is required' }, 400)
    if (!SERVICE_ROLE) return json({ error: 'Server not configured' }, 500)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: wo, error: woErr } = await admin
      .from('work_orders')
      .select('id, community_id, request_id, vendor_id, title, description, priority, sla_due_at, estimated_cost, quote_status, quoted_cost, quote_note')
      .eq('quote_token', token)
      .single()
    if (woErr || !wo) return json({ error: 'This quote link is invalid or has expired.' }, 404)

    // Vendor + community + location context (shared by get & submit responses).
    const [{ data: vendor }, { data: community }] = await Promise.all([
      wo.vendor_id ? admin.from('vendors').select('name').eq('id', wo.vendor_id).single() : Promise.resolve({ data: null }),
      admin.from('communities').select('name').eq('id', wo.community_id).single(),
    ])
    let location = ''
    if (wo.request_id) {
      const { data: rq } = await admin.from('resident_requests').select('submitter_name, submitter_unit').eq('id', wo.request_id).single()
      location = [rq?.submitter_name, rq?.submitter_unit].filter(Boolean).join(' · ')
    }
    const context = {
      title: wo.title, description: wo.description, priority: wo.priority,
      sla_due_at: wo.sla_due_at, location,
      community: community?.name || 'the community',
      vendor: vendor?.name || '',
      quote_status: wo.quote_status, quoted_cost: wo.quoted_cost, quote_note: wo.quote_note,
    }

    if (action === 'submit') {
      if (wo.quote_status === 'approved') return json({ error: 'This quote has already been approved.' }, 409)
      const amount = Number(cost)
      if (!isFinite(amount) || amount < 0) return json({ error: 'Enter a valid amount.' }, 400)
      const { error: upErr } = await admin.from('work_orders').update({
        quoted_cost: amount,
        quote_note: (typeof note === 'string' && note.trim()) ? note.trim() : null,
        quote_submitted_at: new Date().toISOString(),
        quote_status: 'submitted',
      }).eq('id', wo.id)
      if (upErr) return json({ error: upErr.message }, 500)
      return json({ ok: true, submitted: true })
    }

    // default: 'get'
    return json({ ok: true, context })
  } catch (err) {
    return json({ error: (err as Error).message }, 400)
  }
})
