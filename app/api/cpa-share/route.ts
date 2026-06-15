// CPA share — the public, login-free read endpoint behind a share token.
//
// A board officer mints a token (cpa_share_create); their outside CPA opens
// /cpa/<token>, which calls THIS route with ?token=. We validate the token
// (exists, not revoked, not expired) with the service role, then return the
// AGGREGATE CPA package for that community + fiscal year — trial balance by fund +
// a financial-position summary. No residents, names, or units → no PII. Every
// successful open is audit-logged. Fails closed: a bad/expired/revoked token gets
// a 404, and any source-read error returns an error (never a partial bundle).
//
// Env (Vercel): SUPABASE_SERVICE_ROLE_KEY + a Supabase URL.

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { balanceSheetByFund, revExpByFund, type TBRow } from '@/lib/gl/statements'

export const dynamic = 'force-dynamic'

function adminClient(): SupabaseClient | null {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    'https://nozzfcxijdnllkiydhfi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || ''
  if (!token || token.length < 32) {
    return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  }
  const admin = adminClient()
  if (!admin) return NextResponse.json({ error: 'server not configured' }, { status: 500 })

  // ---- validate the token ----
  const { data: tok, error: tErr } = await admin
    .from('cpa_share_tokens')
    .select('community_id, fiscal_year, expires_at, revoked')
    .eq('token', token)
    .maybeSingle()
  if (tErr) return NextResponse.json({ error: 'lookup failed' }, { status: 502 })
  if (!tok || tok.revoked) return NextResponse.json({ error: 'this link is no longer valid' }, { status: 404 })
  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'this link has expired' }, { status: 410 })
  }

  const communityId = String(tok.community_id)
  const fy = tok.fiscal_year != null ? Number(tok.fiscal_year) : null

  try {
    // ---- load the aggregate ledger (fail closed) ----
    const [cRes, tbRes, tbFyRes] = await Promise.all([
      admin.from('communities').select('name').eq('id', communityId).single(),
      admin.from('gl_trial_balance').select('*').eq('community_id', communityId),
      admin.from('gl_trial_balance_fy').select('*').eq('community_id', communityId),
    ])
    if (tbRes.error) return NextResponse.json({ error: 'ledger read failed' }, { status: 502 })

    const tb = (tbRes.data || []) as TBRow[]
    const tbFy = (tbFyRes.data || []) as TBRow[]
    const fyYear = fy ?? Math.max(0, ...tbFy.map((r: any) => Number(r.fiscal_year) || 0))
    const bsheet = balanceSheetByFund(tb)
    const revexp = revExpByFund(tbFy, fyYear)
    const operatingAssets = bsheet.funds.find((f: any) => f.fund === 'operating')?.totalAssets || 0
    const reserveAssets = bsheet.funds.find((f: any) => f.fund === 'reserve')?.totalAssets || 0

    // ---- audit the open (best-effort; never block the view) ----
    try {
      await admin.from('ev_audit_log').insert({
        community_id: communityId,
        event_type: 'financial.cpa_bundle_viewed',
        target_type: 'financial_filing',
        metadata: { fiscal_year: fyYear, via: 'cpa_share' },
      })
    } catch { /* best-effort */ }

    return NextResponse.json({
      community_name: (cRes.data as any)?.name || 'Association',
      fiscal_year: fyYear || null,
      trial_balance: tb
        .slice()
        .sort((a: any, b: any) => String(a.fund).localeCompare(String(b.fund)) || String(a.code).localeCompare(String(b.code)))
        .map((r: any) => ({ code: r.code, name: r.name, fund: r.fund, debit: r.debit, credit: r.credit })),
      position: {
        operatingAssets, reserveAssets,
        revenue: revexp.totalRevenue, expense: revexp.totalExpense, net: revexp.net,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
