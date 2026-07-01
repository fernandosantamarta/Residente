'use client'

// Procurement workspace — competitive bidding, written contracts & the condo
// management-agreement required terms. FS 718.3026 / 720.3055 / 718.3025. Board
// records significant vendor + management contracts; the threshold math and the
// advisory signals live in lib/compliance/contracts.ts and surface on
// /admin/compliance. Nothing here blocks a board action. Director conflicts of
// interest (718.3027 / 720.3033) live in the Directors & management workspace.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { Dropdown } from '@/components/Dropdown'
import { supabase, hasSupabase } from '@/lib/supabase'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
import { logAudit } from '@/lib/audit'
import {
  BID_THRESHOLD_PCT, BID_THRESHOLD_BASIS, CONDO_MGMT_REQUIRED_TERMS,
  totalAnnualBudgetInclReserves, bidThreshold,
  type ContractRow, type ContractKind, type BudgetRow,
} from '@/lib/compliance/contracts'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

const KIND_LABEL: Record<string, string> = { products: 'Products / equipment', services: 'Services', management: 'Management / maintenance' }
const EXCEPTION_LABEL: Record<string, string> = {
  none: '— none —',
  emergency: 'Emergency',
  sole_source: 'Only source in the county',
  professional_service: 'Professional service / employee',
  employee: 'Association employee',
  franchise: 'Local-government franchise (HOA)',
  renewal_cancelable: 'Renewal of a bid contract, cancelable on 30 days (HOA)',
  pre_2004: 'Executed before Oct 1, 2004 (HOA)',
  opt_out: '≤10-unit two-thirds opt-out (condo)',
  governing_docs: 'Governing-document procedure (not less stringent)',
}

export default function ContractsPage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [budgets, setBudgets] = useState<BudgetRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Fire every read in ONE parallel batch instead of three serial round-trips —
      // the queries are independent, so the page now waits for the slowest single
      // query rather than the sum of all three.
      const [cRes, kRes, bRes] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        withTimeout(supabase.from('ev_contracts').select('*').eq('community_id', communityId).order('created_at', { ascending: false })),
        withTimeout(supabase.from('budget_categories').select('budget, fiscal_year, is_reserve').eq('community_id', communityId)),
      ])
      const { data: c } = cRes as any
      const { data: k, error: kErr } = kRes as any
      if (kErr) throw kErr
      const { data: b } = bRes as any
      setCommunity(c || null)
      setContracts(k || [])
      setBudgets(b || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load contracts'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const pct = BID_THRESHOLD_PCT.value[regime]
  const budgetInfo = useMemo(() => totalAnnualBudgetInclReserves(community, budgets), [community, budgets])
  const threshold = useMemo(() => bidThreshold(regime, budgetInfo.total), [regime, budgetInfo])

  // ---------- contract intake ----------
  const [form, setForm] = useState<any>({ contract_kind: 'services', exception_basis: 'none' })
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)

  const createContract = async (e: any) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const insert: Record<string, any> = {
        community_id: communityId,
        vendor: (form.vendor || '').trim() || null,
        description: (form.description || '').trim() || null,
        amount: form.amount === '' || form.amount == null ? null : Number(form.amount),
        contract_kind: (form.contract_kind || 'services') as ContractKind,
        term_months: form.term_months === '' || form.term_months == null ? null : Number(form.term_months),
        executed_on: (form.executed_on || '').trim() || null,
        bids_obtained: !!form.bids_obtained,
        written_contract: !!form.written_contract,
        exception_basis: form.exception_basis && form.exception_basis !== 'none' ? form.exception_basis : null,
        required_terms_attested: !!form.required_terms_attested,
        notes: (form.notes || '').trim() || null,
        created_by: profile?.id ?? null,
      }
      const { data: ins, error } = (await withTimeout(supabase.from('ev_contracts').insert(insert).select('id').single())) as any
      if (error) throw error
      if (ins?.id) await logAudit({ community_id: communityId!, event_type: 'contract.recorded', target_type: 'contract', target_id: ins.id, metadata: { contract_kind: insert.contract_kind } })
      setForm({ contract_kind: 'services', exception_basis: 'none' })
      setMsg(t('admin.contracts.contractRecorded'))
      load()
    } catch (err: any) { setError(err?.message || 'Could not record the contract') }
    finally { setSaving(false) }
  }

  const updateContract = async (id: string, patch: Record<string, any>) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_contracts').update(patch).eq('id', id))) as any
      if (error) throw error
      await logAudit({ community_id: communityId!, event_type: 'contract.updated', target_type: 'contract', target_id: id, metadata: patch })
      load()
    } catch (err: any) { setError(err?.message || 'Could not update the contract') }
  }

  const deleteContract = async (id: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_contracts').delete().eq('id', id))) as any
      if (error) throw error
      setMsg(t('admin.contracts.contractRemoved')); load()
    } catch (err: any) { setError(err?.message || 'Could not remove the contract') }
  }

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.contracts.kicker')}</div>
      <h1 className="admin-h1">{t('admin.contracts.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.contracts.pageDesc', { pct, basis: BID_THRESHOLD_BASIS.value, statute: regime === 'hoa' ? '720.3055' : '718.3026' })}{' '}
        <Link href="/admin/governance">{t('admin.contracts.pageDescLinkLabel')}</Link>.
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">{t('admin.contracts.noAccount')}</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.contracts.retry')}</button></div>
      )}
      {status === 'loading' && <div className="admin-note">{t('admin.contracts.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* Threshold banner */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.contracts.thresholdTitle')}</h2></div></div>
            {budgetInfo.basis === 'none' ? (
              <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>
                {t('admin.contracts.noBudget', { pct })}{' '}
                <Link href="/admin/community">{t('admin.contracts.noBudgetLinkCommunity')}</Link>{' '}
                {t('admin.contracts.noBudgetLinkOr')}
              </p>
            ) : (
              <p style={{ fontSize: 13, margin: 0 }}>
                {budgetInfo.basis === 'budget' ? t('admin.contracts.budgetSummaryBudget') : t('admin.contracts.budgetSummaryRevenue')}
                {' '}<strong>{fmt$(budgetInfo.total)}</strong> · {t('admin.contracts.budgetSummaryThreshold', { pct })} <strong>{fmt$(threshold)}</strong>.{' '}
                {t('admin.contracts.budgetSummaryNote')}
              </p>
            )}
          </div>

          {/* Contract intake */}
          <div className="card">
          <div className="card-head"><div><h2>{t('admin.contracts.recordTitle')}</h2></div></div>
          <form className="admin-form" onSubmit={createContract}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">{t('admin.contracts.fieldVendor')}</span>
                <input className="admin-input" value={form.vendor ?? ''} onChange={e => setF('vendor', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.contracts.fieldDescription')}</span>
                <input className="admin-input" value={form.description ?? ''} onChange={e => setF('description', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.contracts.fieldAmount')}</span>
                <input className="admin-input" type="number" min="0" step="100" value={form.amount ?? ''} onChange={e => setF('amount', e.target.value)} /></label>
              <div className="admin-field"><span className="admin-field-label">{t('admin.contracts.fieldType')}</span>
                <Dropdown<string>
                  value={form.contract_kind}
                  onChange={v => setF('contract_kind', v)}
                  ariaLabel={t('admin.contracts.fieldType')}
                  options={[
                    { value: 'products', label: t('admin.contracts.optionProducts') },
                    { value: 'services', label: t('admin.contracts.optionServices') },
                    { value: 'management', label: t('admin.contracts.optionManagement') },
                  ]}
                /></div>
              <label className="admin-field"><span className="admin-field-label">{t('admin.contracts.fieldTerm')}</span>
                <input className="admin-input" type="number" min="0" step="1" value={form.term_months ?? ''} onChange={e => setF('term_months', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.contracts.fieldExecutedOn')}</span>
                <input className="admin-input" type="date" value={form.executed_on ?? ''} onChange={e => setF('executed_on', e.target.value)} /></label>
              <div className="admin-field"><span className="admin-field-label">{t('admin.contracts.fieldException')}</span>
                <Dropdown<string>
                  value={form.exception_basis ?? 'none'}
                  onChange={v => setF('exception_basis', v)}
                  ariaLabel={t('admin.contracts.fieldException')}
                  options={Object.keys(EXCEPTION_LABEL).map(k => ({ value: k, label: EXCEPTION_LABEL[k] }))}
                /></div>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0', fontSize: 14 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!form.bids_obtained} onChange={e => setF('bids_obtained', e.target.checked)} /> {t('admin.contracts.checkBidsObtained')}
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!form.written_contract} onChange={e => setF('written_contract', e.target.checked)} /> {t('admin.contracts.checkWrittenContract')}
              </label>
              {regime === 'condo' && form.contract_kind === 'management' && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!form.required_terms_attested} onChange={e => setF('required_terms_attested', e.target.checked)} /> {t('admin.contracts.checkRequiredTerms')}
                </label>
              )}
            </div>
            <div className="card-cta">
              {error && <span className="admin-err-inline">{error}</span>}
              <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? t('admin.contracts.saving') : t('admin.contracts.recordBtn')}</button>
            </div>
          </form>
          </div>

          {/* Contracts list */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.contracts.listTitle')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({contracts.length})</span></h2></div></div>
            {contracts.length === 0 && <div className="admin-note">{t('admin.contracts.noContracts')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {contracts.map(c => (
                <ContractCard
                  key={c.id}
                  c={c}
                  regime={regime}
                  threshold={threshold}
                  onUpdate={updateContract}
                  onDelete={deleteContract}
                />
              ))}
            </div>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.contracts.docsTitle')}</h2><div className="sub">{t('admin.contracts.docsSub')}</div></div></div>
            <div className="wslist">
              {[
                { type: 'summary', label: t('admin.contracts.docLabelSummary'), live: true },
                { type: 'bid_log', label: t('admin.contracts.docLabelBidLog'), live: true },
                ...(regime === 'condo' ? [{ type: 'mgmt_checklist', label: t('admin.contracts.docLabelMgmtChecklist'), live: false }] : []),
              ].map(d => {
                const col = d.live ? '#0E7490' : '#7A5AF8'
                return (
                  <Link key={d.type} href={`/admin/contracts/document?type=${d.type}`} className="wsrow">
                    <span className="wsrow-glyph" style={{ color: col, background: col + '18' }}>
                      {d.live ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                      )}
                    </span>
                    <div className="wsrow-main">
                      <div className="wsrow-title">{d.label}</div>
                      <div className="wsrow-desc">{d.live ? t('admin.contracts.docLive') : t('admin.contracts.docDraft')}</div>
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

function ContractCard({
  c, regime, threshold, onUpdate, onDelete,
}: {
  c: ContractRow
  regime: 'condo' | 'hoa'
  threshold: number
  onUpdate: (id: string, patch: Record<string, any>) => void
  onDelete: (id: string) => void
}) {
  const t = useT()
  const amount = Number(c.amount) || 0
  const overThreshold = threshold > 0 && amount > threshold
  const hasException = !!c.exception_basis && c.exception_basis !== 'none'
  const isService = c.contract_kind === 'services' || c.contract_kind === 'management'
  // Exception basis exempts from both the bidding AND the writing requirement
  // (FS 718.3026(2)(a) / 720.3055(2)(a)1), so mirror the bid-needed guard here.
  const needsWriting = (isService || (Number(c.term_months) || 0) > 12) && !hasException
  const fmt = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

  const bidGap = overThreshold && !hasException && !c.bids_obtained
  const writeGap = needsWriting && !c.written_contract
  const termsGap = regime === 'condo' && c.contract_kind === 'management' && !c.required_terms_attested

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {c.vendor || c.description || c.id.slice(0, 8)}{amount ? ` · ${fmt(amount)}` : ''}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
            {KIND_LABEL[String(c.contract_kind)] || String(c.contract_kind)}
            {c.term_months ? ` · ${c.term_months} mo` : ''}
            {c.executed_on ? ` · ${t('admin.contracts.cardExecuted', { date: c.executed_on })}` : ''}
            {overThreshold ? ` · ${t('admin.contracts.cardOverThreshold')}` : ''}
            {hasException ? ` · ${t('admin.contracts.cardException', { label: EXCEPTION_LABEL[String(c.exception_basis)] || String(c.exception_basis) })}` : ''}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ color: bidGap ? '#B54708' : '#067647' }}>{bidGap ? t('admin.contracts.cardBidGap') : c.bids_obtained ? t('admin.contracts.cardBidsObtained') : (overThreshold && hasException ? t('admin.contracts.cardExceptionClaimed') : t('admin.contracts.cardUnderThreshold'))}</span>
            <span style={{ color: writeGap ? '#B54708' : '#067647' }}>{writeGap ? t('admin.contracts.cardWriteGap') : c.written_contract ? t('admin.contracts.cardWrittenContract') : t('admin.contracts.cardWritingNotRequired')}</span>
            {regime === 'condo' && c.contract_kind === 'management' && (
              <span style={{ color: termsGap ? '#B54708' : '#067647' }}>{termsGap ? t('admin.contracts.cardTermsGap') : t('admin.contracts.cardTermsConfirmed')}</span>
            )}
          </div>
        </div>
        <button className="admin-btn-ghost" onClick={() => onDelete(c.id)} style={{ color: '#B42318' }}>{t('admin.contracts.removeBtn')}</button>
      </div>

      {/* Inline toggles */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 13, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 10 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={!!c.bids_obtained} onChange={e => onUpdate(c.id, { bids_obtained: e.target.checked })} /> {t('admin.contracts.toggleBidsObtained')}
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={!!c.written_contract} onChange={e => onUpdate(c.id, { written_contract: e.target.checked })} /> {t('admin.contracts.toggleWrittenContract')}
        </label>
        {regime === 'condo' && c.contract_kind === 'management' && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!c.required_terms_attested} onChange={e => onUpdate(c.id, { required_terms_attested: e.target.checked })} /> {t('admin.contracts.toggleRequiredTerms')}
          </label>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ opacity: 0.7 }}>{t('admin.contracts.exceptionLabel')}</span>
          <div style={{ width: 230 }}>
            <Dropdown<string>
              value={String(c.exception_basis ?? 'none')}
              onChange={v => onUpdate(c.id, { exception_basis: v === 'none' ? null : v })}
              ariaLabel={t('admin.contracts.exceptionLabel')}
              options={Object.keys(EXCEPTION_LABEL).map(k => ({ value: k, label: EXCEPTION_LABEL[k] }))}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
