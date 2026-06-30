'use client'

// Collection case detail — the statutory collection ladder workspace
// (FS 718.116/.121 condo / FS 720.3085/.305 HOA). Log each statutory notice,
// advance the stage, watch the waiting periods + lien-enforcement window, record
// collection costs, run a payment plan, and generate the draft letters / sworn
// ledger. Advisory posture: every gate says "you may proceed" — nothing blocks.

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { ymd, toDate, addCalendarDays, calendarDaysUntil } from '@/lib/compliance/rules-core'
import { casePayoff, fmtMoney, type PayoffResult } from '@/lib/dues'
import { countyRecorderUrl, recorderCountyLabel } from '@/lib/compliance/fl-recorders'
import { RecordPaymentForm } from '@/components/RecordPaymentForm'
import { Dropdown } from '@/components/Dropdown'
import { AttorneyNote } from '../../AttorneyNote'
import { Pager } from '@/components/Pager'
import { useT } from '@/lib/i18n'
import {
  STAGE_LABELS, NOTICE_KIND_LABELS, nextEscalation, lienEnforceDeadline, noticeMethodWarning, isOpenStage,
  dualAddressRule, resolveNoticeAddresses, noticeAddressWarning, ownerNoticeAddresses,
  NOTICE_30_DAY_DAYS, INTENT_TO_LIEN_DAYS, INTENT_TO_FORECLOSE_DAYS, HOA_FINE_LIEN_FLOOR, QUALIFYING_OFFER_STAY_DAYS,
  type CollectionCaseRow, type CollectionStage, type CollectionNoticeKind, type CollectionNoticeRow, type PaymentPlanRow,
} from '@/lib/compliance/collections'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())
const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

// NOTE: METHODS labels are module-scope and cannot use the useT hook.
// They are left in English. See i18n notes.
const METHODS = [
  { value: 'both', label: 'Certified + first-class mail (statutory dual delivery)' },
  { value: 'certified_mail', label: 'Certified / registered mail (return receipt)' },
  { value: 'first_class', label: 'First-class mail' },
  { value: 'hand', label: 'Hand-delivered' },
  { value: 'electronic', label: 'Electronic' },
]

// The advance available from each open stage.
interface Advance {
  label: string
  nextStage: CollectionStage
  stampField: keyof CollectionCaseRow
  notice?: CollectionNoticeKind
  citation: string
  needsNotice: boolean
}

// NOTE: advanceFor is a plain helper function (not a React component) and
// cannot call useT. Its label strings are left in English. See i18n notes.
function advanceFor(stage: CollectionStage): Advance | null {
  switch (stage) {
    case 'delinquent':
      return { label: 'Log 30-day notice of late assessment', nextStage: 'notice_30', stampField: 'notice_30_sent_at', notice: 'late_assessment_30', citation: NOTICE_30_DAY_DAYS.citation, needsNotice: true }
    case 'notice_30':
      return { label: 'Log 45-day notice of intent to record a lien', nextStage: 'intent_to_lien', stampField: 'intent_to_lien_sent_at', notice: 'intent_to_lien_45', citation: INTENT_TO_LIEN_DAYS.citation, needsNotice: true }
    case 'intent_to_lien':
      return { label: 'Mark claim of lien recorded', nextStage: 'lien_recorded', stampField: 'lien_recorded_at', citation: INTENT_TO_LIEN_DAYS.citation, needsNotice: false }
    case 'lien_recorded':
      return { label: 'Log 45-day notice of intent to foreclose', nextStage: 'intent_to_foreclose', stampField: 'intent_to_foreclose_sent_at', notice: 'intent_to_foreclose_45', citation: INTENT_TO_FORECLOSE_DAYS.citation, needsNotice: true }
    case 'intent_to_foreclose':
      return { label: 'Mark foreclosure action filed', nextStage: 'foreclosure', stampField: 'foreclosure_filed_at', citation: INTENT_TO_FORECLOSE_DAYS.citation, needsNotice: false }
    default:
      return null
  }
}

export default function CollectionCaseDetail() {
  const params = useParams()
  const id = params?.id as string
  const { profile } = useAuth() || {}
  const t = useT()

  const [c, setC] = useState<CollectionCaseRow | null>(null)
  const [community, setCommunity] = useState<any>(null)
  const [resident, setResident] = useState<any>(null)
  const [payments, setPayments] = useState<any[]>([])
  const [notices, setNotices] = useState<CollectionNoticeRow[]>([])
  const [plans, setPlans] = useState<PaymentPlanRow[]>([])
  const [demand, setDemand] = useState<any>(null) // active tenant rent demand, if any
  const [hold, setHold] = useState<any>(null) // latest open legal hold on this case, if any
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [showManualPay, setShowManualPay] = useState(false)
  const [noticePage, setNoticePage] = useState(0)
  const [snapMsg, setSnapMsg] = useState('')
  const [holdFormOpen, setHoldFormOpen] = useState(false)
  const [holdHover, setHoldHover] = useState(false)
  // First load shows the spinner; later refetches (after an action) keep the
  // content mounted so the page doesn't jump back to the top.
  const loadedRef = useRef(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])
  useEffect(() => { if (!snapMsg) return; const x = setTimeout(() => setSnapMsg(''), 3000); return () => clearTimeout(x) }, [snapMsg])

  const load = useCallback(async () => {
    if (!hasSupabase || !id) { setStatus('error'); setError('No case'); return }
    if (!loadedRef.current) setStatus('loading')
    setError('')
    try {
      const { data: cs, error: cErr } = (await withTimeout(
        supabase.from('ev_collection_cases').select('*').eq('id', id).single(),
      )) as any
      if (cErr) throw cErr
      const { data: comm } = (await withTimeout(
        supabase.from('communities').select('*').eq('id', cs.community_id).single(),
      )) as any
      let res: any = null
      let pays: any[] = []
      if (cs.resident_id) {
        const { data: r } = (await withTimeout(
          supabase.from('residents').select('*').eq('id', cs.resident_id).single(),
        )) as any
        res = r || null
        const { data: p } = (await withTimeout(
          supabase.from('payments').select('amount, created_at').eq('resident_id', cs.resident_id),
        )) as any
        pays = p || []
      }
      const { data: ns } = (await withTimeout(
        supabase.from('ev_collection_notices').select('*').eq('case_id', id).order('sent_at', { ascending: false }),
      )) as any
      const { data: pl } = (await withTimeout(
        supabase.from('ev_payment_plans').select('*').eq('case_id', id).order('created_at', { ascending: false }),
      )) as any
      // Active tenant rent demand (FS 720.3085(8)/718.116(11)), if one is open.
      let dm: any = null
      try {
        const { data: d } = (await withTimeout(
          supabase.from('ev_rent_demands').select('*').eq('case_id', id).eq('status', 'active').maybeSingle(),
        )) as any
        dm = d || null
      } catch { /* table may not exist yet — ignore */ }
      // Latest OPEN legal hold (requested / pending_resident / active) on the case.
      let hd: any = null
      try {
        const { data: h } = (await withTimeout(
          supabase.from('ev_legal_holds').select('*').eq('case_id', id)
            .in('status', ['requested', 'pending_resident', 'active'])
            .order('created_at', { ascending: false }).limit(1),
        )) as any
        hd = (h && h[0]) || null
      } catch { /* table may not exist yet — ignore */ }
      setC(cs); setCommunity(comm || null); setResident(res); setPayments(pays)
      setNotices(ns || []); setPlans(pl || []); setDemand(dm); setHold(hd); loadedRef.current = true; setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.collectionsDetail.couldNotLoadCase')); setStatus('error')
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const patchCase = async (p: any, okMsg: string) => {
    try {
      const { error } = (await withTimeout(supabase.from('ev_collection_cases').update(p).eq('id', id))) as any
      if (error) throw error
      setMsg(okMsg); load()
    } catch (err: any) { setError(err?.message || t('admin.collectionsDetail.updateFailed')) }
  }

  // ---- Legal-hold board actions (ev_legal_holds; see legal-holds.sql) ----
  const insertHold = async (row: any, okMsg: string) => {
    try {
      const { error } = (await withTimeout(supabase.from('ev_legal_holds').insert({
        community_id: c?.community_id, case_id: id,
        profile_id: (c as any)?.profile_id ?? null,
        created_by: profile?.id ?? null, requested_at: todayYmd(), ...row,
      }))) as any
      if (error) throw error
      setMsg(okMsg); load()
    } catch (err: any) { setError(err?.message || t('admin.collectionsDetail.updateFailed')) }
  }
  const updateHold = async (patch: any, okMsg: string) => {
    if (!hold) return
    try {
      const { error } = (await withTimeout(supabase.from('ev_legal_holds').update(patch).eq('id', hold.id))) as any
      if (error) throw error
      setMsg(okMsg); load()
    } catch (err: any) { setError(err?.message || t('admin.collectionsDetail.updateFailed')) }
  }
  const placeHoldNow = (reason: string, note: string) =>
    insertHold({ reason, note: note.trim() || null, status: 'active', initiated_by: 'board', decided_by: profile?.id ?? null, decided_at: todayYmd() }, t('admin.collectionsDetail.legalHoldPlaced'))
  const requestHoldFromResident = (reason: string) =>
    insertHold({ reason, status: 'pending_resident', initiated_by: 'board' }, t('admin.collectionsDetail.legalHoldRequested'))
  const verifyHold = () =>
    updateHold({ status: 'active', decided_by: profile?.id ?? null, decided_at: todayYmd() }, t('admin.collectionsDetail.legalHoldPlaced'))
  const denyHold = (reason: string) =>
    updateHold({ status: 'denied', decided_by: profile?.id ?? null, decided_at: todayYmd(), decision_reason: reason.trim() || null }, t('admin.collectionsDetail.legalHoldDenied'))
  const releaseHold = () =>
    updateHold({ status: 'released' }, t('admin.collectionsDetail.legalHoldReleased'))

  // Record an offline DUES payment against this case's owner via the append-only
  // record_offline_payment RPC (tagged applied_to_case = this case), then refresh
  // payments so the payoff ledger recomputes.
  const recordPayment = async (
    { amount, method, paidOn, memo }: { amount: number; method: string; paidOn: string; memo: string },
  ): Promise<{ error?: string } | void> => {
    if (!resident || !c) return { error: t('admin.collectionsDetail.linkOwnerFirst') }
    const client_key = (globalThis.crypto?.randomUUID?.() || `${id}:${paidOn}:${amount}`)
    const { error } = await supabase.rpc('record_offline_payment', {
      p_community: c.community_id,
      p_resident: resident.id,
      p_amount: amount,
      p_method: method,
      p_paid_on: paidOn || null,
      p_memo: memo || null,
      p_client_key: client_key,
      p_case: id,
    })
    if (error) return { error: error.message }
    const { data } = (await supabase.from('payments').select('amount, created_at').eq('resident_id', resident.id)) as any
    setPayments(data || [])
    setMsg(`Recorded ${fmtMoney(amount)}`)
  }

  // Issue the statutory demand for rent from the tenant (FS 720.3085(8) /
  // 718.116(11)). Opens a stateful demand record + logs the notice. The tenant
  // then pays the unit's balance directly (in-app if they have an account); the
  // demand is satisfied when the owner's payoff reaches $0.
  const demandRent = async (obligation: number) => {
    if (!resident || !c) return
    try {
      const { error: dErr } = await withTimeout(supabase.from('ev_rent_demands').insert({
        community_id: c.community_id, case_id: id, resident_id: resident.id,
        owner_profile_id: resident.profile_id || null,
        tenant_profile_id: resident.tenant_profile_id || null,
        obligation_at_demand: obligation,
        created_by: (await supabase.auth.getUser()).data.user?.id || null,
      }))
      if (dErr) throw dErr
      // Log the statutory notice on the case timeline.
      await withTimeout(supabase.from('ev_collection_notices').insert({
        community_id: c.community_id, case_id: id, kind: 'tenant_rent_demand',
        method: 'both', recipient_name: resident.tenant_name || t('admin.collectionsDetail.theTenant'),
      }))
      setMsg(t('admin.collectionsDetail.rentDemandIssued')); load()
    } catch (err: any) { setError(err?.message || t('admin.collectionsDetail.updateFailed')) }
  }

  const releaseDemand = async (reason: 'paid_in_full' | 'withdrawn') => {
    if (!demand) return
    try {
      const { error } = await withTimeout(supabase.from('ev_rent_demands')
        .update({ status: 'released', released_at: new Date().toISOString().slice(0, 10), released_reason: reason })
        .eq('id', demand.id))
      if (error) throw error
      setMsg(t('admin.collectionsDetail.rentDemandReleased')); load()
    } catch (err: any) { setError(err?.message || t('admin.collectionsDetail.updateFailed')) }
  }

  if (status === 'loading') return <div className="admin-page"><div className="admin-note">{t('admin.collectionsDetail.loading')}</div></div>
  if (status === 'error' || !c) return <div className="admin-page"><div className="admin-note admin-note-err">{error || t('admin.collectionsDetail.notFound')} <Link className="admin-btn-ghost" href="/admin/collections">{t('admin.collectionsDetail.back')}</Link></div></div>

  const regime: 'condo' | 'hoa' = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const stage = String(c.stage ?? 'delinquent') as CollectionStage
  const open = isOpenStage(stage)
  const adv = open ? advanceFor(stage) : null
  const esc = nextEscalation(c)
  const now = new Date()
  const gateReady = esc?.readyAt ? esc.readyAt.getTime() <= toDate(now)!.getTime() : true
  const lienDeadline = lienEnforceDeadline(c, regime)
  // A hold blocks escalation only once it's 'active' (a resident's unverified
  // report or a pending board request warns but doesn't hard-block).
  const holdActive = hold?.status === 'active'
  const legalHoldLabel = holdActive ? t(HOLD_REASON_KEY[hold.reason] || 'admin.collectionsDetail.holdOther') : null

  // Interest & late-fee freeze — each independent. A manual override on the case
  // wins; when untouched (null) it follows the plan automatically (frozen while a
  // plan is current, resumes on default/cancel).
  const interestFrozen = (c as any).freeze_interest == null ? !!c.on_payment_plan : !!(c as any).freeze_interest
  const lateFeesFrozen = (c as any).freeze_late_fees == null ? !!c.on_payment_plan : !!(c as any).freeze_late_fees
  const frozen = interestFrozen || lateFeesFrozen

  // Authoritative payoff from the dues model + recorded costs.
  let payoff: PayoffResult | null = null
  if (resident) {
    try { payoff = casePayoff(resident, community, payments, { extraCosts: (Number(c.cost_balance) || 0) + (Number((c as any).mailing_cost_balance) || 0), freezeInterest: interestFrozen, freezeLateFees: lateFeesFrozen }) } catch { payoff = null }
  }

  return (
    <div className="admin-page">
      <div style={{ marginBottom: 6 }}><Link className="admin-back" href="/admin/collections">&larr; {t('admin.collectionsDetail.allCases')}</Link></div>
      <div className="admin-kicker">{t('admin.collectionsDetail.breadcrumb')}</div>
      <h1 className="admin-h1" style={{ marginBottom: 2 }}>{c.unit_label || c.id.slice(0, 8)}</h1>
      <p className="admin-dek" style={{ marginTop: 0 }}>
        {t('admin.collectionsDetail.opened')} {c.opened_at} · {t('admin.collectionsDetail.stageLabel')}: <strong>{STAGE_LABELS[stage]}</strong>
        {c.delinquent_since ? ` · ${t('admin.collectionsDetail.delinquentSince')} ${c.delinquent_since}` : ''}
      </p>

      <div className="cset"><AttorneyNote /></div>
      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {error && <div className="admin-note admin-note-err">{error}</div>}

      {/* ---- Stage ladder ---- */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <h2 className="bc-title" style={{ margin: 0 }}>{t('admin.collectionsDetail.statutoryLadder')}</h2>
          {open && !hold && !holdFormOpen && (
            <button className="admin-btn-ghost"
              onMouseEnter={() => setHoldHover(true)} onMouseLeave={() => setHoldHover(false)}
              style={{ fontSize: 12.5, flexShrink: 0, fontWeight: 700, transition: 'background .15s ease, border-color .15s ease, color .15s ease',
                color: holdHover ? '#fff' : '#B42318',
                border: '1px solid #B42318',
                background: holdHover ? '#B42318' : '#FEF3F2' }}
              onClick={() => setHoldFormOpen(true)}>{t('admin.collectionsDetail.legalHoldManage')}</button>
          )}
        </div>
        <StageBar stage={stage} esc={esc} />

        {open && (
          <div style={{ marginTop: 30 }}>
            <LegalHoldPanel
              hold={hold}
              resident={resident}
              formOpen={holdFormOpen}
              setFormOpen={setHoldFormOpen}
              onPlace={placeHoldNow}
              onRequest={requestHoldFromResident}
              onVerify={verifyHold}
              onDeny={denyHold}
              onRelease={releaseHold}
            />
            {/* EVERY statutory note for this stage lives in ONE blue card: the
                next-step waiting period, the lien enforcement window, the HB 1203
                fine-floor warning, and the county recorder link — spaced lines in
                the same section. Plain blue normally; turns red only once the lien
                enforcement window has lapsed. County resolves a city (e.g.
                Tallahassee → Leon) via recorderCountyLabel/countyRecorderUrl. */}
            {(() => {
              const showEnforce = (stage === 'lien_recorded' || stage === 'intent_to_foreclose' || stage === 'foreclosure') && !!lienDeadline
              const showRecorder = stage === 'intent_to_lien' || stage === 'lien_recorded'
              const showFloor = regime === 'hoa' && !!c.is_fine_only && (Number(c.principal_balance) || 0) < HOA_FINE_LIEN_FLOOR.value
              const lapsed = showEnforce && calendarDaysUntil(lienDeadline!, now) < 0
              const countyName = recorderCountyLabel((community as any)?.county) || t('admin.collectionsDetail.yourCounty')

              // Text-only note lines, in legal order.
              const lines: string[] = []
              if (esc?.readyAt) {
                lines.push(gateReady
                  ? `${t('admin.collectionsDetail.waitingPeriodElapsed')} ${ymd(esc.readyAt)}, ${t('admin.collectionsDetail.youMayProceed')} ${esc.label}. (${esc.citation})`
                  : `${t('admin.collectionsDetail.waitingPeriodRunsUntil')} ${ymd(esc.readyAt)} (${calendarDaysUntil(esc.readyAt, now)} ${t('admin.collectionsDetail.days')}). ${t('admin.collectionsDetail.mayProceedEarlier')} (${esc.citation})`)
              }
              if (showEnforce) {
                lines.push(`${lapsed
                  ? `${t('admin.collectionsDetail.lienWindowLapsed')} ${ymd(lienDeadline!)}.`
                  : regime === 'condo'
                    ? `${t('admin.collectionsDetail.condoLienDeadline')} ${ymd(lienDeadline!)}.`
                    : `${t('admin.collectionsDetail.hoaLienDeadline')} ${ymd(lienDeadline!)}.`} (${LIEN_CITE})`)
              }
              if (showFloor) {
                lines.push(`${t('admin.collectionsDetail.fineFloorWarning', { amount: '$' + HOA_FINE_LIEN_FLOOR.value })} (${HOA_FINE_LIEN_FLOOR.citation})`)
              }
              if (lines.length === 0 && !showRecorder) return null
              return (
                <div className={`admin-note ${lapsed ? 'admin-note-err' : ''}`}
                  style={{ fontSize: 12.5, marginBottom: 10, marginLeft: 12,
                    ...(lapsed ? {} : { background: 'linear-gradient(180deg, #F2F7FF, #FAFCFF)', border: '1px solid rgba(23,92,211,0.22)' }) }}>
                  {lines.map((ln, i) => (
                    <div key={i} style={{ marginTop: i ? 8 : 0 }}>{ln}</div>
                  ))}
                  {showRecorder && (
                    <div style={{ marginTop: lines.length ? 8 : 0 }}>
                      {t('admin.collectionsDetail.recordWithCounty', { county: countyName })}{' '}
                      <a href={countyRecorderUrl((community as any)?.county)} target="_blank" rel="noopener noreferrer" style={{ color: '#175CD3', fontWeight: 700, whiteSpace: 'nowrap' }}>{t('admin.collectionsDetail.openRecorder')} &rarr;</a>
                    </div>
                  )}
                </div>
              )
            })()}

            <div style={{ display: 'flex', gap: 8, marginTop: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'resolved', resolved_at: todayYmd() }, t('admin.collectionsDetail.caseResolved')).then(() => logAudit({ community_id: c.community_id!, event_type: 'collection.resolved', target_type: 'collection_case', target_id: id }))}>{t('admin.collectionsDetail.markResolved')}</button>
              <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'cancelled', resolved_at: todayYmd() }, t('admin.collectionsDetail.caseCancelled'))}>{t('admin.collectionsDetail.cancelCase')}</button>
              <StageActions
                adv={adv}
                caseRow={c}
                communityId={c.community_id!}
                profileId={profile?.id ?? null}
                resident={resident}
                regime={regime}
                legalHoldLabel={legalHoldLabel}
                onAdvanced={load}
                onError={setError}
              />
            </div>
          </div>
        )}
        {!open && (
          <div className="admin-note" style={{ marginTop: 12 }}>
            {t('admin.collectionsDetail.caseIs')} {STAGE_LABELS[stage].toLowerCase()}{c.resolved_at ? ` (${c.resolved_at})` : ''}.
            {/* Reopening restarts the ladder at delinquent, so clear every prior-
                cycle stage stamp — otherwise regenerated draft letters would print
                stale sent/recorded/filed dates. */}
            <button className="admin-btn-ghost" onClick={() => patchCase({
              stage: 'delinquent', resolved_at: null,
              notice_30_sent_at: null, intent_to_lien_sent_at: null, lien_recorded_at: null,
              intent_to_foreclose_sent_at: null, foreclosure_filed_at: null,
            }, t('admin.collectionsDetail.caseReopened'))}>{t('admin.collectionsDetail.reopen')}</button>
          </div>
        )}
      </section>

      {/* ---- Statutory notices (under the ladder that creates them) ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 10 }}>{t('admin.collectionsDetail.statutoryNotices')}</h2>
        {notices.length === 0 && <div className="admin-note">{t('admin.collectionsDetail.noNoticesLogged')}</div>}
        {(() => {
          const NOTICE_SIZE = 5
          const pageCount = Math.ceil(notices.length / NOTICE_SIZE)
          const page = Math.min(noticePage, Math.max(0, pageCount - 1))
          const paged = notices.slice(page * NOTICE_SIZE, (page + 1) * NOTICE_SIZE)
          return (
          <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {paged.map(n => {
            const warn = noticeMethodWarning(n.kind, n.method)
            const docType = NOTICE_DOC[n.kind]
            const rowStyle: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'flex-start', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '11px 14px', background: '#fff', textDecoration: 'none', color: 'inherit' }
            const body = (
              <>
                <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: noticeColor(n.kind), background: noticeColor(n.kind) + '18' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1F2233' }}>{NOTICE_KIND_LABELS[n.kind as CollectionNoticeKind] || n.kind}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {t('admin.collectionsDetail.sent')} {n.sent_at}{n.method ? ` · ${METHODS.find(m => m.value === n.method)?.label || n.method}` : ''}
                  {n.tracking_number ? ` · #${n.tracking_number}` : ''}
                  {n.return_receipt_at ? ` · ${t('admin.collectionsDetail.receipt')} ${n.return_receipt_at}` : ''}
                </div>
                {(n.mailed_to_record_address || n.mailed_to_unit_address) && (
                  <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 4 }}>
                    {t('admin.collectionsDetail.mailedTo')} {n.mailed_to_record_address || '—'}
                    {n.dual_address_required && n.mailed_to_unit_address
                      ? <> + {t('admin.collectionsDetail.unitParcelCopy')} <span style={{ background: '#175CD314', color: '#175CD3', fontWeight: 700, padding: '1px 6px', borderRadius: 999, marginLeft: 4 }}>{t('admin.collectionsDetail.bothAddresses')}</span></>
                      : null}
                  </div>
                )}
                {warn && <div className="admin-note admin-note-warn" style={{ fontSize: 11.5, marginTop: 6 }}>{warn}</div>}
                </div>
                {docType && <span style={{ alignSelf: 'center', flexShrink: 0, color: '#B54708', fontWeight: 700 }} aria-hidden="true">&rarr;</span>}
              </>
            )
            return docType
              ? <Link key={n.id} href={`/admin/collections/${id}/document?type=${docType}`} style={rowStyle}>{body}</Link>
              : <div key={n.id} style={rowStyle}>{body}</div>
          })}
          </div>
          {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setNoticePage} />}
          </>
          )
        })()}
      </section>

      {/* ---- Sworn ledger / payoff ---- */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 className="bc-title" style={{ margin: 0, display: 'flex', alignItems: 'center' }}>{t('admin.collectionsDetail.payoffLedger')}<span className="coll-payoff-badge">{t('admin.collectionsDetail.autoComputed')}</span></h2>
          {resident && (
            <button type="button" aria-pressed={frozen}
              onClick={() => {
                const next = !frozen
                setC((prev: any) => prev ? { ...prev, freeze_interest: next, freeze_late_fees: next } : prev)
                patchCase({ freeze_interest: next, freeze_late_fees: next }, next ? t('admin.collectionsDetail.freezeBoth') : t('admin.collectionsDetail.freezeBothResumed'))
              }}
              style={{ padding: '7px 16px', fontSize: 12.5, fontWeight: 600, borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .15s ease, border-color .15s ease, color .15s ease', border: `1px solid ${frozen ? '#175CD3' : '#D0D5DD'}`, background: frozen ? '#175CD3' : '#fff', color: frozen ? '#fff' : '#344054' }}>
              {t('admin.collectionsDetail.freezeBoth')}
            </button>
          )}
        </div>
        {!resident && (
          <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>
            {t('admin.collectionsDetail.linkOwnerWarning')}
          </div>
        )}
        {payoff && (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <tbody>
                <LedgerRow label={t('admin.collectionsDetail.ledgerPrincipal')} value={fmt$(payoff.gross.principal)} />
                <LedgerRow label={t('admin.collectionsDetail.ledgerInterest')} value={fmt$(payoff.gross.interest)} tag={interestFrozen ? t('admin.collectionsDetail.frozenTag') : undefined} />
                <LedgerRow label={t('admin.collectionsDetail.ledgerLateFees')} value={fmt$(payoff.gross.lateFee)} tag={lateFeesFrozen ? t('admin.collectionsDetail.frozenTag') : undefined} />
                <LedgerRow label={t('admin.collectionsDetail.ledgerCosts')} value={fmt$(Number(c.cost_balance) || 0)} />
                {(Number((c as any).mailing_cost_balance) || 0) > 0 && (
                  <LedgerRow label={t('admin.collectionsDetail.ledgerMailing')} value={fmt$((c as any).mailing_cost_balance)} />
                )}
                <LedgerRow label={t('admin.collectionsDetail.ledgerPaymentsApplied')} value={'– ' + fmt$(payoff.gross.principal + payoff.gross.interest + payoff.gross.lateFee + payoff.gross.cost - payoff.payoff)} valueColor="#067647" />
              </tbody>
            </table>
            <div className="coll-payoff-total">
              <div className="coll-payoff-total-label">{t('admin.collectionsDetail.ledgerTotal')}<span className="coll-payoff-asof">{t('admin.collectionsDetail.asOf')} {payoff.asOf}</span></div>
              <div className="coll-payoff-total-amt">{fmt$(payoff.payoff)}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 11.5, opacity: 0.6, margin: 0, flex: 1, minWidth: 240 }}>
                {t('admin.collectionsDetail.ledgerFootnote', { mo: fmtMoney(Number(community?.monthly_dues) || 0) })}
              </p>
              {resident && !showManualPay && (
                <button className="admin-btn-ghost" style={{ flexShrink: 0 }} onClick={() => setShowManualPay(true)}>+ {t('admin.collectionsDetail.recordManualPayment')}</button>
              )}
            </div>
            {resident && showManualPay && (
              <div style={{ marginTop: 12, padding: '14px 16px', background: 'rgba(0,0,0,0.025)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span className="admin-field-label">{t('admin.collectionsDetail.recordOfflinePayment')}</span>
                  <button className="admin-btn-ghost" style={{ padding: '4px 10px' }} onClick={() => setShowManualPay(false)}>{t('admin.collectionsDetail.cancel')}</button>
                </div>
                <RecordPaymentForm onSubmit={recordPayment} />
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginTop: 40, flexWrap: 'wrap' }}>
          <CostEditor caseRow={c} onSaved={(p, m) => patchCase(p, m)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#475467' }}>{t('admin.collectionsDetail.currentCosts')}: <strong style={{ color: '#1F2233', fontWeight: 700 }}>{'$' + (Math.round((Number(c.cost_balance) || 0) * 100) / 100).toLocaleString('en-US')}</strong></span>
            {snapMsg && <span style={{ fontSize: 12.5, fontWeight: 700, color: '#067647' }}>{snapMsg}</span>}
            {payoff && (
              <button className="admin-btn-ghost" onClick={() => { patchCase({
                principal_balance: payoff!.remaining.principal,
                interest_balance: payoff!.remaining.interest,
                late_fee_balance: payoff!.remaining.lateFee,
                cost_balance: payoff!.remaining.cost,
                total_balance: payoff!.payoff,
              }, ''); setSnapMsg(t('admin.collectionsDetail.balanceSnapshotSaved')) }}>{t('admin.collectionsDetail.saveBalanceSnapshot')}</button>
            )}
          </div>
        </div>
      </section>

      {/* ---- Tenant rent demand (FS 720.3085(8) / 718.116(11)) ---- */}
      {(() => {
        const leased = !!(resident && (resident.is_rented || resident.tenant_name || resident.tenant_email || resident.tenant_profile_id))
        const owed = payoff?.payoff ?? Number(c.total_balance) ?? 0
        if (!leased && !demand) return null
        return (
          <section style={card}>
            <h2 className="bc-title" style={{ marginBottom: 4 }}>{t('admin.collectionsDetail.rentDemandTitle')}</h2>
            <p className="admin-dek" style={{ marginTop: 0 }}>{t('admin.collectionsDetail.rentDemandIntro')}</p>
            {demand ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="admin-note" style={{ background: 'rgba(6,118,71,0.08)' }}>
                  {t('admin.collectionsDetail.rentDemandActive', { date: demand.demanded_at })}
                  {' · '}{t('admin.collectionsDetail.rentDemandObligation', { amount: fmt$(demand.obligation_at_demand || 0) })}
                  {' · '}{t('admin.collectionsDetail.rentDemandRemaining', { amount: fmt$(owed) })}
                  {demand.tenant_profile_id
                    ? ' · ' + t('admin.collectionsDetail.rentDemandTenantInApp')
                    : ' · ' + t('admin.collectionsDetail.rentDemandTenantNoAccount')}
                </div>
                {owed <= 0 && <div className="admin-note" style={{ background: 'rgba(6,118,71,0.12)', fontWeight: 600 }}>{t('admin.collectionsDetail.rentDemandSatisfied')}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link className="admin-btn-ghost" href={`/admin/collections/${id}/document?type=tenant_demand`}>{t('admin.collectionsDetail.rentDemandPrint')}</Link>
                  <button className="admin-btn-ghost" onClick={() => releaseDemand('paid_in_full')}>{t('admin.collectionsDetail.rentDemandReleasePaid')}</button>
                  <button className="admin-btn-ghost" onClick={() => releaseDemand('withdrawn')}>{t('admin.collectionsDetail.rentDemandWithdraw')}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="admin-primary-btn" disabled={owed <= 0} onClick={() => demandRent(owed)}
                  title={owed <= 0 ? t('admin.collectionsDetail.rentDemandNoBalance') : t('admin.collectionsDetail.rentDemandBtnTitle')}>
                  {t('admin.collectionsDetail.rentDemandBtn')}
                </button>
                <Link className="admin-btn-ghost" href={`/admin/collections/${id}/document?type=tenant_demand`}>{t('admin.collectionsDetail.rentDemandPreview')}</Link>
                {owed <= 0 && <span className="muted" style={{ fontSize: 12.5 }}>{t('admin.collectionsDetail.rentDemandNoBalance')}</span>}
              </div>
            )}
          </section>
        )
      })()}


      {/* ---- Payment plan ---- */}
      <PaymentPlanSection caseRow={c} plans={plans} profileId={profile?.id ?? null} payoffTotal={payoff ? payoff.payoff : (Number(c.total_balance) || 0)} onChange={load} onError={setError} />

      {/* ---- Generate documents ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 4 }}>{t('admin.collectionsDetail.generateDocuments')}</h2>
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>{t('admin.collectionsDetail.generateDocumentsHint')}</p>
        <div className="coll-doclist" style={{ marginTop: 10 }}>
          {DOC_LINKS.map(d => {
            const col = d.live ? '#0E7490' : '#7A5AF8'
            return (
              <a key={d.type} className="coll-docrow" href={`/admin/collections/${id}/document?type=${d.type}`}>
                <span className="coll-docrow-glyph" style={{ color: col, background: col + '18' }}>
                  {d.live ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                  )}
                </span>
                <div className="coll-docrow-main">
                  <div className="coll-docrow-title">{d.label}</div>
                  <div className="coll-docrow-desc">{d.live ? t('admin.collectionsDetail.liveDocument') : t('admin.collectionsDetail.draftTemplate')}</div>
                </div>
                <span className="coll-docrow-arrow" aria-hidden="true">&rarr;</span>
              </a>
            )
          })}
        </div>
      </section>
    </div>
  )
}

const LIEN_CITE = 'FS 718.116(5)(b) / FS 95.11(2)(c)'

// NOTE: DOC_LINKS labels are module-scope and cannot use the useT hook.
// They are left in English. See i18n notes.
// Color a statutory notice by its kind (escalating severity).
const NOTICE_COLORS: Record<string, string> = {
  late_assessment_30: '#175CD3',
  intent_to_lien_45: '#B54708',
  intent_to_foreclose_45: '#B42318',
  tenant_rent_demand: '#0E7490',
}
const noticeColor = (k: string) => NOTICE_COLORS[k] || '#175CD3'

// Map a logged notice to its printable document type, so a notice row opens the
// exact letter that was sent. Kinds without a document just aren't clickable.
const NOTICE_DOC: Record<string, string> = {
  late_assessment_30: 'notice_30',
  intent_to_lien_45: 'intent_to_lien',
  intent_to_foreclose_45: 'intent_to_foreclose',
  tenant_rent_demand: 'tenant_demand',
}

// Legal-hold reasons → their i18n label key (shared by the hold panel + the
// advance gate). A held case can't advance the ladder without a counsel ack.
const HOLD_REASON_KEY: Record<string, string> = {
  bankruptcy: 'admin.collectionsDetail.holdBankruptcy',
  scra: 'admin.collectionsDetail.holdScra',
  qualifying_offer: 'admin.collectionsDetail.holdQualifyingOffer',
  other: 'admin.collectionsDetail.holdOther',
}
const HOLD_REASON_OPTIONS = ['bankruptcy', 'scra', 'qualifying_offer', 'other']

const DOC_LINKS = [
  { type: 'notice_30', label: '30-day notice of late assessment', live: false },
  { type: 'intent_to_lien', label: '45-day intent to record lien', live: false },
  { type: 'claim_of_lien', label: 'Claim of lien (draft)', live: false },
  { type: 'intent_to_foreclose', label: '45-day intent to foreclose', live: false },
  { type: 'ledger', label: 'Sworn account ledger', live: true },
  { type: 'tenant_demand', label: 'Tenant rent demand', live: false },
  { type: 'payment_plan', label: 'Payment-plan agreement', live: false },
]

const card: React.CSSProperties = { border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: '16px 18px', background: '#fafafa', marginTop: 16 }

function LedgerRow({ label, value, valueColor, tag }: { label: string; value: string; valueColor?: string; tag?: string }) {
  return <tr><td style={{ padding: '7px 10px', borderBottom: '1px solid #EEF0F2', color: '#475467' }}>{label}{tag ? <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#175CD3', background: '#175CD314', padding: '1px 7px', borderRadius: 999, verticalAlign: 'middle' }}>{tag}</span> : null}</td><td style={{ padding: '7px 10px', borderBottom: '1px solid #EEF0F2', textAlign: 'right', fontWeight: 600, color: valueColor || '#1F2233' }}>{value}</td></tr>
}

function StageBar({ stage, esc }: {
  stage: CollectionStage
  esc: { readyAt: Date | null; label: string; citation: string } | null
}) {
  const t = useT()
  if (stage === 'resolved' || stage === 'cancelled') {
    return (
      <div className="coll-steps coll-steps-terminal">
        <span className="coll-step-node is-done" style={{ background: stage === 'resolved' ? '#067647' : '#98A2B3' }}>✓</span>
        <span className="coll-step-label" style={{ marginTop: 0, fontWeight: 700 }}>{STAGE_LABELS[stage]}</span>
      </div>
    )
  }
  // Each statutory stage carries its required notice/waiting period (days). The
  // current stage also shows a LIVE countdown (or "Ready now") from esc.readyAt.
  const steps: { key: CollectionStage; label: string; days: number }[] = [
    { key: 'delinquent',          label: t('admin.collectionsDetail.stageDelinquent'),        days: 0 },
    { key: 'notice_30',           label: t('admin.collectionsDetail.stage30day'),             days: NOTICE_30_DAY_DAYS.value },
    { key: 'intent_to_lien',      label: t('admin.collectionsDetail.stageIntentToLien'),      days: INTENT_TO_LIEN_DAYS.value },
    { key: 'lien_recorded',       label: t('admin.collectionsDetail.stageLien'),              days: 0 },
    { key: 'intent_to_foreclose', label: t('admin.collectionsDetail.stageIntentToForeclose'), days: INTENT_TO_FORECLOSE_DAYS.value },
    { key: 'foreclosure',         label: t('admin.collectionsDetail.stageForeclosure'),       days: 0 },
  ]
  const cur = steps.findIndex(s => s.key === stage)
  let live: { txt: string; ready: boolean } | null = null
  if (esc?.readyAt) {
    const daysLeft = Math.ceil((esc.readyAt.getTime() - Date.now()) / 86400000)
    live = daysLeft <= 0
      ? { txt: t('admin.collectionsDetail.stageReady'), ready: true }
      : { txt: `${daysLeft} ${t('admin.collectionsDetail.days')}`, ready: false }
  }
  // Statutorily required mailing method for the rungs that send a notice, shown
  // on hover. Admin is English-only, so these aren't routed through i18n.
  const METHOD_HINT: Partial<Record<CollectionStage, string>> = {
    notice_30: 'Required delivery: first-class mail',
    intent_to_lien: 'Required delivery: certified + first-class mail (statutory dual delivery)',
    intent_to_foreclose: 'Required delivery: certified + first-class mail',
  }
  return (
    <div className="coll-steps">
      {steps.map((s, i) => {
        const done = i < cur
        const current = i === cur
        return (
          <div key={s.key} className={`coll-step${i <= cur ? ' is-reached' : ''}`}
            title={METHOD_HINT[s.key]}
            style={METHOD_HINT[s.key] ? { cursor: 'help' } : undefined}>
            <span className={`coll-step-node ${done ? 'is-done' : current ? 'is-current' : 'is-future'}`}>
              {done ? '✓' : i + 1}
            </span>
            <span className="coll-step-label">{s.label}</span>
            {s.days > 0 && <span className="coll-step-days">{s.days} {t('admin.collectionsDetail.days')}</span>}
            {current && live && <span className={`coll-step-live${live.ready ? ' is-ready' : ''}`}>{live.txt}</span>}
          </div>
        )
      })}
    </div>
  )
}

// First-class for the late-assessment notice (statutory), certified+first-class
// dual delivery for the lien/foreclosure notices.
const defaultMethod = (kind?: CollectionNoticeKind | null): string =>
  kind === 'late_assessment_30' || kind === 'tenant_rent_demand' ? 'first_class' : 'both'

function StageActions({ adv, caseRow, communityId, profileId, resident, regime, legalHoldLabel, onAdvanced, onError }: {
  adv: Advance | null; caseRow: CollectionCaseRow; communityId: string; profileId: string | null
  resident: any; regime: 'condo' | 'hoa'
  legalHoldLabel: string | null
  onAdvanced: () => void; onError: (m: string) => void
}) {
  const t = useT()
  const [openComposer, setOpenComposer] = useState(false)
  const [form, setForm] = useState<any>({ date: todayYmd(), method: 'both', tracking: '', recipient: '' })
  const [busy, setBusy] = useState(false)
  // When the case is under a legal hold, advancing the ladder requires an explicit
  // counsel-reviewed acknowledgment (the one place a blocking gate is justified).
  const [ack, setAck] = useState(false)
  // Terminal foreclosure note — pushed hard-right in the action row, deep-red so
  // it reads as the most severe stage (matches the resident tier-4 escalation).
  if (!adv) return <div className="admin-note" style={{ fontSize: 12.5, marginTop: 0, marginLeft: 'auto', padding: '8px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#7F1D1D', background: 'rgba(127,29,29,0.10)', border: '1px solid rgba(127,29,29,0.5)' }}>{t('admin.collectionsDetail.foreclosureFiled')}</div>

  // The statutory dual-address rule for this notice, resolved against the owner's
  // roster addresses (mailing address of record vs. the unit/parcel address).
  const rule = adv.notice ? dualAddressRule(adv.notice, regime) : null
  const addrInput = ownerNoticeAddresses(resident)
  const resolved = resolveNoticeAddresses(addrInput)
  const addrWarn = adv.notice ? noticeAddressWarning(adv.notice, regime, addrInput) : null

  const run = async () => {
    setBusy(true)
    try {
      if (adv.needsNotice && adv.notice) {
        const applies = !!rule?.applies
        const { error: nErr } = (await withTimeout(supabase.from('ev_collection_notices').insert({
          community_id: communityId,
          case_id: caseRow.id,
          kind: adv.notice,
          sent_at: form.date || todayYmd(),
          method: form.method || null,
          tracking_number: (form.tracking || '').trim() || null,
          recipient_name: (form.recipient || '').trim() || null,
          // dual-address evidence — the address(es) this notice was mailed to
          mailed_to_record_address: applies ? (resolved.recordAddress || null) : null,
          mailed_to_unit_address: applies ? (resolved.unitAddress || null) : null,
          dual_address_required: applies ? resolved.dualRequired : null,
          created_by: profileId,
        }))) as any
        if (nErr) throw nErr
        await logAudit({ community_id: communityId, event_type: 'collection.notice_logged', target_type: 'collection_case', target_id: caseRow.id, metadata: { kind: adv.notice, dual_address: !!(rule?.applies && resolved.dualRequired) } })
      }
      const patch: any = { stage: adv.nextStage, [adv.stampField]: form.date || todayYmd() }
      const { error: uErr } = (await withTimeout(supabase.from('ev_collection_cases').update(patch).eq('id', caseRow.id))) as any
      if (uErr) throw uErr
      await logAudit({ community_id: communityId, event_type: 'collection.stage_changed', target_type: 'collection_case', target_id: caseRow.id, metadata: { to: adv.nextStage } })
      setOpenComposer(false)
      setForm({ date: todayYmd(), method: 'both', tracking: '', recipient: '' })
      onAdvanced()
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.couldNotAdvanceCase')) }
    finally { setBusy(false) }
  }

  if (!openComposer) return <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} onClick={() => { setForm({ date: todayYmd(), method: defaultMethod(adv.notice), tracking: '', recipient: '' }); setAck(false); setOpenComposer(true) }}>{adv.label}</button>

  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, width: '100%', flexBasis: '100%', marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{adv.label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <label className="admin-field"><span className="admin-field-label">{adv.needsNotice ? t('admin.collectionsDetail.dateSent') : t('admin.collectionsDetail.date')}</span>
          <input className="admin-input" type="date" value={form.date} onChange={e => setForm((f: any) => ({ ...f, date: e.target.value }))} /></label>
        {adv.needsNotice && (
          <>
            <div className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.deliveryMethod')}</span>
              <Dropdown<string>
                value={form.method}
                onChange={v => setForm((f: any) => ({ ...f, method: v }))}
                ariaLabel={t('admin.collectionsDetail.deliveryMethod')}
                options={METHODS.map(m => ({ value: m.value, label: m.label }))}
              /></div>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.trackingNumber')}</span>
              <input className="admin-input" value={form.tracking} placeholder={t('admin.collectionsDetail.trackingPlaceholder')} onChange={e => setForm((f: any) => ({ ...f, tracking: e.target.value }))} /></label>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.addressedTo')}</span>
              <input className="admin-input" value={form.recipient} placeholder={t('admin.collectionsDetail.addressedToPlaceholder')} onChange={e => setForm((f: any) => ({ ...f, recipient: e.target.value }))} /></label>
          </>
        )}
      </div>

      {/* Dual-address advisory for the statutory collection notices */}
      {adv.needsNotice && rule?.applies && (
        <div className="admin-note" style={{ fontSize: 12, marginTop: 10, borderColor: addrWarn ? '#B54708' : (resolved.dualRequired ? '#175CD3' : 'rgba(0,0,0,0.1)') }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('admin.collectionsDetail.mailingAddress')}{resolved.dualRequired ? t('admin.collectionsDetail.mailingAddressPlural') : ''} ({rule.citation})</div>
          {resolved.addresses.length > 0 ? (
            <ul style={{ margin: '0 0 0 16px', padding: 0 }}>
              <li>{t('admin.collectionsDetail.addressOfRecord')}: <strong>{resolved.recordAddress || '—'}</strong></li>
              {resolved.dualRequired && <li>+ {t('admin.collectionsDetail.unitParcelCopyDiffer')}: <strong>{resolved.unitAddress}</strong></li>}
            </ul>
          ) : <div>{t('admin.collectionsDetail.noAddressOnFile')}</div>}
          {resolved.dualRequired && !addrWarn && <div style={{ marginTop: 4 }}>{t('admin.collectionsDetail.loggedAsBothAddresses')}</div>}
          {addrWarn && <div style={{ marginTop: 4, color: '#B54708' }}>{addrWarn}</div>}
          <div style={{ marginTop: 4, opacity: 0.7 }}>{rule.note} {t('admin.collectionsDetail.updateAddressesOnRoster')}</div>
        </div>
      )}

      {legalHoldLabel && (
        <div className="admin-note admin-note-err" style={{ fontSize: 12, marginTop: 10 }}>
          <div style={{ fontWeight: 700 }}>{t('admin.collectionsDetail.advanceUnderHoldWarn', { reason: legalHoldLabel })}</div>
          <label style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 2 }} />
            <span>{t('admin.collectionsDetail.advanceUnderHoldAck')}</span>
          </label>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="admin-btn-ghost" disabled={busy} onClick={() => setOpenComposer(false)}>{t('admin.collectionsDetail.cancel')}</button>
        <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} disabled={busy || (!!legalHoldLabel && !ack)} onClick={run}>{busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.confirm')}</button>
      </div>
    </div>
  )
}

function CostEditor({ caseRow, onSaved }: { caseRow: CollectionCaseRow; onSaved: (p: any, m: string) => void }) {
  const t = useT()
  const [amt, setAmt] = useState('')
  return (
    <div>
      <span className="admin-field-label" style={{ display: 'block', marginBottom: 6, whiteSpace: 'nowrap' }}>{t('admin.collectionsDetail.addCostLabel')}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="admin-input" type="number" min="0" step="0.01" style={{ width: 150 }} value={amt} onChange={e => setAmt(e.target.value)} />
        <button className="admin-btn-ghost" disabled={!amt} onClick={() => { onSaved({ cost_balance: (Number(caseRow.cost_balance) || 0) + Number(amt) }, t('admin.collectionsDetail.costRecorded')); setAmt('') }}>{t('admin.collectionsDetail.addCost')}</button>
      </div>
    </div>
  )
}

// Per-case legal hold (bankruptcy stay / SCRA / qualifying-offer / other), backed
// by ev_legal_holds. Either the owner self-reports (status 'requested') or the
// board requests confirmation ('pending_resident'); the board verifies before it
// goes 'active'. Active shows a red banner + qualifying-offer countdown and the
// advance gate then requires a counsel ack.
function LegalHoldPanel({ hold, resident, formOpen, setFormOpen, onPlace, onRequest, onVerify, onDeny, onRelease }: {
  hold: any; resident: any
  formOpen: boolean; setFormOpen: (v: boolean) => void
  onPlace: (reason: string, note: string) => void
  onRequest: (reason: string) => void
  onVerify: () => void
  onDeny: (reason: string) => void
  onRelease: () => void
}) {
  const t = useT()
  const [form, setForm] = useState<{ reason: string; note: string }>({ reason: 'bankruptcy', note: '' })
  const [denyMode, setDenyMode] = useState(false)
  const [denyReason, setDenyReason] = useState('')
  const status = hold?.status ?? null
  const label = (r?: string | null) => t(HOLD_REASON_KEY[r || 'other'] || 'admin.collectionsDetail.holdOther')

  // ACTIVE — red banner, qualifying-offer countdown, release.
  if (status === 'active') {
    const at = hold.requested_at || hold.decided_at || null
    const stayEnds = hold.reason === 'qualifying_offer' && at ? addCalendarDays(at, QUALIFYING_OFFER_STAY_DAYS.value) : null
    const daysLeft = stayEnds ? calendarDaysUntil(stayEnds, new Date()) : null
    return (
      <div className="admin-note admin-note-err" style={{ marginBottom: 10, fontSize: 12.5 }}>
        <div style={{ fontWeight: 800 }}>{t('admin.collectionsDetail.legalHoldActive', { reason: label(hold.reason) })}</div>
        <div style={{ marginTop: 4 }}>{t('admin.collectionsDetail.legalHoldBlurb')}{at ? ` ${t('admin.collectionsDetail.legalHoldPlacedOn', { date: at })}` : ''}</div>
        {hold.note && <div style={{ marginTop: 4, opacity: 0.85 }}>{hold.note}</div>}
        {stayEnds && (
          <div style={{ marginTop: 4, fontWeight: 700 }}>
            {daysLeft != null && daysLeft >= 0
              ? t('admin.collectionsDetail.qualifyingOfferStayEnds', { date: ymd(stayEnds), days: daysLeft })
              : t('admin.collectionsDetail.qualifyingOfferStayEnded', { date: ymd(stayEnds) })}
          </div>
        )}
        <button className="admin-btn-ghost" style={{ marginTop: 8 }} onClick={onRelease}>{t('admin.collectionsDetail.releaseHold')}</button>
      </div>
    )
  }

  // REQUESTED — owner reported / responded; board verifies or denies.
  if (status === 'requested') {
    return (
      <div className="admin-note admin-note-warn" style={{ marginBottom: 10, fontSize: 12.5 }}>
        <div style={{ fontWeight: 800 }}>{t('admin.collectionsDetail.legalHoldReview', { reason: label(hold.reason) })}</div>
        {hold.note && <div style={{ marginTop: 4, opacity: 0.85 }}>{hold.note}</div>}
        <div style={{ marginTop: 4, opacity: 0.7 }}>{t('admin.collectionsDetail.legalHoldVerifyHint')}</div>
        {denyMode ? (
          <div style={{ marginTop: 8 }}>
            <input className="admin-input" placeholder={t('admin.collectionsDetail.denialReasonLabel')} value={denyReason} onChange={e => setDenyReason(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button className="admin-btn-ghost" onClick={() => setDenyMode(false)}>{t('admin.collectionsDetail.cancel')}</button>
              <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} onClick={() => onDeny(denyReason)}>{t('admin.collectionsDetail.confirmDenial')}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="admin-btn-ghost" onClick={() => setDenyMode(true)}>{t('admin.collectionsDetail.deny')}</button>
            <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} onClick={onVerify}>{t('admin.collectionsDetail.legalHoldVerify')}</button>
          </div>
        )}
      </div>
    )
  }

  // PENDING_RESIDENT — board asked the owner; awaiting their response.
  if (status === 'pending_resident') {
    return (
      <div className="admin-note" style={{ marginBottom: 10, fontSize: 12.5 }}>
        <div style={{ fontWeight: 700 }}>{t('admin.collectionsDetail.legalHoldAwaitingResident', { reason: label(hold.reason) })}</div>
        <button className="admin-btn-ghost" style={{ marginTop: 8 }} onClick={onRelease}>{t('admin.collectionsDetail.cancelRequest')}</button>
      </div>
    )
  }

  // No open hold + form closed → trigger lives in the section header.
  if (!formOpen) return null

  // No open hold + form open → place now OR request confirmation from the owner.
  const ownerHasAccount = !!resident?.profile_id
  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{t('admin.collectionsDetail.legalHoldManage')}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="admin-field" style={{ minWidth: 220 }}><span className="admin-field-label">{t('admin.collectionsDetail.holdReason')}</span>
          <Dropdown<string>
            value={form.reason}
            onChange={v => setForm(f => ({ ...f, reason: v }))}
            ariaLabel={t('admin.collectionsDetail.holdReason')}
            options={HOLD_REASON_OPTIONS.map(r => ({ value: r, label: t(HOLD_REASON_KEY[r]) }))}
          /></div>
        <label className="admin-field" style={{ flex: 1, minWidth: 180 }}><span className="admin-field-label">{t('admin.collectionsDetail.holdNote')}</span>
          <input className="admin-input" value={form.note} placeholder={t('admin.collectionsDetail.holdNotePlaceholder')} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="admin-btn-ghost" disabled={!ownerHasAccount} title={ownerHasAccount ? '' : t('admin.collectionsDetail.holdNeedsAccount')} onClick={() => { onRequest(form.reason); setFormOpen(false) }}>{t('admin.collectionsDetail.requestFromResident')}</button>
        <button className="admin-btn-ghost" onClick={() => setFormOpen(false)}>{t('admin.collectionsDetail.cancel')}</button>
        <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} onClick={() => { onPlace(form.reason, form.note); setFormOpen(false) }}>{t('admin.collectionsDetail.placeHoldBtn')}</button>
      </div>
      {!ownerHasAccount && <p style={{ fontSize: 11.5, opacity: 0.7, margin: '8px 0 0' }}>{t('admin.collectionsDetail.holdNeedsAccount')}</p>}
    </div>
  )
}

function PaymentPlanSection({ caseRow, plans, profileId, payoffTotal, onChange, onError }: {
  caseRow: CollectionCaseRow; plans: PaymentPlanRow[]; profileId: string | null
  payoffTotal: number
  onChange: () => void; onError: (m: string) => void
}) {
  const t = useT()
  // A resident-requested plan awaiting review takes priority over the active
  // panel (it still has status='active', so split it out by request_status).
  const requested = plans.find(p => p.request_status === 'requested')
  const active = plans.find(p => String(p.status) === 'active' && p.request_status !== 'requested')
  const [form, setForm] = useState<any>({ installment_amount: '', installment_count: '', frequency_days: 30, start_date: todayYmd() })
  const [busy, setBusy] = useState(false)
  // Review sub-form for a resident request: null = show decision buttons.
  const [review, setReview] = useState<any>({ mode: null, amount: '', count: '', freq: '', reason: '' })
  const [planOpen, setPlanOpen] = useState(false)
  const [planMsg, setPlanMsg] = useState('')
  useEffect(() => { if (!planMsg) return; const x = setTimeout(() => setPlanMsg(''), 4000); return () => clearTimeout(x) }, [planMsg])
  const [editPlan, setEditPlan] = useState<any>(null)

  const create = async () => {
    setBusy(true)
    try {
      const freq = Number(form.frequency_days) || 30
      // First installment is due at the plan start (installment #1 in the schedule
      // render + the printed agreement + the resident-request approve path all use
      // the start date). recordInstallment then advances next_due by one cadence.
      const startDate = form.start_date || todayYmd()
      const { data: newPlan, error } = (await withTimeout(supabase.from('ev_payment_plans').insert({
        community_id: caseRow.community_id,
        case_id: caseRow.id,
        status: 'active',
        start_date: startDate,
        installment_amount: form.installment_amount ? Number(form.installment_amount) : null,
        installment_count: form.installment_count ? Number(form.installment_count) : null,
        frequency_days: freq,
        next_due_at: startDate,
        paid_count: 0,
        created_by: profileId,
      }).select('id').single())) as any
      if (error) throw error
      await withTimeout(supabase.from('ev_collection_cases').update({ on_payment_plan: true }).eq('id', caseRow.id))
      await logAudit({ community_id: caseRow.community_id!, event_type: 'collection.payment_plan_created', target_type: 'payment_plan', target_id: newPlan?.id ?? null })
      onChange()
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.couldNotCreatePlan')) }
    finally { setBusy(false) }
  }

  const recordInstallment = async (p: PaymentPlanRow) => {
    if (busy) return // guard a double-click from double-posting (or silently dropping the 2nd intended installment via the dedupe key)
    setBusy(true)
    const paid = (Number(p.paid_count) || 0) + 1
    const freq = Number(p.frequency_days) || 30
    const done = p.installment_count != null && paid >= Number(p.installment_count)
    // Advance the next due date; harden against a missing/unparseable stored date.
    const next = done ? null : (addCalendarDays(p.next_due_at || todayYmd(), freq) || addCalendarDays(todayYmd(), freq))
    try {
      // Post the installment as a REAL payment so it lands in the payoff ledger
      // (payments-applied grows, balance drops). Deterministic client_key →
      // idempotent, so a double-click can't double-post. This is why a later
      // cancel/default still shows the paid amounts applied with the rest owed.
      const amt = Number(p.installment_amount) || 0
      if (amt > 0 && (caseRow as any).resident_id) {
        const { error: payErr } = await supabase.rpc('record_offline_payment', {
          p_community: caseRow.community_id,
          p_resident: (caseRow as any).resident_id,
          p_amount: amt,
          p_method: 'other',
          p_paid_on: todayYmd(),
          p_memo: `Plan installment ${paid}${p.installment_count != null ? '/' + p.installment_count : ''}`,
          p_client_key: `${p.id}:inst:${paid}`,
          p_case: caseRow.id,
        })
        if (payErr) throw payErr
      }
      await withTimeout(supabase.from('ev_payment_plans').update({
        paid_count: paid,
        // Completed plans have no next installment → clear the date.
        next_due_at: done ? null : (next ? ymd(next) : p.next_due_at),
        status: done ? 'completed' : 'active',
      }).eq('id', p.id))
      if (done) await withTimeout(supabase.from('ev_collection_cases').update({ on_payment_plan: false }).eq('id', caseRow.id))
      await logAudit({ community_id: caseRow.community_id!, event_type: 'collection.payment_plan_updated', target_type: 'payment_plan', target_id: p.id, metadata: { paid_count: paid, amount: amt } })
      onChange()
      setPlanOpen(true)
      setPlanMsg(done
        ? t('admin.collectionsDetail.planComplete')
        : `${t('admin.collectionsDetail.installmentRecorded')}: ${paid}${p.installment_count != null ? '/' + p.installment_count : ''} ${t('admin.collectionsDetail.paid')}`)
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.updateFailed')) }
    finally { setBusy(false) }
  }

  // Edit an ACTIVE plan in place — raise the installment, add installments
  // (extend), or change the cadence. Recomputes the next due from installments
  // already paid so the schedule stays consistent.
  const savePlanEdit = async (p: PaymentPlanRow) => {
    setBusy(true)
    try {
      const amount = Number(editPlan.amount) || 0
      const count = editPlan.count === '' || editPlan.count == null ? null : Number(editPlan.count)
      const freq = Number(editPlan.freq) || 30
      const paidN = Number(p.paid_count) || 0
      const finished = count != null && paidN >= count
      const next = finished ? null : addCalendarDays(p.start_date || todayYmd(), paidN * freq)
      await withTimeout(supabase.from('ev_payment_plans').update({
        installment_amount: amount || null,
        installment_count: count,
        frequency_days: freq,
        next_due_at: finished ? null : (next ? ymd(next) : p.next_due_at),
        status: finished ? 'completed' : 'active',
      }).eq('id', p.id))
      if (finished) await withTimeout(supabase.from('ev_collection_cases').update({ on_payment_plan: false }).eq('id', caseRow.id))
      await logAudit({ community_id: caseRow.community_id!, event_type: 'collection.payment_plan_updated', target_type: 'payment_plan', target_id: p.id, metadata: { edited: true } })
      onChange(); setEditPlan(null); setPlanOpen(true)
      setPlanMsg(t('admin.collectionsDetail.planUpdated'))
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.updateFailed')) }
    finally { setBusy(false) }
  }

  const endPlan = async (p: PaymentPlanRow, status: 'defaulted' | 'cancelled') => {
    try {
      await withTimeout(supabase.from('ev_payment_plans').update({ status }).eq('id', p.id))
      await withTimeout(supabase.from('ev_collection_cases').update({ on_payment_plan: false }).eq('id', caseRow.id))
      onChange()
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.updateFailed')) }
  }

  // Decide a resident's plan request (ARC-style). 'modified' lets the board
  // overwrite the proposed terms before approving; 'denied' requires a reason.
  // The DB trigger fires the owner notice on the request_status change.
  const decideRequest = async (
    p: PaymentPlanRow,
    decision: 'approved' | 'modified' | 'denied',
    opts: { amount?: string; count?: string; freq?: string; reason?: string } = {},
  ) => {
    setBusy(true)
    try {
      const patch: any = { request_status: decision, decided_at: todayYmd(), decided_by: profileId }
      if (decision === 'denied') {
        patch.decision_reason = (opts.reason || '').trim() || null
        patch.status = 'cancelled'
      } else {
        // Working terms = proposal, unless the board modified them.
        patch.installment_amount = opts.amount != null && opts.amount !== '' ? Number(opts.amount) : Number(p.installment_amount)
        patch.installment_count = opts.count != null && opts.count !== '' ? Number(opts.count) : Number(p.installment_count)
        patch.frequency_days = opts.freq != null && opts.freq !== '' ? Number(opts.freq) : (Number(p.frequency_days) || 30)
        // First installment is due at the plan start so the resident can pay now.
        patch.start_date = p.start_date || todayYmd()
        patch.next_due_at = p.start_date || todayYmd()
      }
      await withTimeout(supabase.from('ev_payment_plans').update(patch).eq('id', p.id))
      if (decision !== 'denied') {
        await withTimeout(supabase.from('ev_collection_cases').update({ on_payment_plan: true }).eq('id', caseRow.id))
      }
      await logAudit({
        community_id: caseRow.community_id!, event_type: 'collection.payment_plan_decided',
        target_type: 'payment_plan', target_id: p.id, metadata: { decision },
      })
      setReview({ mode: null, amount: '', count: '', freq: '', reason: '' })
      onChange()
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.couldNotRecordDecision')) }
    finally { setBusy(false) }
  }

  return (
    <section style={card}>
      <h2 className="bc-title" style={{ marginBottom: 10 }}>{t('admin.collectionsDetail.paymentPlan')}</h2>
      {requested ? (
        <div style={{ border: '1px solid rgba(225,73,9,0.3)', borderRadius: 10, padding: '12px 14px', background: 'rgba(225,73,9,0.04)' }}>
          <div style={{ fontWeight: 800, color: '#B54708', fontSize: 12.5, letterSpacing: 0.3, textTransform: 'uppercase' }}>{t('admin.collectionsDetail.ownerRequestedPlan')}</div>
          <div style={{ fontWeight: 700, marginTop: 6 }}>
            {fmt$(requested.requested_amount ?? requested.installment_amount)} × {requested.requested_count ?? requested.installment_count ?? '—'}
            {' '}{t('admin.collectionsDetail.every')} {requested.requested_frequency_days ?? requested.frequency_days ?? 30} {t('admin.collectionsDetail.days')}
          </div>
          {requested.autopay_opt_in && <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>{t('admin.collectionsDetail.autopayOptIn')}</div>}

          {review.mode === 'modify' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, alignItems: 'flex-end', marginTop: 10 }}>
              <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.installmentAmount')}</span>
                <input className="admin-input" type="number" min="0" step="0.01"
                  value={review.amount === '' ? (requested.requested_amount ?? requested.installment_amount ?? '') : review.amount}
                  onChange={e => setReview((r: any) => ({ ...r, amount: e.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.numberOfInstallments')}</span>
                <input className="admin-input" type="number" min="1" step="1"
                  value={review.count === '' ? (requested.requested_count ?? requested.installment_count ?? '') : review.count}
                  onChange={e => setReview((r: any) => ({ ...r, count: e.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.everyDays')}</span>
                <input className="admin-input" type="number" min="1" step="1"
                  value={review.freq === '' ? (requested.requested_frequency_days ?? requested.frequency_days ?? 30) : review.freq}
                  onChange={e => setReview((r: any) => ({ ...r, freq: e.target.value }))} /></label>
              <button className="admin-btn-ghost" onClick={() => setReview({ mode: null, amount: '', count: '', freq: '', reason: '' })}>{t('admin.collectionsDetail.back')}</button>
              <button className="admin-primary-btn" disabled={busy}
                onClick={() => decideRequest(requested, 'modified', { amount: review.amount, count: review.count, freq: review.freq })}>
                {busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.approveWithTerms')}
              </button>
            </div>
          ) : review.mode === 'deny' ? (
            <div style={{ marginTop: 10 }}>
              <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.denialReasonLabel')}</span>
                <textarea className="admin-input" rows={2} value={review.reason}
                  onChange={e => setReview((r: any) => ({ ...r, reason: e.target.value }))} /></label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <button className="admin-btn-ghost" onClick={() => setReview({ mode: null, amount: '', count: '', freq: '', reason: '' })}>{t('admin.collectionsDetail.back')}</button>
                <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} disabled={busy || !review.reason.trim()}
                  onClick={() => decideRequest(requested, 'denied', { reason: review.reason })}>
                  {busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.confirmDenial')}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="admin-btn-ghost" onClick={() => setReview((r: any) => ({ ...r, mode: 'modify' }))}>{t('admin.collectionsDetail.modifyTerms')}</button>
              <button className="admin-btn-ghost" onClick={() => setReview((r: any) => ({ ...r, mode: 'deny' }))}>{t('admin.collectionsDetail.deny')}</button>
              <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => decideRequest(requested, 'approved')}>{t('admin.collectionsDetail.approveAsProposed')}</button>
            </div>
          )}
        </div>
      ) : active ? (
        <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '12px 14px', background: 'linear-gradient(180deg, #F4FBFC, #fff 60%)' }}>
          <button type="button" onClick={() => setPlanOpen(o => !o)}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', boxSizing: 'border-box', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>
              <span style={{ display: 'block', fontWeight: 700 }}>
                {fmt$(active.installment_amount)} {t('admin.collectionsDetail.every')} {active.frequency_days} {t('admin.collectionsDetail.days')}
                {active.installment_count ? ` · ${active.paid_count ?? 0}/${active.installment_count} ${t('admin.collectionsDetail.paid')}` : ` · ${active.paid_count ?? 0} ${t('admin.collectionsDetail.paid')}`}
              </span>
              <span style={{ display: 'block', fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>{t('admin.collectionsDetail.started')} {active.start_date} · {t('admin.collectionsDetail.nextDue')} {active.next_due_at || '—'}</span>
            </span>
            <span style={{ color: '#98A2B3', fontSize: 12, flexShrink: 0 }}>{planOpen ? '▲' : '▼'}</span>
          </button>

          {active.installment_count != null && (
            <div style={{ height: 7, borderRadius: 4, background: '#E6ECEE', overflow: 'hidden', marginTop: 10 }}>
              <div style={{ height: '100%', width: `${Math.min(100, ((Number(active.paid_count) || 0) / (Number(active.installment_count) || 1)) * 100)}%`, background: 'linear-gradient(90deg, #0E7490, #22A06B)', transition: 'width .45s ease' }} />
            </div>
          )}
          {planMsg && (
            <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', color: '#067647', fontWeight: 700, fontSize: 13, background: '#06764712', padding: '6px 12px', borderRadius: 999 }}>
              {planMsg}
            </div>
          )}
          {active.installment_count != null && (() => {
            const remaining = (Number(active.installment_amount) || 0) * (Number(active.installment_count) - (Number(active.paid_count) || 0))
            const short = payoffTotal - remaining
            if (short <= 0.5) return null
            return <div style={{ marginTop: 10, fontSize: 12.5, color: '#B42318', fontWeight: 600 }}>{t('admin.collectionsDetail.planShortfallActive', { short: fmt$(short) })}</div>
          })()}

          {planOpen && active.installment_count != null && (
            <div style={{ marginTop: 12, borderTop: '1px solid #F2F4F7', paddingTop: 8 }}>
              {Array.from({ length: Number(active.installment_count) || 0 }).map((_, i) => {
                const due = addCalendarDays(active.start_date || todayYmd(), i * (Number(active.frequency_days) || 30))
                const paidN = Number(active.paid_count) || 0
                const st = i < paidN ? 'paid' : i === paidN ? 'next' : 'upcoming'
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', color: st === 'upcoming' ? '#98A2B3' : '#475467' }}>
                    <span>#{i + 1} · {fmt$(active.installment_amount)}</span>
                    <span style={{ fontWeight: st === 'next' ? 700 : 400, color: st === 'paid' ? '#067647' : st === 'next' ? '#B54708' : undefined }}>
                      {due ? ymd(due) : '—'}{st === 'paid' ? ` · ${t('admin.collectionsDetail.paid')}` : st === 'next' ? ` · ${t('admin.collectionsDetail.nextDue')}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {editPlan && (
            <div style={{ marginTop: 12, padding: '12px 14px', border: '1px dashed #cbd5e1', borderRadius: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, alignItems: 'flex-end' }}>
                <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.installmentAmount')}</span>
                  <input className="admin-input" type="number" min="0" step="0.01" value={editPlan.amount ?? ''} onChange={e => setEditPlan((p: any) => ({ ...p, amount: e.target.value }))} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.numberOfInstallments')}</span>
                  <input className="admin-input" type="number" min="1" step="1" value={editPlan.count ?? ''} onChange={e => setEditPlan((p: any) => ({ ...p, count: e.target.value }))} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.everyDays')}</span>
                  <input className="admin-input" type="number" min="1" step="1" value={editPlan.freq ?? ''} onChange={e => setEditPlan((p: any) => ({ ...p, freq: e.target.value }))} /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {payoffTotal > 0 && (
                  <button className="admin-btn-ghost" type="button" onClick={() => {
                    const count = Number(editPlan.count) || 6
                    const amount = Math.ceil((payoffTotal / count) * 100) / 100
                    setEditPlan((p: any) => ({ ...p, count: String(count), amount: String(amount) }))
                  }}>{t('admin.collectionsDetail.suggestPlan')}</button>
                )}
                <button className="admin-btn-ghost" onClick={() => setEditPlan(null)}>{t('admin.collectionsDetail.cancel')}</button>
                <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => savePlanEdit(active)}>{busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.saveChanges')}</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="admin-btn-ghost" onClick={() => setEditPlan({ amount: active.installment_amount ?? '', count: active.installment_count ?? '', freq: active.frequency_days ?? 30 })}>{t('admin.collectionsDetail.editPlan')}</button>
            <button className="admin-btn-ghost" onClick={() => endPlan(active, 'defaulted')}>{t('admin.collectionsDetail.markDefaulted')}</button>
            <button className="admin-btn-ghost" onClick={() => endPlan(active, 'cancelled')}>{t('admin.collectionsDetail.cancelPlan')}</button>
            <button className="admin-primary-btn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => recordInstallment(active)}>{busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.recordInstallmentPaid')}</button>
          </div>
        </div>
      ) : (
        <>
          {payoffTotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, color: '#475467' }}>{t('admin.collectionsDetail.balanceToCover')}: <strong style={{ color: '#B54708' }}>{fmt$(payoffTotal)}</strong></span>
              <button className="admin-btn-ghost" type="button" onClick={() => {
                const count = Number(form.installment_count) || 6
                const amount = Math.ceil((payoffTotal / count) * 100) / 100
                setForm((f: any) => ({ ...f, installment_count: String(count), installment_amount: String(amount) }))
              }}>{t('admin.collectionsDetail.suggestPlan')}</button>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'flex-end' }}>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.installmentAmount')}</span>
              <input className="admin-input" type="number" min="0" step="0.01" value={form.installment_amount} onChange={e => setForm((f: any) => ({ ...f, installment_amount: e.target.value }))} /></label>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.numberOfInstallments')}</span>
              <input className="admin-input" type="number" min="1" step="1" value={form.installment_count} onChange={e => setForm((f: any) => ({ ...f, installment_count: e.target.value }))} /></label>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.everyDays')}</span>
              <input className="admin-input" type="number" min="1" step="1" value={form.frequency_days} onChange={e => setForm((f: any) => ({ ...f, frequency_days: e.target.value }))} /></label>
            <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.start')}</span>
              <input className="admin-input" type="date" value={form.start_date} onChange={e => setForm((f: any) => ({ ...f, start_date: e.target.value }))} /></label>
            <button className="admin-primary-btn" disabled={busy} onClick={create}>{busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.createPlan')}</button>
          </div>
          {(() => {
            const planTotal = (Number(form.installment_amount) || 0) * (Number(form.installment_count) || 0)
            if (planTotal <= 0 || payoffTotal <= 0) return null
            const short = payoffTotal - planTotal
            if (short <= 0.5) return <div style={{ marginTop: 10, fontSize: 12.5, color: '#067647', fontWeight: 600 }}>{t('admin.collectionsDetail.planCovers', { total: fmt$(planTotal) })}</div>
            return <div style={{ marginTop: 10, fontSize: 12.5, color: '#B42318', fontWeight: 600 }}>{t('admin.collectionsDetail.planShortfall', { plan: fmt$(planTotal), balance: fmt$(payoffTotal), short: fmt$(short) })}</div>
          })()}
        </>
      )}
    </section>
  )
}
