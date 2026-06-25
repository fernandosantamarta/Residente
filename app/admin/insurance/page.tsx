'use client'

// Insurance workspace — property (replacement-cost appraisal) & fidelity bond.
// FS 718.111(11)(a)/(h) (condo) and FS 720.3033(5) (HOA). The property +
// 36-month appraisal half is condo-only; the fidelity bond applies to both.
// Board records policies; the date/amount math + advisory signals live in
// lib/compliance/insurance.ts and surface on /admin/compliance. Nothing here
// blocks a board action.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import { logAudit } from '@/lib/audit'
import { useT } from '@/lib/i18n'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
import {
  PROPERTY_APPRAISAL_INTERVAL_MONTHS, FIDELITY_BOND_COVERED_PERSONS,
  HOA_FIDELITY_BOND_WAIVER_BASIS,
  appraisalNextDue, estimatedMaxFunds, currentFiscalYear,
  type InsurancePolicyRow, type InsuranceKind, type ReserveBalanceRow,
} from '@/lib/compliance/insurance'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

export default function InsurancePage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [policies, setPolicies] = useState<InsurancePolicyRow[]>([])
  const [reserves, setReserves] = useState<ReserveBalanceRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Fire all three reads in ONE parallel batch instead of awaiting three
      // round-trips in series — the page now waits for the slowest single query
      // rather than the sum. Reserve balances feed the fidelity-bond "max funds
      // in custody" estimate. The queries are independent (none uses another's result).
      const [cRes, pRes, rRes] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        withTimeout(supabase.from('ev_insurance_policies').select('*').eq('community_id', communityId).order('created_at', { ascending: false })),
        withTimeout(supabase.from('ev_reserve_components').select('current_balance').eq('community_id', communityId)),
      ])
      const { data: c } = cRes as any
      const { data: p, error: pErr } = pRes as any
      const { data: r } = rRes as any
      if (pErr) throw pErr
      setCommunity(c || null)
      setPolicies(p || [])
      setReserves(r || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.insurance.errorLoadData')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const propertyPolicies = useMemo(() => policies.filter(p => p.kind === 'property'), [policies])
  const bondPolicies = useMemo(() => policies.filter(p => p.kind === 'fidelity_bond'), [policies])
  const maxFunds = useMemo(() => estimatedMaxFunds(community, reserves), [community, reserves])
  const reserveSum = useMemo(() => reserves.reduce((s, r) => s + (Number(r.current_balance) || 0), 0), [reserves])

  // ---------- fidelity-bond settings (max funds + HOA waiver) ----------
  const [bondForm, setBondForm] = useState<any>({})
  useEffect(() => {
    if (!community) return
    setBondForm({
      estimated_max_funds: community.estimated_max_funds ?? '',
      fidelity_bond_waiver_fy: community.fidelity_bond_waiver_fy ?? '',
    })
  }, [community])
  const [bondSaving, setBondSaving] = useState(false)
  const saveBondSettings = async () => {
    setBondSaving(true); setError('')
    try {
      const patch: Record<string, any> = {
        estimated_max_funds: bondForm.estimated_max_funds === '' ? null : Number(bondForm.estimated_max_funds),
      }
      // The annual waiver is HOA-only; condominiums cannot waive.
      if (regime === 'hoa') {
        patch.fidelity_bond_waiver_fy = bondForm.fidelity_bond_waiver_fy === '' ? null : Number(bondForm.fidelity_bond_waiver_fy)
      }
      const { error } = (await withTimeout(supabase.from('communities').update(patch).eq('id', communityId))) as any
      if (error) throw error
      if (regime === 'hoa' && patch.fidelity_bond_waiver_fy) {
        await logAudit({ community_id: communityId!, event_type: 'insurance.waiver_recorded', target_type: 'insurance_policy', target_id: null, metadata: { fiscal_year: patch.fidelity_bond_waiver_fy } })
      }
      setMsg(t('admin.insurance.msgBondSettingsSaved')); load()
    } catch (err: any) { setError(err?.message || t('admin.insurance.errorSaveSettings')) }
    finally { setBondSaving(false) }
  }

  // ---------- policy intake / edit ----------
  const addPolicy = async (kind: InsuranceKind, form: any): Promise<boolean> => {
    setError('')
    try {
      const insert: Record<string, any> = {
        community_id: communityId,
        kind,
        carrier: (form.carrier || '').trim() || null,
        policy_number: (form.policy_number || '').trim() || null,
        amount: form.amount === '' || form.amount == null ? null : Number(form.amount),
        effective_date: (form.effective_date || '').trim() || null,
        expiration_date: (form.expiration_date || '').trim() || null,
        notes: (form.notes || '').trim() || null,
        created_by: profile?.id ?? null,
      }
      if (kind === 'property') {
        insert.last_appraisal_date = (form.last_appraisal_date || '').trim() || null
        insert.replacement_cost_value = form.replacement_cost_value === '' || form.replacement_cost_value == null ? null : Number(form.replacement_cost_value)
      }
      const { data: ins, error } = (await withTimeout(supabase.from('ev_insurance_policies').insert(insert).select('id').single())) as any
      if (error) throw error
      if (ins?.id) await logAudit({ community_id: communityId!, event_type: 'insurance.policy_recorded', target_type: 'insurance_policy', target_id: ins.id, metadata: { kind } })
      setMsg(kind === 'property' ? t('admin.insurance.msgPropertyPolicyRecorded') : t('admin.insurance.msgFidelityBondRecorded'))
      load()
      return true
    } catch (err: any) { setError(err?.message || t('admin.insurance.errorRecordPolicy')); return false }
  }

  const updatePolicy = async (id: string, patch: Record<string, any>) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_insurance_policies').update(patch).eq('id', id))) as any
      if (error) throw error
      load()
    } catch (err: any) { setError(err?.message || t('admin.insurance.errorUpdatePolicy')) }
  }

  const deletePolicy = async (id: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_insurance_policies').delete().eq('id', id))) as any
      if (error) throw error
      setMsg(t('admin.insurance.msgPolicyRemoved')); load()
    } catch (err: any) { setError(err?.message || t('admin.insurance.errorRemovePolicy')) }
  }

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.insurance.kicker')}</div>
      <h1 className="admin-h1">{t('admin.insurance.heading')}</h1>
      <p className="admin-dek">
        {regime === 'condo'
          ? t('admin.insurance.dekCondo', { interval: PROPERTY_APPRAISAL_INTERVAL_MONTHS.value, waiverBasis: HOA_FIDELITY_BOND_WAIVER_BASIS.value })
          : t('admin.insurance.dekHoa', { interval: PROPERTY_APPRAISAL_INTERVAL_MONTHS.value, waiverBasis: HOA_FIDELITY_BOND_WAIVER_BASIS.value })}
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">{t('admin.insurance.statusNone')}</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.insurance.retry')}</button></div>
      )}
      {status === 'loading' && <div className="admin-note">{t('admin.insurance.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* ---------- PROPERTY INSURANCE (condo only) ---------- */}
          {regime === 'condo' && (
            <PolicySection
              kind="property"
              title={t('admin.insurance.propertySectionTitle')}
              accent="#DD2590"
              blurb={t('admin.insurance.propertySectionBlurb', { interval: PROPERTY_APPRAISAL_INTERVAL_MONTHS.value })}
              policies={propertyPolicies}
              onAdd={(f) => addPolicy('property', f)}
              onUpdate={updatePolicy}
              onDelete={deletePolicy}
            />
          )}
          {regime === 'hoa' && (
            <div className="admin-note" style={{ margin: '0 0 18px' }}>
              {t('admin.insurance.hoaPropertyNote')}
            </div>
          )}

          {/* ---------- FIDELITY BOND (both regimes) ---------- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.insurance.bondFloorHeading')}</h2>
              <div className="sub">
                {t('admin.insurance.bondFloorSub', { reserveSum: fmt$(reserveSum) })}
              </div></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.labelMaxFunds')}</span>
                <input className="admin-input" type="number" min="0" step="1000" placeholder={reserveSum ? `${t('admin.insurance.placeholderReserves')} ${fmt$(reserveSum)}` : t('admin.insurance.placeholderMaxFundsExample')}
                  value={bondForm.estimated_max_funds ?? ''} onChange={e => setBondForm((f: any) => ({ ...f, estimated_max_funds: e.target.value }))} /></label>
              {regime === 'hoa' && (
                <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.labelWaiverFy')}</span>
                  <input className="admin-input" type="number" min="2000" max="2100" step="1" placeholder={`${t('admin.insurance.placeholderWaiverFyPrefix')} ${currentFiscalYear(community)}`}
                    value={bondForm.fidelity_bond_waiver_fy ?? ''} onChange={e => setBondForm((f: any) => ({ ...f, fidelity_bond_waiver_fy: e.target.value }))} /></label>
              )}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 12 }}>
              {t('admin.insurance.estimatedBondFloor')} <strong>{fmt$(maxFunds)}</strong>
              {regime === 'hoa' && (
                <span style={{ opacity: 0.72 }}> · {t('admin.insurance.hoaWaiverNote', { waiverBasis: HOA_FIDELITY_BOND_WAIVER_BASIS.value })}</span>
              )}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
              {t('admin.insurance.mustCover')} {FIDELITY_BOND_COVERED_PERSONS.value.join(' · ')}.
            </div>
            <div className="card-cta">
              <button className="admin-primary-btn" disabled={bondSaving} onClick={saveBondSettings}>{bondSaving ? t('admin.insurance.saving') : t('admin.insurance.saveBondSettings')}</button>
            </div>
          </div>

          <PolicySection
            kind="fidelity_bond"
            title={t('admin.insurance.bondSectionTitle')}
            accent="#7A5AF8"
            blurb={t('admin.insurance.bondSectionBlurb')}
            policies={bondPolicies}
            maxFunds={maxFunds}
            onAdd={(f) => addPolicy('fidelity_bond', f)}
            onUpdate={updatePolicy}
            onDelete={deletePolicy}
          />

          {/* Documents — generate or view each statutory artifact (one wsrow each,
              matching the financials Documents card). */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.insurance.documentsHeading')}</h2><div className="sub">{t('admin.insurance.documentsSub')}</div></div></div>
            <div className="wslist">
              {[
                { type: 'summary', label: t('admin.insurance.docSummaryLabel'), live: true },
                ...(regime === 'condo' ? [{ type: 'appraisal_request', label: t('admin.insurance.docAppraisalLabel'), live: false }] : []),
                { type: 'bond_worksheet', label: t('admin.insurance.docBondWorksheetLabel'), live: false },
              ].map(d => {
                const col = d.live ? '#0E7490' : '#7A5AF8'
                return (
                  <Link key={d.type} href={`/admin/insurance/document?type=${d.type}`} className="wsrow">
                    <span className="wsrow-glyph" style={{ color: col, background: col + '18' }}>
                      {d.live ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                      )}
                    </span>
                    <div className="wsrow-main">
                      <div className="wsrow-title">{d.label}</div>
                      <div className="wsrow-desc">{d.live ? t('admin.insurance.docLiveSummary') : t('admin.insurance.docDraftTemplate')}</div>
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

function PolicySection({
  kind, title, accent, blurb, policies, maxFunds, onAdd, onUpdate, onDelete,
}: {
  kind: InsuranceKind
  title: string
  accent: string
  blurb: string
  policies: InsurancePolicyRow[]
  maxFunds?: number
  onAdd: (form: any) => Promise<boolean>
  onUpdate: (id: string, patch: Record<string, any>) => void
  onDelete: (id: string) => void
}) {
  const t = useT()
  const isProperty = kind === 'property'
  const [form, setForm] = useState<any>({})
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)

  const submit = async (e: any) => {
    e.preventDefault()
    setSaving(true)
    const ok = await onAdd(form)
    if (ok) setForm({})
    setSaving(false)
  }

  return (
    <div className="card">
      <div className="card-head"><div><h2>{title}</h2>
        <div className="sub">{blurb}</div></div></div>
      <form className="admin-form" onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.fieldCarrier')}</span>
            <input className="admin-input" value={form.carrier ?? ''} onChange={e => setF('carrier', e.target.value)} /></label>
          <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.fieldPolicyNumber')}</span>
            <input className="admin-input" value={form.policy_number ?? ''} onChange={e => setF('policy_number', e.target.value)} /></label>
          <label className="admin-field"><span className="admin-field-label">{isProperty ? t('admin.insurance.fieldCoverageAmount') : t('admin.insurance.fieldBondAmount')}</span>
            <input className="admin-input" type="number" min="0" step="1000" value={form.amount ?? ''} onChange={e => setF('amount', e.target.value)} /></label>
          <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.fieldEffectiveDate')}</span>
            <input className="admin-input" type="date" value={form.effective_date ?? ''} onChange={e => setF('effective_date', e.target.value)} /></label>
          <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.fieldExpirationDate')}</span>
            <input className="admin-input" type="date" value={form.expiration_date ?? ''} onChange={e => setF('expiration_date', e.target.value)} /></label>
          {isProperty && (
            <>
              <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.fieldLastAppraisalDate')}</span>
                <input className="admin-input" type="date" value={form.last_appraisal_date ?? ''} onChange={e => setF('last_appraisal_date', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.insurance.fieldReplacementCostValue')}</span>
                <input className="admin-input" type="number" min="0" step="1000" value={form.replacement_cost_value ?? ''} onChange={e => setF('replacement_cost_value', e.target.value)} /></label>
            </>
          )}
        </div>
        <div className="card-cta">
          <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? t('admin.insurance.saving') : (isProperty ? t('admin.insurance.recordPropertyPolicy') : t('admin.insurance.recordFidelityBond'))}</button>
        </div>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {policies.length === 0 && <div className="admin-note">{t('admin.insurance.noneRecorded')}</div>}
        {policies.map(p => (
          <PolicyCard key={p.id} p={p} accent={accent} maxFunds={maxFunds} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </div>
    </div>
  )
}

function PolicyCard({
  p, accent, maxFunds, onUpdate, onDelete,
}: {
  p: InsurancePolicyRow
  accent: string
  maxFunds?: number
  onUpdate: (id: string, patch: Record<string, any>) => void
  onDelete: (id: string) => void
}) {
  const t = useT()
  const isProperty = p.kind === 'property'
  const fmt = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')
  const nextDue = isProperty ? appraisalNextDue(p.last_appraisal_date) : null
  // Show the under-bond chip whenever the bond amount is below the estimated
  // max-funds floor (including zero-amount entries — mirrors INS-01 signal fix).
  const underBond = !isProperty && maxFunds && maxFunds > 0 && (Number(p.amount) || 0) < maxFunds

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {p.carrier || (isProperty ? t('admin.insurance.cardPropertyPolicy') : t('admin.insurance.cardFidelityBond'))}
            {p.amount != null ? ` · ${fmt(p.amount)}` : ''}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
            {p.policy_number ? `#${p.policy_number} · ` : ''}
            {p.effective_date ? `${t('admin.insurance.cardEff')} ${p.effective_date}` : t('admin.insurance.cardNoEffectiveDate')}
            {p.expiration_date ? ` · ${t('admin.insurance.cardExp')} ${p.expiration_date}` : ''}
            {isProperty && p.last_appraisal_date ? ` · ${t('admin.insurance.cardAppraised')} ${p.last_appraisal_date}` : ''}
            {isProperty && p.replacement_cost_value != null ? ` · RCV ${fmt(p.replacement_cost_value)}` : ''}
          </div>
          {isProperty && nextDue && (
            <div style={{ fontSize: 12.5, marginTop: 4 }}>{t('admin.insurance.cardNextAppraisalDue')} <strong>{ymd(nextDue)}</strong></div>
          )}
          {underBond && (
            <div style={{ fontSize: 12.5, marginTop: 4, color: '#B54708' }}>{t('admin.insurance.cardUnderBond', { maxFunds: fmt(maxFunds) })}</div>
          )}
        </div>
        <button className="admin-btn-ghost" onClick={() => onDelete(p.id)} style={{ color: '#B42318' }}>{t('admin.insurance.remove')}</button>
      </div>
    </div>
  )
}
