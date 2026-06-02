'use client'

// Architectural review (ARC) workspace — FS 720.3035 (HOA architectural
// authority) and FS 718.113(2) (condo material alterations). Tracks owner ARC
// applications against the response deadline; a missed deadline may constitute
// a DEEMED APPROVAL where the governing documents so provide. Advisory only —
// every decision stays with the board.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import {
  arcResponseDeadline,
  arcResponseDays,
  ARC_TYPE_LABELS,
  ARC_STATUS_LABELS,
  MATERIAL_ALTERATION_APPROVAL_PCT,
  type ArcRequestRow,
  type ArcRequestType,
  type ArcStatus,
} from '@/lib/compliance/arc'
import { logAudit } from '@/lib/audit'

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

  const [community, setCommunity]   = useState<any>(null)
  const [requests, setRequests]     = useState<ArcRequestRow[]>([])
  const [residents, setResidents]   = useState<any[]>([])
  const [status, setStatus]         = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError]           = useState('')
  const [msg, setMsg]               = useState('')

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

      const { data: c } = (await withTimeout(
        supabase.from('communities').select('*').eq('id', communityId).single(),
      )) as any
      setCommunity(c || null)

      setRequests(await grab('ev_arc_requests', 'submitted_at'))

      const { data: res } = (await withTimeout(
        supabase
          .from('residents')
          .select('id, full_name, unit_number, address, profile_id')
          .eq('community_id', communityId)
          .order('unit_number', { ascending: true }),
      )) as any
      setResidents(res || [])

      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load ARC data'); setStatus('error')
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  // ---- mutations ----
  const patchRequest = async (id: string, patch: Record<string, any>, ok?: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_arc_requests').update(patch).eq('id', id))) as any
      if (error) throw error
      if (ok) setMsg(ok)
      await load()
    } catch (err: any) { setError(err?.message || 'Could not update the request') }
  }

  const decide = async (r: ArcRequestRow, newStatus: ArcStatus, reason?: string) => {
    const patch: Record<string, any> = { status: newStatus, decided_at: todayYmd() }
    if (reason !== undefined) patch.decision_reason = reason
    await patchRequest(r.id, patch, `Request ${ARC_STATUS_LABELS[newStatus].toLowerCase()}.`)
    try {
      await logAudit({
        community_id: communityId!,
        event_type: 'arc.decided',
        target_type: 'arc_request',
        target_id: r.id,
        metadata: { status: newStatus },
      })
    } catch { /* audit must not block */ }
  }

  const withdraw = async (r: ArcRequestRow) => {
    await patchRequest(r.id, { status: 'withdrawn' }, 'Request withdrawn.')
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
      setMsg('ARC request logged.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not log the request') }
    finally { setSaving(false) }
  }

  const isCondo = community?.association_type !== 'hoa'

  return (
    <div className="admin-page">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Architectural review</h1>
      <p className="admin-dek">
        Track owner ARC applications and respond within the governing-document window
        ({arcResponseDays(community)} days configured). A written denial must state the specific reason(s).
        Advisory only — every decision stays with the board and the ARC committee.
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>{ATTORNEY_REVIEW_BANNER}</div>

      {community?.arc_deemed_approval && (
        <div className="admin-note admin-note-warn" style={{ fontWeight: 600, fontSize: 13 }}>
          ⚠ Your governing documents provide for DEEMED APPROVAL — if the association does not respond
          within the configured window ({arcResponseDays(community)} days), the request may be
          automatically approved by operation of the governing documents. Respond in writing before the deadline.
        </div>
      )}

      {msg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden>✓</span>{msg}
        </div>
      )}
      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked to your account yet. Run the setup SQL, then reload.
        </div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* ---- Log a request ---- */}
          <form className="admin-form" onSubmit={logRequest} style={{ marginTop: 22 }}>
            <h2 className="bc-title" style={{ marginBottom: 8 }}>Log an ARC request</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label className="admin-field">
                <span className="admin-field-label">Owner (from roster)</span>
                <select className="admin-input" value={form.resident_id} onChange={e => setF('resident_id', e.target.value)}>
                  <option value="">— select —</option>
                  {residents.map(r => (
                    <option key={r.id} value={r.id}>
                      {[r.full_name || 'Owner', r.unit_number ? `Unit ${r.unit_number}` : null, r.address].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Request type</span>
                <select className="admin-input" value={form.request_type} onChange={e => setF('request_type', e.target.value)}>
                  {(Object.entries(ARC_TYPE_LABELS) as [ArcRequestType, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="admin-field" style={{ marginTop: 10 }}>
              <span className="admin-field-label">Description of proposed work</span>
              <textarea
                className="admin-input" rows={3}
                value={form.description}
                placeholder="Describe the alteration, construction, or landscaping work…"
                onChange={e => setF('description', e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '10px 0' }}>
              <input
                type="checkbox"
                checked={!!form.is_material_alteration}
                onChange={e => setF('is_material_alteration', e.target.checked)}
              />
              Material alteration of common elements
              {isCondo && (
                <span style={{ fontSize: 12, color: '#B54708', marginLeft: 4 }}>
                  (condo: may require {community?.material_alteration_threshold_pct || MATERIAL_ALTERATION_APPROVAL_PCT.value}% membership vote — FS 718.113(2))
                </span>
              )}
            </label>
            <div className="admin-form-actions">
              <button
                type="submit" className="admin-primary-btn"
                disabled={saving || !form.resident_id}
              >
                {saving ? 'Saving…' : 'Log request'}
              </button>
              {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          {/* ---- Worklist ---- */}
          <h2 className="bc-title" style={{ margin: '26px 0 10px' }}>
            ARC requests ({requests.length})
          </h2>
          {requests.length === 0 && (
            <div className="admin-note">No ARC requests on file.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {requests.map(r => (
              <ArcRequestCard
                key={r.id}
                r={r}
                community={community}
                isCondo={isCondo}
                onDecide={decide}
                onWithdraw={withdraw}
              />
            ))}
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
  r, community, isCondo, onDecide, onWithdraw,
}: {
  r: ArcRequestRow
  community: any
  isCondo: boolean
  onDecide: (r: ArcRequestRow, status: ArcStatus, reason?: string) => Promise<void>
  onWithdraw: (r: ArcRequestRow) => Promise<void>
}) {
  const st = String(r.status ?? 'submitted') as ArcStatus
  const isOpen = OPEN_STATUSES.includes(st)
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
            {r.submitted_at ? ` · Submitted ${r.submitted_at}` : ''}
            {r.description ? ` · ${r.description}` : ''}
          </div>
          {r.decision_reason && (
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Reason: {r.decision_reason}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {isCondo && r.is_material_alteration && (
            <span style={chip('#7C3AED')}>Material alteration</span>
          )}
          <span style={chip(statusColor)}>{ARC_STATUS_LABELS[st] || st}</span>
          {deadline && (
            <span style={chip(deadlineColor)}>
              Respond by {ymd(deadline)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {isOpen && (
          <>
            <button
              className="admin-primary-btn"
              disabled={busy}
              onClick={() => { setDecideMode(null); setReason(''); submit('approved') }}
            >
              Approve
            </button>
            <button
              className="admin-btn-ghost"
              disabled={busy}
              onClick={() => setDecideMode(decideMode === 'approve_conditions' ? null : 'approve_conditions')}
            >
              Approve w/ conditions
            </button>
            <button
              className="admin-btn-ghost"
              disabled={busy}
              onClick={() => setDecideMode(decideMode === 'deny' ? null : 'deny')}
            >
              Deny
            </button>
            <button
              className="admin-btn-ghost"
              disabled={busy}
              onClick={() => onWithdraw(r)}
            >
              Withdraw
            </button>
          </>
        )}
        <a
          className="admin-btn-ghost"
          href={`/admin/arc/${r.id}/document?type=decision`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Decision letter
        </a>
      </div>

      {/* Inline reason form */}
      {decideMode && (
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, marginTop: 10 }}>
          <label className="admin-field">
            <span className="admin-field-label">
              {decideMode === 'deny'
                ? 'Reason for denial (required — FS 720.3035(3))'
                : 'Conditions of approval'}
            </span>
            <textarea
              className="admin-input" rows={3}
              value={reason}
              placeholder={
                decideMode === 'deny'
                  ? 'State the specific reason(s) for the denial…'
                  : 'Describe the conditions that apply to this approval…'
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
              {busy ? 'Saving…' : decideMode === 'deny' ? 'Record denial' : 'Record approval w/ conditions'}
            </button>
            <button className="admin-btn-ghost" onClick={() => { setDecideMode(null); setReason('') }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
