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
import { ymd, toDate, addCalendarDays, calendarDaysUntil, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import { casePayoff, fmtMoney, type PayoffResult } from '@/lib/dues'
import {
  STAGE_LABELS, NOTICE_KIND_LABELS, nextEscalation, lienEnforceDeadline, noticeMethodWarning, isOpenStage,
  NOTICE_30_DAY_DAYS, INTENT_TO_LIEN_DAYS, INTENT_TO_FORECLOSE_DAYS,
  type CollectionCaseRow, type CollectionStage, type CollectionNoticeKind, type CollectionNoticeRow, type PaymentPlanRow,
} from '@/lib/compliance/collections'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())
const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

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

  const [c, setC] = useState<CollectionCaseRow | null>(null)
  const [community, setCommunity] = useState<any>(null)
  const [resident, setResident] = useState<any>(null)
  const [payments, setPayments] = useState<any[]>([])
  const [notices, setNotices] = useState<CollectionNoticeRow[]>([])
  const [plans, setPlans] = useState<PaymentPlanRow[]>([])
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
      setC(cs); setCommunity(comm || null); setResident(res); setPayments(pays)
      setNotices(ns || []); setPlans(pl || []); setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load the case'); setStatus('error')
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const patchCase = async (p: any, okMsg: string) => {
    try {
      const { error } = (await withTimeout(supabase.from('ev_collection_cases').update(p).eq('id', id))) as any
      if (error) throw error
      setMsg(okMsg); load()
    } catch (err: any) { setError(err?.message || 'Update failed') }
  }

  if (status === 'loading') return <div className="admin-page"><div className="admin-note">Loading…</div></div>
  if (status === 'error' || !c) return <div className="admin-page"><div className="admin-note admin-note-err">{error || 'Not found'} <Link className="admin-btn-ghost" href="/admin/collections">Back</Link></div></div>

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
      <div style={{ marginBottom: 6 }}><Link className="admin-back" href="/admin/collections">&larr; All cases</Link></div>
      <div className="admin-kicker">Florida compliance · Collections</div>
      <h1 className="admin-h1" style={{ marginBottom: 2 }}>{c.unit_label || c.id.slice(0, 8)}</h1>
      <p className="admin-dek" style={{ marginTop: 0 }}>
        Opened {c.opened_at} · stage: <strong>{STAGE_LABELS[stage]}</strong>
        {c.delinquent_since ? ` · delinquent since ${c.delinquent_since}` : ''}
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>{ATTORNEY_REVIEW_BANNER}</div>
      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {error && <div className="admin-note admin-note-err">{error}</div>}

      {/* ---- Stage ladder ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 10 }}>Statutory ladder</h2>
        <StageBar stage={stage} />

        {open && (
          <div style={{ marginTop: 14 }}>
            {esc?.readyAt && (
              <div className="admin-note" style={{ fontSize: 12.5, marginBottom: 10, borderColor: gateReady ? '#067647' : '#B54708' }}>
                {gateReady
                  ? `The statutory waiting period elapsed ${ymd(esc.readyAt)} — you may ${esc.label}. (${esc.citation})`
                  : `Waiting period runs until ${ymd(esc.readyAt)} (${calendarDaysUntil(esc.readyAt, now)} days). You may proceed earlier, but the statute expects the full period. (${esc.citation})`}
              </div>
            )}
            {stage === 'lien_recorded' && lienDeadline && (
              <div className="admin-note admin-note-warn" style={{ fontSize: 12.5, marginBottom: 10 }}>
                {regime === 'condo'
                  ? `A condo claim of lien must be foreclosed within 1 year of recording — by ${ymd(lienDeadline)}.`
                  : `Enforce the lien within the 5-year limitations period — by ${ymd(lienDeadline)}.`}
                {' '}({LIEN_CITE})
              </div>
            )}

            <StageActions
              adv={adv}
              caseRow={c}
              communityId={c.community_id!}
              profileId={profile?.id ?? null}
              onAdvanced={load}
              onError={setError}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'resolved', resolved_at: todayYmd() }, 'Case resolved.').then(() => logAudit({ community_id: c.community_id!, event_type: 'collection.resolved', target_type: 'collection_case', target_id: id }))}>Mark resolved (paid in full)</button>
              <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'cancelled', resolved_at: todayYmd() }, 'Case cancelled.')}>Cancel case</button>
            </div>
          </div>
        )}
        {!open && (
          <div className="admin-note" style={{ marginTop: 12 }}>
            This case is {STAGE_LABELS[stage].toLowerCase()}{c.resolved_at ? ` (${c.resolved_at})` : ''}.
            <button className="admin-btn-ghost" onClick={() => patchCase({ stage: 'delinquent', resolved_at: null }, 'Case reopened.')}>Reopen</button>
          </div>
        )}
      </section>

      {/* ---- Sworn ledger / payoff ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 10 }}>Payoff ledger</h2>
        {!resident && (
          <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>
            Link this case to a roster owner (from the Collections list intake) to compute the statutory payoff from the dues ledger.
          </div>
        )}
        {payoff && (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <tbody>
                <LedgerRow label="Delinquent assessments (principal)" value={fmt$(payoff.gross.principal)} />
                <LedgerRow label="Interest (simple, daily-accrued)" value={fmt$(payoff.gross.interest)} />
                <LedgerRow label="Administrative late fees" value={fmt$(payoff.gross.lateFee)} />
                <LedgerRow label="Collection / attorney costs" value={fmt$(payoff.gross.cost)} />
                <LedgerRow label="Less: payments applied (interest → fees → costs → principal)" value={'– ' + fmt$(payoff.gross.principal + payoff.gross.interest + payoff.gross.lateFee + payoff.gross.cost - payoff.payoff)} />
                <tr><td style={{ padding: '8px 10px', fontWeight: 800, borderTop: '2px solid #111' }}>Total to bring current (as of {payoff.asOf})</td><td style={{ padding: '8px 10px', fontWeight: 800, borderTop: '2px solid #111', textAlign: 'right' }}>{fmt$(payoff.payoff)}</td></tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>
              Computed from the dues ledger (opening balance + {fmtMoney(Number(community?.monthly_dues) || 0)}/mo) at the community&apos;s configured interest rate. Confirm before relying on it.
            </p>
          </>
        )}

        <CostEditor caseRow={c} onSaved={(p, m) => patchCase(p, m)} />

        {payoff && (
          <button className="admin-btn-ghost" style={{ marginTop: 8 }} onClick={() => patchCase({
            principal_balance: payoff!.remaining.principal,
            interest_balance: payoff!.remaining.interest,
            late_fee_balance: payoff!.remaining.lateFee,
            cost_balance: payoff!.remaining.cost,
            total_balance: payoff!.payoff,
          }, 'Balance snapshot saved.')}>Save balance snapshot to case</button>
        )}
      </section>

      {/* ---- Notices ledger ---- */}
      <section style={card}>
        <h2 className="bc-title" style={{ marginBottom: 10 }}>Statutory notices</h2>
        {notices.length === 0 && <div className="admin-note">No notices logged yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notices.map(n => {
            const warn = noticeMethodWarning(n.kind, n.method)
            return (
              <div key={n.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{NOTICE_KIND_LABELS[n.kind as CollectionNoticeKind] || n.kind}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Sent {n.sent_at}{n.method ? ` · ${METHODS.find(m => m.value === n.method)?.label || n.method}` : ''}
                  {n.tracking_number ? ` · #${n.tracking_number}` : ''}
                  {n.return_receipt_at ? ` · receipt ${n.return_receipt_at}` : ''}
                </div>
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
        <h2 className="bc-title" style={{ marginBottom: 4 }}>Generate documents</h2>
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>Draft letters / ledger — open, review with counsel, print or save as PDF.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {DOC_LINKS.map(d => (
            <a key={d.type} className="admin-secondary-btn" href={`/admin/collections/${id}/document?type=${d.type}`} target="_blank" rel="noopener noreferrer">{d.label}</a>
          ))}
        </div>
      </section>
    </div>
  )
}

const LIEN_CITE = 'FS 718.116(5)(b) / FS 95.11(2)(c)'

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
  const steps: { key: CollectionStage; short: string }[] = [
    { key: 'delinquent', short: 'Delinquent' },
    { key: 'notice_30', short: '30-day' },
    { key: 'intent_to_lien', short: 'Intent-to-lien' },
    { key: 'lien_recorded', short: 'Lien' },
    { key: 'intent_to_foreclose', short: 'Intent-to-foreclose' },
    { key: 'foreclosure', short: 'Foreclosure' },
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

function StageActions({ adv, caseRow, communityId, profileId, onAdvanced, onError }: {
  adv: Advance | null; caseRow: CollectionCaseRow; communityId: string; profileId: string | null
  onAdvanced: () => void; onError: (m: string) => void
}) {
  const [openComposer, setOpenComposer] = useState(false)
  const [form, setForm] = useState<any>({ date: todayYmd(), method: 'both', tracking: '', recipient: '' })
  const [busy, setBusy] = useState(false)
  if (!adv) return <div className="admin-note" style={{ fontSize: 12.5 }}>Foreclosure filed — no further automated step. Use resolve/cancel when concluded.</div>

  const run = async () => {
    setBusy(true)
    try {
      if (adv.needsNotice && adv.notice) {
        const { error: nErr } = (await withTimeout(supabase.from('ev_collection_notices').insert({
          community_id: communityId,
          case_id: caseRow.id,
          kind: adv.notice,
          sent_at: form.date || todayYmd(),
          method: form.method || null,
          tracking_number: (form.tracking || '').trim() || null,
          recipient_name: (form.recipient || '').trim() || null,
          created_by: profileId,
        }))) as any
        if (nErr) throw nErr
        await logAudit({ community_id: communityId, event_type: 'collection.notice_logged', target_type: 'collection_case', target_id: caseRow.id, metadata: { kind: adv.notice } })
      }
      const patch: any = { stage: adv.nextStage, [adv.stampField]: form.date || todayYmd() }
      const { error: uErr } = (await withTimeout(supabase.from('ev_collection_cases').update(patch).eq('id', caseRow.id))) as any
      if (uErr) throw uErr
      await logAudit({ community_id: communityId, event_type: 'collection.stage_changed', target_type: 'collection_case', target_id: caseRow.id, metadata: { to: adv.nextStage } })
      setOpenComposer(false)
      setForm({ date: todayYmd(), method: 'both', tracking: '', recipient: '' })
      onAdvanced()
    } catch (err: any) { onError(err?.message || 'Could not advance the case') }
    finally { setBusy(false) }
  }

  if (!openComposer) return <button className="admin-primary-btn" onClick={() => setOpenComposer(true)}>{adv.label}</button>

  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{adv.label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <label className="admin-field"><span className="admin-field-label">{adv.needsNotice ? 'Date sent' : 'Date'}</span>
          <input className="admin-input" type="date" value={form.date} onChange={e => setForm((f: any) => ({ ...f, date: e.target.value }))} /></label>
        {adv.needsNotice && (
          <>
            <label className="admin-field"><span className="admin-field-label">Delivery method</span>
              <select className="admin-input" value={form.method} onChange={e => setForm((f: any) => ({ ...f, method: e.target.value }))}>
                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select></label>
            <label className="admin-field"><span className="admin-field-label">Tracking #</span>
              <input className="admin-input" value={form.tracking} placeholder="certified mail #" onChange={e => setForm((f: any) => ({ ...f, tracking: e.target.value }))} /></label>
            <label className="admin-field"><span className="admin-field-label">Addressed to</span>
              <input className="admin-input" value={form.recipient} placeholder="owner of record" onChange={e => setForm((f: any) => ({ ...f, recipient: e.target.value }))} /></label>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="admin-primary-btn" disabled={busy} onClick={run}>{busy ? 'Saving…' : 'Confirm'}</button>
        <button className="admin-btn-ghost" disabled={busy} onClick={() => setOpenComposer(false)}>Cancel</button>
      </div>
    </div>
  )
}

function CostEditor({ caseRow, onSaved }: { caseRow: CollectionCaseRow; onSaved: (p: any, m: string) => void }) {
  const [amt, setAmt] = useState('')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
      <label className="admin-field" style={{ maxWidth: 200 }}><span className="admin-field-label">Add collection / attorney cost ($)</span>
        <input className="admin-input" type="number" min="0" step="0.01" value={amt} onChange={e => setAmt(e.target.value)} /></label>
      <button className="admin-btn-ghost" disabled={!amt} onClick={() => { onSaved({ cost_balance: (Number(caseRow.cost_balance) || 0) + Number(amt) }, 'Cost recorded.'); setAmt('') }}>Add cost</button>
      <span style={{ fontSize: 12.5, opacity: 0.7 }}>Current costs: {'$' + (Math.round((Number(caseRow.cost_balance) || 0) * 100) / 100).toLocaleString('en-US')}</span>
    </div>
  )
}

function PaymentPlanSection({ caseRow, plans, profileId, onChange, onError }: {
  caseRow: CollectionCaseRow; plans: PaymentPlanRow[]; profileId: string | null
  onChange: () => void; onError: (m: string) => void
}) {
  const active = plans.find(p => String(p.status) === 'active')
  const [form, setForm] = useState<any>({ installment_amount: '', installment_count: '', frequency_days: 30, start_date: todayYmd() })
  const [busy, setBusy] = useState(false)

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
    } catch (err: any) { onError(err?.message || 'Could not create the plan') }
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
    } catch (err: any) { onError(err?.message || 'Update failed') }
  }

  const endPlan = async (p: PaymentPlanRow, status: 'defaulted' | 'cancelled') => {
    try {
      await withTimeout(supabase.from('ev_payment_plans').update({ status }).eq('id', p.id))
      await withTimeout(supabase.from('ev_collection_cases').update({ on_payment_plan: false }).eq('id', caseRow.id))
      onChange()
    } catch (err: any) { onError(err?.message || 'Update failed') }
  }

  return (
    <section style={card}>
      <h2 className="bc-title" style={{ marginBottom: 10 }}>Payment plan</h2>
      {active ? (
        <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
          <div style={{ fontWeight: 700 }}>
            {fmt$(active.installment_amount)} every {active.frequency_days} days
            {active.installment_count ? ` · ${active.paid_count ?? 0}/${active.installment_count} paid` : ` · ${active.paid_count ?? 0} paid`}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>Started {active.start_date} · next due {active.next_due_at || '—'}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="admin-primary-btn" onClick={() => recordInstallment(active)}>Record installment paid</button>
            <button className="admin-btn-ghost" onClick={() => endPlan(active, 'defaulted')}>Mark defaulted</button>
            <button className="admin-btn-ghost" onClick={() => endPlan(active, 'cancelled')}>Cancel plan</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'flex-end' }}>
          <label className="admin-field"><span className="admin-field-label">Installment $</span>
            <input className="admin-input" type="number" min="0" step="0.01" value={form.installment_amount} onChange={e => setForm((f: any) => ({ ...f, installment_amount: e.target.value }))} /></label>
          <label className="admin-field"><span className="admin-field-label"># of installments</span>
            <input className="admin-input" type="number" min="1" step="1" value={form.installment_count} onChange={e => setForm((f: any) => ({ ...f, installment_count: e.target.value }))} /></label>
          <label className="admin-field"><span className="admin-field-label">Every (days)</span>
            <input className="admin-input" type="number" min="1" step="1" value={form.frequency_days} onChange={e => setForm((f: any) => ({ ...f, frequency_days: e.target.value }))} /></label>
          <label className="admin-field"><span className="admin-field-label">Start</span>
            <input className="admin-input" type="date" value={form.start_date} onChange={e => setForm((f: any) => ({ ...f, start_date: e.target.value }))} /></label>
          <button className="admin-primary-btn" disabled={busy} onClick={create}>{busy ? 'Saving…' : 'Create plan'}</button>
        </div>
      )}
    </section>
  )
}
