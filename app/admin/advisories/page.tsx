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
import { useT } from '@/lib/i18n'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
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
  const t = useT()
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
      setError(err?.message || t('admin.advisories.errorLoad')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const stale = useMemo(() => staleProxies(proxies), [proxies])
  const kindOptions = useMemo(
    () => (Object.keys(KIND_META) as ComplianceEventKind[]).filter(k => KIND_META[k].regime === 'both' || KIND_META[k].regime === regime),
    [regime],
  )

  // Translated KIND_META labels and help strings (hook-safe, inside component)
  const kindLabel: Record<ComplianceEventKind, string> = {
    turnover_trigger:        t('admin.advisories.kindLabelTurnoverTrigger'),
    receivership_notice:     t('admin.advisories.kindLabelReceivership'),
    invoice_delivery_change: t('admin.advisories.kindLabelInvoiceDelivery'),
    tiered_report_petition:  t('admin.advisories.kindLabelTieredReport'),
  }
  const kindHelp: Record<ComplianceEventKind, string> = {
    turnover_trigger:        t('admin.advisories.kindHelpTurnoverTrigger'),
    receivership_notice:     t('admin.advisories.kindHelpReceivership'),
    invoice_delivery_change: t('admin.advisories.kindHelpInvoiceDelivery'),
    tiered_report_petition:  t('admin.advisories.kindHelpTieredReport'),
  }

  // ---------- event intake ----------
  const [form, setForm] = useState<any>({})
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)

  const createEvent = async (e: any) => {
    e.preventDefault()
    if (!form.kind || !form.event_date) { setError(t('admin.advisories.errorPickKindDate')); return }
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
      setMsg(t('admin.advisories.msgEventRecorded'))
      load()
    } catch (err: any) { setError(err?.message || t('admin.advisories.errorRecord')) }
    finally { setSaving(false) }
  }

  const resolveEvent = async (id: string, resolved: boolean) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_compliance_events').update({ resolved_at: resolved ? ymd(new Date()) : null }).eq('id', id))) as any
      if (error) throw error
      await logAudit({ community_id: communityId!, event_type: 'advisory.event_resolved', target_type: 'compliance_event', target_id: id, metadata: { resolved } })
      load()
    } catch (err: any) { setError(err?.message || t('admin.advisories.errorUpdate')) }
  }

  const deleteEvent = async (id: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_compliance_events').delete().eq('id', id))) as any
      if (error) throw error
      setMsg(t('admin.advisories.msgEventRemoved')); load()
    } catch (err: any) { setError(err?.message || t('admin.advisories.errorRemove')) }
  }

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.advisories.kicker')}</div>
      <h1 className="admin-h1">{t('admin.advisories.pageTitle')} <span className="amp">&</span> {t('admin.advisories.pageTitleSuffix')}</h1>
      <p className="admin-dek">
        {t('admin.advisories.pageDek')}
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">{t('admin.advisories.noCommunity')}</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.advisories.retry')}</button></div>
      )}
      {status === 'loading' && <div className="admin-note">{t('admin.advisories.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* Event intake */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.advisories.recordEventHeading')}</h2></div></div>
            <form className="admin-form" onSubmit={createEvent}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">{t('admin.advisories.fieldEventType')}</span>
                  <select className="admin-input" value={form.kind ?? ''} onChange={e => setF('kind', e.target.value)}>
                    <option value="">{t('admin.advisories.selectPlaceholder')}</option>
                    {kindOptions.map(k => <option key={k} value={k}>{kindLabel[k]}</option>)}
                  </select></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.advisories.fieldEventDate')}</span>
                  <input className="admin-input" type="date" value={form.event_date ?? ''} onChange={e => setF('event_date', e.target.value)} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.advisories.fieldNotes')}</span>
                  <input className="admin-input" value={form.notes ?? ''} onChange={e => setF('notes', e.target.value)} /></label>
              </div>
              {form.kind && <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 6 }}>{kindHelp[form.kind as ComplianceEventKind]}</div>}
              <div className="card-cta">
                {error && <span className="admin-err-inline">{error}</span>}
                <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? t('admin.advisories.saving') : t('admin.advisories.recordEventBtn')}</button>
              </div>
            </form>
          </div>

          {/* Event list */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.advisories.trackedEventsHeading')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({events.length})</span></h2></div></div>
            {events.length === 0 && <div className="admin-note">{t('admin.advisories.noEvents')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {events.map(ev => {
              const meta = KIND_META[String(ev.kind) as ComplianceEventKind]
              const resolved = !!ev.resolved_at
              return (
                <div key={ev.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${resolved ? '#067647' : '#C2410C'}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{kindLabel[String(ev.kind) as ComplianceEventKind] || String(ev.kind)}</div>
                      <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>
                        {t('admin.advisories.eventSubtitle', { date: ev.event_date })}{resolved ? ` · ${t('admin.advisories.eventResolved', { date: ev.resolved_at ?? '' })}` : ''}{ev.notes ? ` · ${ev.notes}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="admin-btn-ghost" onClick={() => resolveEvent(ev.id, !resolved)}>{resolved ? t('admin.advisories.reopen') : t('admin.advisories.markResolved')}</button>
                      <button className="admin-btn-ghost" onClick={() => deleteEvent(ev.id)} style={{ color: '#B42318' }}>{t('admin.advisories.remove')}</button>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          </div>

          {/* Proxy expiry */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.advisories.proxyExpiryHeading')}</h2></div></div>
            <div className="admin-note" style={{ fontSize: 13 }}>
              {stale.length === 0
                ? t('admin.advisories.proxyNone', { days: PROXY_EXPIRY_DAYS.value })
                : t('admin.advisories.proxySome', { count: stale.length, days: PROXY_EXPIRY_DAYS.value })}
            </div>
          </div>

          {/* Standing-right reference */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.advisories.standingRightsHeading')} <span className="amp">&</span> {t('admin.advisories.standingRightsSuffix')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({t('admin.advisories.reference')})</span></h2></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            <RefCard title={t('admin.advisories.refReceivership')} cite="FS 718.1124 / 720.3053">
              {t('admin.advisories.refReceivershipBody', { days: RECEIVERSHIP_CURE_DAYS.value })}
            </RefCard>
            {regime === 'condo' && (
              <RefCard title={t('admin.advisories.refEvCondo')} cite={EV_CHARGING_RIGHT_NOTE.citation}>
                {EV_CHARGING_RIGHT_NOTE.value}
              </RefCard>
            )}
            {regime === 'hoa' && (
              <RefCard title={t('admin.advisories.refEvHoa')} cite="FS 720.3075">
                {t('admin.advisories.refEvHoaBody')}
              </RefCard>
            )}
            <RefCard title={t('admin.advisories.refPresuit')} cite={PRESUIT_ADR_NOTE.citation}>
              {PRESUIT_ADR_NOTE.value} {t('admin.advisories.refPresuitSuffix')}
            </RefCard>
            </div>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.advisories.documentsHeading')}</h2><div className="sub">{t('admin.advisories.documentsSub')}</div></div></div>
            <div className="wslist">
              {[
                { type: 'turnover_checklist', label: regime === 'hoa' ? t('admin.advisories.docTurnoverHoa') : t('admin.advisories.docTurnoverCondo'), live: false },
                { type: 'receivership_notice', label: t('admin.advisories.docReceivership'), live: false },
                { type: 'mediation_demand', label: t('admin.advisories.docMediation'), live: false },
              ].map(d => {
                const col = d.live ? '#0E7490' : '#7A5AF8'
                return (
                  <Link key={d.type} href={`/admin/advisories/document?type=${d.type}`} className="wsrow">
                    <span className="wsrow-glyph" style={{ color: col, background: col + '18' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                    </span>
                    <div className="wsrow-main">
                      <div className="wsrow-title">{d.label}</div>
                      <div className="wsrow-desc">{t('admin.advisories.draftTemplate')}</div>
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
