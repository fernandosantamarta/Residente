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
import { supabase, hasSupabase } from '@/lib/supabase'
import { AttorneyNote } from '../AttorneyNote'
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
      const { data: c } = (await withTimeout(
        supabase.from('communities').select('*').eq('id', communityId).single(),
      )) as any
      const { data: k, error: kErr } = (await withTimeout(
        supabase.from('ev_contracts').select('*').eq('community_id', communityId).order('created_at', { ascending: false }),
      )) as any
      if (kErr) throw kErr
      const { data: b } = (await withTimeout(
        supabase.from('budget_categories').select('budget, fiscal_year, is_reserve').eq('community_id', communityId),
      )) as any
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
      setMsg('Contract recorded.')
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
      setMsg('Contract removed.'); load()
    } catch (err: any) { setError(err?.message || 'Could not remove the contract') }
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Procurement <span className="amp">&</span> contracts</h1>
      <p className="admin-dek">
        Florida requires competitive bids for a contract exceeding {pct}% of {BID_THRESHOLD_BASIS.value}
        (FS {regime === 'hoa' ? '720.3055' : '718.3026'}), and every service contract or contract over a year
        must be in writing. We compute the threshold from your budget; you decide each step. Director conflicts
        of interest are tracked under <Link href="/admin/governance">Directors &amp; management</Link>.
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>
      )}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* Documents */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
            {[
              { type: 'summary', label: 'Procurement summary' },
              { type: 'bid_log', label: 'Competitive-bid solicitation log' },
              ...(regime === 'condo' ? [{ type: 'mgmt_checklist', label: 'Management-agreement required-terms checklist' }] : []),
            ].map(d => (
              <Link key={d.type} href={`/admin/contracts/document?type=${d.type}`} className="admin-btn-ghost" style={{ textDecoration: 'none' }}>
                📄 {d.label}
              </Link>
            ))}
          </div>

          {/* Threshold banner */}
          <div className="card">
            <div className="card-head"><div><h2>Competitive-bid threshold</h2></div></div>
            {budgetInfo.basis === 'none' ? (
              <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>
                No budget is recorded yet, so the {pct}% threshold can&apos;t be computed. Add this year&apos;s budget
                (including reserve lines) in <Link href="/admin/community">Community</Link> or the financials workspace.
              </p>
            ) : (
              <p style={{ fontSize: 13, margin: 0 }}>
                Total annual budget {budgetInfo.basis === 'budget' ? '(including reserves)' : '(estimated from annual revenue)'}:
                {' '}<strong>{fmt$(budgetInfo.total)}</strong> · {pct}% competitive-bid threshold: <strong>{fmt$(threshold)}</strong>.
                A contract exceeding this requires competitive bids unless a statutory exception applies.
              </p>
            )}
          </div>

          {/* Contract intake */}
          <div className="card">
          <div className="card-head"><div><h2>Record a contract</h2></div></div>
          <form className="admin-form" onSubmit={createContract}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">Vendor</span>
                <input className="admin-input" value={form.vendor ?? ''} onChange={e => setF('vendor', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Description</span>
                <input className="admin-input" value={form.description ?? ''} onChange={e => setF('description', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Amount (aggregate)</span>
                <input className="admin-input" type="number" min="0" step="100" value={form.amount ?? ''} onChange={e => setF('amount', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Type</span>
                <select className="admin-input" value={form.contract_kind} onChange={e => setF('contract_kind', e.target.value)}>
                  <option value="products">Products / equipment</option>
                  <option value="services">Services</option>
                  <option value="management">Management / maintenance</option>
                </select></label>
              <label className="admin-field"><span className="admin-field-label">Term (months)</span>
                <input className="admin-input" type="number" min="0" step="1" value={form.term_months ?? ''} onChange={e => setF('term_months', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Executed on</span>
                <input className="admin-input" type="date" value={form.executed_on ?? ''} onChange={e => setF('executed_on', e.target.value)} /></label>
              <label className="admin-field"><span className="admin-field-label">Exception (if any)</span>
                <select className="admin-input" value={form.exception_basis ?? 'none'} onChange={e => setF('exception_basis', e.target.value)}>
                  {Object.keys(EXCEPTION_LABEL).map(k => <option key={k} value={k}>{EXCEPTION_LABEL[k]}</option>)}
                </select></label>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0', fontSize: 14 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!form.bids_obtained} onChange={e => setF('bids_obtained', e.target.checked)} /> Competitive bids obtained
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!form.written_contract} onChange={e => setF('written_contract', e.target.checked)} /> Signed written contract on file
              </label>
              {regime === 'condo' && form.contract_kind === 'management' && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!form.required_terms_attested} onChange={e => setF('required_terms_attested', e.target.checked)} /> 718.3025 required terms confirmed
                </label>
              )}
            </div>
            <div className="card-cta">
              {error && <span className="admin-err-inline">{error}</span>}
              <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? 'Saving…' : 'Record contract'}</button>
            </div>
          </form>
          </div>

          {/* Contracts list */}
          <div className="card">
            <div className="card-head"><div><h2>Contracts <span style={{ opacity: 0.55, fontWeight: 400 }}>({contracts.length})</span></h2></div></div>
            {contracts.length === 0 && <div className="admin-note">No contracts recorded yet. Add your material vendor and management contracts above.</div>}
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
  const amount = Number(c.amount) || 0
  const overThreshold = threshold > 0 && amount > threshold
  const hasException = !!c.exception_basis && c.exception_basis !== 'none'
  const isService = c.contract_kind === 'services' || c.contract_kind === 'management'
  const needsWriting = isService || (Number(c.term_months) || 0) > 12
  const fmt = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

  const bidGap = overThreshold && !hasException && !c.bids_obtained
  const writeGap = needsWriting && !c.written_contract
  const termsGap = regime === 'condo' && c.contract_kind === 'management' && !c.required_terms_attested

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${overThreshold ? '#B54708' : '#0D9488'}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {c.vendor || c.description || c.id.slice(0, 8)}{amount ? ` · ${fmt(amount)}` : ''}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
            {KIND_LABEL[String(c.contract_kind)] || String(c.contract_kind)}
            {c.term_months ? ` · ${c.term_months} mo` : ''}
            {c.executed_on ? ` · executed ${c.executed_on}` : ''}
            {overThreshold ? ' · over threshold' : ''}
            {hasException ? ` · exception: ${EXCEPTION_LABEL[String(c.exception_basis)] || c.exception_basis}` : ''}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ color: bidGap ? '#B54708' : '#067647' }}>{bidGap ? '⚠ bids not recorded' : c.bids_obtained ? '✓ bids obtained' : (overThreshold && hasException ? '— exception claimed' : '— under threshold')}</span>
            <span style={{ color: writeGap ? '#B54708' : '#067647' }}>{writeGap ? '⚠ no written contract' : c.written_contract ? '✓ written contract' : '— writing not required'}</span>
            {regime === 'condo' && c.contract_kind === 'management' && (
              <span style={{ color: termsGap ? '#B54708' : '#067647' }}>{termsGap ? '⚠ 718.3025 terms unconfirmed' : '✓ required terms confirmed'}</span>
            )}
          </div>
        </div>
        <button className="admin-btn-ghost" onClick={() => onDelete(c.id)} style={{ color: '#B42318' }}>Remove</button>
      </div>

      {/* Inline toggles */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 13, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 10 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={!!c.bids_obtained} onChange={e => onUpdate(c.id, { bids_obtained: e.target.checked })} /> Bids obtained
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={!!c.written_contract} onChange={e => onUpdate(c.id, { written_contract: e.target.checked })} /> Written contract
        </label>
        {regime === 'condo' && c.contract_kind === 'management' && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!c.required_terms_attested} onChange={e => onUpdate(c.id, { required_terms_attested: e.target.checked })} /> 718.3025 terms confirmed
          </label>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ opacity: 0.7 }}>Exception:</span>
          <select className="admin-input" style={{ maxWidth: 230, padding: '3px 6px' }} value={String(c.exception_basis ?? 'none')} onChange={e => onUpdate(c.id, { exception_basis: e.target.value === 'none' ? null : e.target.value })}>
            {Object.keys(EXCEPTION_LABEL).map(k => <option key={k} value={k}>{EXCEPTION_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
