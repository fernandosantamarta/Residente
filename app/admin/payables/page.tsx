'use client'

// Vendor bills & payments — the dual-control accounts-payable inbox.
// Capture a bill → a financials.initiate officer proposes paying it → a SECOND,
// distinct financials.approve officer signs → the payer records the bank bill-pay
// confirmation. "Link, don't hold": the money leaves through the HOA's own bank;
// Residente only runs the controls + posts the ledger. Backed by
// supabase/disbursements.sql (the dual-control RPCs) and lib/gl/project.ts (the
// 2010 Accounts-payable + bill/bill_payment projection).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { Dropdown } from '@/components/Dropdown'
import { AdminModal } from '../AdminModal'
import { useT } from '@/lib/i18n'

const fmtMoney = (n: number | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const newKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.round(Math.random() * 1e9)}`)

type Bill = { id: string; vendor_id: string | null; payee_name: string | null; bill_number: string | null; bill_date: string | null; due_date: string | null; amount: number; fund: string; budget_category_id: string | null; description: string | null; status: string }
type Disb = { id: string; bill_id: string; amount: number; status: string; initiated_by: string; approved_at: string | null; paid_on: string | null; payment_reference: string | null; required_approvals: number }
type Approval = { id: string; disbursement_id: string; approver_id: string }

const EMPTY = { vendor_id: '', payee_name: '', amount: '', bill_date: todayISO(), due_date: '', budget_category_id: '', fund: 'operating', bill_number: '', description: '' }

const BILL_COLS = '104px minmax(0,1.3fr) minmax(0,1fr) 96px minmax(150px,200px) 28px'

export default function PayablesPage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const me = profile?.id
  const { can, canAny, loading: permLoading } = usePermissions()

  const canView = canAny(['financials.view'])
  const canManage = can('financials.manage')
  const canInitiate = can('disbursements.initiate')
  const canApprove = can('disbursements.approve')

  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [disbs, setDisbs] = useState<Disb[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<Disb | null>(null)

  useEffect(() => { if (!msg) return; const x = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(x) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [v, c, b, d, a] = await Promise.all([
        supabase.from('vendors').select('id, name').eq('community_id', communityId).order('name'),
        supabase.from('budget_categories').select('id, name').eq('community_id', communityId).order('sort_order'),
        supabase.from('vendor_bills').select('id, vendor_id, payee_name, bill_number, bill_date, due_date, amount, fund, budget_category_id, description, status').eq('community_id', communityId).order('bill_date', { ascending: false }),
        supabase.from('disbursements').select('id, bill_id, amount, status, initiated_by, approved_at, paid_on, payment_reference, required_approvals').eq('community_id', communityId),
        supabase.from('disbursement_approvals').select('id, disbursement_id, approver_id').eq('community_id', communityId),
      ])
      if (b.error) throw b.error
      setVendors((v.data as any) || [])
      setCats((c.data as any) || [])
      setBills((b.data as any) || [])
      setDisbs((d.data as any) || [])
      setApprovals((a.data as any) || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.payables.errorLoad')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setField = (k: keyof typeof EMPTY, val: string) => setForm(f => ({ ...f, [k]: val }))
  const vendorName = (id: string | null) => vendors.find(v => v.id === id)?.name
  const catName = (id: string | null) => cats.find(c => c.id === id)?.name || '—'
  const payeeOf = (bl: Bill) => vendorName(bl.vendor_id) || bl.payee_name || t('admin.payables.payeeUnknown')
  const activeDisb = (billId: string) => disbs.find(d => d.bill_id === billId && d.status !== 'void') || null
  const approvalsFor = (id: string) => approvals.filter(a => a.disbursement_id === id)

  // ---- summary ----
  const openPayables = useMemo(() => bills.filter(b => b.status === 'open').reduce((s, b) => s + Number(b.amount || 0), 0), [bills])
  const awaitingApproval = disbs.filter(d => d.status === 'initiated').length
  const readyToPay = disbs.filter(d => d.status === 'approved').length

  // ---- capture a bill ----
  const addBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.amount === '' || Number(form.amount) <= 0) { setFormErr(t('admin.payables.errorEnterAmount')); return }
    if (!form.vendor_id && !form.payee_name.trim()) { setFormErr(t('admin.payables.errorEnterPayee')); return }
    setSaving(true); setFormErr('')
    try {
      const fund = form.fund === 'reserve' ? 'reserve' : 'operating'
      const { error } = await supabase!.from('vendor_bills').insert({
        community_id: communityId,
        vendor_id: form.vendor_id || null,
        payee_name: form.vendor_id ? null : form.payee_name.trim(),
        bill_number: form.bill_number.trim() || null,
        bill_date: form.bill_date || todayISO(),
        due_date: form.due_date || null,
        amount: Number(form.amount),
        fund,
        gl_account_code: fund === 'reserve' ? '5010' : '5000',
        budget_category_id: form.budget_category_id || null,
        description: form.description.trim() || null,
        status: 'open',
        created_by: me,
      })
      if (error) throw error
      setForm({ ...EMPTY, bill_date: form.bill_date })
      setMsg(t('admin.payables.billRecorded')); load()
    } catch (err: any) { setFormErr(err?.message || t('admin.payables.errorSaveBill')) }
    finally { setSaving(false) }
  }

  const deleteBill = async (bl: Bill) => {
    if (!confirm(t('admin.payables.confirmDeleteBill'))) return
    setBusyId(bl.id)
    try {
      const { error } = await supabase!.from('vendor_bills').delete().eq('id', bl.id)
      if (error) throw error
      load()
    } catch (err: any) { setError(err?.message || t('admin.payables.errorAction')) }
    finally { setBusyId(null) }
  }

  // ---- dual-control actions (RPCs) ----
  const runRpc = async (key: string, fn: string, args: Record<string, any>, okMsg: string) => {
    setBusyId(key); setError('')
    try {
      const { error } = await supabase!.rpc(fn, args)
      if (error) throw error
      setMsg(okMsg); await load()
    } catch (err: any) { setError(err?.message || t('admin.payables.errorAction')) }
    finally { setBusyId(null) }
  }

  const initiate = (bl: Bill) =>
    runRpc(bl.id, 'disbursement_initiate', { p_bill: bl.id, p_amount: bl.amount, p_method: 'bank_bill_pay', p_idempotency_key: newKey(), p_memo: null }, t('admin.payables.initiatedMsg'))
  const approve = (d: Disb) =>
    runRpc(d.id, 'disbursement_approve', { p_disbursement: d.id }, t('admin.payables.approvedMsg'))
  const voidDisb = (d: Disb) => {
    if (!confirm(t('admin.payables.confirmVoid'))) return
    runRpc(d.id, 'disbursement_void', { p_disbursement: d.id, p_reason: null }, t('admin.payables.voidedMsg'))
  }

  if (!permLoading && !canView) {
    return (
      <div className="admin-page cset">
        <h1 className="admin-h1">{t('admin.payables.pageTitle')}</h1>
        <div className="admin-note admin-note-warn">{t('admin.payables.noAccess')}</div>
      </div>
    )
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">{t('admin.payables.kicker')}</div>
      <h1 className="admin-h1">{t('admin.payables.pageTitle')}</h1>
      <p className="admin-dek">{t('admin.payables.dek')}</p>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.payables.noCommunity')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.payables.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.payables.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Stat label={t('admin.payables.statOpen')} value={fmtMoney(openPayables)} />
            <Stat label={t('admin.payables.statAwaiting')} value={String(awaitingApproval)} accent={awaitingApproval > 0 ? '#B54708' : undefined} />
            <Stat label={t('admin.payables.statReady')} value={String(readyToPay)} accent={readyToPay > 0 ? '#175CD3' : undefined} />
          </div>

          {/* Capture a bill */}
          {canManage && (
            <div className="card">
              <div className="card-head"><div><h2>{t('admin.payables.recordBillHeading')}</h2><div className="sub">{t('admin.payables.recordBillSub')}</div></div></div>
              <form className="admin-form" onSubmit={addBill}>
                <div className="admin-2col">
                  <div className="admin-field">
                    <span className="admin-field-label">{t('admin.payables.fieldVendor')}</span>
                    <Dropdown<string>
                      value={form.vendor_id}
                      onChange={v => setField('vendor_id', v)}
                      ariaLabel={t('admin.payables.fieldVendor')}
                      placeholder={vendors.length ? t('admin.payables.vendorPick') : t('admin.payables.vendorNone')}
                      searchable
                      options={[{ value: '', label: t('admin.payables.vendorOneOff') }, ...vendors.map(v => ({ value: v.id, label: v.name }))]}
                    />
                  </div>
                  {form.vendor_id ? (
                    <label className="admin-field">
                      <span className="admin-field-label">{t('admin.payables.fieldBillNumber')}</span>
                      <input className="admin-input" placeholder="INV-1042" value={form.bill_number} onChange={e => setField('bill_number', e.target.value)} />
                    </label>
                  ) : (
                    <label className="admin-field">
                      <span className="admin-field-label">{t('admin.payables.fieldPayeeName')}</span>
                      <input className="admin-input" placeholder={t('admin.payables.payeePlaceholder')} value={form.payee_name} onChange={e => setField('payee_name', e.target.value)} />
                    </label>
                  )}
                </div>
                <div className="admin-2col">
                  <label className="admin-field">
                    <span className="admin-field-label">{t('admin.payables.fieldAmount')}</span>
                    <div className="admin-input-wrap">
                      <span className="admin-input-prefix">$</span>
                      <input className="admin-input" type="number" placeholder="1200" value={form.amount} onChange={e => setField('amount', e.target.value)} />
                    </div>
                  </label>
                  <label className="admin-field">
                    <span className="admin-field-label">{t('admin.payables.fieldBillDate')}</span>
                    <input className="admin-input" type="date" value={form.bill_date} onChange={e => setField('bill_date', e.target.value)} />
                  </label>
                </div>
                <div className="admin-2col">
                  <label className="admin-field">
                    <span className="admin-field-label">{t('admin.payables.fieldDueDate')}</span>
                    <input className="admin-input" type="date" value={form.due_date} onChange={e => setField('due_date', e.target.value)} />
                  </label>
                  <div className="admin-field">
                    <span className="admin-field-label">{t('admin.payables.fieldFund')}</span>
                    <Dropdown<string>
                      value={form.fund}
                      onChange={v => setField('fund', v)}
                      ariaLabel={t('admin.payables.fieldFund')}
                      options={[{ value: 'operating', label: t('admin.payables.fundOperating') }, { value: 'reserve', label: t('admin.payables.fundReserve') }]}
                    />
                  </div>
                </div>
                <div className="admin-2col">
                  <div className="admin-field">
                    <span className="admin-field-label">{t('admin.payables.fieldCategory')}</span>
                    <Dropdown<string>
                      value={form.budget_category_id}
                      onChange={v => setField('budget_category_id', v)}
                      ariaLabel={t('admin.payables.fieldCategory')}
                      placeholder={cats.length ? t('admin.payables.categoryPick') : t('admin.payables.categoryNone')}
                      searchable
                      options={[{ value: '', label: t('admin.payables.categoryNoneOption') }, ...cats.map(c => ({ value: c.id, label: c.name }))]}
                    />
                  </div>
                  <label className="admin-field">
                    <span className="admin-field-label">{t('admin.payables.fieldDescription')}</span>
                    <input className="admin-input" placeholder={t('admin.payables.descriptionPlaceholder')} value={form.description} onChange={e => setField('description', e.target.value)} />
                  </label>
                </div>
                <div className="admin-form-actions" style={{ justifyContent: 'flex-end' }}>
                  {formErr && <span className="admin-err-inline">{formErr}</span>}
                  <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? t('admin.payables.recording') : t('admin.payables.recordBillBtn')}</button>
                </div>
              </form>
            </div>
          )}

          {/* Bills list */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.payables.billsHeading')}</h2><div className="sub">{t('admin.payables.billsSub', { count: bills.length })}</div></div></div>
            {error && status === 'ready' && <div className="admin-note admin-note-err" style={{ marginTop: 6 }}>{error}</div>}

            {bills.length === 0 ? (
              <div className="bc-empty">{t('admin.payables.emptyState')}</div>
            ) : (
              <div className="bc" style={{ marginTop: 12 }}>
                <div className="bc-row bc-row-head" style={{ gridTemplateColumns: BILL_COLS }}>
                  <span>{t('admin.payables.colDate')}</span><span>{t('admin.payables.colPayee')}</span><span>{t('admin.payables.colStatus')}</span>
                  <span style={{ textAlign: 'right' }}>{t('admin.payables.colAmount')}</span><span>{t('admin.payables.colAction')}</span><span />
                </div>
                {bills.map(bl => {
                  const d = activeDisb(bl.id)
                  const appr = d ? approvalsFor(d.id) : []
                  const iApproved = d ? appr.some(a => a.approver_id === me) : false
                  const iInitiated = d ? d.initiated_by === me : false
                  const busy = busyId === bl.id || (d && busyId === d.id)
                  const state = billState(bl, d)
                  return (
                    <div className="bc-row" key={bl.id} style={{ gridTemplateColumns: BILL_COLS, alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-dim)' }}>{fmtDate(bl.bill_date)}</span>
                      <span style={{ overflow: 'hidden' }}>
                        <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{payeeOf(bl)}</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {catName(bl.budget_category_id)}{bl.due_date ? ` · ${t('admin.payables.due')} ${fmtDate(bl.due_date)}` : ''}
                        </span>
                      </span>
                      <span><Pill state={state} t={t} /></span>
                      <span style={{ fontWeight: 700, textAlign: 'right' }}>{fmtMoney(bl.amount)}</span>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        {/* OPEN → initiate */}
                        {state === 'open' && canInitiate && (
                          <button type="button" className="admin-primary-btn admin-btn-sm" disabled={!!busy} onClick={() => initiate(bl)}>{t('admin.payables.actInitiate')}</button>
                        )}
                        {/* INITIATED → approve (second, distinct signer) */}
                        {state === 'initiated' && d && (
                          canApprove && !iInitiated && !iApproved ? (
                            <button type="button" className="admin-primary-btn admin-btn-sm" disabled={!!busy} onClick={() => approve(d)}>{t('admin.payables.actApprove')}</button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                              {iInitiated ? t('admin.payables.youInitiated') : iApproved ? t('admin.payables.youApproved') : t('admin.payables.needsApprover')}
                            </span>
                          )
                        )}
                        {/* APPROVED → record payment */}
                        {state === 'approved' && d && (canInitiate || canManage) && (
                          <button type="button" className="admin-primary-btn admin-btn-sm" disabled={!!busy} onClick={() => setPayFor(d)}>{t('admin.payables.actRecordPayment')}</button>
                        )}
                        {/* paid → show reference */}
                        {state === 'paid' && (
                          <span style={{ fontSize: 11.5, color: '#067647' }}>{d?.paid_on ? fmtDate(d.paid_on) : ''}{d?.payment_reference ? ` · ${d.payment_reference}` : ''}</span>
                        )}
                        {/* void disbursement (unpaid) */}
                        {(state === 'initiated' || state === 'approved') && d && (canInitiate || canManage) && (
                          <button type="button" className="admin-btn-ghost admin-btn-sm" disabled={!!busy} onClick={() => voidDisb(d)}>{t('admin.payables.actVoid')}</button>
                        )}
                      </span>
                      {/* delete an open bill with no active payment */}
                      {state === 'open' && canManage ? (
                        <button type="button" className="bc-del" disabled={!!busy} onClick={() => deleteBill(bl)} aria-label={t('admin.payables.deleteBillAria')}>&times;</button>
                      ) : <span />}
                    </div>
                  )
                })}
              </div>
            )}
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 14 }}>{t('admin.payables.handoffNote')}</p>
          </div>
        </>
      )}

      {payFor && (
        <RecordPaymentModal
          disb={payFor}
          bill={bills.find(b => b.id === payFor.bill_id)}
          payeeOf={payeeOf}
          onClose={() => setPayFor(null)}
          onDone={(m) => { setPayFor(null); setMsg(m); load() }}
          onError={(m) => setError(m)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card" style={{ margin: 0, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: accent || 'inherit' }}>{value}</div>
    </div>
  )
}

type BillUiState = 'draft' | 'open' | 'initiated' | 'approved' | 'paid' | 'void'
function billState(bl: Bill, d: Disb | null): BillUiState {
  if (bl.status === 'paid') return 'paid'
  if (bl.status === 'void') return 'void'
  if (bl.status === 'draft') return 'draft'
  if (d?.status === 'approved') return 'approved'
  if (d?.status === 'initiated') return 'initiated'
  return 'open'
}

function Pill({ state, t }: { state: BillUiState; t: (k: string) => string }) {
  const map: Record<BillUiState, { label: string; bg: string; fg: string }> = {
    draft:     { label: t('admin.payables.stateDraft'),     bg: 'rgba(0,0,0,0.06)', fg: 'var(--text-dim)' },
    open:      { label: t('admin.payables.stateOpen'),      bg: 'rgba(181,71,8,0.12)', fg: '#B54708' },
    initiated: { label: t('admin.payables.stateInitiated'), bg: 'rgba(181,71,8,0.12)', fg: '#B54708' },
    approved:  { label: t('admin.payables.stateApproved'),  bg: 'rgba(23,92,211,0.12)', fg: '#175CD3' },
    paid:      { label: t('admin.payables.statePaid'),      bg: 'rgba(6,118,71,0.12)', fg: '#067647' },
    void:      { label: t('admin.payables.stateVoid'),      bg: 'rgba(0,0,0,0.06)', fg: 'var(--text-dim)' },
  }
  const s = map[state]
  return <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{s.label}</span>
}

function RecordPaymentModal({ disb, bill, payeeOf, onClose, onDone, onError }: {
  disb: Disb
  bill: Bill | undefined
  payeeOf: (b: Bill) => string
  onClose: () => void
  onDone: (m: string) => void
  onError: (m: string) => void
}) {
  const t = useT()
  const [paidOn, setPaidOn] = useState(todayISO())
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { error } = await supabase!.rpc('disbursement_record_payment', { p_disbursement: disb.id, p_paid_on: paidOn || todayISO(), p_reference: reference.trim() || null })
      if (error) throw error
      onDone(t('admin.payables.paidMsg'))
    } catch (err: any) { onError(err?.message || t('admin.payables.errorAction')); setBusy(false) }
  }

  return (
    <AdminModal title={t('admin.payables.payModalTitle')} sub={bill ? `${payeeOf(bill)} · ${fmtMoney(bill.amount)}` : undefined} onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 6px' }}>{t('admin.payables.payModalHint')}</p>
        <div className="admin-2col">
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.payables.fieldPaidOn')}</span>
            <input className="admin-input" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
          </label>
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.payables.fieldReference')}</span>
            <input className="admin-input" placeholder={t('admin.payables.referencePlaceholder')} value={reference} onChange={e => setReference(e.target.value)} />
          </label>
        </div>
        <div className="admin-form-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="admin-btn-ghost" onClick={onClose} disabled={busy}>{t('admin.payables.cancel')}</button>
          <button type="submit" className="admin-primary-btn" disabled={busy}>{busy ? t('admin.payables.recording') : t('admin.payables.confirmPaidBtn')}</button>
        </div>
      </form>
    </AdminModal>
  )
}
