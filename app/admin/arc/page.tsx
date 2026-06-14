'use client'

// Architectural review (ARC) workspace — FS 720.3035 (HOA architectural
// authority) and FS 718.113(2) (condo material alterations). Tracks owner ARC
// applications against the response deadline; a missed deadline may constitute
// a DEEMED APPROVAL where the governing documents so provide. Advisory only —
// every decision stays with the board.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate } from '@/lib/compliance/rules-core'
import {
  arcResponseDeadline,
  arcResponseDays,
  ARC_TYPE_LABELS,
  ARC_STATUS_LABELS,
  ARC_STATUS_DESC,
  MATERIAL_ALTERATION_APPROVAL_PCT,
  type ArcRequestRow,
  type ArcRequestType,
  type ArcStatus,
} from '@/lib/compliance/arc'
import { logAudit } from '@/lib/audit'
import { Tip } from '@/components/Tip'
import { AttorneyNote } from '../AttorneyNote'
import { EasyVoiceTabs } from '../EasyVoiceTabs'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())

function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}

const OPEN_STATUSES: ArcStatus[] = ['submitted', 'under_review']

export default function ArcPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const t = useT()

  const [community, setCommunity]   = useState<any>(null)
  const [requests, setRequests]     = useState<ArcRequestRow[]>([])
  const [residents, setResidents]   = useState<any[]>([])
  const [status, setStatus]         = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError]           = useState('')
  const [msg, setMsg]               = useState('')

  // Worklist filters + pagination.
  const [catFilter, setCatFilter]       = useState<'all' | ArcRequestType>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ArcStatus>('all')
  const [listPage, setListPage]         = useState(0)
  const LIST_PAGE = 8

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 4000)
    return () => clearTimeout(t)
  }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const grab = async (table: string, order?: string) => {
        try {
          let q = supabase.from(table).select('*').eq('community_id', communityId)
          if (order) q = q.order(order, { ascending: false })
          const { data, error } = (await withTimeout(q)) as any
          if (error) return []
          return data || []
        } catch { return [] }
      }

      // Fire every read in ONE parallel batch instead of awaiting three round-trips
      // in series — these queries are independent, so the page now waits for the
      // slowest single query rather than the sum. The arc-request read keeps its own
      // tolerant grab() wrapper (returns [] on a missing table) so it never blocks.
      const [cRes, reqRows, resRes] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        grab('ev_arc_requests', 'submitted_at'),
        withTimeout(
          supabase
            .from('residents')
            .select('id, full_name, unit_number, address, profile_id')
            .eq('community_id', communityId)
            .order('unit_number', { ascending: true }),
        ),
      ])
      const { data: c } = cRes as any
      const { data: res } = resRes as any
      setCommunity(c || null)
      setRequests(reqRows)
      setResidents(res || [])

      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.arc.errLoadArc')); setStatus('error')
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  // ---- mutations ----
  const patchRequest = async (id: string, patch: Record<string, any>, ok?: string): Promise<boolean> => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_arc_requests').update(patch).eq('id', id))) as any
      if (error) throw error
      if (ok) setMsg(ok)
      await load()
      return true
    } catch (err: any) { setError(err?.message || t('admin.arc.errUpdateRequest')); return false }
  }

  // Invoke the arc-decision-letter edge function to render the decision letter
  // to a PDF and deliver it to the owner (the function verifies the board
  // caller, builds the PDF from the same shared content as the document page,
  // uploads to the owner's folder, records it, and notifies them). Returns the
  // outcome without touching the page message, so callers can phrase it in
  // context (automatic on a decision vs. an explicit resend).
  const deliverLetter = async (requestId: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { data, error } = (await withTimeout(
        supabase.functions.invoke('arc-decision-letter', { body: { request_id: requestId } }),
        30000,
      )) as any
      if (error) {
        // functions.invoke surfaces a non-2xx as FunctionsHttpError; dig out the
        // JSON {error} the function returns so the board sees a real message.
        let msg = error.message || t('admin.arc.errSendLetter')
        try {
          const ctx = (error as any).context
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json()
            if (body?.error) msg = body.error
          }
        } catch { /* keep the generic message */ }
        return { ok: false, error: msg }
      }
      if (data?.error) return { ok: false, error: data.error }
      try {
        await logAudit({
          community_id: communityId!,
          event_type: 'arc.letter_sent',
          target_type: 'arc_request',
          target_id: requestId,
        })
      } catch { /* audit must not block */ }
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message || t('admin.arc.errSendLetter') }
    }
  }

  const decide = async (r: ArcRequestRow, newStatus: ArcStatus, reason?: string) => {
    const patch: Record<string, any> = { status: newStatus, decided_at: todayYmd() }
    if (reason !== undefined) patch.decision_reason = reason
    const saved = await patchRequest(r.id, patch)
    if (!saved) return
    try {
      await logAudit({
        community_id: communityId!,
        event_type: 'arc.decided',
        target_type: 'arc_request',
        target_id: r.id,
        metadata: { status: newStatus },
      })
    } catch { /* audit must not block */ }

    // Automatically deliver the official decision letter to the resident. The
    // board can still open "Decision letter" to print and mail a paper copy.
    const label = ARC_STATUS_LABELS[newStatus].toLowerCase()
    const sent = await deliverLetter(r.id)
    await load()
    setMsg(sent.ok
      ? t('admin.arc.msgDecidedSent', { label })
      : t('admin.arc.msgDecidedNotSent', { label, detail: sent.error ? ` (${sent.error})` : '' }))
  }

  // Explicit (re)send from the card button.
  const sendLetter = async (r: ArcRequestRow): Promise<boolean> => {
    setError('')
    const sent = await deliverLetter(r.id)
    if (sent.ok) { setMsg(t('admin.arc.msgLetterSent')); await load() }
    else setError(sent.error || t('admin.arc.errSendLetter'))
    return sent.ok
  }

  const withdraw = async (r: ArcRequestRow) => {
    await patchRequest(r.id, { status: 'withdrawn' }, t('admin.arc.msgWithdrawn'))
    try {
      await logAudit({
        community_id: communityId!,
        event_type: 'arc.decided',
        target_type: 'arc_request',
        target_id: r.id,
        metadata: { status: 'withdrawn' },
      })
    } catch { /* audit must not block */ }
  }

  // ---- intake form ----
  const [form, setForm] = useState<any>({
    resident_id: '', request_type: 'exterior_alteration', description: '', is_material_alteration: false,
  })
  const setF = (k: string, val: any) => setForm((f: any) => ({ ...f, [k]: val }))
  const [saving, setSaving] = useState(false)

  const logRequest = async (e: any) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = residents.find(r => r.id === form.resident_id)
      const unit_label = res
        ? `${res.full_name || 'Owner'}${res.unit_number ? ` · ${res.unit_number}` : ''}`.trim()
        : null
      const today = todayYmd()
      const fakeRow: ArcRequestRow = { id: '', submitted_at: today }
      const deadline = arcResponseDeadline(fakeRow, community)
      const insert: Record<string, any> = {
        community_id: communityId,
        resident_id: res?.id ?? null,
        profile_id: res?.profile_id ?? null,
        unit_label,
        request_type: form.request_type,
        description: (form.description || '').trim() || null,
        submitted_at: today,
        response_due_at: deadline ? ymd(deadline) : null,
        status: 'submitted',
        is_material_alteration: !!form.is_material_alteration,
        created_by: profile?.id ?? null,
      }
      const { data: inserted, error } = (await withTimeout(
        supabase.from('ev_arc_requests').insert(insert).select('id').single(),
      )) as any
      if (error) throw error
      try {
        await logAudit({
          community_id: communityId!,
          event_type: 'arc.request_submitted',
          target_type: 'arc_request',
          target_id: inserted?.id ?? null,
        })
      } catch { /* audit must not block */ }
      setForm({ resident_id: '', request_type: 'exterior_alteration', description: '', is_material_alteration: false })
      setMsg(t('admin.arc.msgRequestLogged'))
      load()
    } catch (err: any) { setError(err?.message || t('admin.arc.errLogRequest')) }
    finally { setSaving(false) }
  }

  const isCondo = community?.association_type !== 'hoa'

  // Category (request type) + status filters + pagination over the worklist.
  const catOptions = useMemo(
    () => [
      { value: 'all' as const, label: t('admin.arc.filterAllCategories') },
      ...(Object.entries(ARC_TYPE_LABELS) as [ArcRequestType, string][]).map(([value, label]) => ({ value, label })),
    ],
    [],
  )
  const statusOptions = useMemo(
    () => [
      { value: 'all' as const, label: t('admin.arc.filterAllStatuses') },
      ...(Object.entries(ARC_STATUS_LABELS) as [ArcStatus, string][]).map(([value, label]) => ({ value, label })),
    ],
    [],
  )
  const filtered = useMemo(
    () => requests.filter(r =>
      (catFilter === 'all' || (r.request_type ?? 'other') === catFilter) &&
      (statusFilter === 'all' || (r.status ?? 'submitted') === statusFilter),
    ),
    [requests, catFilter, statusFilter],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE))
  const pg = Math.min(listPage, pageCount - 1)
  const paged = filtered.slice(pg * LIST_PAGE, pg * LIST_PAGE + LIST_PAGE)
  // Back to the first page whenever a filter changes or the list shrinks.
  useEffect(() => { setListPage(0) }, [catFilter, statusFilter])

  // Opening this worklist marks every open ARC request "seen" for this board
  // member — the cards are all on screen, so loading the page is seeing them.
  // The receipt is server-side (board_read_receipts, per member) so the Easy
  // Voice badge clears across devices, not just this browser. The worklist still
  // lists each open request until it's decided; only the nag clears. A new
  // submission (later created_at, no receipt) re-triggers the badge.
  const openArcKey = useMemo(
    () => requests
      .filter(r => OPEN_STATUSES.includes(String(r.status ?? 'submitted') as ArcStatus))
      .map(r => r.id)
      .join(','),
    [requests],
  )
  useEffect(() => {
    if (!hasSupabase || !supabase || !profile?.id || !openArcKey) return
    const ids = openArcKey.split(',')
    ;(async () => {
      try {
        await supabase.from('board_read_receipts').upsert(
          ids.map(id => ({ profile_id: profile.id, item_type: 'arc', item_id: id, read_at: new Date().toISOString() })),
          { onConflict: 'profile_id,item_type,item_id' },
        )
        window.dispatchEvent(new Event('board-read'))
      } catch { /* receipts table may not exist yet — non-fatal */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openArcKey, profile?.id])

  return (
    <div className="admin-page cset">
      <EasyVoiceTabs active="architectural" />
      <div className="admin-kicker" style={{ marginTop: 18 }}>{t('admin.arc.kicker')}</div>
      <h1 className="admin-h1">{t('admin.arc.heading')}</h1>
      <p className="admin-dek">
        {t('admin.arc.dek', { days: String(arcResponseDays(community)) })}
      </p>

      <AttorneyNote />

      {community?.arc_deemed_approval && (
        <div className="admin-note admin-note-warn" style={{ fontWeight: 600, fontSize: 13 }}>
          {t('admin.arc.deemedApprovalWarn', { days: String(arcResponseDays(community)) })}
        </div>
      )}

      {msg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden>✓</span>{msg}
        </div>
      )}
      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          {t('admin.arc.noCommunity')}
        </div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.arc.retry')}</button>
        </div>
      )}
      {status === 'loading' && <div className="admin-note">{t('admin.arc.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* ---- Log a request ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.arc.logCardHeading')}</h2></div></div>
            <form className="admin-form" onSubmit={logRequest}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.arc.fieldOwner')}</span>
                  <select className="admin-input" value={form.resident_id} onChange={e => setF('resident_id', e.target.value)}>
                    <option value="">{t('admin.arc.selectPlaceholder')}</option>
                    {residents.map(r => (
                      <option key={r.id} value={r.id}>
                        {[r.full_name || 'Owner', r.unit_number ? `${t('admin.arc.unitPrefix')} ${r.unit_number}` : null, r.address].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.arc.fieldRequestType')}</span>
                  <select className="admin-input" value={form.request_type} onChange={e => setF('request_type', e.target.value)}>
                    {(Object.entries(ARC_TYPE_LABELS) as [ArcRequestType, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="admin-field" style={{ marginTop: 10 }}>
                <span className="admin-field-label">{t('admin.arc.fieldDescription')}</span>
                <textarea
                  className="admin-input" rows={3}
                  value={form.description}
                  placeholder={t('admin.arc.descriptionPlaceholder')}
                  onChange={e => setF('description', e.target.value)}
                />
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '10px 0' }}>
                <input
                  type="checkbox"
                  checked={!!form.is_material_alteration}
                  onChange={e => setF('is_material_alteration', e.target.checked)}
                />
                {t('admin.arc.materialAlterationLabel')}
                {isCondo && (
                  <span style={{ fontSize: 12, color: '#B54708', marginLeft: 4 }}>
                    {t('admin.arc.condoMaterialNote', { pct: String(community?.material_alteration_threshold_pct || MATERIAL_ALTERATION_APPROVAL_PCT.value) })}
                  </span>
                )}
              </label>
              <div className="card-cta">
                {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
                <button
                  type="submit" className="admin-primary-btn"
                  disabled={saving || !form.resident_id}
                >
                  {saving ? t('admin.arc.saving') : t('admin.arc.logRequestBtn')}
                </button>
              </div>
            </form>
          </div>

          {/* ---- Worklist ---- */}
          <div className="card">
            <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div><h2>{t('admin.arc.worklistHeading')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({filtered.length})</span></h2></div>
              {requests.length > 0 && (
                // Native <select>s styled with admin-input — the same control the
                // intake form on this page already renders. Two filters: request
                // type ("All categories") and status ("All statuses").
                <div className="arc-filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    className="admin-input"
                    style={{ width: 220, flexShrink: 0 }}
                    value={catFilter}
                    onChange={e => setCatFilter(e.target.value as 'all' | ArcRequestType)}
                    aria-label={t('admin.arc.ariaFilterCategory')}
                  >
                    {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select
                    className="admin-input"
                    style={{ width: 220, flexShrink: 0 }}
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as 'all' | ArcStatus)}
                    aria-label={t('admin.arc.ariaFilterStatus')}
                  >
                    {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
            </div>
            {requests.length === 0 && (
              <div className="admin-note">{t('admin.arc.emptyNoRequests')}</div>
            )}
            {requests.length > 0 && filtered.length === 0 && (
              <div className="admin-note">{t('admin.arc.emptyNoFiltered')}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {paged.map(r => (
                <ArcRequestCard
                  key={r.id}
                  r={r}
                  community={community}
                  isCondo={isCondo}
                  onDecide={decide}
                  onWithdraw={withdraw}
                  onSendLetter={sendLetter}
                />
              ))}
            </div>
            {pageCount > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button type="button" className="admin-btn-ghost" style={{ marginLeft: 0 }}
                  onClick={() => setListPage(p => Math.max(0, p - 1))} disabled={pg === 0}>{t('admin.arc.pagePrev')}</button>
                <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{pg + 1} / {pageCount}</span>
                <button type="button" className="admin-btn-ghost" style={{ marginLeft: 0 }}
                  onClick={() => setListPage(p => Math.min(pageCount - 1, p + 1))} disabled={pg >= pageCount - 1}>{t('admin.arc.pageNext')}</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Request card with inline decision form
// ----------------------------------------------------------------------------
function ArcRequestCard({
  r, community, isCondo, onDecide, onWithdraw, onSendLetter,
}: {
  r: ArcRequestRow
  community: any
  isCondo: boolean
  onDecide: (r: ArcRequestRow, status: ArcStatus, reason?: string) => Promise<void>
  onWithdraw: (r: ArcRequestRow) => Promise<void>
  onSendLetter: (r: ArcRequestRow) => Promise<boolean>
}) {
  const t = useT()
  const st = String(r.status ?? 'submitted') as ArcStatus
  const isOpen = OPEN_STATUSES.includes(st)
  const isDecided = ['approved', 'approved_with_conditions', 'denied'].includes(st)
  const letterSentAt = r.decision_letter_sent_at
  const deadline = arcResponseDeadline(r, community)
  const today = new Date()

  // Deadline chip color
  let deadlineColor = '#067647'
  if (deadline && isOpen) {
    const ms = deadline.getTime() - today.getTime()
    const days = ms / 86400000
    if (days < 0) deadlineColor = '#B42318'
    else if (days <= 7) deadlineColor = '#B54708'
  }

  // Status chip color
  const STATUS_COLOR: Record<string, string> = {
    submitted: '#175CD3',
    under_review: '#B54708',
    approved: '#067647',
    approved_with_conditions: '#067647',
    denied: '#B42318',
    withdrawn: '#98A2B3',
  }
  const statusColor = STATUS_COLOR[st] || '#475467'

  const [decideMode, setDecideMode] = useState<null | 'approve_conditions' | 'deny'>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [sending, setSending] = useState(false)

  const doSend = async () => {
    setSending(true)
    const sent = await onSendLetter(r)
    setSending(false)
    if (sent) setConfirmSend(false)
  }

  const submit = async (newStatus: ArcStatus) => {
    if (newStatus === 'denied' && !reason.trim()) return
    setBusy(true)
    await onDecide(r, newStatus, reason.trim() || undefined)
    setBusy(false)
    setDecideMode(null)
    setReason('')
  }

  return (
    <div style={{
      border: '1px solid rgba(0,0,0,0.08)',
      borderLeft: `4px solid ${statusColor}`,
      borderRadius: 12,
      padding: '14px 16px',
      background: '#fff',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {r.unit_label || r.id.slice(0, 8)}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            {ARC_TYPE_LABELS[(r.request_type ?? 'other') as ArcRequestType] || r.request_type}
            {r.submitted_at ? ` · ${t('admin.arc.submittedOn')} ${r.submitted_at}` : ''}
            {r.description ? ` · ${r.description}` : ''}
          </div>
          {r.decision_reason && (
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{t('admin.arc.reasonLabel')}: {r.decision_reason}</div>
          )}
          {(r as any).attachment_path && (
            <button type="button" onClick={async () => {
              try {
                const { data } = await supabase.storage.from('request-attachments').createSignedUrl((r as any).attachment_path, 3600)
                if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
              } catch { /* ignore */ }
            }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E14909', font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '6px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" />
              </svg>
              {(r as any).attachment_name || t('admin.arc.viewAttachment')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {isCondo && r.is_material_alteration && (
            <span style={chip('#7C3AED')}>{t('admin.arc.chipMaterialAlteration')}</span>
          )}
          <Tip text={ARC_STATUS_DESC[st] || ''}><span style={chip(statusColor)}>{ARC_STATUS_LABELS[st] || st}</span></Tip>
          {deadline && (
            <span style={chip(deadlineColor)}>
              {t('admin.arc.respondBy')} {ymd(deadline)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {isOpen && (
          <>
            {/* Desktop: individual decision buttons. Mobile: one dropdown (below)
                so the four actions don't cram the card. */}
            <span className="arc-decide-btns">
            <Tip text={`${ARC_STATUS_DESC.approved} ${t('admin.arc.tipApprove')}`}>
              <button
                className="admin-primary-btn"
                disabled={busy}
                onClick={() => { setDecideMode(null); setReason(''); submit('approved') }}
              >
                {busy ? t('admin.arc.sending') : t('admin.arc.btnApproveAndSend')}
              </button>
            </Tip>
            <Tip text={ARC_STATUS_DESC.approved_with_conditions}>
              <button
                className="admin-btn-ghost"
                style={{ marginLeft: 0 }}
                disabled={busy}
                onClick={() => setDecideMode(decideMode === 'approve_conditions' ? null : 'approve_conditions')}
              >
                {t('admin.arc.btnApproveWithConditions')}
              </button>
            </Tip>
            <Tip text={ARC_STATUS_DESC.denied}>
              <button
                className="admin-btn-ghost"
                style={{ marginLeft: 0 }}
                disabled={busy}
                onClick={() => setDecideMode(decideMode === 'deny' ? null : 'deny')}
              >
                {t('admin.arc.btnDeny')}
              </button>
            </Tip>
            <Tip text={ARC_STATUS_DESC.withdrawn}>
              <button
                className="admin-btn-ghost"
                style={{ marginLeft: 0 }}
                disabled={busy}
                onClick={() => onWithdraw(r)}
              >
                {t('admin.arc.btnWithdraw')}
              </button>
            </Tip>
            </span>
            <select
              className="arc-decide-select"
              value=""
              disabled={busy}
              aria-label={t('admin.arc.decisionPlaceholder')}
              onChange={(e) => {
                const v = e.target.value
                e.currentTarget.value = ''
                if (v === 'approved') { setDecideMode(null); setReason(''); submit('approved') }
                else if (v === 'approve_conditions') setDecideMode('approve_conditions')
                else if (v === 'deny') setDecideMode('deny')
                else if (v === 'withdraw') onWithdraw(r)
              }}
            >
              <option value="" disabled>{t('admin.arc.decisionPlaceholder')}</option>
              <option value="approved">{t('admin.arc.btnApproveAndSend')}</option>
              <option value="approve_conditions">{t('admin.arc.btnApproveWithConditions')}</option>
              <option value="deny">{t('admin.arc.btnDeny')}</option>
              <option value="withdraw">{t('admin.arc.btnWithdraw')}</option>
            </select>
          </>
        )}
        {isDecided && (
          <Tip text={t('admin.arc.tipSendLetter')}>
            <button
              className="admin-btn-ghost"
              style={{ marginLeft: 0 }}
              disabled={sending}
              onClick={() => setConfirmSend(s => !s)}
            >
              {letterSentAt ? t('admin.arc.btnResendLetter') : t('admin.arc.btnSendLetter')}
            </button>
          </Tip>
        )}
        {letterSentAt && !confirmSend && (
          <span style={{ fontSize: 12, color: '#067647', fontWeight: 600 }}>
            ✓ {t('admin.arc.letterSentOn')} {ymd(toDate(letterSentAt) || new Date())}
          </span>
        )}

        {/* Draft letter to view + print — pushed to the far right; it's a preview,
            not a decision action. Same-tab nav (admin auth lives in sessionStorage,
            which a new tab doesn't inherit — a fresh tab loses the session). */}
        <div style={{ marginLeft: 'auto' }}>
          <Tip text={t('admin.arc.tipDecisionLetter')}>
            <a
              href={`/admin/arc/${r.id}/document?type=decision`}
              style={{ background: '#0A2440', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" />
              </svg>
              {t('admin.arc.decisionLetterLink')}
            </a>
          </Tip>
        </div>
      </div>

      {/* Send-letter confirm (DRAFT — confirm with counsel) */}
      {confirmSend && (
        <div style={{ border: '1px dashed #d6b8a8', borderRadius: 10, padding: 12, marginTop: 10, background: '#fdf6f1' }}>
          <div style={{ fontSize: 13, color: '#7a4a2b', fontWeight: 600, marginBottom: 4 }}>
            {t('admin.arc.confirmSendTitle', { owner: r.unit_label || t('admin.arc.theOwner') })}
          </div>
          <div style={{ fontSize: 12.5, color: '#8a5a38', marginBottom: 10 }}>
            {t('admin.arc.confirmSendBody')}
            {!r.profile_id && <><br /><strong>{t('admin.arc.noOwnerAccount')}</strong></>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="admin-primary-btn" disabled={sending || !r.profile_id} onClick={doSend}>
              {sending ? t('admin.arc.sending') : letterSentAt ? t('admin.arc.btnResendOfficialLetter') : t('admin.arc.btnSendOfficialLetter')}
            </button>
            <button className="admin-btn-ghost" disabled={sending} onClick={() => setConfirmSend(false)}>
              {t('admin.arc.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Inline reason form */}
      {decideMode && (
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, marginTop: 10 }}>
          <label className="admin-field">
            <span className="admin-field-label">
              {decideMode === 'deny'
                ? t('admin.arc.labelDenialReason')
                : t('admin.arc.labelConditions')}
            </span>
            <textarea
              className="admin-input" rows={3}
              value={reason}
              placeholder={
                decideMode === 'deny'
                  ? t('admin.arc.placeholderDenialReason')
                  : t('admin.arc.placeholderConditions')
              }
              onChange={e => setReason(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              className="admin-primary-btn"
              disabled={busy || (decideMode === 'deny' && !reason.trim())}
              onClick={() => submit(decideMode === 'deny' ? 'denied' : 'approved_with_conditions')}
            >
              {busy ? t('admin.arc.sending') : decideMode === 'deny' ? t('admin.arc.btnDenyAndSend') : t('admin.arc.btnApproveConditionsAndSend')}
            </button>
            <button className="admin-btn-ghost" onClick={() => { setDecideMode(null); setReason('') }}>
              {t('admin.arc.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
