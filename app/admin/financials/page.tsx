'use client'

// Financial reporting workspace — audit tiers, the annual financial report,
// budget adoption, and reserve funding (FS 718.111(13), 718.112(2)(f) /
// 720.303(6)-(7)). Applies to condo + HOA. Advisory; nothing here blocks.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import { logAudit } from '@/lib/audit'
import { AttorneyNote } from '../AttorneyNote'
import { SignalRow } from '../SignalRow'
import {
  requiredAuditTier, estimateAnnualRevenue, AUDIT_TIER_LABEL, financialSignals,
  type BudgetCategoryRow, type ReserveComponentRow, type FinancialFilingRow, type FilingType,
} from '@/lib/compliance/financials'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')
const thisYear = new Date().getUTCFullYear()

// Plaid Link is loaded on demand (only when an admin clicks "Link bank") so the
// CDN script never costs the rest of the app. Resolves to window.Plaid once ready.
const PLAID_SDK = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
function loadPlaid(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any
    if (w.Plaid) { resolve(w.Plaid); return }
    const existing = document.querySelector(`script[src="${PLAID_SDK}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(w.Plaid))
      existing.addEventListener('error', () => reject(new Error('Could not load Plaid')))
      return
    }
    const s = document.createElement('script')
    s.src = PLAID_SDK; s.async = true
    s.onload = () => resolve(w.Plaid)
    s.onerror = () => reject(new Error('Could not load Plaid'))
    document.head.appendChild(s)
  })
}

const FILING_TYPES: { value: FilingType; label: string }[] = [
  { value: 'annual_financial_report', label: 'Annual financial report' },
  { value: 'budget_adoption', label: 'Budget adoption' },
  { value: 'reserve_study', label: 'Reserve study' },
  { value: 'audit_tier', label: 'Audit / financial statements' },
  { value: 'reserve_waiver', label: 'Reserve waiver' },
]
const FILING_LABEL: Record<string, string> = Object.fromEntries(FILING_TYPES.map(f => [f.value, f.label]))
const STATUSES = ['planned', 'in_progress', 'completed', 'delivered', 'waived'] as const

export default function FinancialsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [budgets, setBudgets] = useState<BudgetCategoryRow[]>([])
  const [reserves, setReserves] = useState<ReserveComponentRow[]>([])
  const [filings, setFilings] = useState<FinancialFilingRow[]>([])
  const [bankTx, setBankTx] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [plaidBusy, setPlaidBusy] = useState(false)
  const [plaidErr, setPlaidErr] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data: c } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
      const { data: b } = (await withTimeout(supabase.from('budget_categories').select('*').eq('community_id', communityId).order('sort_order'))) as any
      const { data: r } = (await withTimeout(supabase.from('ev_reserve_components').select('*').eq('community_id', communityId).order('created_at'))) as any
      const { data: f } = (await withTimeout(supabase.from('ev_financial_filings').select('*').eq('community_id', communityId).order('fiscal_year', { ascending: false }))) as any
      // Bank feed (Plaid) — tolerant: returns null (not a throw) if the table
      // isn't created yet, so this never breaks the page before community-plaid.sql.
      const { data: bt } = (await withTimeout(supabase.from('bank_transactions').select('id, amount, mapped_budget_category_id, posted_date, name, merchant_name, plaid_category').eq('community_id', communityId).order('posted_date', { ascending: false }))) as any
      setCommunity(c || null); setBudgets(b || []); setReserves(r || []); setFilings(f || []); setBankTx(bt || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load financial data'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const revenue = useMemo(() => estimateAnnualRevenue(community, budgets), [community, budgets])
  const required = useMemo(() => requiredAuditTier(revenue, regime as any, Number(community?.parcel_count) || 0), [revenue, regime, community])
  const signals = useMemo(() => financialSignals(community, budgets, reserves, filings), [community, budgets, reserves, filings])

  // ---- Budget vs Actual (actuals come from the Plaid bank feed) ----
  // Plaid sign: positive amount = money OUT of the account, i.e. spending.
  const actuals = useMemo(() => {
    const byCat = new Map<string, number>()
    let unmapped = 0
    for (const t of bankTx) {
      const amt = Number(t.amount) || 0
      if (amt <= 0) continue // ignore deposits/credits here — this view is spend
      if (t.mapped_budget_category_id) byCat.set(t.mapped_budget_category_id, (byCat.get(t.mapped_budget_category_id) || 0) + amt)
      else unmapped += amt
    }
    return { byCat, unmapped }
  }, [bankTx])
  const opBudgets = useMemo(() => budgets.filter(b => !b.is_reserve), [budgets])

  // ---- community financial settings ----
  const [cForm, setCForm] = useState<any>({})
  useEffect(() => {
    if (!community) return
    setCForm({
      annual_revenue: community.annual_revenue ?? '',
      fiscal_year_start_month: community.fiscal_year_start_month ?? 1,
      reserves_established: !!community.reserves_established,
      reserve_study_last_completed: community.reserve_study_last_completed ?? '',
      reserve_study_type: community.reserve_study_type ?? '',
    })
  }, [community])
  const [cSaving, setCSaving] = useState(false)
  const saveCommunity = async () => {
    setCSaving(true); setError('')
    try {
      const patch = {
        annual_revenue: cForm.annual_revenue === '' ? null : Number(cForm.annual_revenue),
        fiscal_year_start_month: Number(cForm.fiscal_year_start_month) || 1,
        reserves_established: !!cForm.reserves_established,
        reserve_study_last_completed: (cForm.reserve_study_last_completed || '').trim() || null,
        reserve_study_type: cForm.reserve_study_type || null,
      }
      const { error } = (await withTimeout(supabase.from('communities').update(patch).eq('id', communityId))) as any
      if (error) throw error
      setMsg('Financial settings saved.'); load()
    } catch (err: any) { setError(err?.message || 'Could not save settings') }
    finally { setCSaving(false) }
  }

  // ---- Stripe Connect ("link, don't hold") ----
  // Links the association's OWN Stripe account so dues/fines are charged onto it;
  // funds never touch Residente. connect-onboard returns a hosted onboarding URL.
  const connectStripe = async () => {
    setConnectBusy(true); setConnectErr('')
    try {
      const { data, error } = await supabase.functions.invoke('connect-onboard', { body: {} })
      if (error) throw error
      if (data?.url) { window.location.href = data.url; return }
      throw new Error(data?.error || 'Could not start Stripe onboarding')
    } catch (err: any) {
      setConnectErr(err?.message || 'Could not start Stripe onboarding'); setConnectBusy(false)
    }
  }

  // ---- Plaid ("link your bank", read-only) ----
  // Mint a link_token, open Plaid Link, then exchange the public_token for an
  // access_token (stored server-side only). Residente reads the feed; never moves money.
  const linkBank = async () => {
    setPlaidBusy(true); setPlaidErr('')
    try {
      const { data, error } = await supabase.functions.invoke('plaid-link-token', { body: {} })
      if (error) throw error
      const linkToken = data?.link_token
      if (!linkToken) throw new Error(data?.error || 'Could not start bank linking')

      const Plaid = await loadPlaid()
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (public_token: string, metadata: any) => {
          try {
            const { error: exErr } = await supabase.functions.invoke('plaid-link-exchange', {
              body: { public_token, institution_name: metadata?.institution?.name ?? null },
            })
            if (exErr) throw exErr
            setMsg('Bank linked. Syncing transactions…')
            await syncBank()
          } catch (err: any) {
            setPlaidErr(err?.message || 'Could not finish bank linking')
          } finally { setPlaidBusy(false) }
        },
        onExit: (err: any) => {
          if (err) setPlaidErr(err?.display_message || err?.error_message || 'Bank linking cancelled')
          setPlaidBusy(false)
        },
      })
      handler.open()
    } catch (err: any) {
      setPlaidErr(err?.message || 'Could not start bank linking'); setPlaidBusy(false)
    }
  }

  // Pull the latest bank activity on demand (admin mode). Read-only.
  const syncBank = async () => {
    setSyncBusy(true); setPlaidErr('')
    try {
      const { error } = await supabase.functions.invoke('plaid-sync-transactions', { body: {} })
      if (error) throw error
      setMsg('Bank feed synced.'); await load()
    } catch (err: any) {
      setPlaidErr(err?.message || 'Could not sync the bank feed')
    } finally { setSyncBusy(false) }
  }

  // ---- reserve component intake ----
  const [rForm, setRForm] = useState<any>({ is_sirs: false })
  const setRF = (k: string, v: any) => setRForm((f: any) => ({ ...f, [k]: v }))
  const addReserve = async (e: any) => {
    e.preventDefault(); setError('')
    try {
      const insert = {
        community_id: communityId,
        name: (rForm.name || '').trim(),
        is_sirs: !!rForm.is_sirs,
        current_balance: rForm.current_balance ? Number(rForm.current_balance) : null,
        fully_funded_balance: rForm.fully_funded_balance ? Number(rForm.fully_funded_balance) : null,
        created_by: profile?.id ?? null,
      }
      if (!insert.name) { setError('Name the reserve component'); return }
      const { error } = (await withTimeout(supabase.from('ev_reserve_components').insert(insert))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'financial.reserve_updated', target_type: 'reserve_component' })
      setRForm({ is_sirs: false }); setMsg('Reserve component added.'); load()
    } catch (err: any) { setError(err?.message || 'Could not add component') }
  }
  const removeReserve = async (id: string) => {
    setReserves(rs => rs.filter(r => r.id !== id))
    try { await withTimeout(supabase.from('ev_reserve_components').delete().eq('id', id)) } catch { load() }
  }

  // ---- filing intake ----
  const [fForm, setFForm] = useState<any>({ filing_type: 'annual_financial_report', fiscal_year: thisYear - 1, status: 'planned' })
  const setFF = (k: string, v: any) => setFForm((f: any) => ({ ...f, [k]: v }))
  const addFiling = async (e: any) => {
    e.preventDefault(); setError('')
    try {
      const insert = {
        community_id: communityId,
        fiscal_year: Number(fForm.fiscal_year) || thisYear - 1,
        filing_type: fForm.filing_type,
        status: fForm.status || 'planned',
        audit_tier: fForm.audit_tier || null,
        completed_at: (fForm.completed_at || '').trim() || null,
        delivered_at: (fForm.delivered_at || '').trim() || null,
        created_by: profile?.id ?? null,
      }
      const { data: ins, error } = (await withTimeout(supabase.from('ev_financial_filings').insert(insert).select('id').single())) as any
      if (error) throw error
      if (ins?.id && communityId) logAudit({ community_id: communityId, event_type: 'financial.filing_recorded', target_type: 'financial_filing', target_id: ins.id, metadata: { filing_type: insert.filing_type, fiscal_year: insert.fiscal_year } })
      setFForm({ filing_type: 'annual_financial_report', fiscal_year: thisYear - 1, status: 'planned' })
      setMsg('Filing recorded.'); load()
    } catch (err: any) { setError(err?.message || 'Could not record filing') }
  }
  const updateFiling = async (id: string, patch: Record<string, any>) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_financial_filings').update(patch).eq('id', id))) as any
      if (error) throw error
      load()
    } catch (err: any) { setError(err?.message || 'Could not update filing') }
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Financial reporting <span className="amp">&</span> reserves</h1>
      <p className="admin-dek">
        Track the audit tier your revenue requires, the annual financial report and budget-adoption
        clocks, and reserve funding (FS 718.111(13) / 720.303(6)-(7)). Advisory — you decide each step.
      </p>

      <AttorneyNote />
      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* Payments — Connect ("link, don't hold") */}
          <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 16, background: '#fff', margin: '8px 0 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 className="bc-title" style={{ margin: 0 }}>Collect payments</h2>
                <p style={{ fontSize: 13, opacity: 0.75, margin: '4px 0 0', maxWidth: 540 }}>
                  Link your association&rsquo;s own Stripe account. Dues and fines are paid directly into it —
                  Residente never holds or moves your money.
                </p>
              </div>
              {community?.stripe_connect_status === 'active' ? (
                <span className="admin-success" style={{ margin: 0 }}><span className="admin-success-check" aria-hidden>✓</span>Connected</span>
              ) : (
                <button className="admin-primary-btn" disabled={connectBusy} onClick={connectStripe}>
                  {connectBusy ? 'Opening Stripe…' : community?.stripe_connect_status === 'pending' ? 'Finish Stripe setup' : 'Connect Stripe account'}
                </button>
              )}
            </div>
            {community?.stripe_connect_status === 'pending' && (
              <div className="admin-note admin-note-warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                Stripe onboarding started but isn&rsquo;t finished — click &ldquo;Finish Stripe setup&rdquo; to complete it.
              </div>
            )}
            {connectErr && <div className="admin-note admin-note-err" style={{ marginTop: 10 }}>{connectErr}</div>}
          </div>

          {/* Budget vs Actual — actuals auto-tracked from the Plaid bank feed */}
          <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 16, background: '#fff', margin: '0 0 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h2 className="bc-title" style={{ margin: 0 }}>Budget vs actual</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, opacity: 0.65 }}>
                  {bankTx.length > 0 ? `${bankTx.length} bank transactions synced` : 'no bank feed yet'}
                </span>
                {community?.plaid_status === 'active' ? (
                  <>
                    <span className="admin-success" style={{ margin: 0, fontSize: 12 }}><span className="admin-success-check" aria-hidden>✓</span>Bank linked</span>
                    <button className="admin-btn-ghost" disabled={syncBusy} onClick={syncBank}>
                      {syncBusy ? 'Syncing…' : 'Sync now'}
                    </button>
                  </>
                ) : (
                  <button className="admin-primary-btn" disabled={plaidBusy} onClick={linkBank}>
                    {plaidBusy ? 'Opening…' : 'Link bank account'}
                  </button>
                )}
              </div>
            </div>
            {plaidErr && <div className="admin-note admin-note-err" style={{ marginTop: 10 }}>{plaidErr}</div>}

            {community?.plaid_status !== 'active' && bankTx.length === 0 && (
              <p style={{ fontSize: 13, opacity: 0.75, margin: '8px 0 0' }}>
                Link your association&rsquo;s bank to track actual spending automatically against each budget line —
                no spreadsheets. Residente reads the feed only; it never moves money.
              </p>
            )}

            {opBudgets.length === 0 ? (
              <p style={{ fontSize: 13, opacity: 0.7, margin: '8px 0 0' }}>Add budget categories below to see budget-vs-actual.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {opBudgets.map(b => {
                  const budgeted = Number(b.budget) || 0
                  const actual = actuals.byCat.get(b.id) || 0
                  const pct = budgeted > 0 ? Math.round(actual / budgeted * 100) : null
                  const over = budgeted > 0 && actual > budgeted
                  const barColor = over ? '#B42318' : pct != null && pct >= 85 ? '#B54708' : '#067647'
                  return (
                    <div key={b.id} style={{ border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
                        <span style={{ fontWeight: 600 }}>{b.name || 'Untitled'}</span>
                        <span style={{ opacity: 0.8 }}>
                          {fmt$(actual)} <span style={{ opacity: 0.5 }}>/ {fmt$(budgeted)}</span>
                          {pct != null && <span style={{ color: barColor, fontWeight: 600 }}> · {pct}%</span>}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 4, background: 'rgba(0,0,0,0.06)', marginTop: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, pct ?? 0)}%`, background: barColor }} />
                      </div>
                      {over && <div style={{ fontSize: 11.5, color: '#B42318', marginTop: 4 }}>Over budget by {fmt$(actual - budgeted)}</div>}
                    </div>
                  )
                })}
              </div>
            )}

            {actuals.unmapped > 0 && (
              <div className="admin-note admin-note-warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                {fmt$(actuals.unmapped)} of synced spending isn&rsquo;t mapped to a budget line yet — map those categories so it counts.
              </div>
            )}
          </div>

          {/* Required tier banner */}
          <div className="admin-note admin-note-info" style={{ marginTop: 8 }}>
            <strong>Required financial statements:</strong> at ~{fmt$(revenue)} annual revenue
            {regime === 'hoa' ? ` (HOA, ${Number(community?.parcel_count) || 0} parcels)` : ' (condo)'}, the law requires <strong>{AUDIT_TIER_LABEL[required]}</strong>.
            <span style={{ opacity: 0.7 }}> Revenue is your entered figure, else the sum of non-reserve budget lines.</span>
          </div>

          {/* Documents — live statements first, then draft aids. Each artifact is
              its own wsrow (glyph + label + arrow), matching the workspace cards. */}
          <div className="card">
            <div className="card-head"><div><h2>Documents</h2><div className="sub">Generate or view each statutory artifact</div></div></div>
            <div className="wslist">
              {[
                { type: 'statement', label: 'Statement of cash receipts & expenditures', live: true },
                { type: 'budget_actual', label: 'Budget vs actual', live: true },
                { type: 'afr', label: 'Annual financial report + affidavit', live: false },
                { type: 'budget', label: 'Proposed-budget package', live: false },
                { type: 'reserve_worksheet', label: 'Reserve-funding worksheet', live: false },
              ].map(d => {
                const col = d.live ? '#0E7490' : '#7A5AF8'
                return (
                  <Link key={d.type} href={`/admin/financials/document?type=${d.type}`} className="wsrow">
                    <span className="wsrow-glyph" style={{ color: col, background: col + '18' }}>
                      {d.live ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                      )}
                    </span>
                    <div className="wsrow-main">
                      <div className="wsrow-title">{d.label}</div>
                      <div className="wsrow-desc">{d.live ? 'Live statement' : 'Draft template'}</div>
                    </div>
                    <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Open signals for this domain */}
          {signals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {signals.map(s => <SignalRow key={s.id} signal={s} />)}
            </div>
          )}

          {/* Financial settings */}
          <div className="card">
            <div className="card-head"><div><h2>Financial settings</h2></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 10 }}>
              <label className="admin-field"><span className="admin-field-label">Annual revenue ($)</span>
                <input className="admin-input" type="number" min="0" step="1000" value={cForm.annual_revenue ?? ''} placeholder="auto from budget" onChange={e => setCForm((f: any) => ({ ...f, annual_revenue: e.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">Fiscal year start month (1–12)</span>
                <input className="admin-input" type="number" min="1" max="12" step="1" value={cForm.fiscal_year_start_month ?? 1} onChange={e => setCForm((f: any) => ({ ...f, fiscal_year_start_month: e.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">Last reserve study</span>
                <input className="admin-input" type="date" value={cForm.reserve_study_last_completed ?? ''} onChange={e => setCForm((f: any) => ({ ...f, reserve_study_last_completed: e.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">Reserve study type</span>
                <select className="admin-input" value={cForm.reserve_study_type ?? ''} onChange={e => setCForm((f: any) => ({ ...f, reserve_study_type: e.target.value }))}>
                  <option value="">—</option><option value="sirs">SIRS</option><option value="general">General</option>
                </select></label>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '4px 0 10px' }}>
              <input type="checkbox" checked={!!cForm.reserves_established} onChange={e => setCForm((f: any) => ({ ...f, reserves_established: e.target.checked }))} />
              Reserves established
            </label>
            <div className="card-cta">
              <button className="admin-primary-btn" disabled={cSaving} onClick={saveCommunity}>{cSaving ? 'Saving…' : 'Save settings'}</button>
            </div>
          </div>

          {/* Reserve components */}
          <div className="card">
            <div className="card-head"><div><h2>Reserve components <span style={{ opacity: 0.55, fontWeight: 400 }}>({reserves.length})</span></h2></div></div>
            <form className="admin-form" onSubmit={addReserve}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">Component</span>
                  <input className="admin-input" value={rForm.name ?? ''} placeholder="Roof" onChange={e => setRF('name', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">Current balance ($)</span>
                  <input className="admin-input" type="number" min="0" step="100" value={rForm.current_balance ?? ''} onChange={e => setRF('current_balance', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">Fully-funded ($)</span>
                  <input className="admin-input" type="number" min="0" step="100" value={rForm.fully_funded_balance ?? ''} onChange={e => setRF('fully_funded_balance', e.target.value)} /></label>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '8px 0' }}>
                <input type="checkbox" checked={!!rForm.is_sirs} onChange={e => setRF('is_sirs', e.target.checked)} />
                SIRS structural component (reserves may not be waived for budgets adopted on/after 2024-12-31)
              </label>
              <div className="card-cta"><button type="submit" className="admin-primary-btn">Add component</button></div>
            </form>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {reserves.map(r => {
              const ff = Number(r.fully_funded_balance) || 0
              const pct = ff > 0 ? Math.round((Number(r.current_balance) || 0) / ff * 100) : null
              return (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}{r.is_sirs ? ' · SIRS' : ''}</div>
                    <div style={{ fontSize: 12.5, opacity: 0.75 }}>
                      {fmt$(r.current_balance)} / {fmt$(r.fully_funded_balance)}
                      {pct != null && <span style={{ color: pct < 50 ? '#B42318' : pct < 100 ? '#B54708' : '#067647', fontWeight: 600 }}> · {pct}% funded</span>}
                    </div>
                  </div>
                  <button type="button" className="bc-del" onClick={() => removeReserve(r.id)} aria-label="Remove">&times;</button>
                </div>
              )
            })}
            </div>
          </div>

          {/* Filings */}
          <div className="card">
            <div className="card-head"><div><h2>Compliance filings</h2></div></div>
            <form className="admin-form" onSubmit={addFiling}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">Type</span>
                  <select className="admin-input" value={fForm.filing_type} onChange={e => setFF('filing_type', e.target.value)}>
                    {FILING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">Fiscal year</span>
                  <input className="admin-input" type="number" step="1" value={fForm.fiscal_year ?? ''} onChange={e => setFF('fiscal_year', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">Status</span>
                  <select className="admin-input" value={fForm.status} onChange={e => setFF('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">Statement level</span>
                  <select className="admin-input" value={fForm.audit_tier ?? ''} onChange={e => setFF('audit_tier', e.target.value)}>
                    <option value="">—</option><option value="cash">cash</option><option value="compiled">compiled</option><option value="reviewed">reviewed</option><option value="audited">audited</option>
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">Completed</span>
                  <input className="admin-input" type="date" value={fForm.completed_at ?? ''} onChange={e => setFF('completed_at', e.target.value)} /></label>
              </div>
              <div className="card-cta"><button type="submit" className="admin-primary-btn">Record filing</button></div>
            </form>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {filings.length === 0 && <div className="admin-note">No filings recorded yet.</div>}
            {filings.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>FY{f.fiscal_year} · {FILING_LABEL[String(f.filing_type)] || f.filing_type}{f.audit_tier ? ` · ${f.audit_tier}` : ''}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.75 }}>{f.completed_at ? `completed ${f.completed_at}` : ''}{f.delivered_at ? ` · delivered ${f.delivered_at}` : ''}</div>
                </div>
                <select className="admin-input" style={{ maxWidth: 160 }} value={String(f.status)} onChange={e => updateFiling(f.id, { status: e.target.value })}>
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
