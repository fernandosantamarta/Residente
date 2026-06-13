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
import { ComplianceBackLink } from '../ComplianceBackLink'
import { Dropdown } from '@/components/Dropdown'
import {
  requiredAuditTier, estimateAnnualRevenue, AUDIT_TIER_LABEL, financialSignals,
  type BudgetCategoryRow, type ReserveComponentRow, type FinancialFilingRow, type FilingType,
} from '@/lib/compliance/financials'
import { fetchGlCurrentFyRevenue } from '@/lib/gl/liveRevenue'
import { useT } from '@/lib/i18n'

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
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [budgets, setBudgets] = useState<BudgetCategoryRow[]>([])
  const [reserves, setReserves] = useState<ReserveComponentRow[]>([])
  const [filings, setFilings] = useState<FinancialFilingRow[]>([])
  const [glRevenue, setGlRevenue] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectErr, setConnectErr] = useState('')

  useEffect(() => { if (!msg) return; const timer = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(timer) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Fire every read in ONE parallel batch instead of awaiting four round-trips
      // in series — the page used to wait for the SUM of all four; now it waits for
      // the slowest single query. (budget_categories still feeds the audit-tier
      // revenue estimate; the bank feed itself lives on the Budget page now.)
      const [cRes, bRes, rRes, fRes] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        withTimeout(supabase.from('budget_categories').select('*').eq('community_id', communityId).order('sort_order')),
        withTimeout(supabase.from('ev_reserve_components').select('*').eq('community_id', communityId).order('created_at')),
        withTimeout(supabase.from('ev_financial_filings').select('*').eq('community_id', communityId).order('fiscal_year', { ascending: false })),
      ])
      const { data: c } = cRes as any
      const { data: b } = bRes as any
      const { data: r } = rRes as any
      const { data: f } = fRes as any
      // Live current-FY GL revenue for the audit tier (null until a ledger exists).
      const live = await fetchGlCurrentFyRevenue(supabase, communityId, Number(c?.fiscal_year_start_month) || 1)
      setCommunity(c || null); setBudgets(b || []); setReserves(r || []); setFilings(f || []); setGlRevenue(live)
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.financials.errorLoadData')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const revenue = useMemo(() => estimateAnnualRevenue(community, budgets, glRevenue ?? undefined), [community, budgets, glRevenue])
  const required = useMemo(() => requiredAuditTier(revenue, regime as any, Number(community?.parcel_count) || 0), [revenue, regime, community])
  const signals = useMemo(() => financialSignals(community, budgets, reserves, filings, undefined, glRevenue ?? undefined), [community, budgets, reserves, filings, glRevenue])

  // ---- community financial settings ----
  const [cForm, setCForm] = useState<any>({})
  useEffect(() => {
    if (!community) return
    setCForm({
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
        fiscal_year_start_month: Number(cForm.fiscal_year_start_month) || 1,
        reserves_established: !!cForm.reserves_established,
        reserve_study_last_completed: (cForm.reserve_study_last_completed || '').trim() || null,
        reserve_study_type: cForm.reserve_study_type || null,
      }
      const { error } = (await withTimeout(supabase.from('communities').update(patch).eq('id', communityId))) as any
      if (error) throw error
      setMsg(t('admin.financials.settingsSaved')); load()
    } catch (err: any) { setError(err?.message || t('admin.financials.errorSaveSettings')) }
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
      throw new Error(data?.error || t('admin.financials.errorStripeOnboard'))
    } catch (err: any) {
      setConnectErr(err?.message || t('admin.financials.errorStripeOnboard')); setConnectBusy(false)
    }
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
      if (!insert.name) { setError(t('admin.financials.errorReserveName')); return }
      const { error } = (await withTimeout(supabase.from('ev_reserve_components').insert(insert))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'financial.reserve_updated', target_type: 'reserve_component' })
      setRForm({ is_sirs: false }); setMsg(t('admin.financials.reserveAdded')); load()
    } catch (err: any) { setError(err?.message || t('admin.financials.errorAddComponent')) }
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
      setMsg(t('admin.financials.filingRecorded')); load()
    } catch (err: any) { setError(err?.message || t('admin.financials.errorRecordFiling')) }
  }
  const updateFiling = async (id: string, patch: Record<string, any>) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_financial_filings').update(patch).eq('id', id))) as any
      if (error) throw error
      load()
    } catch (err: any) { setError(err?.message || t('admin.financials.errorUpdateFiling')) }
  }

  const filingTypeLabel: Record<string, string> = {
    annual_financial_report: t('admin.financials.filingTypeAnnual'),
    budget_adoption: t('admin.financials.filingTypeBudget'),
    reserve_study: t('admin.financials.filingTypeReserveStudy'),
    audit_tier: t('admin.financials.filingTypeAudit'),
    reserve_waiver: t('admin.financials.filingTypeReserveWaiver'),
  }

  const statusLabel: Record<string, string> = {
    planned: t('admin.financials.statusPlanned'),
    in_progress: t('admin.financials.statusInProgress'),
    completed: t('admin.financials.statusCompleted'),
    delivered: t('admin.financials.statusDelivered'),
    waived: t('admin.financials.statusWaived'),
  }

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.financials.kicker')}</div>
      <h1 className="admin-h1">{t('admin.financials.pageTitle')} <span className="amp">&</span> {t('admin.financials.pageTitleReserves')}</h1>
      <p className="admin-dek">
        {t('admin.financials.dek')}
      </p>

      <AttorneyNote />
      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.financials.noCommunity')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.financials.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.financials.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* 1 — Required financial statements: what the law requires at this revenue */}
          <div className="admin-note admin-note-info" style={{ marginBottom: 18 }}>
            <strong>{t('admin.financials.requiredStatementsLabel')}</strong> {t('admin.financials.requiredStatementsAt')} ~{fmt$(revenue)} {t('admin.financials.requiredStatementsRevenue')}
            {regime === 'hoa' ? ` (HOA, ${Number(community?.parcel_count) || 0} ${t('admin.financials.parcels')})` : ` (${t('admin.financials.condo')})`}, {t('admin.financials.requiredStatementsLaw')} <strong>{AUDIT_TIER_LABEL[required]}</strong>.
            <span style={{ opacity: 0.7 }}> {t('admin.financials.revenueHint')}</span>
          </div>

          {/* 2 — Open signals: statutory deadlines that need attention */}
          {signals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {signals.map(s => <SignalRow key={s.id} signal={s} />)}
            </div>
          )}

          {/* 3 — Financial settings */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.financials.settingsTitle')}</h2></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 10 }}>
              <label className="admin-field"><span className="admin-field-label">{t('admin.financials.fiscalYearStartMonth')}</span>
                <input className="admin-input" type="number" min="1" max="12" step="1" value={cForm.fiscal_year_start_month ?? 1} onChange={e => setCForm((f: any) => ({ ...f, fiscal_year_start_month: e.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.financials.lastReserveStudy')}</span>
                <input className="admin-input" type="date" value={cForm.reserve_study_last_completed ?? ''} onChange={e => setCForm((f: any) => ({ ...f, reserve_study_last_completed: e.target.value }))} /></label>
              <div className="admin-field"><span className="admin-field-label">{t('admin.financials.reserveStudyType')}</span>
                <Dropdown<string>
                  value={cForm.reserve_study_type ?? ''}
                  onChange={v => setCForm((f: any) => ({ ...f, reserve_study_type: v }))}
                  ariaLabel={t('admin.financials.reserveStudyType')}
                  options={[
                    { value: '', label: '—' },
                    { value: 'sirs', label: 'SIRS' },
                    { value: 'general', label: t('admin.financials.optionGeneral') },
                  ]}
                /></div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '4px 0 10px' }}>
              <input type="checkbox" checked={!!cForm.reserves_established} onChange={e => setCForm((f: any) => ({ ...f, reserves_established: e.target.checked }))} />
              {t('admin.financials.reservesEstablished')}
            </label>
            <div className="card-cta">
              <button className="admin-primary-btn" disabled={cSaving} onClick={saveCommunity}>{cSaving ? t('admin.financials.saving') : t('admin.financials.saveSettings')}</button>
            </div>
          </div>

          {/* 4 — Collect payments: Stripe Connect ("link, don't hold") */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.financials.collectPaymentsTitle')}</h2>
                <div className="sub" style={{ maxWidth: 540 }}>{t('admin.financials.collectPaymentsSub')}</div>
              </div>
              {community?.stripe_connect_status === 'active' ? (
                <span className="admin-success" style={{ margin: 0 }}><span className="admin-success-check" aria-hidden>✓</span>{t('admin.financials.connected')}</span>
              ) : (
                <button className="admin-primary-btn" disabled={connectBusy} onClick={connectStripe}>
                  {connectBusy ? t('admin.financials.openingStripe') : community?.stripe_connect_status === 'pending' ? t('admin.financials.finishStripeSetup') : t('admin.financials.connectStripeBtn')}
                </button>
              )}
            </div>
            {community?.stripe_connect_status === 'pending' && (
              <div className="admin-note admin-note-warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                {t('admin.financials.stripePendingNote')}
              </div>
            )}
            {connectErr && <div className="admin-note admin-note-err" style={{ marginTop: 10 }}>{connectErr}</div>}
          </div>

          {/* 5 — Budget & spending: lives on the dedicated Budget page now. */}
          <div className="card">
            <div className="wslist">
              <Link href="/admin/budget" className="wsrow">
                <span className="wsrow-glyph" style={{ color: '#0E7490', background: '#0E749018' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
                </span>
                <div className="wsrow-main">
                  <div className="wsrow-title">{t('admin.financials.budgetRowTitle')} <span className="amp">&</span> {t('admin.financials.budgetRowTitleSpending')}</div>
                  <div className="wsrow-desc">{t('admin.financials.budgetRowDesc')}</div>
                  <div className="wsrow-desc">{t('admin.financials.budgetRowBankHint')}</div>
                </div>
                <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>

          {/* 6 — Reserve components */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.financials.reserveComponentsTitle')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({reserves.length})</span></h2></div></div>
            <form className="admin-form" onSubmit={addReserve}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">{t('admin.financials.componentLabel')}</span>
                  <input className="admin-input" value={rForm.name ?? ''} placeholder={t('admin.financials.componentPlaceholder')} onChange={e => setRF('name', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.financials.currentBalance')}</span>
                  <input className="admin-input" type="number" min="0" step="100" value={rForm.current_balance ?? ''} onChange={e => setRF('current_balance', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.financials.fullyFunded')}</span>
                  <input className="admin-input" type="number" min="0" step="100" value={rForm.fully_funded_balance ?? ''} onChange={e => setRF('fully_funded_balance', e.target.value)} /></label>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '8px 0' }}>
                <input type="checkbox" checked={!!rForm.is_sirs} onChange={e => setRF('is_sirs', e.target.checked)} />
                {t('admin.financials.sirsLabel')}
              </label>
              <div className="card-cta"><button type="submit" className="admin-primary-btn">{t('admin.financials.addComponent')}</button></div>
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
                      {pct != null && <span style={{ color: pct < 50 ? '#B42318' : pct < 100 ? '#B54708' : '#067647', fontWeight: 600 }}> · {pct}% {t('admin.financials.funded')}</span>}
                    </div>
                  </div>
                  <button type="button" className="bc-del" onClick={() => removeReserve(r.id)} aria-label={t('admin.financials.removeAriaLabel')}>&times;</button>
                </div>
              )
            })}
            </div>
          </div>

          {/* Filings */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.financials.filingsTitle')}</h2></div></div>
            <form className="admin-form" onSubmit={addFiling}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <div className="admin-field"><span className="admin-field-label">{t('admin.financials.filingTypeFieldLabel')}</span>
                  <Dropdown<string>
                    value={fForm.filing_type}
                    onChange={v => setFF('filing_type', v)}
                    ariaLabel={t('admin.financials.filingTypeFieldLabel')}
                    options={FILING_TYPES.map(ft => ({ value: ft.value, label: filingTypeLabel[ft.value] ?? ft.label }))}
                  /></div>
                <label className="admin-field"><span className="admin-field-label">{t('admin.financials.fiscalYear')}</span>
                  <input className="admin-input" type="number" step="1" value={fForm.fiscal_year ?? ''} onChange={e => setFF('fiscal_year', e.target.value)} /></label>
                <div className="admin-field"><span className="admin-field-label">{t('admin.financials.filingStatus')}</span>
                  <Dropdown<string>
                    value={fForm.status}
                    onChange={v => setFF('status', v)}
                    ariaLabel={t('admin.financials.filingStatus')}
                    options={STATUSES.map(s => ({ value: s, label: statusLabel[s] ?? s.replace('_', ' ') }))}
                  /></div>
                <div className="admin-field"><span className="admin-field-label">{t('admin.financials.statementLevel')}</span>
                  <Dropdown<string>
                    value={fForm.audit_tier ?? ''}
                    onChange={v => setFF('audit_tier', v)}
                    ariaLabel={t('admin.financials.statementLevel')}
                    options={[
                      { value: '', label: '—' },
                      { value: 'cash', label: 'cash' },
                      { value: 'compiled', label: 'compiled' },
                      { value: 'reviewed', label: 'reviewed' },
                      { value: 'audited', label: 'audited' },
                    ]}
                  /></div>
                <label className="admin-field"><span className="admin-field-label">{t('admin.financials.completedLabel')}</span>
                  <input className="admin-input" type="date" value={fForm.completed_at ?? ''} onChange={e => setFF('completed_at', e.target.value)} /></label>
              </div>
              <div className="card-cta"><button type="submit" className="admin-primary-btn">{t('admin.financials.recordFiling')}</button></div>
            </form>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {filings.length === 0 && <div className="admin-note">{t('admin.financials.noFilings')}</div>}
            {filings.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>FY{f.fiscal_year} · {filingTypeLabel[String(f.filing_type)] || FILING_LABEL[String(f.filing_type)] || f.filing_type}{f.audit_tier ? ` · ${f.audit_tier}` : ''}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.75 }}>{f.completed_at ? `${t('admin.financials.completedOn')} ${f.completed_at}` : ''}{f.delivered_at ? ` · ${t('admin.financials.deliveredOn')} ${f.delivered_at}` : ''}</div>
                </div>
                <div style={{ width: 160 }}>
                  <Dropdown<string>
                    value={String(f.status)}
                    onChange={v => updateFiling(f.id, { status: v })}
                    ariaLabel={t('admin.financials.filingStatus')}
                    options={STATUSES.map(s => ({ value: s, label: statusLabel[s] ?? s.replace('_', ' ') }))}
                  />
                </div>
              </div>
            ))}
            </div>
          </div>

          {/* 8 — Documents: generate or view each statutory artifact (one wsrow each) */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.financials.documentsTitle')}</h2><div className="sub">{t('admin.financials.documentsSub')}</div></div></div>
            <div className="wslist">
              {[
                { type: 'statement', label: t('admin.financials.docStatement'), live: true },
                { type: 'budget_actual', label: t('admin.financials.docBudgetActual'), live: true },
                { type: 'rev_exp', label: t('admin.financials.docRevExp'), live: true },
                { type: 'balance_sheet', label: t('admin.financials.docBalanceSheet'), live: true },
                { type: 'afr', label: t('admin.financials.docAfr'), live: false },
                { type: 'budget', label: t('admin.financials.docBudget'), live: false },
                { type: 'reserve_worksheet', label: t('admin.financials.docReserveWorksheet'), live: false },
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
                      <div className="wsrow-desc">{d.live ? t('admin.financials.liveStatement') : t('admin.financials.draftTemplate')}</div>
                    </div>
                    <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
