'use client'

// Collection case detail — the statutory collection ladder workspace
// (FS 718.116/.121 condo / FS 720.3085/.305 HOA). Log each statutory notice,
// advance the stage, watch the waiting periods + lien-enforcement window, record
// collection costs, run a payment plan, and generate the draft letters / sworn
// ledger. Advisory posture: every gate says "you may proceed" — nothing blocks.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { ymd, toDate, addCalendarDays, calendarDaysUntil } from '@/lib/compliance/rules-core'
import { casePayoff, fmtMoney, type PayoffResult } from '@/lib/dues'
import { RecordPaymentForm } from '@/components/RecordPaymentForm'
import { Dropdown } from '@/components/Dropdown'
import { AttorneyNote } from '../../AttorneyNote'
import { useT } from '@/lib/i18n'
import {
  STAGE_LABELS, NOTICE_KIND_LABELS, nextEscalation, lienEnforceDeadline, noticeMethodWarning, isOpenStage,
  dualAddressRule, resolveNoticeAddresses, noticeAddressWarning, ownerNoticeAddresses,
  NOTICE_30_DAY_DAYS, INTENT_TO_LIEN_DAYS, INTENT_TO_FORECLOSE_DAYS,
  type CollectionCaseRow, type CollectionStage, type CollectionNoticeKind, type CollectionNoticeRow, type PaymentPlanRow,
} from '@/lib/compliance/collections'
import { noticeLetterContent, mailCollectionNotice } from '@/lib/certifiedMail'
import type { PayoffResult as PayoffResultType } from '@/lib/dues'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())
const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

// NOTE: METHODS labels are module-scope and cannot use the useT hook.
// They are left in English. See i18n notes.
const METHODS = [
  { value: 'both', label: 'Certified + first-class mail (statutory dual delivery)' },
  { value: 'certified_mail', label: 'Certified / registered mail (return receipt)' },
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
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !id) { setStatus('error'); setError('No case'); return }
    setStatus('loading'); setError('')
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
      setC(cs); setCommunity(comm || null); setResident(res); setPayments(pays)
      setNotices(ns || []); setPlans(pl || []); setDemand(dm); setStatus('ready')
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

  // Authoritative payoff from the dues model + recorded costs.
  let payoff: PayoffResult | null = null
  if (resident) {
    try { payoff = casePayoff(resident, community, payments, { extraCosts: Number(c.cost_balance) || 0 }) } catch { payoff = null }
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

      <AttorneyNote />
      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {error && <div className="admin-note admin-note-err">{error}</div>}

      {/* ---- Stage ladder ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 10 }}>{t('admin.collectionsDetail.statutoryLadder')}</h2>
        <StageBar stage={stage} />

        {open && (
          <div style={{ marginTop: 14 }}>
            {esc?.readyAt && (
              <div className="admin-note" style={{ fontSize: 12.5, marginBottom: 10, borderColor: gateReady ? '#067647' : '#B54708' }}>
                {gateReady
                  ? `${t('admin.collectionsDetail.waitingPeriodElapsed')} ${ymd(esc.readyAt)} — ${t('admin.collectionsDetail.youMayProceed')} ${esc.label}. (${esc.citation})`
                  : `${t('admin.collectionsDetail.waitingPeriodRunsUntil')} ${ymd(esc.readyAt)} (${calendarDaysUntil(esc.readyAt, now)} ${t('admin.collectionsDetail.days')}). ${t('admin.collectionsDetail.mayProceedEarlier')} (${esc.citation})`}
              </div>
            )}
            {stage === 'lien_recorded' && lienDeadline && (
              <div className="admin-note admin-note-warn" style={{ fontSize: 12.5, marginBottom: 10 }}>
                {regime === 'condo'
                  ? `${t('admin.collectionsDetail.condoLienDeadline')} ${ymd(lienDeadline)}.`
                  : `${t('admin.collectionsDetail.hoaLienDeadline')} ${ymd(lienDeadline)}.`}
                {' '}({LIEN_CITE})
              </div>
            )}

            <StageActions
              adv={adv}
              caseRow={c}
              communityId={c.community_id!}
              profileId={profile?.id ?? null}
              resident={resident}
              community={community}
              payoff={payoff}
              regime={regime}
              onAdvanced={load}
              onError={setError}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'resolved', resolved_at: todayYmd() }, t('admin.collectionsDetail.caseResolved')).then(() => logAudit({ community_id: c.community_id!, event_type: 'collection.resolved', target_type: 'collection_case', target_id: id }))}>{t('admin.collectionsDetail.markResolved')}</button>
              <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'cancelled', resolved_at: todayYmd() }, t('admin.collectionsDetail.caseCancelled'))}>{t('admin.collectionsDetail.cancelCase')}</button>
            </div>
          </div>
        )}
        {!open && (
          <div className="admin-note" style={{ marginTop: 12 }}>
            {t('admin.collectionsDetail.caseIs')} {STAGE_LABELS[stage].toLowerCase()}{c.resolved_at ? ` (${c.resolved_at})` : ''}.
            <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'delinquent', resolved_at: null }, t('admin.collectionsDetail.caseReopened'))}>{t('admin.collectionsDetail.reopen')}</button>
          </div>
        )}
      </section>

      {/* ---- Sworn ledger / payoff ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 10 }}>{t('admin.collectionsDetail.payoffLedger')}</h2>
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
                <LedgerRow label={t('admin.collectionsDetail.ledgerInterest')} value={fmt$(payoff.gross.interest)} />
                <LedgerRow label={t('admin.collectionsDetail.ledgerLateFees')} value={fmt$(payoff.gross.lateFee)} />
                <LedgerRow label={t('admin.collectionsDetail.ledgerCosts')} value={fmt$(payoff.gross.cost)} />
                <LedgerRow label={t('admin.collectionsDetail.ledgerPaymentsApplied')} value={'– ' + fmt$(payoff.gross.principal + payoff.gross.interest + payoff.gross.lateFee + payoff.gross.cost - payoff.payoff)} />
                <tr><td style={{ padding: '8px 10px', fontWeight: 800, borderTop: '2px solid #111' }}>{t('admin.collectionsDetail.ledgerTotal')} ({payoff.asOf})</td><td style={{ padding: '8px 10px', fontWeight: 800, borderTop: '2px solid #111', textAlign: 'right' }}>{fmt$(payoff.payoff)}</td></tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>
              {t('admin.collectionsDetail.ledgerFootnote', { mo: fmtMoney(Number(community?.monthly_dues) || 0) })}
            </p>
          </>
        )}

        {resident && (
          <div style={{ marginTop: 14, padding: '14px 16px', background: 'rgba(0,0,0,0.025)', borderRadius: 10 }}>
            <span className="admin-field-label" style={{ display: 'block', marginBottom: 8 }}>
              {t('admin.collectionsDetail.recordOfflinePayment')}
            </span>
            <RecordPaymentForm onSubmit={recordPayment} />
          </div>
        )}

        <CostEditor caseRow={c} onSaved={(p, m) => patchCase(p, m)} />

        {payoff && (
          <button className="admin-btn-ghost" style={{ marginTop: 8 }} onClick={() => patchCase({
            principal_balance: payoff!.remaining.principal,
            interest_balance: payoff!.remaining.interest,
            late_fee_balance: payoff!.remaining.lateFee,
            cost_balance: payoff!.remaining.cost,
            total_balance: payoff!.payoff,
          }, t('admin.collectionsDetail.balanceSnapshotSaved'))}>{t('admin.collectionsDetail.saveBalanceSnapshot')}</button>
        )}
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

      {/* ---- Notices ledger ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 10 }}>{t('admin.collectionsDetail.statutoryNotices')}</h2>
        {notices.length === 0 && <div className="admin-note">{t('admin.collectionsDetail.noNoticesLogged')}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notices.map(n => {
            const warn = noticeMethodWarning(n.kind, n.method)
            return (
              <div key={n.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{NOTICE_KIND_LABELS[n.kind as CollectionNoticeKind] || n.kind}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {t('admin.collectionsDetail.sent')} {n.sent_at}{n.method ? ` · ${METHODS.find(m => m.value === n.method)?.label || n.method}` : ''}
                  {n.tracking_number ? ` · #${n.tracking_number}` : ''}
                  {n.return_receipt_at ? ` · ${t('admin.collectionsDetail.receipt')} ${n.return_receipt_at}` : ''}
                </div>
                {n.mail_provider === 'lob' && (
                  <div style={{ fontSize: 11.5, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ background: '#175CD314', color: '#175CD3', fontWeight: 700, padding: '1px 7px', borderRadius: 999 }}>{t('admin.collectionsDetail.mailedViaCertified')}</span>
                    {n.lob_status ? <span style={{ opacity: 0.75 }}>{n.lob_status.replace(/^letter\./, '').replace(/[._]/g, ' ')}</span> : null}
                    {n.lob_expected_delivery && !n.return_receipt_at ? <span style={{ opacity: 0.6 }}>· {t('admin.collectionsDetail.lobExpected')} {n.lob_expected_delivery}</span> : null}
                    {typeof n.lob_cost === 'number' && n.lob_cost > 0 ? <span style={{ opacity: 0.6 }}>· {fmt$(n.lob_cost)}</span> : null}
                  </div>
                )}
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
            )
          })}
        </div>
      </section>

      {/* ---- Payment plan ---- */}
      <PaymentPlanSection caseRow={c} plans={plans} profileId={profile?.id ?? null} onChange={load} onError={setError} />

      {/* ---- Generate documents ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 4 }}>{t('admin.collectionsDetail.generateDocuments')}</h2>
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>{t('admin.collectionsDetail.generateDocumentsHint')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {DOC_LINKS.map(d => (
            <a key={d.type} className="admin-secondary-btn" href={`/admin/collections/${id}/document?type=${d.type}`}>{d.label}</a>
          ))}
        </div>
      </section>
    </div>
  )
}

const LIEN_CITE = 'FS 718.116(5)(b) / FS 95.11(2)(c)'

// NOTE: DOC_LINKS labels are module-scope and cannot use the useT hook.
// They are left in English. See i18n notes.
const DOC_LINKS = [
  { type: 'notice_30', label: '30-day notice of late assessment' },
  { type: 'intent_to_lien', label: '45-day intent to record lien' },
  { type: 'claim_of_lien', label: 'Claim of lien (draft)' },
  { type: 'intent_to_foreclose', label: '45-day intent to foreclose' },
  { type: 'ledger', label: 'Sworn account ledger' },
  { type: 'tenant_demand', label: 'Tenant rent demand' },
  { type: 'payment_plan', label: 'Payment-plan agreement' },
]

const card: React.CSSProperties = { border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: '16px 18px', background: '#fafafa', marginTop: 16 }

function LedgerRow({ label, value }: { label: string; value: string }) {
  return <tr><td style={{ padding: '6px 10px', borderBottom: '1px solid #eee' }}>{label}</td><td style={{ padding: '6px 10px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{value}</td></tr>
}

function StageBar({ stage }: { stage: CollectionStage }) {
  const t = useT()
  const steps: { key: CollectionStage; short: string }[] = [
    { key: 'delinquent', short: t('admin.collectionsDetail.stageDelinquent') },
    { key: 'notice_30', short: t('admin.collectionsDetail.stage30day') },
    { key: 'intent_to_lien', short: t('admin.collectionsDetail.stageIntentToLien') },
    { key: 'lien_recorded', short: t('admin.collectionsDetail.stageLien') },
    { key: 'intent_to_foreclose', short: t('admin.collectionsDetail.stageIntentToForeclose') },
    { key: 'foreclosure', short: t('admin.collectionsDetail.stageForeclosure') },
  ]
  const order = ['delinquent', 'notice_30', 'intent_to_lien', 'lien_recorded', 'intent_to_foreclose', 'foreclosure']
  const cur = order.indexOf(stage)
  const terminal = stage === 'resolved' || stage === 'cancelled'
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {steps.map((s, i) => {
        const done = !terminal && i <= cur
        return (
          <span key={s.key} style={{
            fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
            color: done ? '#fff' : '#667085', background: done ? (i === cur ? '#B54708' : '#067647') : '#EAECF0',
          }}>{s.short}</span>
        )
      })}
      {terminal && <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: '#fff', background: stage === 'resolved' ? '#067647' : '#98A2B3' }}>{STAGE_LABELS[stage]}</span>}
    </div>
  )
}

// First-class for the late-assessment notice (statutory), certified+first-class
// dual delivery for the lien/foreclosure notices.
const defaultMethod = (kind?: CollectionNoticeKind | null): string =>
  kind === 'late_assessment_30' || kind === 'tenant_rent_demand' ? 'first_class' : 'both'

function StageActions({ adv, caseRow, communityId, profileId, resident, community, payoff, regime, onAdvanced, onError }: {
  adv: Advance | null; caseRow: CollectionCaseRow; communityId: string; profileId: string | null
  resident: any; community: any; payoff: PayoffResultType | null; regime: 'condo' | 'hoa'
  onAdvanced: () => void; onError: (m: string) => void
}) {
  const t = useT()
  const [openComposer, setOpenComposer] = useState(false)
  const [form, setForm] = useState<any>({ date: todayYmd(), method: 'both', tracking: '', recipient: '' })
  const [busy, setBusy] = useState(false)
  const [mailBusy, setMailBusy] = useState(false)
  const [mailNote, setMailNote] = useState('')
  if (!adv) return <div className="admin-note" style={{ fontSize: 12.5 }}>{t('admin.collectionsDetail.foreclosureFiled')}</div>

  // The statutory dual-address rule for this notice, resolved against the owner's
  // roster addresses (mailing address of record vs. the unit/parcel address).
  const rule = adv.notice ? dualAddressRule(adv.notice, regime) : null
  const addrInput = ownerNoticeAddresses(resident)
  const resolved = resolveNoticeAddresses(addrInput)
  const addrWarn = adv.notice ? noticeAddressWarning(adv.notice, regime, addrInput) : null
  const ownerDual = !!(rule?.applies && resolved.dualRequired)

  // Advance the case stage (and audit) WITHOUT logging a notice — used after a
  // notice has already been recorded (manually below, or by the certified-mail
  // rail). Throws on failure; callers surface the error.
  const advanceStage = async () => {
    const patch: any = { stage: adv.nextStage, [adv.stampField]: form.date || todayYmd() }
    const { error: uErr } = (await withTimeout(supabase.from('ev_collection_cases').update(patch).eq('id', caseRow.id))) as any
    if (uErr) throw uErr
    await logAudit({ community_id: communityId, event_type: 'collection.stage_changed', target_type: 'collection_case', target_id: caseRow.id, metadata: { to: adv.nextStage } })
    setOpenComposer(false)
    setForm({ date: todayYmd(), method: 'both', tracking: '', recipient: '' })
    onAdvanced()
  }

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
        await logAudit({ community_id: communityId, event_type: 'collection.notice_logged', target_type: 'collection_case', target_id: caseRow.id, metadata: { kind: adv.notice, dual_address: ownerDual } })
      }
      await advanceStage()
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.couldNotAdvanceCase')) }
    finally { setBusy(false) }
  }

  // Certified-mail rail: generate + mail the statutory notice through Lob, which
  // logs it on the ledger, then advance the stage. Fails soft when the rail isn't
  // configured (LOB_API_KEY unset) or no usable mailing address is on file.
  const runMailed = async () => {
    if (!adv.notice) return
    setMailBusy(true); setMailNote('')
    try {
      const isCondo = regime === 'condo'
      const baseDate = form.date || todayYmd()
      const days = adv.notice === 'late_assessment_30' ? 30 : 45
      const payByDate = ymd(addCalendarDays(baseDate, days)) || baseDate
      const letter = noticeLetterContent(adv.notice, {
        communityName: community?.name || 'the association',
        isCondo,
        amount: payoff ? fmtMoney(payoff.payoff) : null,
        today: baseDate,
        payByDate,
        ownerDual,
        dualStatutory: !!rule?.statutory,
        unitLabel: resident?.unit_number || caseRow.unit_label || '',
      })
      const res = await mailCollectionNotice({
        caseId: caseRow.id,
        kind: adv.notice,
        recipientName: resident?.full_name || caseRow.unit_label || '',
        recordAddress: resolved.recordAddress,
        unitAddress: resolved.unitAddress,
        dualRequired: ownerDual,
        dateStr: baseDate,
        title: letter.title,
        paragraphs: letter.paragraphs,
        footer: letter.footer,
      })
      if (res.notConfigured) { setMailNote(t('admin.collectionsDetail.mailNotConfigured')); return }
      if (!res.ok) { setMailNote(res.error || t('admin.collectionsDetail.mailFailed')); return }
      await advanceStage()
    } catch (err: any) {
      setMailNote(err?.message || t('admin.collectionsDetail.mailFailed'))
    } finally { setMailBusy(false) }
  }

  if (!openComposer) return <button className="admin-primary-btn" onClick={() => { setForm({ date: todayYmd(), method: defaultMethod(adv.notice), tracking: '', recipient: '' }); setMailNote(''); setOpenComposer(true) }}>{adv.label}</button>

  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12 }}>
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

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {adv.needsNotice && adv.notice ? (
          <>
            <button className="admin-primary-btn" disabled={mailBusy || busy} onClick={runMailed}>
              {mailBusy ? t('admin.collectionsDetail.mailSending') : `✉ ${t('admin.collectionsDetail.mailCertified')}`}
            </button>
            <button className="admin-btn-ghost" disabled={busy || mailBusy} onClick={run}>
              {busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.logManually')}
            </button>
          </>
        ) : (
          <button className="admin-primary-btn" disabled={busy} onClick={run}>{busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.confirm')}</button>
        )}
        <button className="admin-btn-ghost" disabled={busy || mailBusy} onClick={() => setOpenComposer(false)}>{t('admin.collectionsDetail.cancel')}</button>
      </div>
      {mailNote && <div className="admin-note" style={{ fontSize: 12, marginTop: 8 }}>{mailNote}</div>}
    </div>
  )
}

function CostEditor({ caseRow, onSaved }: { caseRow: CollectionCaseRow; onSaved: (p: any, m: string) => void }) {
  const t = useT()
  const [amt, setAmt] = useState('')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
      <label className="admin-field" style={{ maxWidth: 200 }}><span className="admin-field-label">{t('admin.collectionsDetail.addCostLabel')}</span>
        <input className="admin-input" type="number" min="0" step="0.01" value={amt} onChange={e => setAmt(e.target.value)} /></label>
      <button className="admin-btn-ghost" disabled={!amt} onClick={() => { onSaved({ cost_balance: (Number(caseRow.cost_balance) || 0) + Number(amt) }, t('admin.collectionsDetail.costRecorded')); setAmt('') }}>{t('admin.collectionsDetail.addCost')}</button>
      <span style={{ fontSize: 12.5, opacity: 0.7 }}>{t('admin.collectionsDetail.currentCosts')}: {'$' + (Math.round((Number(caseRow.cost_balance) || 0) * 100) / 100).toLocaleString('en-US')}</span>
    </div>
  )
}

function PaymentPlanSection({ caseRow, plans, profileId, onChange, onError }: {
  caseRow: CollectionCaseRow; plans: PaymentPlanRow[]; profileId: string | null
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

  const create = async () => {
    setBusy(true)
    try {
      const freq = Number(form.frequency_days) || 30
      const next = addCalendarDays(form.start_date || todayYmd(), freq)
      const { data: newPlan, error } = (await withTimeout(supabase.from('ev_payment_plans').insert({
        community_id: caseRow.community_id,
        case_id: caseRow.id,
        status: 'active',
        start_date: form.start_date || todayYmd(),
        installment_amount: form.installment_amount ? Number(form.installment_amount) : null,
        installment_count: form.installment_count ? Number(form.installment_count) : null,
        frequency_days: freq,
        next_due_at: next ? ymd(next) : null,
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
    const paid = (Number(p.paid_count) || 0) + 1
    const freq = Number(p.frequency_days) || 30
    const done = p.installment_count != null && paid >= Number(p.installment_count)
    // Advance the next due date; harden against a missing/unparseable stored date.
    const next = done ? null : (addCalendarDays(p.next_due_at || todayYmd(), freq) || addCalendarDays(todayYmd(), freq))
    try {
      await withTimeout(supabase.from('ev_payment_plans').update({
        paid_count: paid,
        // Completed plans have no next installment → clear the date.
        next_due_at: done ? null : (next ? ymd(next) : p.next_due_at),
        status: done ? 'completed' : 'active',
      }).eq('id', p.id))
      if (done) await withTimeout(supabase.from('ev_collection_cases').update({ on_payment_plan: false }).eq('id', caseRow.id))
      await logAudit({ community_id: caseRow.community_id!, event_type: 'collection.payment_plan_updated', target_type: 'payment_plan', target_id: p.id, metadata: { paid_count: paid } })
      onChange()
    } catch (err: any) { onError(err?.message || t('admin.collectionsDetail.updateFailed')) }
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
              <button className="admin-primary-btn" disabled={busy}
                onClick={() => decideRequest(requested, 'modified', { amount: review.amount, count: review.count, freq: review.freq })}>
                {busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.approveWithTerms')}
              </button>
              <button className="admin-btn-ghost" onClick={() => setReview({ mode: null, amount: '', count: '', freq: '', reason: '' })}>{t('admin.collectionsDetail.back')}</button>
            </div>
          ) : review.mode === 'deny' ? (
            <div style={{ marginTop: 10 }}>
              <label className="admin-field"><span className="admin-field-label">{t('admin.collectionsDetail.denialReasonLabel')}</span>
                <textarea className="admin-input" rows={2} value={review.reason}
                  onChange={e => setReview((r: any) => ({ ...r, reason: e.target.value }))} /></label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="admin-primary-btn" disabled={busy || !review.reason.trim()}
                  onClick={() => decideRequest(requested, 'denied', { reason: review.reason })}>
                  {busy ? t('admin.collectionsDetail.saving') : t('admin.collectionsDetail.confirmDenial')}
                </button>
                <button className="admin-btn-ghost" onClick={() => setReview({ mode: null, amount: '', count: '', freq: '', reason: '' })}>{t('admin.collectionsDetail.back')}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="admin-primary-btn" disabled={busy} onClick={() => decideRequest(requested, 'approved')}>{t('admin.collectionsDetail.approveAsProposed')}</button>
              <button className="admin-btn-ghost" onClick={() => setReview((r: any) => ({ ...r, mode: 'modify' }))}>{t('admin.collectionsDetail.modifyTerms')}</button>
              <button className="admin-btn-ghost" onClick={() => setReview((r: any) => ({ ...r, mode: 'deny' }))}>{t('admin.collectionsDetail.deny')}</button>
            </div>
          )}
        </div>
      ) : active ? (
        <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
          <div style={{ fontWeight: 700 }}>
            {fmt$(active.installment_amount)} {t('admin.collectionsDetail.every')} {active.frequency_days} {t('admin.collectionsDetail.days')}
            {active.installment_count ? ` · ${active.paid_count ?? 0}/${active.installment_count} ${t('admin.collectionsDetail.paid')}` : ` · ${active.paid_count ?? 0} ${t('admin.collectionsDetail.paid')}`}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>{t('admin.collectionsDetail.started')} {active.start_date} · {t('admin.collectionsDetail.nextDue')} {active.next_due_at || '—'}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="admin-primary-btn" onClick={() => recordInstallment(active)}>{t('admin.collectionsDetail.recordInstallmentPaid')}</button>
            <button className="admin-btn-ghost" onClick={() => endPlan(active, 'defaulted')}>{t('admin.collectionsDetail.markDefaulted')}</button>
            <button className="admin-btn-ghost" onClick={() => endPlan(active, 'cancelled')}>{t('admin.collectionsDetail.cancelPlan')}</button>
          </div>
        </div>
      ) : (
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
      )}
    </section>
  )
}
