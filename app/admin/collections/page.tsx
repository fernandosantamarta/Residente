'use client'

// Collections worklist (FS 718.116/.121 condo / FS 720.3085/.305 HOA). Open a
// case on a delinquent owner, then work the statutory ladder on the case detail
// page: 30-day notice → 45-day intent-to-lien → lien recorded → 45-day
// intent-to-foreclose → foreclosure. Advisory posture — nothing here blocks.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { communityDuesConfig, residentBalance } from '@/lib/dues'
import { ymd, toDate, calendarDaysUntil } from '@/lib/compliance/rules-core'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
import {
  STAGE_LABELS, nextEscalation, lienEnforceDeadline, isOpenStage,
  delinquentOwnersWithoutCase,
  type CollectionCaseRow, type CollectionStage, type DelinquentCandidate,
} from '@/lib/compliance/collections'
import { Dropdown } from '@/components/Dropdown'
import { Pager } from '@/components/Pager'
import { useT } from '@/lib/i18n'

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
  const t = useT()
  const { profile } = useAuth() || {}
  const router = useRouter()
  const searchParams = useSearchParams()
  // Arrived from the Reports "Collect" link → Back returns to Reports (not the
  // compliance hub), with a "View in compliance" link on the opposite side.
  const fromReports = searchParams?.get('from') === 'reports'
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [rows, setRows] = useState<CollectionCaseRow[]>([])
  const [residents, setResidents] = useState<any[]>([])
  const [payByResident, setPayByResident] = useState<Record<string, { amount: number }[]>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [openPage, setOpenPage] = useState(0)
  const [flashIntake, setFlashIntake] = useState(false)
  const deepLinkDone = useRef(false)

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
      setError(err?.message || t('admin.collections.errorLoadCases')); setStatus('error')
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
      if (reload) { setMsg(t('admin.collections.caseOpenedFor', { unit: cand.unit_label })); await load() }
    } catch (err: any) { setError(err?.message || t('admin.collections.errorOpenCase')); throw err }
  }

  // Open all current suggestions, then refresh once. Each insert awaits in turn;
  // the DB partial-unique index guarantees no duplicate open case per owner.
  const openAllCandidates = async () => {
    let opened = 0
    for (const cand of candidates) {
      try { await openForCandidate(cand, false); opened++ } catch { /* skip (already opened / race) */ }
    }
    setMsg(t('admin.collections.openedNCases', { count: opened }))
    await load()
  }

  // ---- intake ----
  const [form, setForm] = useState<any>({ resident_id: '', is_fine_only: false })
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)

  // Deep link from Reports → "Collect →" (?resident=<id>). If that owner already
  // has an open case, jump straight to it; otherwise pre-pick them in the intake
  // form and scroll/flash it so the board opens the case in one step.
  useEffect(() => {
    if (status !== 'ready' || deepLinkDone.current) return
    const rid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('resident') : null
    if (!rid) return
    deepLinkDone.current = true
    const existing = rows.find(r => (r as any).resident_id === rid && isOpenStage(r.stage))
    if (existing) { router.replace(`/admin/collections/${existing.id}`); return }
    if (residents.some(r => r.id === rid)) {
      setForm((f: any) => ({ ...f, resident_id: rid }))
      setFlashIntake(true)
      setTimeout(() => setFlashIntake(false), 2600)
      requestAnimationFrame(() => document.getElementById('open-case')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [status, rows, residents, router])

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
      setMsg(t('admin.collections.caseOpened'))
      load()
    } catch (err: any) { setError(err?.message || t('admin.collections.errorOpenCase')) }
    finally { setSaving(false) }
  }

  const open = rows.filter(r => isOpenStage(r.stage))
  const closed = rows.filter(r => !isOpenStage(r.stage))

  return (
    <div className="admin-page cset">
      {fromReports ? (
        <div className="cset-backrow">
          <Link href="/admin/reports" className="admin-backlink"><span aria-hidden>&larr;</span> {t('admin.collections.backToReports')}</Link>
          <Link href="/admin/compliance" className="admin-backlink">{t('admin.collections.viewInCompliance')} <span aria-hidden>&rarr;</span></Link>
        </div>
      ) : (
        <ComplianceBackLink />
      )}
      <div className="admin-kicker">{t('admin.collections.kicker')}</div>
      <h1 className="admin-h1">{t('admin.collections.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.collections.pageDek')}
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">{t('admin.collections.noCommunity')}</div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.collections.retry')}</button></div>
      )}

      {/* Intake */}
      <div className="card" id="open-case" style={{
        scrollMarginTop: 80,
        boxShadow: flashIntake ? '0 0 0 2px var(--pink)' : undefined,
        transition: 'box-shadow .3s ease',
      }}>
        <div className="card-head"><div><h2>{t('admin.collections.openCaseTitle')}</h2></div></div>
        <form className="admin-form" onSubmit={create}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="admin-field"><span className="admin-field-label">{t('admin.collections.fieldOwner')}</span>
              <Dropdown<string>
                value={form.resident_id}
                onChange={v => setF('resident_id', v)}
                ariaLabel={t('admin.collections.fieldOwner')}
                options={[
                  { value: '', label: t('admin.collections.selectPlaceholder') },
                  ...residents.map(r => ({ value: r.id, label: [r.full_name || t('admin.collections.ownerFallback'), r.unit_number ? `Unit ${r.unit_number}` : null, r.address].filter(Boolean).join(' · ') })),
                ]}
              /></div>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collections.fieldUnitLabel')}</span>
              <input className="admin-input" value={form.unit_label ?? ''} placeholder={t('admin.collections.placeholderAutoOwner')} onChange={e => setF('unit_label', e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collections.fieldDelinquentSince')}</span>
              <input className="admin-input" type="date" value={form.delinquent_since ?? ''} onChange={e => setF('delinquent_since', e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collections.fieldAmountPastDue')}</span>
              <input className="admin-input" type="number" min="0" step="0.01" value={form.principal_balance ?? ''} placeholder={t('admin.collections.placeholderAutoLedger')} onChange={e => setF('principal_balance', e.target.value)} /></label>
          </div>
          {regime === 'hoa' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '10px 0 0' }}>
              <input type="checkbox" checked={!!form.is_fine_only} onChange={e => setF('is_fine_only', e.target.checked)} />
              {t('admin.collections.fineOnlyLabel')}
            </label>
          )}
          <div className="card-cta">
            {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
            <button type="submit" className="admin-primary-btn" disabled={saving}>{saving ? t('admin.collections.opening') : t('admin.collections.openCaseBtn')}</button>
          </div>
        </form>
      </div>

      {/* Suggested cases — delinquent owners with no open case */}
      {status === 'ready' && (
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <div>
              <h2>{t('admin.collections.suggestedTitle', { count: candidates.length })}</h2>
              <div className="sub">
                {t('admin.collections.suggestedDek')}
              </div>
            </div>
            <AutoOpenSettings community={community} onSaved={load} />
          </div>
          {candidates.length === 0 ? (
            <div className="admin-note">{t('admin.collections.noDelinquent')}{(community?.collections_min_balance || community?.collections_min_days) ? t('admin.collections.aboveThresholds') : ''}.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map(cand => (
                  <div key={cand.resident_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(0,0,0,0.08)', borderLeft: '4px solid #B54708', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{cand.unit_label}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{fmt$(cand.balance)} {t('admin.collections.pastDueSuffix')} · ~{cand.months_late} mo · {cand.days_past_due} days</div>
                    </div>
                    <button className="admin-primary-btn" onClick={() => openForCandidate(cand)}>{t('admin.collections.openCaseBtn')}</button>
                  </div>
                ))}
              </div>
              {candidates.length > 1 && (
                <button className="admin-btn-ghost" style={{ marginTop: 10 }} onClick={openAllCandidates}>{t('admin.collections.openAllCases', { count: candidates.length })}</button>
              )}
            </>
          )}
        </div>
      )}

      {/* Open cases */}
      <div className="card">
        <div className="card-head"><div><h2>{t('admin.collections.openCasesHeading')}</h2></div></div>
        {status === 'loading' && <div className="admin-note">{t('admin.collections.loading')}</div>}
        {status === 'ready' && open.length === 0 && <div className="admin-note">{t('admin.collections.noOpenCases')}</div>}
        {open.length > 0 && (() => {
          const OPEN_SIZE = 10
          const pageCount = Math.ceil(open.length / OPEN_SIZE)
          const page = Math.min(openPage, Math.max(0, pageCount - 1))
          const paged = open.slice(page * OPEN_SIZE, (page + 1) * OPEN_SIZE)
          return (
          <>
          <table className="coll-cases-tbl">
            <thead><tr>
              <th>{t('admin.collections.colOwner')}</th>
              <th>{t('admin.collections.colUnit')}</th>
              <th>{t('admin.collections.colBalanceOwed')}</th>
              <th aria-hidden="true"></th>
            </tr></thead>
            <tbody>
              {paged.map(r => {
                const stage = String(r.stage ?? 'delinquent') as CollectionStage
                const res = residents.find((x: any) => x.id === r.resident_id)
                const name = res?.full_name || r.unit_label || r.id.slice(0, 8)
                const unit = res?.unit_number || '—'
                const bal = r.total_balance != null
                  ? Number(r.total_balance)
                  : (res ? residentBalance(res, Number(community?.monthly_dues) || 0, payByResident[res.id] || [], communityDuesConfig(community)) : 0)
                const action = stage === 'delinquent' ? t('admin.collections.chipStart30Day') : t('admin.collections.openLink')
                return (
                  <tr key={r.id}>
                    <td className="cc-owner">{name}</td>
                    <td className="cc-unit">{unit}</td>
                    <td className="cc-bal">{fmt$(bal)}</td>
                    <td className="cc-action"><Link href={`/admin/collections/${r.id}`}>{action} &rarr;</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setOpenPage} />}
          </>
          )
        })()}

        {closed.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <button className="admin-btn-ghost" onClick={() => setShowClosed(s => !s)}>
              {showClosed ? t('admin.collections.hideClosed') : t('admin.collections.showClosed', { count: closed.length })}
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
  const t = useT()
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
    if (ready.getTime() <= toDate(now)!.getTime()) { chipText = t('admin.collections.chipReadyTo', { label: esc.label.split(' ').slice(0, 3).join(' ') }); chipColor = '#B54708' }
    else chipText = t('admin.collections.chipWaitUntil', { date: ymd(ready) })
  } else if (open && stage === 'lien_recorded') {
    const dl = lienEnforceDeadline(r, regime)
    if (dl) { const d = calendarDaysUntil(dl, now); chipText = d < 0 ? t('admin.collections.chipLienLapsed', { date: ymd(dl) }) : t('admin.collections.chipEnforceBy', { date: ymd(dl) }); chipColor = d < 0 ? '#B42318' : '#B54708' }
  } else if (open && stage === 'delinquent') {
    chipText = t('admin.collections.chipStart30Day'); chipColor = '#175CD3'
  }

  return (
    <Link href={`/admin/collections/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{r.unit_label || r.id.slice(0, 8)}</div>
            <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>
              {t('admin.collections.caseRowOpened')} {r.opened_at} · {STAGE_LABELS[stage]}
              {r.total_balance != null ? ` · ${t('admin.collections.caseRowBalance')} ${fmt$(r.total_balance)}` : ''}
              {r.on_payment_plan ? ` · ${t('admin.collections.caseRowPaymentPlan')}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {chipText && <span style={chip(chipColor)}>{chipText}</span>}
            <span style={{ fontSize: 13, color, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('admin.collections.openLink')}</span>
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
  const t = useT()
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
      setNote(t('admin.collections.saved')); onSaved()
    } catch (err: any) { setNote(err?.message || t('admin.collections.errorSaveSettings')) }
    finally { setBusy(false) }
  }

  if (!open) return <button className="admin-btn-ghost" onClick={() => setOpen(true)}>{t('admin.collections.scanSettingsBtn')}</button>

  return (
    <div style={{ width: '100%', border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="admin-field" style={{ maxWidth: 150 }}><span className="admin-field-label">{t('admin.collections.fieldMinBalance')}</span>
          <input className="admin-input" type="number" min="0" step="0.01" value={minBalance} placeholder={t('admin.collections.placeholderAny')} onChange={e => setMinBalance(e.target.value)} /></label>
        <label className="admin-field" style={{ maxWidth: 150 }}><span className="admin-field-label">{t('admin.collections.fieldMinDays')}</span>
          <input className="admin-input" type="number" min="0" step="1" value={minDays} placeholder={t('admin.collections.placeholderAny')} onChange={e => setMinDays(e.target.value)} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, paddingBottom: 8 }}>
          <input type="checkbox" checked={autoOpen} onChange={e => setAutoOpen(e.target.checked)} />
          {t('admin.collections.autoOpenLabel')}
        </label>
        <button className="admin-primary-btn" disabled={busy} onClick={save}>{busy ? t('admin.collections.saving') : t('admin.collections.saveBtn')}</button>
        <button className="admin-btn-ghost" disabled={busy} onClick={() => setOpen(false)}>{t('admin.collections.closeBtn')}</button>
      </div>
      <p style={{ fontSize: 11.5, opacity: 0.7, margin: '8px 0 0' }}>
        {t('admin.collections.autoOpenNote')} {note && <strong style={{ color: note === t('admin.collections.saved') ? '#067647' : '#B42318' }}>{note}</strong>}
      </p>
    </div>
  )
}
