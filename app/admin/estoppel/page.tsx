'use client'

// Estoppel certificate workspace (FS 718.116(8) / 720.30851). Intake a request,
// watch the statutory delivery clock, generate the certificate, and record
// delivery. Advisory posture: when delivery is late the law requires ALL fees
// to be waived — we surface that and zero the fee, but never block the board.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, calendarDaysUntil, businessDaysBetween, toDate } from '@/lib/compliance/rules-core'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
import { Dropdown } from '@/components/Dropdown'
import {
  estoppelDueAt, estoppelFee, estoppelValidUntil,
  ESTOPPEL_DELIVERY_BUSINESS_DAYS, ESTOPPEL_EXPEDITED_BUSINESS_DAYS,
  type EstoppelRequestRow,
} from '@/lib/compliance/estoppel'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())


const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

export default function EstoppelPage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<EstoppelRequestRow[]>([])
  const [residents, setResidents] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const REQUESTOR_TYPES = [
    { value: 'owner', label: t('admin.estoppel.requestorOwner') },
    { value: 'owner_designee', label: t('admin.estoppel.requestorOwnerDesignee') },
    { value: 'mortgagee', label: t('admin.estoppel.requestorMortgagee') },
    { value: 'mortgagee_designee', label: t('admin.estoppel.requestorMortgageeDesignee') },
  ]
  const DELIVERY_METHODS = [
    { value: 'electronic', label: t('admin.estoppel.deliveryElectronic') },
    { value: 'hand', label: t('admin.estoppel.deliveryHand') },
    { value: 'mail', label: t('admin.estoppel.deliveryMail') },
  ]
  const STATUS_LABEL: Record<string, string> = {
    new: t('admin.estoppel.statusNew'),
    in_progress: t('admin.estoppel.statusInProgress'),
    delivered: t('admin.estoppel.statusDelivered'),
    fee_waived: t('admin.estoppel.statusFeeWaived'),
    cancelled: t('admin.estoppel.statusCancelled'),
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Fire both independent reads in ONE parallel batch instead of awaiting two
      // round-trips in series — the page now waits for the slower single query
      // rather than the sum of both.
      const [reqRes, resRes] = await Promise.all([
        withTimeout(
          supabase.from('ev_estoppel_requests').select('*')
            .eq('community_id', communityId).order('received_at', { ascending: false }),
        ),
        withTimeout(
          supabase.from('residents').select('id, full_name, unit_number, address, profile_id')
            .eq('community_id', communityId).order('unit_number', { ascending: true }),
        ),
      ])
      const { data, error } = reqRes as any
      if (error) throw error
      const { data: res } = resRes as any
      setResidents(res || [])
      setRows(data || []); setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.estoppel.errorLoadRequests')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // ---- intake ----
  const [form, setForm] = useState<any>({ requestor_type: 'owner', request_method: 'electronic', expedited: false, delinquent: false })
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)

  const create = async (e: any) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const received = todayYmd()
      const due = estoppelDueAt(received, !!form.expedited)
      const fee = estoppelFee({ expedited: !!form.expedited, delinquent: !!form.delinquent })
      const res = residents.find((r: any) => r.id === form.resident_id)
      const unitLabel = res
        ? `${res.full_name || t('admin.estoppel.ownerFallback')}${res.unit_number ? ` · ${t('admin.estoppel.unitPrefix')} ${res.unit_number}` : (res.address ? ` · ${res.address}` : '')}`
        : (form.unit_label || '').trim() || null
      const insert = {
        community_id: communityId,
        unit_label: unitLabel,
        resident_id: res?.id ?? null,
        profile_id: res?.profile_id ?? null,
        requestor_name: (form.requestor_name || '').trim() || null,
        requestor_email: (form.requestor_email || '').trim() || null,
        requestor_type: form.requestor_type,
        request_method: form.request_method,
        received_at: received,
        due_at: due ? ymd(due) : null,
        expedited: !!form.expedited,
        delinquent: !!form.delinquent,
        status: 'new',
        fee_base: fee.base,
        fee_expedited: fee.expedited,
        fee_delinquency: fee.delinquency,
        fee_total: fee.total,
        created_by: profile?.id ?? null,
      }
      const { error } = (await withTimeout(supabase.from('ev_estoppel_requests').insert(insert))) as any
      if (error) throw error
      setForm({ requestor_type: 'owner', request_method: 'electronic', expedited: false, delinquent: false })
      setMsg(t('admin.estoppel.msgRequestLogged'))
      load()
    } catch (err: any) { setError(err?.message || t('admin.estoppel.errorSaveRequest')) }
    finally { setSaving(false) }
  }

  const patch = async (id: string, p: any, okMsg: string) => {
    try {
      const { error } = (await withTimeout(supabase.from('ev_estoppel_requests').update(p).eq('id', id))) as any
      if (error) throw error
      setMsg(okMsg); load()
    } catch (err: any) { setError(err?.message || t('admin.estoppel.errorUpdateFailed')) }
  }

  const markDelivered = (r: EstoppelRequestRow, method: string) => {
    const today = todayYmd()
    const due = toDate(r.due_at)
    const late = !!(due && toDate(today)!.getTime() > due.getTime())
    const validUntil = estoppelValidUntil(today, method)
    patch(r.id, {
      status: 'delivered',
      delivery_method: method,
      delivered_at: today,
      effective_until: validUntil ? ymd(validUntil) : null,
      // Late delivery → statute requires ALL fees waived.
      ...(late ? { fee_waived: true, fee_total: 0 } : {}),
    }, late ? t('admin.estoppel.msgDeliveredLate') : t('admin.estoppel.msgMarkedDelivered'))
  }

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.estoppel.kicker')}</div>
      <h1 className="admin-h1">{t('admin.estoppel.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.estoppel.pageDek', { standard: ESTOPPEL_DELIVERY_BUSINESS_DAYS.value, expedited: ESTOPPEL_EXPEDITED_BUSINESS_DAYS.value })}
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">{t('admin.estoppel.noCommunity')}</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.estoppel.retry')}</button></div>
      )}

      {/* Intake */}
      <div className="card">
        <div className="card-head"><div><h2>{t('admin.estoppel.newRequestTitle')}</h2><div className="sub">{t('admin.estoppel.newRequestSub')}</div></div></div>
        <form className="admin-form" onSubmit={create}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="admin-field"><span className="admin-field-label">{t('admin.estoppel.fieldUnitOwner')}</span>
              <Dropdown<string>
                value={form.resident_id ?? ''}
                onChange={v => setF('resident_id', v)}
                ariaLabel={t('admin.estoppel.fieldUnitOwner')}
                options={[
                  { value: '', label: t('admin.estoppel.selectUnitOwner') },
                  ...residents.map((r: any) => ({
                    value: r.id,
                    label: [r.full_name || t('admin.estoppel.ownerFallback'), r.unit_number ? `${t('admin.estoppel.unitPrefix')} ${r.unit_number}` : null, r.address].filter(Boolean).join(' · '),
                  })),
                ]}
              /></div>
            <label className="admin-field"><span className="admin-field-label">{t('admin.estoppel.fieldRequestorName')}</span>
              <input className="admin-input" value={form.requestor_name ?? ''} placeholder="Sunshine Title Co." onChange={e => setF('requestor_name', e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">{t('admin.estoppel.fieldRequestorEmail')}</span>
              <input className="admin-input" type="email" value={form.requestor_email ?? ''} placeholder="closer@title.com" onChange={e => setF('requestor_email', e.target.value)} /></label>
            <div className="admin-field"><span className="admin-field-label">{t('admin.estoppel.fieldRequestorType')}</span>
              <Dropdown<string>
                value={form.requestor_type}
                onChange={v => setF('requestor_type', v)}
                ariaLabel={t('admin.estoppel.fieldRequestorType')}
                options={REQUESTOR_TYPES.map(o => ({ value: o.value, label: o.label }))}
              /></div>
            <div className="admin-field"><span className="admin-field-label">{t('admin.estoppel.fieldRequestMethod')}</span>
              <Dropdown<string>
                value={form.request_method}
                onChange={v => setF('request_method', v)}
                ariaLabel={t('admin.estoppel.fieldRequestMethod')}
                options={[
                  { value: 'electronic', label: t('admin.estoppel.methodElectronic') },
                  { value: 'written', label: t('admin.estoppel.methodWritten') },
                ]}
              /></div>
          </div>
          <div style={{ display: 'flex', gap: 20, margin: '12px 0', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={!!form.expedited} onChange={e => setF('expedited', e.target.checked)} /> {t('admin.estoppel.checkExpedited', { fee: fmt$(estoppelFee({ expedited: true }).expedited) })}</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={!!form.delinquent} onChange={e => setF('delinquent', e.target.checked)} /> {t('admin.estoppel.checkDelinquent', { fee: fmt$(estoppelFee({ delinquent: true }).delinquency) })}</label>
            <span style={{ fontSize: 14, fontWeight: 700, alignSelf: 'center' }}>
              {t('admin.estoppel.feeLabel', { amount: fmt$(estoppelFee({ expedited: !!form.expedited, delinquent: !!form.delinquent }).total) })}</span>
          </div>
          <div className="card-cta">
            {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
            <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? t('admin.estoppel.saving') : t('admin.estoppel.logRequest')}</button>
          </div>
        </form>
      </div>

      {/* Worklist */}
      <div className="card">
        <div className="card-head"><div><h2>{t('admin.estoppel.worklistTitle')}</h2></div></div>
        {status === 'loading' && <div className="admin-note">{t('admin.estoppel.loading')}</div>}
        {status === 'ready' && rows.length === 0 && <div className="admin-note">{t('admin.estoppel.emptyState')}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => <EstoppelRow key={r.id} r={r} onDeliver={markDelivered} onPatch={patch} communityId={communityId} statusLabel={STATUS_LABEL} />)}
        </div>
      </div>
    </div>
  )
}

function EstoppelRow({ r, onDeliver, onPatch, communityId, statusLabel }: any) {
  const t = useT()
  const due = toDate(r.due_at)
  const open = r.status === 'new' || r.status === 'in_progress'
  const now = new Date()
  const overdue = !!(open && due && toDate(now)!.getTime() > due.getTime())
  const bizLeft = due ? businessDaysBetween(now, due) : null
  const [method, setMethod] = useState('electronic')

  const DELIVERY_METHODS = [
    { value: 'electronic', label: t('admin.estoppel.deliveryElectronic') },
    { value: 'hand', label: t('admin.estoppel.deliveryHand') },
    { value: 'mail', label: t('admin.estoppel.deliveryMail') },
  ]

  const deadlineChip = !due ? null : overdue
    ? <span style={chip('#B42318')}>{t('admin.estoppel.chipOverdue', { date: r.due_at })}</span>
    : <span style={chip(bizLeft != null && bizLeft <= 2 ? '#B54708' : '#175CD3')}>{t('admin.estoppel.chipDue', { date: r.due_at })}{bizLeft != null ? ` · ${t('admin.estoppel.bizDays', { count: bizLeft })}` : ''}</span>

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${overdue ? '#B42318' : '#cbd5e1'}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{r.unit_label || '—'} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {r.requestor_name || t('admin.estoppel.requestorFallback')}</span></div>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>
            {t('admin.estoppel.received')} {r.received_at} · {statusLabel[r.status as string] || r.status} · {t('admin.estoppel.feeWord')} {r.fee_waived ? t('admin.estoppel.feeWaived') : fmt$(r.fee_total)}
            {r.effective_until ? ` · ${t('admin.estoppel.effectiveThrough')} ${r.effective_until}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{deadlineChip}</div>
      </div>

      {overdue && open && (
        <div className="admin-note admin-note-warn" style={{ fontSize: 12, marginTop: 8 }}>
          {t('admin.estoppel.overdueWarning')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <a className="admin-secondary-btn" href={`/admin/estoppel/${r.id}/certificate`} target="_blank" rel="noopener noreferrer">{t('admin.estoppel.generateCertificate')}</a>
        {open && (
          <>
            {r.status === 'new' && <button className="admin-btn-ghost" onClick={() => onPatch(r.id, { status: 'in_progress' }, t('admin.estoppel.msgMarkedInProgress'))}>{t('admin.estoppel.start')}</button>}
            <div style={{ width: 220 }}>
              <Dropdown<string>
                value={method}
                onChange={v => setMethod(v)}
                ariaLabel={t('admin.estoppel.markDelivered')}
                options={DELIVERY_METHODS.map(o => ({ value: o.value, label: o.label }))}
              />
            </div>
            <button className="admin-primary-btn" onClick={() => onDeliver(r, method)}>{t('admin.estoppel.markDelivered')}</button>
            <button className="admin-btn-ghost" onClick={() => onPatch(r.id, { status: 'cancelled' }, t('admin.estoppel.msgRequestCancelled'))}>{t('admin.estoppel.cancel')}</button>
          </>
        )}
      </div>

      {/* Fee & refund tracking — no fee if delivered late (718.116(8)(d) /
          720.30851(4)); refund within 30 days if the closing does not occur
          (718.116(8)(h) / 720.30851(8)). */}
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        {!r.fee_waived && (Number(r.fee_total) || 0) > 0 && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!r.fee_paid} onChange={e => onPatch(r.id, { fee_paid: e.target.checked }, e.target.checked ? t('admin.estoppel.msgFeePaid') : t('admin.estoppel.msgFeeUnpaid'))} /> {t('admin.estoppel.feePaid')}
          </label>
        )}
        {!r.closing_cancelled_at
          ? <button className="admin-btn-ghost" onClick={() => onPatch(r.id, { closing_cancelled_at: todayYmd(), refund_due: !!r.fee_paid }, t('admin.estoppel.msgClosingCancelled'))}>{t('admin.estoppel.closingCancelled')}</button>
          : <span style={chip('#B54708')}>{t('admin.estoppel.closingCancelledOn')} {r.closing_cancelled_at}</span>}
        {r.closing_cancelled_at && r.fee_paid && !r.refund_issued_at && (
          <button className="admin-primary-btn" onClick={() => onPatch(r.id, { refund_issued_at: todayYmd(), refund_due: false }, t('admin.estoppel.msgRefundRecorded'))}>{t('admin.estoppel.markRefunded')}</button>
        )}
        {r.refund_issued_at && <span style={chip('#067647')}>{t('admin.estoppel.refundedOn')} {r.refund_issued_at}</span>}
      </div>
    </div>
  )
}

function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}
