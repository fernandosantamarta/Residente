'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { AdminModal } from '../AdminModal'
import { useT } from '@/lib/i18n'
import {
  type WorkOrder,
  type WorkOrderStatus,
  type Priority,
  PRIORITIES,
  listWorkOrders,
  createWorkOrder,
  updateWorkOrderStatus,
  startPatch,
  completePatch,
  cancelPatch,
} from '@/lib/workOrders'

type Status = 'loading' | 'ready' | 'none' | 'error'

type VendorOption = { id: string; name: string; category: string | null }
type RequestOption = { id: string; subject: string; submitter_name: string | null; submitter_unit: string | null }

const todayPlusDaysLocal = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap' }
}
const STATUS_COLOR: Record<WorkOrderStatus, string> = {
  assigned:    '#175CD3',
  in_progress: '#B54708',
  completed:   '#067647',
  cancelled:   '#475467',
}
const PRIORITY_COLOR: Record<Priority, string> = {
  low:       '#475467',
  normal:    '#175CD3',
  urgent:    '#B54708',
  emergency: '#B42318',
}

const MAX_FILE = 10 * 1024 * 1024 // 10MB

type FormState = {
  title: string
  description: string
  requestId: string
  vendorId: string
  priority: Priority
  estimatedCost: string
  slaDueAt: string
}
const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  requestId: '',
  vendorId: '',
  priority: 'normal',
  estimatedCost: '',
  slaDueAt: '',
}

// Admin → Work orders. The board turns a maintenance issue (or a standalone
// task) into a tracked work order: assign a vendor, set priority + SLA, then
// advance it Assigned → In progress → Completed. Completion records the actual
// cost + notes (and an optional photo).
export default function WorkOrdersAdmin() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id

  const [rows, setRows] = useState<WorkOrder[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [requests, setRequests] = useState<RequestOption[]>([])

  // Filters.
  const [statusFilter, setStatusFilter] = useState<'all' | WorkOrderStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all')
  const [vendorFilter, setVendorFilter] = useState<'all' | string>('all')

  // New work-order form (modal).
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  // Completion modal.
  const [completing, setCompleting] = useState<WorkOrder | null>(null)
  const [completeActualCost, setCompleteActualCost] = useState('')
  const [completeNotes, setCompleteNotes] = useState('')
  const [completeFile, setCompleteFile] = useState<File | null>(null)
  const [completeErr, setCompleteErr] = useState('')
  const [completeSaving, setCompleteSaving] = useState(false)

  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const vendorName = useCallback(
    (id: string | null) => (id ? vendors.find(v => v.id === id)?.name || t('admin.workOrders.unknownVendor') : t('admin.workOrders.noVendor')),
    [vendors, t],
  )

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const data = await listWorkOrders(communityId)
      setRows(data)
      setStatus('ready')
    } catch (err: any) {
      const msg = err?.message || ''
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setStatus('none')
      } else {
        setError(msg || t('admin.workOrders.errorLoad'))
        setStatus('error')
      }
    }
  }, [communityId, t])
  useEffect(() => { load() }, [load])

  // Live refresh — a vendor status flip or a new work order surfaces without a
  // manual reload. Realtime is optional; focus-refresh is the fallback.
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const ch = supabase
      .channel(`admin-work-orders:${communityId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'work_orders',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      supabase!.removeChannel(ch)
      window.removeEventListener('focus', onFocus)
    }
  }, [communityId, load])

  // Vendor picker + the open-request dropdown (requests not yet resolved).
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase!
          .from('vendors')
          .select('id, name, category')
          .eq('community_id', communityId)
          .order('name', { ascending: true })
        if (!cancelled) setVendors((data || []).map((v: any) => ({ id: v.id, name: v.name, category: v.category ?? null })))
      } catch { /* leave empty */ }
      try {
        const { data } = await supabase!
          .from('resident_requests')
          .select('id, subject, submitter_name, submitter_unit, status')
          .eq('community_id', communityId)
          .neq('status', 'resolved')
          .order('created_at', { ascending: false })
        if (!cancelled) setRequests((data || []).map((r: any) => ({
          id: r.id, subject: r.subject, submitter_name: r.submitter_name ?? null, submitter_unit: r.submitter_unit ?? null,
        })))
      } catch { /* leave empty */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, slaDueAt: todayPlusDaysLocal(7) })
    setFormErr('')
    setShowAdd(true)
  }

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setFormErr(t('admin.workOrders.errTitle')); return }
    if (form.estimatedCost !== '' && (isNaN(Number(form.estimatedCost)) || Number(form.estimatedCost) < 0)) {
      setFormErr(t('admin.workOrders.errCost')); return
    }
    setSaving(true); setFormErr('')
    try {
      await createWorkOrder({
        communityId: communityId!,
        assignedBy: profile?.id ?? null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        requestId: form.requestId || null,
        vendorId: form.vendorId || null,
        priority: form.priority,
        estimatedCost: form.estimatedCost === '' ? null : Number(form.estimatedCost),
        slaDueAt: form.slaDueAt ? new Date(form.slaDueAt).toISOString() : null,
      })
      setShowAdd(false)
      setForm(EMPTY_FORM)
      setSuccessMsg(t('admin.workOrders.successCreated', { title: form.title.trim() }))
      await load()
    } catch (err: any) {
      setFormErr(err?.message || t('admin.workOrders.errCreate'))
    } finally {
      setSaving(false)
    }
  }

  // Advance assigned → in_progress, or cancel. Optimistic with rollback.
  const advance = async (wo: WorkOrder, patchFn: () => any, optimistic: Partial<WorkOrder>, okMsg: string) => {
    const prev = rows
    setRows(rs => rs.map(x => (x.id === wo.id ? { ...x, ...optimistic } : x)))
    try {
      const updated = await updateWorkOrderStatus(wo.id, patchFn())
      setRows(rs => rs.map(x => (x.id === wo.id ? updated : x)))
      setSuccessMsg(okMsg)
    } catch (err: any) {
      setRows(prev)
      setError(err?.message || t('admin.workOrders.errUpdate'))
    }
  }

  const startWork = (wo: WorkOrder) =>
    advance(wo, startPatch, { status: 'in_progress', started_at: new Date().toISOString() }, t('admin.workOrders.successStarted', { title: wo.title }))

  const cancelWork = (wo: WorkOrder) =>
    advance(wo, cancelPatch, { status: 'cancelled' }, t('admin.workOrders.successCancelled', { title: wo.title }))

  const openComplete = (wo: WorkOrder) => {
    setCompleting(wo)
    setCompleteActualCost(wo.estimated_cost != null ? String(wo.estimated_cost) : '')
    setCompleteNotes('')
    setCompleteFile(null)
    setCompleteErr('')
  }

  const submitComplete = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!completing) return
    if (completeActualCost !== '' && (isNaN(Number(completeActualCost)) || Number(completeActualCost) < 0)) {
      setCompleteErr(t('admin.workOrders.errCost')); return
    }
    if (completeFile && completeFile.size > MAX_FILE) { setCompleteErr(t('admin.workOrders.errPhotoSize')); return }
    setCompleteSaving(true); setCompleteErr('')
    try {
      let photoPath: string | null = null
      let photoName: string | null = null
      if (completeFile && supabase) {
        const ext = completeFile.name.includes('.') ? completeFile.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${communityId}/${completing.id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase.storage.from('request-attachments').upload(path, completeFile)
        if ((up as any).error) throw (up as any).error
        photoPath = path
        photoName = completeFile.name
      }
      const updated = await updateWorkOrderStatus(
        completing.id,
        completePatch({
          actualCost: completeActualCost === '' ? null : Number(completeActualCost),
          notes: completeNotes.trim() || null,
          photoPath,
          photoName,
        }),
      )
      setRows(rs => rs.map(x => (x.id === updated.id ? updated : x)))
      setCompleting(null)
      setSuccessMsg(t('admin.workOrders.successCompleted', { title: updated.title }))
    } catch (err: any) {
      setCompleteErr(err?.message || t('admin.workOrders.errUpdate'))
    } finally {
      setCompleteSaving(false)
    }
  }

  const openPhoto = async (path: string) => {
    if (!supabase) return
    try {
      const { data } = await supabase.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  // Translated labels (hook-safe, inside the component).
  const statusLabel: Record<WorkOrderStatus, string> = {
    assigned:    t('admin.workOrders.statusAssigned'),
    in_progress: t('admin.workOrders.statusInProgress'),
    completed:   t('admin.workOrders.statusCompleted'),
    cancelled:   t('admin.workOrders.statusCancelled'),
  }
  const priorityLabel: Record<Priority, string> = {
    low:       t('admin.workOrders.priorityLow'),
    normal:    t('admin.workOrders.priorityNormal'),
    urgent:    t('admin.workOrders.priorityUrgent'),
    emergency: t('admin.workOrders.priorityEmergency'),
  }

  // Client-side filtering keeps the realtime list in sync without re-querying.
  const shown = useMemo(() => rows.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false
    if (vendorFilter !== 'all' && r.vendor_id !== vendorFilter) return false
    return true
  }), [rows, statusFilter, priorityFilter, vendorFilter])

  const isOverdue = (wo: WorkOrder) =>
    !!wo.sla_due_at && (wo.status === 'assigned' || wo.status === 'in_progress') && new Date(wo.sla_due_at) < new Date()

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">{t('admin.workOrders.kicker')}</div>
      <h1 className="admin-h1">{t('admin.workOrders.heading')}</h1>
      <p className="admin-dek">{t('admin.workOrders.dek')}</p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">{t('admin.workOrders.noCommunityNote')}</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.workOrders.retry')}</button>
        </div>
      )}

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Toolbar — filters + new */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ width: 168 }}>
                <Dropdown<'all' | WorkOrderStatus>
                  value={statusFilter}
                  onChange={setStatusFilter}
                  ariaLabel={t('admin.workOrders.filterStatus')}
                  options={[
                    { value: 'all', label: t('admin.workOrders.allStatuses') },
                    { value: 'assigned', label: statusLabel.assigned },
                    { value: 'in_progress', label: statusLabel.in_progress },
                    { value: 'completed', label: statusLabel.completed },
                    { value: 'cancelled', label: statusLabel.cancelled },
                  ]}
                />
              </div>
              <div style={{ width: 168 }}>
                <Dropdown<'all' | Priority>
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  ariaLabel={t('admin.workOrders.filterPriority')}
                  options={[
                    { value: 'all', label: t('admin.workOrders.allPriorities') },
                    ...PRIORITIES.map(p => ({ value: p, label: priorityLabel[p] })),
                  ]}
                />
              </div>
              <div style={{ width: 180 }}>
                <Dropdown<'all' | string>
                  value={vendorFilter}
                  onChange={setVendorFilter}
                  ariaLabel={t('admin.workOrders.filterVendor')}
                  options={[
                    { value: 'all', label: t('admin.workOrders.allVendors') },
                    ...vendors.map(v => ({ value: v.id, label: v.name })),
                  ]}
                />
              </div>
            </span>
            <button type="button" className="admin-primary-btn" onClick={openAdd}>
              {t('admin.workOrders.newWorkOrder')}
            </button>
          </div>

          {status === 'loading' && <div className="admin-note" style={{ margin: 12 }}>{t('admin.workOrders.loading')}</div>}

          {status === 'ready' && rows.length === 0 && (
            <div style={{ padding: '28px 18px', color: 'var(--text-dim)', fontSize: 13 }}>
              {t('admin.workOrders.emptyAll')}
            </div>
          )}
          {status === 'ready' && rows.length > 0 && shown.length === 0 && (
            <div style={{ padding: '22px 18px', color: 'var(--text-dim)', fontSize: 13 }}>
              {t('admin.workOrders.emptyFiltered')}
            </div>
          )}

          {shown.map(wo => {
            const overdue = isOverdue(wo)
            return (
              <div key={wo.id} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text)' }}>{wo.title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 3 }}>
                      {vendorName(wo.vendor_id)} · {t('admin.workOrders.assignedOn', { date: fmtDate(wo.assigned_at) })}
                      {wo.sla_due_at ? ` · ${t('admin.workOrders.slaDue', { date: fmtDate(wo.sla_due_at) })}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={chip(PRIORITY_COLOR[wo.priority])}>{priorityLabel[wo.priority]}</span>
                    {overdue && <span style={chip('#B42318')}>{t('admin.workOrders.overdue')}</span>}
                    <span style={chip(STATUS_COLOR[wo.status])}>{statusLabel[wo.status]}</span>
                  </div>
                </div>

                {wo.description && (
                  <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 8, whiteSpace: 'pre-wrap' }}>{wo.description}</div>
                )}

                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                  <span>{t('admin.workOrders.estimate')}: <strong style={{ color: 'var(--text)' }}>{fmtMoney(wo.estimated_cost)}</strong></span>
                  {wo.status === 'completed' && (
                    <span>{t('admin.workOrders.actual')}: <strong style={{ color: 'var(--text)' }}>{fmtMoney(wo.actual_cost)}</strong></span>
                  )}
                  {wo.started_at && <span>{t('admin.workOrders.startedAt', { date: fmtDateTime(wo.started_at) })}</span>}
                  {wo.completed_at && <span>{t('admin.workOrders.completedAt', { date: fmtDateTime(wo.completed_at) })}</span>}
                </div>

                {wo.status === 'completed' && (wo.completion_notes || wo.completion_photo_path) && (
                  <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(6,118,71,0.06)', border: '1px solid rgba(6,118,71,0.22)', borderRadius: 6 }}>
                    {wo.completion_notes && <div style={{ fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{wo.completion_notes}</div>}
                    {wo.completion_photo_path && (
                      <button type="button" className="admin-btn-ghost" style={{ marginLeft: 0, marginTop: wo.completion_notes ? 6 : 0 }}
                        onClick={() => openPhoto(wo.completion_photo_path!)}>
                        {wo.completion_photo_name || t('admin.workOrders.viewPhoto')}
                      </button>
                    )}
                  </div>
                )}

                {/* Lifecycle actions */}
                {(wo.status === 'assigned' || wo.status === 'in_progress') && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {wo.status === 'assigned' && (
                      <button type="button" className="admin-primary-btn" onClick={() => startWork(wo)}>
                        {t('admin.workOrders.startWork')}
                      </button>
                    )}
                    {wo.status === 'in_progress' && (
                      <button type="button" className="admin-primary-btn" onClick={() => openComplete(wo)}>
                        {t('admin.workOrders.markComplete')}
                      </button>
                    )}
                    <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0 }} onClick={() => cancelWork(wo)}>
                      {t('admin.workOrders.cancel')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* NEW WORK ORDER */}
      {showAdd && (
        <AdminModal
          title={t('admin.workOrders.newWorkOrder')}
          sub={t('admin.workOrders.newSub')}
          onClose={() => { if (!saving) setShowAdd(false) }}
        >
          <form onSubmit={submitNew} style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelTitle')}</label>
              <input className="admin-input" style={{ width: '100%', boxSizing: 'border-box' }}
                value={form.title} onChange={e => setField('title', e.target.value)}
                placeholder={t('admin.workOrders.titlePlaceholder')} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelDescription')}</label>
              <textarea className="admin-input admin-textarea" rows={3} style={{ width: '100%', boxSizing: 'border-box' }}
                value={form.description} onChange={e => setField('description', e.target.value)}
                placeholder={t('admin.workOrders.descriptionPlaceholder')} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelLinkRequest')}</label>
              <Dropdown<string>
                value={form.requestId}
                onChange={v => setField('requestId', v)}
                ariaLabel={t('admin.workOrders.labelLinkRequest')}
                options={[
                  { value: '', label: t('admin.workOrders.noRequest') },
                  ...requests.map(r => ({
                    value: r.id,
                    label: `${r.subject}${r.submitter_name ? ` · ${r.submitter_name}` : ''}${r.submitter_unit ? ` (${r.submitter_unit})` : ''}`,
                  })),
                ]}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelVendor')}</label>
              <Dropdown<string>
                value={form.vendorId}
                onChange={v => setField('vendorId', v)}
                ariaLabel={t('admin.workOrders.labelVendor')}
                options={[
                  { value: '', label: t('admin.workOrders.noVendorYet') },
                  ...vendors.map(v => ({ value: v.id, label: v.category ? `${v.name} · ${v.category}` : v.name })),
                ]}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelPriority')}</label>
                <Dropdown<Priority>
                  value={form.priority}
                  onChange={v => setField('priority', v)}
                  ariaLabel={t('admin.workOrders.labelPriority')}
                  options={PRIORITIES.map(p => ({ value: p, label: priorityLabel[p] }))}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelEstimate')}</label>
                <input className="admin-input" type="number" min="0" step="0.01" inputMode="decimal" style={{ width: '100%', boxSizing: 'border-box' }}
                  value={form.estimatedCost} onChange={e => setField('estimatedCost', e.target.value)}
                  placeholder="0.00" />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelSla')}</label>
              <input className="admin-input" type="datetime-local" style={{ width: '100%', boxSizing: 'border-box' }}
                value={form.slaDueAt} onChange={e => setField('slaDueAt', e.target.value)} />
            </div>
            {formErr && <div className="admin-note admin-note-err">{formErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" onClick={() => setShowAdd(false)} disabled={saving}>{t('admin.workOrders.cancel')}</button>
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? t('admin.workOrders.saving') : t('admin.workOrders.create')}
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* COMPLETE WORK ORDER */}
      {completing && (
        <AdminModal
          title={t('admin.workOrders.completeTitle')}
          sub={completing.title}
          onClose={() => { if (!completeSaving) setCompleting(null) }}
        >
          <form onSubmit={submitComplete} style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelActualCost')}</label>
              <input className="admin-input" type="number" min="0" step="0.01" inputMode="decimal" style={{ width: '100%', boxSizing: 'border-box' }}
                value={completeActualCost} onChange={e => setCompleteActualCost(e.target.value)}
                placeholder="0.00" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.workOrders.labelCompletionNotes')}</label>
              <textarea className="admin-input admin-textarea" rows={3} style={{ width: '100%', boxSizing: 'border-box' }}
                value={completeNotes} onChange={e => setCompleteNotes(e.target.value)}
                placeholder={t('admin.workOrders.completionNotesPlaceholder')} />
            </div>
            <div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#E14909' }}>
                <input type="file" accept="image/*" hidden onChange={e => setCompleteFile(e.target.files?.[0] || null)} />
                {completeFile ? completeFile.name : t('admin.workOrders.attachPhoto')}
              </label>
            </div>
            {completeErr && <div className="admin-note admin-note-err">{completeErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" onClick={() => setCompleting(null)} disabled={completeSaving}>{t('admin.workOrders.cancel')}</button>
              <button type="submit" className="admin-primary-btn" disabled={completeSaving}>
                {completeSaving ? t('admin.workOrders.saving') : t('admin.workOrders.markComplete')}
              </button>
            </div>
          </form>
        </AdminModal>
      )}
    </div>
  )
}
