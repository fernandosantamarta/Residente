'use client'

// Financial reporting workspace — audit tiers, the annual financial report,
// budget adoption, and reserve funding (FS 718.111(13), 718.112(2)(f) /
// 720.303(6)-(7)). Applies to condo + HOA. Advisory; nothing here blocks.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import { logAudit } from '@/lib/audit'
import {
  requiredAuditTier, estimateAnnualRevenue, AUDIT_TIER_LABEL, financialSignals,
  type BudgetCategoryRow, type ReserveComponentRow, type FinancialFilingRow, type FilingType,
} from '@/lib/compliance/financials'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')
const thisYear = new Date().getUTCFullYear()

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
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data: c } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
      const { data: b } = (await withTimeout(supabase.from('budget_categories').select('*').eq('community_id', communityId).order('sort_order'))) as any
      const { data: r } = (await withTimeout(supabase.from('ev_reserve_components').select('*').eq('community_id', communityId).order('created_at'))) as any
      const { data: f } = (await withTimeout(supabase.from('ev_financial_filings').select('*').eq('community_id', communityId).order('fiscal_year', { ascending: false }))) as any
      setCommunity(c || null); setBudgets(b || []); setReserves(r || []); setFilings(f || [])
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
    <div className="admin-page">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Financial reporting <span className="amp">&</span> reserves</h1>
      <p className="admin-dek">
        Track the audit tier your revenue requires, the annual financial report and budget-adoption
        clocks, and reserve funding (FS 718.111(13) / 720.303(6)-(7)). Advisory — you decide each step.
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>{ATTORNEY_REVIEW_BANNER}</div>
      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* Required tier banner */}
          <div className="admin-note admin-note-info" style={{ marginTop: 8 }}>
            <strong>Required financial statements:</strong> at ~{fmt$(revenue)} annual revenue
            {regime === 'hoa' ? ` (HOA, ${Number(community?.parcel_count) || 0} parcels)` : ' (condo)'}, the law requires <strong>{AUDIT_TIER_LABEL[required]}</strong>.
            <span style={{ opacity: 0.7 }}> Revenue is your entered figure, else the sum of non-reserve budget lines.</span>
          </div>

          {/* Document artifacts */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
            {[
              { type: 'afr', label: 'Annual financial report + affidavit' },
              { type: 'budget', label: 'Proposed-budget package' },
              { type: 'reserve_worksheet', label: 'Reserve-funding worksheet' },
            ].map(d => (
              <Link key={d.type} href={`/admin/financials/document?type=${d.type}`} className="admin-btn-ghost" style={{ textDecoration: 'none' }}>📄 {d.label}</Link>
            ))}
          </div>

          {/* Open signals for this domain */}
          {signals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {signals.map(s => (
                <div key={s.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${s.severity === 'overdue' ? '#B42318' : s.severity === 'soon' ? '#B54708' : '#175CD3'}`, borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.title}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.75 }}>{s.detail}</div>
                </div>
              ))}
            </div>
          )}

          {/* Financial settings */}
          <h2 className="bc-title" style={{ margin: '8px 0 8px' }}>Financial settings</h2>
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
          <button className="admin-primary-btn" disabled={cSaving} onClick={saveCommunity}>{cSaving ? 'Saving…' : 'Save settings'}</button>

          {/* Reserve components */}
          <h2 className="bc-title" style={{ margin: '24px 0 8px' }}>Reserve components ({reserves.length})</h2>
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
            <button type="submit" className="admin-primary-btn">Add component</button>
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

          {/* Filings */}
          <h2 className="bc-title" style={{ margin: '24px 0 8px' }}>Compliance filings</h2>
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
            <button type="submit" className="admin-primary-btn" style={{ marginTop: 8 }}>Record filing</button>
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
        </>
      )}
    </div>
  )
}
