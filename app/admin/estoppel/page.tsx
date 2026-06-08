'use client'

// Estoppel certificate workspace (FS 718.116(8) / 720.30851). Intake a request,
// watch the statutory delivery clock, generate the certificate, and record
// delivery. Advisory posture: when delivery is late the law requires ALL fees
// to be waived — we surface that and zero the fee, but never block the board.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, calendarDaysUntil, businessDaysBetween, toDate, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import {
  estoppelDueAt, estoppelFee, estoppelValidUntil,
  ESTOPPEL_DELIVERY_BUSINESS_DAYS, ESTOPPEL_EXPEDITED_BUSINESS_DAYS,
  type EstoppelRequestRow,
} from '@/lib/compliance/estoppel'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())

const REQUESTOR_TYPES = [
  { value: 'owner', label: 'Owner' },
  { value: 'owner_designee', label: 'Owner designee' },
  { value: 'mortgagee', label: 'Mortgagee' },
  { value: 'mortgagee_designee', label: 'Mortgagee designee' },
]
const DELIVERY_METHODS = [
  { value: 'electronic', label: 'Electronic (30-day validity)' },
  { value: 'hand', label: 'Hand-delivered (30-day validity)' },
  { value: 'mail', label: 'Mailed (35-day validity)' },
]

const STATUS_LABEL: Record<string, string> = {
  new: 'New', in_progress: 'In progress', delivered: 'Delivered',
  fee_waived: 'Delivered (fee waived)', cancelled: 'Cancelled',
}

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

export default function EstoppelPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<EstoppelRequestRow[]>([])
  const [residents, setResidents] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = (await withTimeout(
        supabase.from('ev_estoppel_requests').select('*')
          .eq('community_id', communityId).order('received_at', { ascending: false }),
      )) as any
      if (error) throw error
      const { data: res } = (await withTimeout(
        supabase.from('residents').select('id, full_name, unit_number, address, profile_id')
          .eq('community_id', communityId).order('unit_number', { ascending: true }),
      )) as any
      setResidents(res || [])
      setRows(data || []); setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load estoppel requests'); setStatus('error')
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
        ? `${res.full_name || 'Owner'}${res.unit_number ? ` · Unit ${res.unit_number}` : (res.address ? ` · ${res.address}` : '')}`
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
      setMsg('Estoppel request logged. The statutory clock has started.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not save the request') }
    finally { setSaving(false) }
  }

  const patch = async (id: string, p: any, okMsg: string) => {
    try {
      const { error } = (await withTimeout(supabase.from('ev_estoppel_requests').update(p).eq('id', id))) as any
      if (error) throw error
      setMsg(okMsg); load()
    } catch (err: any) { setError(err?.message || 'Update failed') }
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
    }, late ? 'Delivered late — fees waived per statute.' : 'Marked delivered.')
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Estoppel certificates</h1>
      <p className="admin-dek">
        Issue an estoppel certificate within the statutory window — {ESTOPPEL_DELIVERY_BUSINESS_DAYS.value} business
        days, or {ESTOPPEL_EXPEDITED_BUSINESS_DAYS.value} if expedited. Deliver late and the law requires every fee to be waived.
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>{ATTORNEY_REVIEW_BANNER}</div>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>
      )}

      {/* Intake */}
      <div className="card">
        <div className="card-head"><div><h2>New request</h2><div className="sub">Logging a request starts the statutory delivery clock.</div></div></div>
        <form className="admin-form" onSubmit={create}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <label className="admin-field"><span className="admin-field-label">Unit / owner</span>
              <select className="admin-input" value={form.resident_id ?? ''} onChange={e => setF('resident_id', e.target.value)}>
                <option value="">— select unit / owner —</option>
                {residents.map((r: any) => (
                  <option key={r.id} value={r.id}>{[r.full_name || 'Owner', r.unit_number ? `Unit ${r.unit_number}` : null, r.address].filter(Boolean).join(' · ')}</option>
                ))}
              </select></label>
            <label className="admin-field"><span className="admin-field-label">Requestor name</span>
              <input className="admin-input" value={form.requestor_name ?? ''} placeholder="Sunshine Title Co." onChange={e => setF('requestor_name', e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">Requestor email</span>
              <input className="admin-input" type="email" value={form.requestor_email ?? ''} placeholder="closer@title.com" onChange={e => setF('requestor_email', e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">Requestor type</span>
              <select className="admin-input" value={form.requestor_type} onChange={e => setF('requestor_type', e.target.value)}>
                {REQUESTOR_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label className="admin-field"><span className="admin-field-label">Request method</span>
              <select className="admin-input" value={form.request_method} onChange={e => setF('request_method', e.target.value)}>
                <option value="electronic">Electronic</option><option value="written">Written</option></select></label>
          </div>
          <div style={{ display: 'flex', gap: 20, margin: '12px 0', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={!!form.expedited} onChange={e => setF('expedited', e.target.checked)} /> Expedited (3-day, +{fmt$(estoppelFee({ expedited: true }).expedited)})</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={!!form.delinquent} onChange={e => setF('delinquent', e.target.checked)} /> Owner is delinquent (+{fmt$(estoppelFee({ delinquent: true }).delinquency)})</label>
            <span style={{ fontSize: 14, fontWeight: 700, alignSelf: 'center' }}>
              Fee: {fmt$(estoppelFee({ expedited: !!form.expedited, delinquent: !!form.delinquent }).total)}</span>
          </div>
          <div className="card-cta">
            {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
            <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? 'Saving…' : 'Log request'}</button>
          </div>
        </form>
      </div>

      {/* Worklist */}
      <div className="card">
        <div className="card-head"><div><h2>Open <span className="amp">&</span> recent requests</h2></div></div>
        {status === 'loading' && <div className="admin-note">Loading…</div>}
        {status === 'ready' && rows.length === 0 && <div className="admin-note">No estoppel requests yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => <EstoppelRow key={r.id} r={r} onDeliver={markDelivered} onPatch={patch} communityId={communityId} />)}
        </div>
      </div>
    </div>
  )
}

function EstoppelRow({ r, onDeliver, onPatch, communityId }: any) {
  const due = toDate(r.due_at)
  const open = r.status === 'new' || r.status === 'in_progress'
  const now = new Date()
  const overdue = !!(open && due && toDate(now)!.getTime() > due.getTime())
  const bizLeft = due ? businessDaysBetween(now, due) : null
  const [method, setMethod] = useState('electronic')

  const deadlineChip = !due ? null : overdue
    ? <span style={chip('#B42318')}>Overdue (due {r.due_at})</span>
    : <span style={chip(bizLeft != null && bizLeft <= 2 ? '#B54708' : '#175CD3')}>Due {r.due_at}{bizLeft != null ? ` · ${bizLeft} biz day${bizLeft === 1 ? '' : 's'}` : ''}</span>

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${overdue ? '#B42318' : '#cbd5e1'}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{r.unit_label || '—'} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {r.requestor_name || 'requestor'}</span></div>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>
            Received {r.received_at} · {STATUS_LABEL[r.status as string] || r.status} · Fee {r.fee_waived ? 'WAIVED' : fmt$(r.fee_total)}
            {r.effective_until ? ` · effective through ${r.effective_until}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{deadlineChip}</div>
      </div>

      {overdue && open && (
        <div className="admin-note admin-note-warn" style={{ fontSize: 12, marginTop: 8 }}>
          Past the statutory deadline — when you deliver, all estoppel fees must be waived (FS 718.116(8) / 720.30851).
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <a className="admin-secondary-btn" href={`/admin/estoppel/${r.id}/certificate`} target="_blank" rel="noopener noreferrer">Generate certificate</a>
        {open && (
          <>
            {r.status === 'new' && <button className="admin-btn-ghost" onClick={() => onPatch(r.id, { status: 'in_progress' }, 'Marked in progress.')}>Start</button>}
            <select className="admin-input" style={{ maxWidth: 220 }} value={method} onChange={e => setMethod(e.target.value)}>
              {DELIVERY_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button className="admin-primary-btn" onClick={() => onDeliver(r, method)}>Mark delivered</button>
            <button className="admin-btn-ghost" onClick={() => onPatch(r.id, { status: 'cancelled' }, 'Request cancelled.')}>Cancel</button>
          </>
        )}
      </div>

      {/* Fee & refund tracking — no fee if delivered late (718.116(8)(d) /
          720.30851(4)); refund within 30 days if the closing does not occur
          (718.116(8)(h) / 720.30851(8)). */}
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        {!r.fee_waived && (Number(r.fee_total) || 0) > 0 && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!r.fee_paid} onChange={e => onPatch(r.id, { fee_paid: e.target.checked }, e.target.checked ? 'Fee marked paid.' : 'Fee marked unpaid.')} /> Fee paid
          </label>
        )}
        {!r.closing_cancelled_at
          ? <button className="admin-btn-ghost" onClick={() => onPatch(r.id, { closing_cancelled_at: todayYmd(), refund_due: !!r.fee_paid }, 'Closing marked cancelled — a refund may be due.')}>Closing cancelled</button>
          : <span style={chip('#B54708')}>Closing cancelled {r.closing_cancelled_at}</span>}
        {r.closing_cancelled_at && r.fee_paid && !r.refund_issued_at && (
          <button className="admin-primary-btn" onClick={() => onPatch(r.id, { refund_issued_at: todayYmd(), refund_due: false }, 'Refund recorded.')}>Mark refunded</button>
        )}
        {r.refund_issued_at && <span style={chip('#067647')}>Refunded {r.refund_issued_at}</span>}
      </div>
    </div>
  )
}

function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}
