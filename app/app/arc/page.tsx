'use client'

// Easy Voice — Architectural review (resident self-service). A self-contained
// route (NOT yet wired into the Easy Voice hub tabs / left rail — see the
// one-line wire-up note at the bottom of this file) so it doesn't collide with
// in-progress Easy Voice front-end work. Residents submit an architectural-
// review request for their unit/parcel and track the board's decision; the
// ev_arc_requests "owner submits / owner reads own" RLS + the decision→owner
// personal-notice trigger (supabase/arc.sql) back it. FS 720.3035 / 718.113(2).
//
// Reuses the shared global con-* styles (the Contact form's look) for visual
// consistency; copy is local English for now (no i18n keys added).

import { ReactNode, useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import {
  ARC_TYPE_LABELS, ARC_STATUS_LABELS, ARC_STATUS_DESC, arcResponseDeadline,
  type ArcRequestRow, type ArcRequestType, type ArcStatus,
} from '@/lib/compliance/arc'
import { IconClip } from '../voice/_sections/RequestForm'
import { Tip } from '@/components/Tip'

const withTimeout = (p: any, ms = 10000): Promise<any> =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const shortId = (id: string) => {
  const s = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
  return `#${s.slice(0, 3)}-${s.slice(3, 6)}`
}

// Status → pill color (inline so this route adds no CSS to the shared globals).
const STATUS_COLOR: Record<string, string> = {
  submitted: '#175CD3', under_review: '#B54708',
  approved: '#067647', approved_with_conditions: '#067647',
  denied: '#B42318', withdrawn: '#98A2B3',
}

const TYPES: { value: ArcRequestType; icon: ReactNode }[] = [
  { value: 'exterior_alteration', icon: <Svg><><path d="M3 9 12 3l9 6" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></></Svg> },
  { value: 'new_construction',    icon: <Svg><><path d="M14 6 19 1l4 4-5 5z" /><path d="m17 4-9 9-4 4 1 1 4-4 9-9" /></></Svg> },
  { value: 'landscaping',         icon: <Svg><><path d="M12 22V8" /><path d="M12 8a4 4 0 0 1 4-4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4 4z" /></></Svg> },
  { value: 'other',              icon: <Svg><><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></></Svg> },
]

const MAX_DESC = 800

export default function ArcPage() {
  const { profile } = useAuth() || {}
  const [community, setCommunity] = useState<any>(null)
  const [rows, setRows] = useState<ArcRequestRow[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [type, setType] = useState<ArcRequestType>('exterior_alteration')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const openAttachment = async (path: string) => {
    if (!supabase) return
    try {
      const { data } = await supabase.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      if (profile.community_id) {
        const { data: c } = (await withTimeout(
          supabase.from('communities').select('*').eq('id', profile.community_id).single(),
        )) as any
        setCommunity(c || null)
      }
      const { data, error } = (await withTimeout(
        supabase.from('ev_arc_requests').select('*')
          .eq('profile_id', profile.id).order('submitted_at', { ascending: false }),
      )) as any
      if (error) throw error
      setRows((data as ArcRequestRow[]) || [])
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [profile?.id, profile?.community_id])
  useEffect(() => { load() }, [load])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) { setError('Please describe what you would like to change.'); return }
    // Demo / preview (no session) — confirm the flow reads end to end.
    if (!supabase || !profile?.id || !profile?.community_id) {
      setOk('Request submitted. The board will review it and notify you.')
      setDescription(''); return
    }
    if (file && file.size > 10 * 1024 * 1024) { setError('Attachment must be 10MB or smaller.'); return }
    setSaving(true); setError('')
    try {
      // Optional photo/model of the proposed change — uploaded to the resident's
      // own folder in the shared request-attachments bucket (board can read it).
      let attachmentPath: string | null = null
      let attachmentName: string | null = null
      if (file) {
        const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${profile.community_id}/${profile.id}/${crypto.randomUUID()}.${ext}`
        const up = await withTimeout(supabase.storage.from('request-attachments').upload(path, file), 30000)
        if ((up as any).error) throw (up as any).error
        attachmentPath = path
        attachmentName = file.name
      }
      const unitLabel = `${profile.full_name || 'Owner'}${profile.unit_number ? ` · Unit ${profile.unit_number}` : ''}`.trim()
      const row: Record<string, any> = {
        community_id: profile.community_id,
        profile_id: profile.id,
        unit_label: unitLabel || null,
        request_type: type,
        description: description.trim(),
        status: 'submitted',
      }
      // Only reference the attachment columns when there's a file, so text-only
      // requests still work before arc-attachments.sql is run.
      if (attachmentPath) {
        row.attachment_path = attachmentPath
        row.attachment_name = attachmentName
      }
      const { data, error } = (await withTimeout(
        supabase.from('ev_arc_requests').insert(row).select().single(),
      )) as any
      if (error) throw error
      setRows(rs => [data as ArcRequestRow, ...rs])
      setDescription(''); setType('exterior_alteration'); setFile(null)
      setOk('Request submitted. The board will review it and notify you.')
    } catch (err: any) {
      setError(err?.message || 'Could not submit your request. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <section className="con-wrap ev-section">
      <div className="voice-page-head">
        <h1 className="voice-page-title">Architectural review</h1>
        <p className="voice-page-sub">
          Request approval before altering the exterior of your home, adding a structure, or changing landscaping.
          <br />
          The board reviews each request and will notify you of its decision.
        </p>
      </div>

      <div className="con-grid">
        {/* LEFT — submit a request */}
        <section className="con-card con-form-card">
          <h2 className="con-card-title">Submit a request</h2>
          <form onSubmit={submit}>
            <div className="con-field">
              <span className="con-label">Type of change</span>
              <div className="con-cats">
                {TYPES.map(c => (
                  <button
                    key={c.value} type="button"
                    className={`con-cat${type === c.value ? ' on' : ''}`}
                    onClick={() => setType(c.value)}
                    aria-pressed={type === c.value}
                  >
                    <span className="con-cat-ic">{c.icon}</span>
                    <span className="con-cat-label">{ARC_TYPE_LABELS[c.value]}</span>
                    <span className="con-cat-radio" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <div className="con-field">
              <label className="con-label" htmlFor="arc-desc">What would you like to change?</label>
              <textarea id="arc-desc" className="con-input con-textarea" rows={5} maxLength={MAX_DESC}
                value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Describe the proposed change — materials, colors, dimensions, location." />
              <div className="con-count">{description.length} / {MAX_DESC}</div>
            </div>

            <div className="con-attach">
              <label className="con-attach-row">
                <input type="file" hidden accept="image/*,application/pdf"
                  onChange={e => setFile(e.target.files?.[0] || null)} />
                <span className="con-attach-ic"><IconClip /></span>
                <span>
                  <span className="con-attach-title">{file ? file.name : 'Attach a photo or model'}</span>
                  <span className="con-attach-sub">Show the board what you want to change — a photo, sketch, or rendering (image or PDF).</span>
                </span>
              </label>
            </div>

            <button type="submit" className="con-submit" disabled={saving}>
              {saving ? 'Submitting…' : 'Submit request'}
            </button>
            {error && <div className="con-error">{error}</div>}
            {ok && <div className="con-ok">✓ {ok}</div>}
          </form>
        </section>

        {/* RIGHT — request history */}
        <section className="con-card con-list-card">
          <h2 className="con-card-title">Your requests</h2>
          {loading && <div className="con-empty">Loading…</div>}
          {!loading && rows.length === 0 && (
            <div className="con-empty">You haven&apos;t submitted any architectural requests yet.</div>
          )}
          {!loading && rows.map(r => {
            const open = expandedId === r.id
            const status = String(r.status ?? 'submitted') as ArcStatus
            const color = STATUS_COLOR[status] || '#475467'
            const decided = ['approved', 'approved_with_conditions', 'denied', 'withdrawn'].includes(status)
            const deadline = !decided ? arcResponseDeadline(r, community) : null
            const toggle = () => setExpandedId(open ? null : r.id)
            return (
              <div key={r.id} style={ROW_WRAP}>
                <div role="button" tabIndex={0} aria-expanded={open} onClick={toggle}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
                  style={ROW}>
                  <div style={{ minWidth: 0 }}>
                    <div style={ROW_TITLE}>
                      {ARC_TYPE_LABELS[(r.request_type ?? 'other') as ArcRequestType]}
                      <span style={{ color: '#E14909', fontWeight: 600, marginLeft: 8, fontSize: 12 }}>{shortId(r.id)}</span>
                    </div>
                    <div style={ROW_META}>Submitted {fmtDate(r.submitted_at)}</div>
                  </div>
                  <Tip text={ARC_STATUS_DESC[status]}><span style={pill(color)}>{ARC_STATUS_LABELS[status]}</span></Tip>
                </div>
                {open && (
                  <div style={{ padding: '0 2px 14px', fontSize: 13, color: '#0A2440' }}>
                    <div style={{ marginBottom: 8 }}>{r.description || <em style={{ color: 'rgba(15,28,46,0.55)' }}>No description</em>}</div>
                    {(r as any).attachment_path && (
                      <button type="button" onClick={() => openAttachment((r as any).attachment_path)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E14909', font: 'inherit', fontSize: 13, fontWeight: 600, padding: '0 0 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" />
                        </svg>
                        {(r as any).attachment_name || 'View attachment'}
                      </button>
                    )}
                    {!decided && deadline && (
                      <div style={ROW_META}>Decision expected by {fmtDate(deadline.toISOString().slice(0, 10))}</div>
                    )}
                    {decided && (
                      <div style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, background: color + '12', color: '#0A2440' }}>
                        {status === 'denied'
                          ? <>Your request was <strong>denied</strong>.{r.decision_reason ? <> Reason: {r.decision_reason}</> : ''}</>
                          : status === 'approved_with_conditions'
                            ? <>Your request was <strong>approved with conditions</strong>.{r.decision_reason ? <> {r.decision_reason}</> : ''}</>
                            : status === 'withdrawn'
                              ? <>This request was withdrawn.</>
                              : <>Your request was <strong>approved</strong>.{r.decision_reason ? <> {r.decision_reason}</> : ''}</>}
                        {r.decided_at && <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'rgba(15,28,46,0.5)' }}>{fmtDate(r.decided_at)}</span>}
                      </div>
                    )}
                    {r.decision_letter_path && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12.5, color: 'rgba(15,28,46,0.6)', marginBottom: 4 }}>
                          The board sent the official decision letter.
                        </div>
                        <button type="button" onClick={() => openAttachment(r.decision_letter_path!)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E14909', font: 'inherit', fontSize: 13, fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
                          </svg>
                          {r.decision_letter_name || 'Download decision letter'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      </div>
    </section>
  )
}

function pill(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }
}

// Self-contained list-row styles (theme colors), so these resident routes don't
// depend on the Contact-tuned con-table grid.
const ROW_WRAP: React.CSSProperties = { borderBottom: '1px solid rgba(15,28,46,0.07)' }
const ROW: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '12px 2px', cursor: 'pointer' }
const ROW_TITLE: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: '#0A2440' }
const ROW_META: React.CSSProperties = { fontSize: 12.5, color: 'rgba(15,28,46,0.6)', marginTop: 2 }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

// ── To wire into the resident UI when your Easy Voice front-end work settles ──
// Left rail (app/app/layout.tsx NAV array): add
//   { href: '/app/arc', label: 'Architectural', icon: <><path d="M3 9 12 3l9 6"/><path d="M5 10v10h14V10"/></> },
// …or surface it as an Easy Voice hub tab (app/app/voice/page.tsx) once that
// file is stable. Until then the page is reachable directly at /app/arc.
