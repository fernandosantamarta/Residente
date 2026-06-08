'use client'

// Collections worklist (FS 718.116/.121 condo / FS 720.3085/.305 HOA). Open a
// case on a delinquent owner, then work the statutory ladder on the case detail
// page: 30-day notice → 45-day intent-to-lien → lien recorded → 45-day
// intent-to-foreclose → foreclosure. Advisory posture — nothing here blocks.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { communityDuesConfig } from '@/lib/dues'
import { ymd, toDate, calendarDaysUntil } from '@/lib/compliance/rules-core'
import { AttorneyNote } from '../AttorneyNote'
import {
  STAGE_LABELS, nextEscalation, lienEnforceDeadline, isOpenStage,
  delinquentOwnersWithoutCase,
  type CollectionCaseRow, type CollectionStage, type DelinquentCandidate,
} from '@/lib/compliance/collections'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())
const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

const STAGE_COLOR: Record<string, string> = {
  delinquent: '#475467', notice_30: '#175CD3', intent_to_lien: '#B54708',
  lien_recorded: '#B54708', intent_to_foreclose: '#B42318', foreclosure: '#B42318',
  resolved: '#067647', cancelled: '#98A2B3',
}

export default function CollectionsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [rows, setRows] = useState<CollectionCaseRow[]>([])
  const [residents, setResidents] = useState<any[]>([])
  const [payByResident, setPayByResident] = useState<Record<string, { amount: number }[]>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Fire all four reads in ONE parallel batch — they're independent, so the
      // page waits for the slowest single query instead of the sum of four.
      const [cRes, casesRes, resRes, paysRes] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        withTimeout(supabase.from('ev_collection_cases').select('*')
          .eq('community_id', communityId).order('opened_at', { ascending: false })),
        withTimeout(supabase.from('residents').select('id, full_name, unit_number, address, profile_id, opening_balance, created_at')
          .eq('community_id', communityId).order('unit_number', { ascending: true })),
        withTimeout(supabase.from('payments').select('resident_id, amount').eq('community_id', communityId)),
      ])
      const { data: c } = cRes as any
      const { data, error } = casesRes as any
      if (error) throw error
      const { data: res } = resRes as any
      const { data: pays } = paysRes as any
      const map: Record<string, { amount: number }[]> = {}
      for (const p of pays || []) { (map[p.resident_id] ||= []).push({ amount: Number(p.amount) || 0 }) }
      setCommunity(c || null)
      setRows(data || [])
      setResidents(res || [])
      setPayByResident(map)
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load collection cases'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'

  // ---- delinquency scan: owners behind, with no open case ----
  const candidates = useMemo<DelinquentCandidate[]>(() => community ? delinquentOwnersWithoutCase({
    residents,
    paymentsByResident: payByResident,
    cases: rows,
    monthlyDues: Number(community.monthly_dues) || 0,
    duesConfig: communityDuesConfig(community),
    minBalance: Number(community.collections_min_balance) || 0,
    minDays: Number(community.collections_min_days) || 0,
    dueDay: Number(community.assessment_due_day) || 1,
  }) : [], [community, residents, rows, payByResident])

  const openForCandidate = async (cand: DelinquentCandidate, reload = true) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_collection_cases').insert({
        community_id: communityId,
        resident_id: cand.resident_id,
        profile_id: cand.profile_id,
        unit_label: cand.unit_label,
        stage: 'delinquent',
        opened_at: todayYmd(),
        principal_balance: cand.balance,
        total_balance: cand.balance,
        notes: `Opened from delinquency scan (~${cand.months_late} mo / ${cand.days_past_due} days past due).`,
        created_by: profile?.id ?? null,
      }))) as any
      if (error) throw error
      if (reload) { setMsg(`Case opened for ${cand.unit_label}.`); await load() }
    } catch (err: any) { setError(err?.message || 'Could not open the case'); throw err }
  }

  // Open all current suggestions, then refresh once. Each insert awaits in turn;
  // the DB partial-unique index guarantees no duplicate open case per owner.
  const openAllCandidates = async () => {
    let opened = 0
    for (const cand of candidates) {
      try { await openForCandidate(cand, false); opened++ } catch { /* skip (already opened / race) */ }
    }
    setMsg(`Opened ${opened} case${opened === 1 ? '' : 's'}.`)
    await load()
  }

  // ---- intake ----
  const [form, setForm] = useState<any>({ resident_id: '', is_fine_only: false })
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)

  const create = async (e: any) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = residents.find(r => r.id === form.resident_id)
      const unit = (form.unit_label || '').trim() ||
        (res ? `${res.full_name || ''}${res.unit_number ? ` · ${res.unit_number}` : ''}`.trim() : '') || null
      const insert = {
        community_id: communityId,
        resident_id: res?.id ?? null,
        profile_id: res?.profile_id ?? null,
        unit_label: unit,
        stage: 'delinquent',
        opened_at: todayYmd(),
        delinquent_since: (form.delinquent_since || '').trim() || null,
        principal_balance: form.principal_balance ? Number(form.principal_balance) : null,
        total_balance: form.principal_balance ? Number(form.principal_balance) : null,
        is_fine_only: !!form.is_fine_only,
        notes: (form.notes || '').trim() || null,
        created_by: profile?.id ?? null,
      }
      const { error } = (await withTimeout(supabase.from('ev_collection_cases').insert(insert))) as any
      if (error) throw error
      setForm({ resident_id: '', is_fine_only: false })
      setMsg('Collection case opened.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not open the case') }
    finally { setSaving(false) }
  }

  const open = rows.filter(r => isOpenStage(r.stage))
  const closed = rows.filter(r => !isOpenStage(r.stage))

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Collections <span className="amp">&</span> liens</h1>
      <p className="admin-dek">
        Work a delinquent owner through the statutory ladder — 30-day notice of late assessment,
        45-day notice of intent to record a lien, the recorded lien, then the 45-day notice of intent
        to foreclose. We track every deadline; you decide each step.
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>
      )}

      {/* Intake */}
      <div className="card">
        <div className="card-head"><div><h2>Open a case</h2></div></div>
        <form className="admin-form" onSubmit={create}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <label className="admin-field"><span className="admin-field-label">Owner (from roster)</span>
              <select className="admin-input" value={form.resident_id} onChange={e => setF('resident_id', e.target.value)}>
                <option value="">— select —</option>
                {residents.map(r => <option key={r.id} value={r.id}>{[r.full_name || 'Owner', r.unit_number ? `Unit ${r.unit_number}` : null, r.address].filter(Boolean).join(' · ')}</option>)}
              </select></label>
            <label className="admin-field"><span className="admin-field-label">Unit / parcel label (override)</span>
              <input className="admin-input" value={form.unit_label ?? ''} placeholder="auto from owner" onChange={e => setF('unit_label', e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">Delinquent since</span>
              <input className="admin-input" type="date" value={form.delinquent_since ?? ''} onChange={e => setF('delinquent_since', e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">Amount past due ($, optional)</span>
              <input className="admin-input" type="number" min="0" step="0.01" value={form.principal_balance ?? ''} placeholder="auto from ledger" onChange={e => setF('principal_balance', e.target.value)} /></label>
          </div>
          {regime === 'hoa' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '10px 0 0' }}>
              <input type="checkbox" checked={!!form.is_fine_only} onChange={e => setF('is_fine_only', e.target.checked)} />
              Fine-only case (HB 1203: an HOA fine under $1,000 may not become a lien)
            </label>
          )}
          <div className="card-cta">
            {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
            <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? 'Opening…' : 'Open case'}</button>
          </div>
        </form>
      </div>

      {/* Suggested cases — delinquent owners with no open case */}
      {status === 'ready' && (
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <div>
              <h2>Suggested cases ({candidates.length})</h2>
              <div className="sub">
                Owners behind by more than the current installment with no open case. Detection is automatic —
                opening a case (and every statutory step after) stays your decision.
              </div>
            </div>
            <AutoOpenSettings community={community} onSaved={load} />
          </div>
          {candidates.length === 0 ? (
            <div className="admin-note">No delinquent owners without a case{(community?.collections_min_balance || community?.collections_min_days) ? ' above your thresholds' : ''}.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map(cand => (
                  <div key={cand.resident_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(0,0,0,0.08)', borderLeft: '4px solid #B54708', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{cand.unit_label}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{fmt$(cand.balance)} past due · ~{cand.months_late} mo · {cand.days_past_due} days</div>
                    </div>
                    <button className="admin-primary-btn" onClick={() => openForCandidate(cand)}>Open case</button>
                  </div>
                ))}
              </div>
              {candidates.length > 1 && (
                <button className="admin-btn-ghost" style={{ marginTop: 10 }} onClick={openAllCandidates}>Open all {candidates.length} cases</button>
              )}
            </>
          )}
        </div>
      )}

      {/* Open cases */}
      <div className="card">
        <div className="card-head"><div><h2>Open cases</h2></div></div>
        {status === 'loading' && <div className="admin-note">Loading…</div>}
        {status === 'ready' && open.length === 0 && <div className="admin-note">No open collection cases.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {open.map(r => <CaseRow key={r.id} r={r} regime={regime} />)}
        </div>

        {closed.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <button className="admin-btn-ghost" onClick={() => setShowClosed(s => !s)}>
              {showClosed ? 'Hide' : 'Show'} resolved / cancelled ({closed.length})
            </button>
            {showClosed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {closed.map(r => <CaseRow key={r.id} r={r} regime={regime} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CaseRow({ r, regime }: { r: CollectionCaseRow; regime: 'condo' | 'hoa' }) {
  const stage = String(r.stage ?? 'delinquent') as CollectionStage
  const color = STAGE_COLOR[stage] || '#475467'
  const open = isOpenStage(stage)

  // Deadline chip: either the next escalation's ready-date or the lien window.
  let chipText: string | null = null
  let chipColor = '#175CD3'
  const esc = nextEscalation(r)
  const now = new Date()
  if (open && esc?.readyAt) {
    const ready = esc.readyAt
    if (ready.getTime() <= toDate(now)!.getTime()) { chipText = `Ready to ${esc.label.split(' ').slice(0, 3).join(' ')}…`; chipColor = '#B54708' }
    else chipText = `Wait until ${ymd(ready)}`
  } else if (open && stage === 'lien_recorded') {
    const dl = lienEnforceDeadline(r, regime)
    if (dl) { const d = calendarDaysUntil(dl, now); chipText = d < 0 ? `Lien window lapsed ${ymd(dl)}` : `Enforce by ${ymd(dl)}`; chipColor = d < 0 ? '#B42318' : '#B54708' }
  } else if (open && stage === 'delinquent') {
    chipText = 'Start 30-day notice'; chipColor = '#175CD3'
  }

  return (
    <Link href={`/admin/collections/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{r.unit_label || r.id.slice(0, 8)}</div>
            <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>
              Opened {r.opened_at} · {STAGE_LABELS[stage]}
              {r.total_balance != null ? ` · balance ${fmt$(r.total_balance)}` : ''}
              {r.on_payment_plan ? ' · on payment plan' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {chipText && <span style={chip(chipColor)}>{chipText}</span>}
            <span style={{ fontSize: 13, color, fontWeight: 700, whiteSpace: 'nowrap' }}>Open →</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}

// Compact board-config for the delinquency scan: a $ / days floor and an
// auto-open toggle (the cron opens pre-notice cases). Writes to communities.
function AutoOpenSettings({ community, onSaved }: { community: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [minBalance, setMinBalance] = useState('')
  const [minDays, setMinDays] = useState('')
  const [autoOpen, setAutoOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!community) return
    setMinBalance(community.collections_min_balance != null ? String(community.collections_min_balance) : '')
    setMinDays(community.collections_min_days != null ? String(community.collections_min_days) : '')
    setAutoOpen(!!community.collections_auto_open)
  }, [community])

  const save = async () => {
    if (!community?.id) return
    setBusy(true); setNote('')
    try {
      const { error } = (await withTimeout(supabase.from('communities').update({
        collections_min_balance: minBalance === '' ? null : Number(minBalance),
        collections_min_days: minDays === '' ? null : Number(minDays),
        collections_auto_open: autoOpen,
      }).eq('id', community.id))) as any
      if (error) throw error
      setNote('Saved.'); onSaved()
    } catch (err: any) { setNote(err?.message || 'Could not save (run collections-auto-open.sql first?)') }
    finally { setBusy(false) }
  }

  if (!open) return <button className="admin-btn-ghost" onClick={() => setOpen(true)}>⚙ Scan settings</button>

  return (
    <div style={{ width: '100%', border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="admin-field" style={{ maxWidth: 150 }}><span className="admin-field-label">Min balance ($)</span>
          <input className="admin-input" type="number" min="0" step="0.01" value={minBalance} placeholder="any" onChange={e => setMinBalance(e.target.value)} /></label>
        <label className="admin-field" style={{ maxWidth: 150 }}><span className="admin-field-label">Min days past due</span>
          <input className="admin-input" type="number" min="0" step="1" value={minDays} placeholder="any" onChange={e => setMinDays(e.target.value)} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, paddingBottom: 8 }}>
          <input type="checkbox" checked={autoOpen} onChange={e => setAutoOpen(e.target.checked)} />
          Auto-open pre-notice cases (daily)
        </label>
        <button className="admin-primary-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="admin-btn-ghost" disabled={busy} onClick={() => setOpen(false)}>Close</button>
      </div>
      <p style={{ fontSize: 11.5, opacity: 0.7, margin: '8px 0 0' }}>
        Auto-open creates the case at the pre-notice <em>delinquent</em> stage only — it never sends a statutory notice or records a lien. {note && <strong style={{ color: note === 'Saved.' ? '#067647' : '#B42318' }}>{note}</strong>}
      </p>
    </div>
  )
}
