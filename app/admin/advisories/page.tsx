'use client'

// Niche / event-driven advisories workspace. The board logs the triggering date
// of an event (developer turnover, a receivership notice, an invoice delivery-
// method change, an HOA tiered-report petition) and the dashboard tracks the
// statutory clock; plus a proxy-expiry housekeeping view and standing-right
// reference cards. The date math + advisory signals live in
// lib/compliance/advisories.ts. Nothing here blocks a board action.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import { logAudit } from '@/lib/audit'
import { AttorneyNote } from '../AttorneyNote'
import {
  TURNOVER_CALL_DAYS, TURNOVER_DOC_DELIVERY_DAYS, RECEIVERSHIP_CURE_DAYS,
  INVOICE_DELIVERY_NOTICE_DAYS, TIERED_REPORT_MEETING_DAYS, TIERED_REPORT_PETITION_PCT,
  PROXY_EXPIRY_DAYS, EV_CHARGING_RIGHT_NOTE, PRESUIT_ADR_NOTE,
  staleProxies,
  type ComplianceEventRow, type ComplianceEventKind, type ProxyRow,
} from '@/lib/compliance/advisories'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

// Which event kinds apply to each regime, with labels.
const KIND_META: Record<ComplianceEventKind, { label: string; regime: 'condo' | 'hoa' | 'both'; help: string }> = {
  turnover_trigger:        { label: 'Developer-turnover trigger', regime: 'both', help: 'The date control passed / the turnover threshold was met.' },
  receivership_notice:     { label: 'Receivership notice of intent', regime: 'both', help: 'Date an owner/member served notice of intent to seek a receiver (30-day cure).' },
  invoice_delivery_change: { label: 'Invoice delivery-method change', regime: 'condo', help: 'Date the 30-day notice of a delivery-method change was sent (condo).' },
  tiered_report_petition:  { label: 'Tiered financial-report petition', regime: 'hoa', help: 'Date a 20%-owner petition for a higher report tier was received (HOA).' },
}

export default function AdvisoriesPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [events, setEvents] = useState<ComplianceEventRow[]>([])
  const [proxies, setProxies] = useState<ProxyRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Fire all three reads in ONE parallel batch instead of three serial
      // round-trips — they only depend on communityId, never on each other, so
      // the page now waits for the slowest single query, not their sum.
      // ev_proxies powers the proxy-expiry advisory (read-only).
      const [cRes, eRes, pRes] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        withTimeout(supabase.from('ev_compliance_events').select('*').eq('community_id', communityId).order('event_date', { ascending: false })),
        withTimeout(supabase.from('ev_proxies').select('id, status, type, submitted_at').eq('community_id', communityId)),
      ])
      const { data: c } = cRes as any
      const { data: e, error: eErr } = eRes as any
      const { data: p } = pRes as any
      if (eErr) throw eErr
      setCommunity(c || null)
      setEvents(e || [])
      setProxies(p || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load advisories'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const stale = useMemo(() => staleProxies(proxies), [proxies])
  const kindOptions = useMemo(
    () => (Object.keys(KIND_META) as ComplianceEventKind[]).filter(k => KIND_META[k].regime === 'both' || KIND_META[k].regime === regime),
    [regime],
  )

  // ---------- event intake ----------
  const [form, setForm] = useState<any>({})
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)

  const createEvent = async (e: any) => {
    e.preventDefault()
    if (!form.kind || !form.event_date) { setError('Pick an event type and a date.'); return }
    setSaving(true); setError('')
    try {
      const insert = {
        community_id: communityId,
        kind: form.kind as ComplianceEventKind,
        event_date: form.event_date,
        notes: (form.notes || '').trim() || null,
        created_by: profile?.id ?? null,
      }
      const { data: ins, error } = (await withTimeout(supabase.from('ev_compliance_events').insert(insert).select('id').single())) as any
      if (error) throw error
      if (ins?.id) await logAudit({ community_id: communityId!, event_type: 'advisory.event_recorded', target_type: 'compliance_event', target_id: ins.id, metadata: { kind: insert.kind } })
      setForm({})
      setMsg('Event recorded.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not record the event') }
    finally { setSaving(false) }
  }

  const resolveEvent = async (id: string, resolved: boolean) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_compliance_events').update({ resolved_at: resolved ? ymd(new Date()) : null }).eq('id', id))) as any
      if (error) throw error
      await logAudit({ community_id: communityId!, event_type: 'advisory.event_resolved', target_type: 'compliance_event', target_id: id, metadata: { resolved } })
      load()
    } catch (err: any) { setError(err?.message || 'Could not update the event') }
  }

  const deleteEvent = async (id: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_compliance_events').delete().eq('id', id))) as any
      if (error) throw error
      setMsg('Event removed.'); load()
    } catch (err: any) { setError(err?.message || 'Could not remove the event') }
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Advisories <span className="amp">&</span> event clocks</h1>
      <p className="admin-dek">
        The long tail of Florida duties: developer turnover, board-vacancy receivership, invoice delivery-method
        changes, the HOA tiered-report petition, and proxy expiry. Log the date an event happens and we track the
        statutory clock; the standing rights below are reference only.
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
          {/* Event intake */}
          <div className="card">
            <div className="card-head"><div><h2>Record an event</h2></div></div>
            <form className="admin-form" onSubmit={createEvent}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">Event type</span>
                  <select className="admin-input" value={form.kind ?? ''} onChange={e => setF('kind', e.target.value)}>
                    <option value="">— choose —</option>
                    {kindOptions.map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">Event date</span>
                  <input className="admin-input" type="date" value={form.event_date ?? ''} onChange={e => setF('event_date', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">Notes</span>
                  <input className="admin-input" value={form.notes ?? ''} onChange={e => setF('notes', e.target.value)} /></label>
              </div>
              {form.kind && <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 6 }}>{KIND_META[form.kind as ComplianceEventKind]?.help}</div>}
              <div className="card-cta">
                {error && <span className="admin-err-inline">{error}</span>}
                <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? 'Saving…' : 'Record event'}</button>
              </div>
            </form>
          </div>

          {/* Event list */}
          <div className="card">
            <div className="card-head"><div><h2>Tracked events <span style={{ opacity: 0.55, fontWeight: 400 }}>({events.length})</span></h2></div></div>
            {events.length === 0 && <div className="admin-note">No events recorded. Log a turnover, receivership notice, delivery-method change, or petition above to start a clock.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {events.map(ev => {
              const meta = KIND_META[String(ev.kind) as ComplianceEventKind]
              const resolved = !!ev.resolved_at
              return (
                <div key={ev.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${resolved ? '#067647' : '#C2410C'}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{meta?.label || String(ev.kind)}</div>
                      <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
                        Event {ev.event_date}{resolved ? ` · resolved ${ev.resolved_at}` : ''}{ev.notes ? ` · ${ev.notes}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="admin-btn-ghost" onClick={() => resolveEvent(ev.id, !resolved)}>{resolved ? 'Reopen' : 'Mark resolved'}</button>
                      <button className="admin-btn-ghost" onClick={() => deleteEvent(ev.id)} style={{ color: '#B42318' }}>Remove</button>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          </div>

          {/* Proxy expiry */}
          <div className="card">
            <div className="card-head"><div><h2>Proxy expiry</h2></div></div>
            <div className="admin-note" style={{ fontSize: 13 }}>
              {stale.length === 0
                ? `No open proxies older than ${PROXY_EXPIRY_DAYS.value} days.`
                : `${stale.length} open prox${stale.length === 1 ? 'y appears' : 'ies appear'} to have expired — a proxy is generally valid only for its meeting and (HOA) expires ${PROXY_EXPIRY_DAYS.value} days after it (FS 720.306(8) / 718.112(2)(b)). Clear or archive them in Easy Voice.`}
            </div>
          </div>

          {/* Standing-right reference */}
          <div className="card">
            <div className="card-head"><div><h2>Standing rights <span className="amp">&</span> processes <span style={{ opacity: 0.55, fontWeight: 400 }}>(reference)</span></h2></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            <RefCard title="Board-vacancy receivership" cite="FS 718.1124 / 720.3053">
              If the board cannot fill vacancies to make a quorum, an owner/member may serve a notice of intent and,
              after a {RECEIVERSHIP_CURE_DAYS.value}-day cure window, petition a circuit court to appoint a receiver.
              There is no notice to the Division. Log the notice date above to track the cure window.
            </RefCard>
            {regime === 'condo' && (
              <RefCard title="EV & natural-gas charging right" cite={EV_CHARGING_RIGHT_NOTE.citation}>
                {EV_CHARGING_RIGHT_NOTE.value}
              </RefCard>
            )}
            {regime === 'hoa' && (
              <RefCard title="No statutory EV-charging right (HOA)" cite="FS 720.3075">
                Unlike condominiums (FS 718.113(8)), Chapter 720 grants HOA owners no statutory EV/natural-gas
                charging-station right — it is governed by the recorded covenants and architectural review.
              </RefCard>
            )}
            <RefCard title="Presuit mediation / arbitration" cite={PRESUIT_ADR_NOTE.citation}>
              {PRESUIT_ADR_NOTE.value} This is a process reminder, not a deadline.
            </RefCard>
            </div>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="card-head"><div><h2>Documents</h2><div className="sub">Generate or view each advisory artifact</div></div></div>
            <div className="wslist">
              {[
                { type: 'turnover_checklist', label: regime === 'hoa' ? 'Developer-turnover document checklist' : 'Turnover transition summary', live: false },
                { type: 'receivership_notice', label: 'Receivership notice of intent', live: false },
                { type: 'mediation_demand', label: 'Presuit mediation demand', live: false },
              ].map(d => {
                const col = d.live ? '#0E7490' : '#7A5AF8'
                return (
                  <Link key={d.type} href={`/admin/advisories/document?type=${d.type}`} className="wsrow">
                    <span className="wsrow-glyph" style={{ color: col, background: col + '18' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                    </span>
                    <div className="wsrow-main">
                      <div className="wsrow-title">{d.label}</div>
                      <div className="wsrow-desc">Draft template</div>
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

function RefCard({ title, cite, children }: { title: string; cite: string; children: any }) {
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: '4px solid #C2410C', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
      <div style={{ fontSize: 11.5, opacity: 0.45, fontFamily: 'monospace', margin: '2px 0 6px' }}>{cite}</div>
      <div style={{ fontSize: 12.5, opacity: 0.78 }}>{children}</div>
    </div>
  )
}
