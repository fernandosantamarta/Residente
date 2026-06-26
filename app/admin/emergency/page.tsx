'use client'

// Emergency & on-call console — the board side of Wave 1 item 2.
// Two jobs: (1) keep an ORDERED on-call roster (paged top to bottom; the next
// contact is paged automatically if no one acknowledges in time), and (2) watch
// + respond to live emergencies (acknowledge stops the escalation ladder;
// resolve closes it out). Reports — from a resident or logged here — page the
// on-call board member by in-app bell + push + email. Backed by
// supabase/emergency-dispatch.sql (the RPCs) + /api/cron/emergency-escalation.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { Dropdown } from '@/components/Dropdown'
import { AdminModal } from '../AdminModal'
import { useT } from '@/lib/i18n'

const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}

type OnCall = { id: string; profile_id: string | null; name: string | null; email: string | null; phone: string | null; order_index: number; active: boolean }
type Event = {
  id: string; reported_by: string | null; reporter_name: string | null; category: string; severity: string
  description: string; location: string | null; status: string; escalation_index: number; ack_minutes: number
  last_paged_at: string | null; acknowledged_by: string | null; acknowledged_at: string | null
  resolved_by: string | null; resolved_at: string | null; resolution_notes: string | null; created_at: string
  work_order_id: string | null
}
type Member = { profile_id: string; full_name: string | null; email: string | null; unit_number: string | null }
type Vendor = { id: string; name: string }
type PreVendor = { category: string; vendor_id: string }

const fmtMoney = (n: number | null | undefined) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const CATEGORIES = ['water', 'fire', 'electrical', 'security', 'structural', 'medical', 'other']
const ROSTER_COLS = '44px minmax(0,1.4fr) minmax(0,1fr) 150px 28px'
const EVENT_COLS = '112px minmax(0,1.6fr) 108px minmax(0,1fr) minmax(150px,200px)'
const EMPTY_CONTACT = { profile_id: '', name: '', phone: '', email: '' }

export default function EmergencyPage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const { can, canAny, loading: permLoading } = usePermissions()
  const canView = canAny(['voice.manage'])
  const canManage = can('voice.manage')
  const canMoney = can('financials.manage') || can('community.manage')

  const [contacts, setContacts] = useState<OnCall[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [preVendors, setPreVendors] = useState<PreVendor[]>([])
  const [cap, setCap] = useState('2500')
  const [savingCap, setSavingCap] = useState(false)
  const [dispatchFor, setDispatchFor] = useState<Event | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [cForm, setCForm] = useState(EMPTY_CONTACT)
  const [savingC, setSavingC] = useState(false)
  const [cErr, setCErr] = useState('')

  const [resolveFor, setResolveFor] = useState<Event | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  useEffect(() => { if (!msg) return; const x = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(x) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [oc, ev, mem, ven, pv, comm] = await Promise.all([
        supabase.from('on_call_contacts').select('id, profile_id, name, email, phone, order_index, active').eq('community_id', communityId).order('order_index'),
        supabase.from('emergency_events').select('*').eq('community_id', communityId).order('created_at', { ascending: false }),
        supabase.from('residents').select('profile_id, full_name, email, unit_number').eq('community_id', communityId).not('profile_id', 'is', null).order('full_name'),
        supabase.from('vendors').select('id, name').eq('community_id', communityId).order('name'),
        supabase.from('emergency_vendors').select('category, vendor_id').eq('community_id', communityId),
        supabase.from('communities').select('emergency_spend_cap').eq('id', communityId).single(),
      ])
      if (oc.error) throw oc.error
      setContacts((oc.data as any) || [])
      setEvents((ev.data as any) || [])
      setMembers((mem.data as any) || [])
      setVendors((ven.data as any) || [])
      setPreVendors((pv.data as any) || [])
      if (comm.data && (comm.data as any).emergency_spend_cap != null) setCap(String((comm.data as any).emergency_spend_cap))
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.emergency.errorLoad')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const memberName = (pid: string | null) => {
    if (!pid) return null
    const m = members.find(x => x.profile_id === pid)
    return m ? (m.full_name || m.email || null) : null
  }
  const contactLabel = (c: OnCall) => c.profile_id ? (memberName(c.profile_id) || t('admin.emergency.memberUnknown')) : (c.name || t('admin.emergency.memberUnknown'))
  const vendorName = (id: string | null) => vendors.find(v => v.id === id)?.name || null
  const preVendorFor = (cat: string) => preVendors.find(p => p.category === cat)?.vendor_id || ''

  const saveCap = async () => {
    setSavingCap(true); setError('')
    try {
      const { error } = await supabase!.rpc('emergency_set_cap', { p_cap: Math.max(0, Number(cap) || 0) })
      if (error) throw error
      setMsg(t('admin.emergency.capSaved')); load()
    } catch (err: any) { setError(err?.message || t('admin.emergency.errorAction')) }
    finally { setSavingCap(false) }
  }

  const setPreVendor = async (category: string, vendorId: string) => {
    setError('')
    try {
      if (!vendorId) {
        const { error } = await supabase!.from('emergency_vendors').delete().eq('community_id', communityId).eq('category', category)
        if (error) throw error
      } else {
        const { error } = await supabase!.from('emergency_vendors').upsert(
          { community_id: communityId, category, vendor_id: vendorId, active: true },
          { onConflict: 'community_id,category' },
        )
        if (error) throw error
      }
      load()
    } catch (err: any) { setError(err?.message || t('admin.emergency.errorAction')) }
  }

  const sortedContacts = useMemo(() => [...contacts].sort((a, b) => a.order_index - b.order_index || 0), [contacts])
  const openCount = events.filter(e => e.status === 'open' || e.status === 'acknowledged' || e.status === 'dispatched').filter(e => e.status !== 'resolved').length
  const unacked = events.filter(e => e.status === 'open').length
  const activeContacts = contacts.filter(c => c.active).length

  // ---- roster actions ----
  const addContact = async (e: React.FormEvent) => {
    e.preventDefault()
    const external = !cForm.profile_id
    if (external && !cForm.name.trim() && !cForm.phone.trim()) { setCErr(t('admin.emergency.errorEnterContact')); return }
    setSavingC(true); setCErr('')
    try {
      const nextOrder = contacts.reduce((m, c) => Math.max(m, c.order_index), -1) + 1
      const { error } = await supabase!.from('on_call_contacts').insert({
        community_id: communityId,
        profile_id: cForm.profile_id || null,
        name: external ? (cForm.name.trim() || null) : null,
        phone: cForm.phone.trim() || null,
        email: external ? (cForm.email.trim() || null) : null,
        order_index: nextOrder,
        active: true,
      })
      if (error) throw error
      setCForm(EMPTY_CONTACT); setMsg(t('admin.emergency.contactAdded')); load()
    } catch (err: any) { setCErr(err?.message || t('admin.emergency.errorAddContact')) }
    finally { setSavingC(false) }
  }

  const toggleActive = async (c: OnCall) => {
    setBusyId(c.id); setError('')
    try {
      const { error } = await supabase!.from('on_call_contacts').update({ active: !c.active }).eq('id', c.id)
      if (error) throw error
      load()
    } catch (err: any) { setError(err?.message || t('admin.emergency.errorAction')) }
    finally { setBusyId(null) }
  }

  const removeContact = async (c: OnCall) => {
    if (!confirm(t('admin.emergency.confirmRemoveContact'))) return
    setBusyId(c.id); setError('')
    try {
      const { error } = await supabase!.from('on_call_contacts').delete().eq('id', c.id)
      if (error) throw error
      load()
    } catch (err: any) { setError(err?.message || t('admin.emergency.errorAction')) }
    finally { setBusyId(null) }
  }

  // Swap order_index with the adjacent contact to move it up/down the ladder.
  const move = async (c: OnCall, dir: -1 | 1) => {
    const idx = sortedContacts.findIndex(x => x.id === c.id)
    const other = sortedContacts[idx + dir]
    if (!other) return
    setBusyId(c.id); setError('')
    try {
      const r1 = await supabase!.from('on_call_contacts').update({ order_index: other.order_index }).eq('id', c.id)
      if (r1.error) throw r1.error
      const r2 = await supabase!.from('on_call_contacts').update({ order_index: c.order_index }).eq('id', other.id)
      if (r2.error) throw r2.error
      load()
    } catch (err: any) { setError(err?.message || t('admin.emergency.errorAction')) }
    finally { setBusyId(null) }
  }

  // ---- event actions (RPCs) ----
  const acknowledge = async (ev: Event) => {
    setBusyId(ev.id); setError('')
    try {
      const { error } = await supabase!.rpc('emergency_acknowledge', { p_event: ev.id })
      if (error) throw error
      setMsg(t('admin.emergency.ackedMsg')); load()
    } catch (err: any) { setError(err?.message || t('admin.emergency.errorAction')) }
    finally { setBusyId(null) }
  }

  if (!permLoading && !canView) {
    return (
      <div className="admin-page cset">
        <h1 className="admin-h1">{t('admin.emergency.pageTitle')}</h1>
        <div className="admin-note admin-note-warn">{t('admin.emergency.noAccess')}</div>
      </div>
    )
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">{t('admin.emergency.kicker')}</div>
      <h1 className="admin-h1">{t('admin.emergency.pageTitle')}</h1>
      <p className="admin-dek">{t('admin.emergency.dek')}</p>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.emergency.noCommunity')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.emergency.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.emergency.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Stat label={t('admin.emergency.statOpen')} value={String(openCount)} accent={openCount > 0 ? '#C82E2E' : undefined} />
            <Stat label={t('admin.emergency.statUnacked')} value={String(unacked)} accent={unacked > 0 ? '#B54708' : undefined} />
            <Stat label={t('admin.emergency.statOnCall')} value={String(activeContacts)} accent={activeContacts === 0 ? '#B54708' : undefined} />
          </div>

          {activeContacts === 0 && (
            <div className="admin-note admin-note-warn" style={{ marginBottom: 16 }}>{t('admin.emergency.noRosterWarn')}</div>
          )}

          {/* Emergency authority — spend cap + pre-authorized vendors */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.emergency.authHeading')}</h2><div className="sub">{t('admin.emergency.authSub')}</div></div></div>
            <div className="admin-2col" style={{ marginTop: 6 }}>
              <label className="admin-field">
                <span className="admin-field-label">{t('admin.emergency.capLabel')}</span>
                {canMoney ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div className="admin-input-wrap" style={{ flex: 1 }}>
                      <span className="admin-input-prefix">$</span>
                      <input className="admin-input" type="number" min={0} value={cap} onChange={e => setCap(e.target.value)} />
                    </div>
                    <button type="button" className="admin-primary-btn" disabled={savingCap} onClick={saveCap}>{savingCap ? t('admin.emergency.saving') : t('admin.emergency.save')}</button>
                  </div>
                ) : (
                  <div className="admin-input" style={{ display: 'flex', alignItems: 'center' }}>{fmtMoney(Number(cap))}</div>
                )}
                <span style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4 }}>{Number(cap) > 0 ? t('admin.emergency.capHint', { amount: fmtMoney(Number(cap)) }) : t('admin.emergency.capZeroHint')}</span>
              </label>
            </div>

            <div style={{ marginTop: 14 }}>
              <span className="admin-field-label">{t('admin.emergency.preVendorsLabel')}</span>
              {vendors.length === 0 ? (
                <div className="admin-note" style={{ marginTop: 8 }}>{t('admin.emergency.noVendors')}</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 8 }}>
                  {CATEGORIES.map(c => (
                    <div className="admin-field" key={c}>
                      <span className="admin-field-label" style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{t(`emergency.cat.${c}`)}</span>
                      {canManage ? (
                        <Dropdown<string>
                          value={preVendorFor(c)}
                          onChange={v => setPreVendor(c, v)}
                          ariaLabel={t(`emergency.cat.${c}`)}
                          searchable
                          placeholder={t('admin.emergency.preVendorNone')}
                          options={[{ value: '', label: t('admin.emergency.preVendorNone') }, ...vendors.map(v => ({ value: v.id, label: v.name }))]}
                        />
                      ) : (
                        <div className="admin-input" style={{ display: 'flex', alignItems: 'center' }}>{vendorName(preVendorFor(c)) || t('admin.emergency.preVendorNone')}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* On-call roster */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.emergency.rosterHeading')}</h2><div className="sub">{t('admin.emergency.rosterSub')}</div></div></div>

            {canManage && (
              <form className="admin-form" onSubmit={addContact} style={{ marginTop: 6 }}>
                <div className="admin-2col">
                  <div className="admin-field">
                    <span className="admin-field-label">{t('admin.emergency.fieldMember')}</span>
                    <Dropdown<string>
                      value={cForm.profile_id}
                      onChange={v => setCForm(f => ({ ...f, profile_id: v }))}
                      ariaLabel={t('admin.emergency.fieldMember')}
                      placeholder={members.length ? t('admin.emergency.memberPick') : t('admin.emergency.memberNone')}
                      searchable
                      options={[{ value: '', label: t('admin.emergency.memberExternal') }, ...members.map(m => ({ value: m.profile_id, label: m.full_name || m.email || m.profile_id }))]}
                    />
                  </div>
                  <label className="admin-field">
                    <span className="admin-field-label">{t('admin.emergency.fieldPhone')}</span>
                    <input className="admin-input" value={cForm.phone} onChange={e => setCForm(f => ({ ...f, phone: e.target.value }))} placeholder="(305) 555-0123" />
                  </label>
                </div>
                {!cForm.profile_id && (
                  <div className="admin-2col">
                    <label className="admin-field">
                      <span className="admin-field-label">{t('admin.emergency.fieldName')}</span>
                      <input className="admin-input" value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))} placeholder={t('admin.emergency.namePlaceholder')} />
                    </label>
                    <label className="admin-field">
                      <span className="admin-field-label">{t('admin.emergency.fieldEmail')}</span>
                      <input className="admin-input" value={cForm.email} onChange={e => setCForm(f => ({ ...f, email: e.target.value }))} placeholder="oncall@example.com" />
                    </label>
                  </div>
                )}
                <div className="admin-form-actions" style={{ justifyContent: 'flex-end' }}>
                  {cErr && <span className="admin-err-inline">{cErr}</span>}
                  <button type="submit" className="admin-primary-btn" disabled={savingC}>{savingC ? t('admin.emergency.adding') : t('admin.emergency.addContactBtn')}</button>
                </div>
              </form>
            )}

            {sortedContacts.length === 0 ? (
              <div className="bc-empty">{t('admin.emergency.rosterEmpty')}</div>
            ) : (
              <div className="bc" style={{ marginTop: 12 }}>
                <div className="bc-row bc-row-head" style={{ gridTemplateColumns: ROSTER_COLS }}>
                  <span>#</span><span>{t('admin.emergency.colContact')}</span><span>{t('admin.emergency.colReach')}</span><span>{t('admin.emergency.colActions')}</span><span />
                </div>
                {sortedContacts.map((c, i) => {
                  const busy = busyId === c.id
                  return (
                    <div className="bc-row" key={c.id} style={{ gridTemplateColumns: ROSTER_COLS, alignItems: 'center', opacity: c.active ? 1 : 0.55 }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-dim)' }}>{i + 1}</span>
                      <span style={{ overflow: 'hidden' }}>
                        <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contactLabel(c)}</span>
                        {(c.phone || c.email) && (
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.phone || c.email}</span>
                        )}
                      </span>
                      <span style={{ fontSize: 11.5, color: c.profile_id ? '#067647' : 'var(--text-dim)' }}>
                        {c.profile_id ? t('admin.emergency.reachApp') : t('admin.emergency.reachLogged')}
                      </span>
                      {canManage ? (
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button type="button" className="admin-btn-ghost admin-btn-sm" disabled={busy || i === 0} onClick={() => move(c, -1)} aria-label={t('admin.emergency.moveUp')}>↑</button>
                          <button type="button" className="admin-btn-ghost admin-btn-sm" disabled={busy || i === sortedContacts.length - 1} onClick={() => move(c, 1)} aria-label={t('admin.emergency.moveDown')}>↓</button>
                          <button type="button" className="admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => toggleActive(c)}>{c.active ? t('admin.emergency.activeOff') : t('admin.emergency.activeOn')}</button>
                        </span>
                      ) : <span />}
                      {canManage ? (
                        <button type="button" className="bc-del" disabled={busy} onClick={() => removeContact(c)} aria-label={t('admin.emergency.removeContactAria')}>&times;</button>
                      ) : <span />}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Live event log */}
          <div className="card">
            <div className="card-head">
              <div><h2>{t('admin.emergency.eventsHeading')}</h2><div className="sub">{t('admin.emergency.eventsSub', { count: events.length })}</div></div>
              {canManage && <button type="button" className="admin-btn-ghost admin-btn-sm" onClick={() => setLogOpen(true)}>{t('admin.emergency.logBtn')}</button>}
            </div>
            {error && status === 'ready' && <div className="admin-note admin-note-err" style={{ marginTop: 6 }}>{error}</div>}

            {events.length === 0 ? (
              <div className="bc-empty">{t('admin.emergency.eventsEmpty')}</div>
            ) : (
              <div className="bc" style={{ marginTop: 12 }}>
                <div className="bc-row bc-row-head" style={{ gridTemplateColumns: EVENT_COLS }}>
                  <span>{t('admin.emergency.colWhen')}</span><span>{t('admin.emergency.colWhat')}</span><span>{t('admin.emergency.colStatus')}</span><span>{t('admin.emergency.colReporter')}</span><span>{t('admin.emergency.colAction')}</span>
                </div>
                {events.map(ev => {
                  const busy = busyId === ev.id
                  const reporter = memberName(ev.reported_by) || ev.reporter_name || t('admin.emergency.reporterResident')
                  return (
                    <div className="bc-row" key={ev.id} style={{ gridTemplateColumns: EVENT_COLS, alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{fmtWhen(ev.created_at)}</span>
                      <span style={{ overflow: 'hidden' }}>
                        <span style={{ display: 'block', fontWeight: 600 }}>
                          {t(`emergency.cat.${ev.category}`)}
                          {ev.severity === 'critical' && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: '#C82E2E' }}>{t('admin.emergency.sevCritical')}</span>}
                        </span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ev.location ? `${ev.location} · ` : ''}{ev.description}
                        </span>
                      </span>
                      <span><EventPill status={ev.status} t={t} /></span>
                      <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reporter}</span>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {canManage && ev.status === 'open' && (
                          <button type="button" className="admin-primary-btn admin-btn-sm" disabled={busy} onClick={() => acknowledge(ev)}>{t('admin.emergency.actAcknowledge')}</button>
                        )}
                        {canManage && ev.status !== 'resolved' && !ev.work_order_id && (
                          <button type="button" className="admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setDispatchFor(ev)}>{t('admin.emergency.actDispatch')}</button>
                        )}
                        {ev.work_order_id && <span style={{ fontSize: 11, fontWeight: 700, color: '#175CD3' }}>{t('admin.emergency.dispatchedTag')}</span>}
                        {canManage && ev.status !== 'resolved' && (
                          <button type="button" className="admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setResolveFor(ev)}>{t('admin.emergency.actResolve')}</button>
                        )}
                        {ev.status === 'resolved' && <span style={{ fontSize: 11.5, color: '#067647' }}>{fmtWhen(ev.resolved_at)}</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 14 }}>{t('admin.emergency.footNote')}</p>
          </div>
        </>
      )}

      {resolveFor && (
        <ResolveModal
          ev={resolveFor}
          onClose={() => setResolveFor(null)}
          onDone={(m) => { setResolveFor(null); setMsg(m); load() }}
          onError={(m) => setError(m)}
        />
      )}

      {logOpen && (
        <LogModal
          onClose={() => setLogOpen(false)}
          onDone={(m) => { setLogOpen(false); setMsg(m); load() }}
        />
      )}

      {dispatchFor && (
        <DispatchModal
          ev={dispatchFor}
          vendors={vendors}
          defaultVendor={preVendorFor(dispatchFor.category)}
          cap={Number(cap) || 0}
          onClose={() => setDispatchFor(null)}
          onDone={(m) => { setDispatchFor(null); setMsg(m); load() }}
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

function EventPill({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    open:         { label: t('admin.emergency.stOpen'),         bg: 'rgba(200,46,46,0.12)', fg: '#C82E2E' },
    acknowledged: { label: t('admin.emergency.stAcknowledged'), bg: 'rgba(181,71,8,0.12)', fg: '#B54708' },
    dispatched:   { label: t('admin.emergency.stDispatched'),   bg: 'rgba(23,92,211,0.12)', fg: '#175CD3' },
    resolved:     { label: t('admin.emergency.stResolved'),     bg: 'rgba(6,118,71,0.12)', fg: '#067647' },
  }
  const s = map[status] || map.open
  return <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{s.label}</span>
}

function ResolveModal({ ev, onClose, onDone, onError }: { ev: Event; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const t = useT()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const { error } = await supabase!.rpc('emergency_resolve', { p_event: ev.id, p_notes: notes.trim() || null })
      if (error) throw error
      onDone(t('admin.emergency.resolvedMsg'))
    } catch (err: any) { onError(err?.message || t('admin.emergency.errorAction')); setBusy(false) }
  }
  return (
    <AdminModal title={t('admin.emergency.resolveTitle')} sub={t(`emergency.cat.${ev.category}`)} onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 6px' }}>{t('admin.emergency.resolveHint')}</p>
        <label className="admin-field">
          <span className="admin-field-label">{t('admin.emergency.fieldNotes')}</span>
          <textarea className="admin-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('admin.emergency.notesPlaceholder')} />
        </label>
        <div className="admin-form-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="admin-btn-ghost" onClick={onClose} disabled={busy}>{t('admin.emergency.cancel')}</button>
          <button type="submit" className="admin-primary-btn" disabled={busy}>{busy ? t('admin.emergency.resolving') : t('admin.emergency.confirmResolveBtn')}</button>
        </div>
      </form>
    </AdminModal>
  )
}

function LogModal({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const t = useT()
  const [category, setCategory] = useState('other')
  const [severity, setSeverity] = useState('urgent')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [ackMin, setAckMin] = useState('15')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) { setErr(t('admin.emergency.errorDesc')); return }
    setBusy(true); setErr('')
    try {
      const { error } = await supabase!.rpc('emergency_report', {
        p_category: category,
        p_severity: severity,
        p_description: description.trim(),
        p_location: location.trim() || null,
        p_ack_minutes: Math.max(1, Number(ackMin) || 15),
      })
      if (error) throw error
      onDone(t('admin.emergency.loggedMsg'))
    } catch (err2: any) { setErr(err2?.message || t('admin.emergency.errorAction')); setBusy(false) }
  }
  return (
    <AdminModal title={t('admin.emergency.logTitle')} sub={t('admin.emergency.logSub')} onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-2col">
          <div className="admin-field">
            <span className="admin-field-label">{t('emergency.field.category')}</span>
            <Dropdown<string> value={category} onChange={setCategory} ariaLabel={t('emergency.field.category')}
              options={CATEGORIES.map(c => ({ value: c, label: t(`emergency.cat.${c}`) }))} />
          </div>
          <div className="admin-field">
            <span className="admin-field-label">{t('emergency.field.severity')}</span>
            <Dropdown<string> value={severity} onChange={setSeverity} ariaLabel={t('emergency.field.severity')}
              options={[{ value: 'urgent', label: t('admin.emergency.sevUrgent') }, { value: 'critical', label: t('admin.emergency.sevCritical') }]} />
          </div>
        </div>
        <div className="admin-2col">
          <label className="admin-field">
            <span className="admin-field-label">{t('emergency.field.location')}</span>
            <input className="admin-input" value={location} onChange={e => setLocation(e.target.value)} placeholder={t('emergency.locationPlaceholder')} />
          </label>
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.emergency.fieldAckMin')}</span>
            <input className="admin-input" type="number" min={1} value={ackMin} onChange={e => setAckMin(e.target.value)} />
          </label>
        </div>
        <label className="admin-field">
          <span className="admin-field-label">{t('emergency.field.description')}</span>
          <textarea className="admin-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('emergency.descPlaceholder')} />
        </label>
        <div className="admin-form-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
          {err && <span className="admin-err-inline">{err}</span>}
          <button type="button" className="admin-btn-ghost" onClick={onClose} disabled={busy}>{t('admin.emergency.cancel')}</button>
          <button type="submit" className="admin-primary-btn" disabled={busy}>{busy ? t('admin.emergency.logging') : t('admin.emergency.logSubmit')}</button>
        </div>
      </form>
    </AdminModal>
  )
}

function DispatchModal({ ev, vendors, defaultVendor, cap, onClose, onDone, onError }: {
  ev: Event
  vendors: { id: string; name: string }[]
  defaultVendor: string
  cap: number
  onClose: () => void
  onDone: (m: string) => void
  onError: (m: string) => void
}) {
  const t = useT()
  const [vendorId, setVendorId] = useState(defaultVendor)
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState(ev.description || '')
  const [fund, setFund] = useState('operating')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const amt = Number(amount) || 0
  const overCap = !(cap > 0 && amt > 0 && amt <= cap)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (amt <= 0) { setErr(t('admin.emergency.dispatchAmountErr')); return }
    if (!vendorId && !payee.trim()) { setErr(t('admin.emergency.dispatchPayeeErr')); return }
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase!.rpc('emergency_dispatch', {
        p_event: ev.id,
        p_vendor: vendorId || null,
        p_payee_name: vendorId ? null : payee.trim(),
        p_amount: amt,
        p_description: description.trim() || null,
        p_fund: fund,
      })
      if (error) throw error
      const auto = (data as any)?.auto_approved
      onDone(auto ? t('admin.emergency.dispatchedAutoMsg') : t('admin.emergency.dispatchedPendingMsg'))
    } catch (err2: any) { onError(err2?.message || t('admin.emergency.errorAction')); setBusy(false) }
  }

  return (
    <AdminModal title={t('admin.emergency.dispatchTitle')} sub={t(`emergency.cat.${ev.category}`)} onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 6px' }}>{t('admin.emergency.dispatchHint')}</p>
        <div className="admin-field">
          <span className="admin-field-label">{t('admin.emergency.dispatchVendor')}</span>
          <Dropdown<string>
            value={vendorId}
            onChange={setVendorId}
            ariaLabel={t('admin.emergency.dispatchVendor')}
            searchable
            placeholder={vendors.length ? t('admin.emergency.dispatchVendorPick') : t('admin.emergency.dispatchVendorNone')}
            options={[{ value: '', label: t('admin.emergency.dispatchOneOff') }, ...vendors.map(v => ({ value: v.id, label: v.name }))]}
          />
        </div>
        {!vendorId && (
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.emergency.dispatchPayee')}</span>
            <input className="admin-input" value={payee} onChange={e => setPayee(e.target.value)} placeholder={t('admin.emergency.dispatchPayeePlaceholder')} />
          </label>
        )}
        <div className="admin-2col">
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.emergency.dispatchAmount')}</span>
            <div className="admin-input-wrap">
              <span className="admin-input-prefix">$</span>
              <input className="admin-input" type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} placeholder="1500" />
            </div>
          </label>
          <div className="admin-field">
            <span className="admin-field-label">{t('admin.payables.fieldFund')}</span>
            <Dropdown<string>
              value={fund}
              onChange={setFund}
              ariaLabel={t('admin.payables.fieldFund')}
              options={[{ value: 'operating', label: t('admin.payables.fundOperating') }, { value: 'reserve', label: t('admin.payables.fundReserve') }]}
            />
          </div>
        </div>
        <label className="admin-field">
          <span className="admin-field-label">{t('admin.emergency.dispatchScope')}</span>
          <textarea className="admin-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('admin.emergency.dispatchScopePlaceholder')} />
        </label>
        {amt > 0 && (
          <div className={`admin-note${overCap ? ' admin-note-warn' : ''}`} style={{ marginTop: 2 }}>
            {overCap ? t('admin.emergency.dispatchOverCap') : t('admin.emergency.dispatchUnderCap')}
          </div>
        )}
        <div className="admin-form-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
          {err && <span className="admin-err-inline">{err}</span>}
          <button type="button" className="admin-btn-ghost" onClick={onClose} disabled={busy}>{t('admin.emergency.cancel')}</button>
          <button type="submit" className="admin-primary-btn" disabled={busy}>{busy ? t('admin.emergency.dispatching') : t('admin.emergency.dispatchSubmit')}</button>
        </div>
      </form>
    </AdminModal>
  )
}
