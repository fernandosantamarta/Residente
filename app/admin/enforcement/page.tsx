'use client'

// Violations, fines, hearings & suspension (FS 718.303 condo / FS 720.305 &
// 720.3085 HOA). The enforcement workspace: stand up an independent fining
// committee, run a proposed fine through the 14-day notice → hearing → decision
// → levy ladder (capped at $100/day and $1,000 aggregate), and track voting /
// use-rights suspensions. Advisory posture — nothing here blocks; the board
// decides each step.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { logAudit } from '@/lib/audit'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, calendarDaysUntil, toDate } from '@/lib/compliance/rules-core'
import {
  STAGE_LABELS, SUSPENSION_BASIS_LABELS, SUSPENSION_RIGHTS_LABELS,
  fineAccrued, hearingReadyDate, committeeReady, independentMembers,
  votingSuspensionCandidates, hoaFindingsNoticeDue, hoaPaymentMinDue,
  FINE_PER_VIOLATION_MAX, FINE_AGGREGATE_CAP, HEARING_NOTICE_DAYS, FINING_COMMITTEE_MIN,
  SUSPENSION_DELINQUENCY_DAYS, HOA_FINDINGS_NOTICE_DAYS, HOA_FINE_PAYMENT_MIN_DAYS,
  VOTING_SUSPENSION_MONETARY_FLOOR, VOTING_SUSPENSION_PROOF_DAYS, VOTING_SUSPENSION_ELECTION_NOTICE_DAYS,
  type ViolationRow, type HearingRow, type FiningCommitteeMemberRow, type SuspensionRow,
  type EnforcementStage, type SuspensionBasis, type SuspensionRights,
} from '@/lib/compliance/enforcement'
import { decideDispute } from '@/lib/violations'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
import { Dropdown } from '@/components/Dropdown'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())
const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

const STAGE_COLOR: Record<string, string> = {
  none: '#475467', proposed: '#175CD3', notice_sent: '#B54708', hearing_set: '#B54708',
  upheld: '#067647', rejected: '#98A2B3', levied: '#B42318',
}

export default function EnforcementPage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [violations, setViolations] = useState<ViolationRow[]>([])
  const [hearings, setHearings] = useState<HearingRow[]>([])
  const [committee, setCommittee] = useState<FiningCommitteeMemberRow[]>([])
  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([])
  const [cases, setCases] = useState<any[]>([])
  const [residents, setResidents] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

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
      // Every read here is independent (each only filters by community_id), so fire
      // them in ONE parallel batch instead of awaiting seven round-trips in series —
      // the page now waits for the slowest single query, not the sum of all of them.
      const [c, vio, hear, comm, susp, cas, res] = await Promise.all([
        (async () => { const { data } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any; return data })(),
        grab('ev_violations', 'opened_at'),
        grab('ev_violation_hearings'),
        grab('ev_fining_committee_members'),
        grab('ev_suspensions', 'created_at'),
        grab('ev_collection_cases', 'opened_at'),
        (async () => {
          const { data } = (await withTimeout(
            supabase.from('residents').select('id, full_name, unit_number, address, profile_id')
              .eq('community_id', communityId).order('unit_number', { ascending: true }),
          )) as any
          return data
        })(),
      ])
      setCommunity(c || null)
      setViolations(vio)
      setHearings(hear)
      setCommittee(comm)
      setSuspensions(susp)
      setCases(cas)
      setResidents(res || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.enforcement.loadError')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const hearingByViolation = useMemo(() => {
    const m = new Map<string, HearingRow>()
    for (const h of hearings) {
      const k = String(h.violation_id ?? '')
      const prev = m.get(k)
      if (!prev || (toDate(h.notice_sent_at)?.getTime() ?? 0) >= (toDate(prev.notice_sent_at)?.getTime() ?? 0)) m.set(k, h)
    }
    return m
  }, [hearings])

  const committeeOk = committeeReady(committee)
  const independents = independentMembers(committee)

  // Fines / violations on the hearing track (open, kind=fine or hearing_required).
  const trackViolations = useMemo(
    () => violations.filter(v =>
      String(v.status ?? 'open') !== 'closed' && !v.resolution &&
      (v.kind === 'fine' || v.hearing_required)),
    [violations],
  )

  const candidates = useMemo(
    () => votingSuspensionCandidates(cases, suspensions, community?.association_type),
    [cases, suspensions, community],
  )

  // ---- mutations ----
  const patchViolation = async (id: string, patch: Record<string, any>, ok?: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_violations').update(patch).eq('id', id))) as any
      if (error) throw error
      if (ok) setMsg(ok)
      await load()
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotUpdate')) }
  }

  const sendHearingNotice = async (v: ViolationRow) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_violation_hearings').insert({
        community_id: communityId,
        violation_id: v.id,
        notice_sent_at: todayYmd(),
        decision: 'pending',
        created_by: profile?.id ?? null,
      }))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'enforcement.hearing_noticed', target_type: 'violation', target_id: v.id })
      await patchViolation(v.id, { enforcement_stage: 'notice_sent' }, t('admin.enforcement.noticeSentMsg'))
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotLogNotice')) }
  }

  const scheduleHearing = async (v: ViolationRow, h: HearingRow | undefined, date: string) => {
    if (!h || !date) return
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_violation_hearings').update({ scheduled_at: date }).eq('id', h.id))) as any
      if (error) throw error
      await patchViolation(v.id, { enforcement_stage: 'hearing_set' }, t('admin.enforcement.hearingScheduledMsg', { date }))
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotSchedule')) }
  }

  const recordDecision = async (
    v: ViolationRow, h: HearingRow | undefined,
    d: { decision: 'upheld' | 'rejected'; present: number; forV: number; against: number; minutes: string },
  ) => {
    setError('')
    try {
      const hearingPatch = {
        held_at: todayYmd(), decision: d.decision,
        committee_present: d.present, vote_for: d.forV, vote_against: d.against,
        minutes: d.minutes || null,
      }
      if (h) {
        const { error } = (await withTimeout(supabase.from('ev_violation_hearings').update(hearingPatch).eq('id', h.id))) as any
        if (error) throw error
      } else {
        const { error } = (await withTimeout(supabase.from('ev_violation_hearings').insert({
          community_id: communityId, violation_id: v.id, notice_sent_at: todayYmd(), ...hearingPatch, created_by: profile?.id ?? null,
        }))) as any
        if (error) throw error
      }
      if (communityId) logAudit({ community_id: communityId, event_type: 'enforcement.hearing_decided', target_type: 'violation', target_id: v.id })
      await patchViolation(v.id, { enforcement_stage: d.decision }, d.decision === 'upheld'
        ? t('admin.enforcement.decisionUpheldMsg')
        : t('admin.enforcement.decisionRejectedMsg'))
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotRecordDecision')) }
  }

  const markLevied = async (v: ViolationRow) => {
    await patchViolation(v.id, { enforcement_stage: 'levied', levied_at: todayYmd() }, t('admin.enforcement.fineLeviedMsg'))
    if (communityId) logAudit({ community_id: communityId, event_type: 'enforcement.fine_levied', target_type: 'violation', target_id: v.id })
  }

  // ---- owner-contested fines (HB 1021 / HB 1203) ----
  const contestedFines = useMemo(
    () => violations.filter(v => v.dispute_status === 'filed' || v.dispute_status === 'under_review'),
    [violations],
  )

  const decideContest = async (
    v: ViolationRow,
    decision: 'upheld' | 'dismissed' | 'reduced',
    note: string,
    reducedAmount?: number | null,
  ) => {
    setError('')
    const err = await decideDispute(v.id, decision, note, reducedAmount)
    if (err) { setError(err); return }
    setMsg(decision === 'dismissed' ? t('admin.enforcement.contestDismissedMsg')
      : decision === 'reduced' ? t('admin.enforcement.contestReducedMsg')
      : t('admin.enforcement.contestUpheldMsg'))
    await load()
  }

  const openEvidence = async (path: string) => {
    try {
      const { data } = await supabase.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { setError(t('admin.enforcement.couldNotOpenEvidence')) }
  }

  // ---- propose-fine intake ----
  const [form, setForm] = useState<any>({ resident_id: '', continuing: false, hearing_required: true })
  const setF = (k: string, val: any) => setForm((f: any) => ({ ...f, [k]: val }))
  const [saving, setSaving] = useState(false)

  const proposeFine = async (e: any) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = residents.find(r => r.id === form.resident_id)
      const label = res ? `${res.full_name || t('admin.enforcement.ownerFallback')}${res.unit_number ? ` · ${res.unit_number}` : ''}`.trim() : (form.resident_label || '').trim() || null
      const insert: Record<string, any> = {
        community_id: communityId,
        profile_id: res?.profile_id ?? null,
        resident_label: label,
        kind: 'fine',
        rule_title: (form.rule_title || '').trim() || null,
        status: 'open',
        opened_at: todayYmd(),
        hearing_required: form.hearing_required !== false,
        enforcement_stage: 'proposed',
        fine_continuing: !!form.continuing,
        created_by: profile?.id ?? null,
      }
      if (form.continuing) {
        insert.fine_per_day = Math.min(Number(form.fine_per_day) || 0, FINE_PER_VIOLATION_MAX.value)
        insert.fine_started_on = (form.fine_started_on || '').trim() || todayYmd()
      } else {
        insert.amount = Math.min(Number(form.amount) || 0, FINE_PER_VIOLATION_MAX.value)
      }
      if ((form.cure_by || '').trim()) insert.cure_by = form.cure_by
      const { error } = (await withTimeout(supabase.from('ev_violations').insert(insert))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'enforcement.fine_proposed', target_type: 'violation' })
      setForm({ resident_id: '', continuing: false, hearing_required: true })
      setMsg(t('admin.enforcement.fineProposedMsg'))
      load()
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotPropose')) }
    finally { setSaving(false) }
  }

  // ---- suspensions ----
  const recordSuspension = async (s: Partial<SuspensionRow> & { resident_id?: string | null }) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_suspensions').insert({
        community_id: communityId,
        ...s,
        status: 'proposed',
        created_by: profile?.id ?? null,
      }))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'enforcement.suspension_recorded', target_type: 'suspension', target_id: s.resident_id ?? null })
      setMsg(t('admin.enforcement.suspensionRecordedMsg'))
      load()
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotRecordSuspension')) }
  }

  const patchSuspension = async (id: string, patch: Record<string, any>, ok?: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_suspensions').update(patch).eq('id', id))) as any
      if (error) throw error
      if (communityId && (patch.status === 'lifted' || patch.ended_at)) logAudit({ community_id: communityId, event_type: 'enforcement.suspension_lifted', target_type: 'suspension', target_id: id })
      if (ok) setMsg(ok)
      await load()
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotUpdateSuspension')) }
  }

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.enforcement.kicker')}</div>
      <h1 className="admin-h1">{t('admin.enforcement.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.enforcement.pageDek', { noticeDays: HEARING_NOTICE_DAYS.value, fineMax: FINE_PER_VIOLATION_MAX.value, aggregateCap: FINE_AGGREGATE_CAP.value.toLocaleString('en-US') })}
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.enforcement.noCommunity')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.enforcement.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.enforcement.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* ---- Owner-contested fines (statutory right to contest) ---- */}
          {contestedFines.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>{t('admin.enforcement.contestedFinesTitle', { count: contestedFines.length })}</h2>
                  <div className="sub">
                    {t('admin.enforcement.contestedFinesDek', { noticeDays: HEARING_NOTICE_DAYS.value })}
                  </div>
                </div>
                <span style={chip(committeeOk ? '#067647' : '#B42318')}>
                  {committeeOk ? t('admin.enforcement.committeeReady') : t('admin.enforcement.committeeShort', { current: independents.length, min: FINING_COMMITTEE_MIN.value })}
                </span>
              </div>
              {contestedFines.map(v => (
                <ContestedFineRow
                  key={v.id}
                  v={v}
                  hearing={hearingByViolation.get(v.id)}
                  committeeOk={committeeOk}
                  onSendNotice={() => sendHearingNotice(v)}
                  onScheduleHearing={(date) => scheduleHearing(v, hearingByViolation.get(v.id), date)}
                  onOpenEvidence={openEvidence}
                  onDecide={decideContest}
                />
              ))}
            </div>
          )}

          {/* ---- Fining committee ---- */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.enforcement.committeeTitle')}</h2>
                <div className="sub">
                  {t('admin.enforcement.committeeDek', { min: FINING_COMMITTEE_MIN.value, citation: FINING_COMMITTEE_MIN.citation })}
                </div>
              </div>
              <span style={chip(committeeOk ? '#067647' : '#B42318')}>
                {t('admin.enforcement.committeeCount', { current: independents.length, min: FINING_COMMITTEE_MIN.value, status: committeeOk ? '✓' : t('admin.enforcement.committeeRequired') })}
              </span>
            </div>
            <CommitteeManager
              members={committee} communityId={communityId} createdBy={profile?.id ?? null}
              onChange={load} setError={setError}
            />
          </div>

          {/* ---- Propose a fine ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.enforcement.proposeFineTitle')}</h2></div></div>
            <form className="admin-form" onSubmit={proposeFine}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldOwner')}</span>
                <Dropdown<string>
                  value={form.resident_id}
                  onChange={v => setF('resident_id', v)}
                  ariaLabel={t('admin.enforcement.fieldOwner')}
                  options={[
                    { value: '', label: t('admin.enforcement.selectPlaceholder') },
                    ...residents.map(r => ({ value: r.id, label: [r.full_name || t('admin.enforcement.ownerFallback'), r.unit_number ? `${t('admin.enforcement.unitPrefix')} ${r.unit_number}` : null, r.address].filter(Boolean).join(' · ') })),
                  ]}
                /></div>
              <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldViolationRule')}</span>
                <input className="admin-input" value={form.rule_title ?? ''} placeholder={t('admin.enforcement.violationRulePlaceholder')} onChange={e => setF('rule_title', e.target.value)} /></label>
              {form.continuing ? (
                <>
                  <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldFinePerDay', { max: FINE_PER_VIOLATION_MAX.value })}</span>
                    <input className="admin-input" type="number" min="0" max={FINE_PER_VIOLATION_MAX.value} step="1" value={form.fine_per_day ?? ''} onChange={e => setF('fine_per_day', e.target.value)} /></label>
                  <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldAccruesFrom')}</span>
                    <input className="admin-input" type="date" value={form.fine_started_on ?? ''} onChange={e => setF('fine_started_on', e.target.value)} /></label>
                </>
              ) : (
                <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldFineAmount', { max: FINE_PER_VIOLATION_MAX.value })}</span>
                  <input className="admin-input" type="number" min="0" max={FINE_PER_VIOLATION_MAX.value} step="1" value={form.amount ?? ''} onChange={e => setF('amount', e.target.value)} /></label>
              )}
              <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldCureBy')}</span>
                <input className="admin-input" type="date" value={form.cure_by ?? ''} onChange={e => setF('cure_by', e.target.value)} /></label>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={!!form.continuing} onChange={e => setF('continuing', e.target.checked)} />
                {t('admin.enforcement.checkContinuing', { cap: FINE_AGGREGATE_CAP.value.toLocaleString('en-US') })}
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={form.hearing_required !== false} onChange={e => setF('hearing_required', e.target.checked)} />
                {t('admin.enforcement.checkHearingRequired')}
              </label>
            </div>
            <div className="card-cta">
              {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
              <button type="submit" className="admin-primary-btn" disabled={saving || !form.resident_id}>{saving ? t('admin.enforcement.saving') : t('admin.enforcement.btnProposeFine')}</button>
            </div>
            </form>
          </div>

          {/* ---- Fines on the hearing track ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.enforcement.finesHearingsTitle', { count: trackViolations.length })}</h2></div></div>
            {trackViolations.length === 0 && <div className="admin-note">{t('admin.enforcement.noFinesInTrack')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {trackViolations.map(v => (
                <ViolationCard
                  key={v.id} v={v} hearing={hearingByViolation.get(String(v.id))} regime={community?.association_type === 'hoa' ? 'hoa' : 'condo'}
                  committeeOk={committeeOk}
                  onSendNotice={() => sendHearingNotice(v)}
                  onSchedule={(date: string) => scheduleHearing(v, hearingByViolation.get(String(v.id)), date)}
                  onDecision={(d: any) => recordDecision(v, hearingByViolation.get(String(v.id)), d)}
                  onLevy={() => markLevied(v)}
                  onPatch={(patch: Record<string, any>, ok?: string) => patchViolation(v.id, patch, ok)}
                />
              ))}
            </div>
          </div>

          {/* ---- Suspensions ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.enforcement.suspensionsTitle')}</h2></div></div>
            <SuspensionForm residents={residents} onRecord={recordSuspension} />

          {/* Suggested voting suspensions (>90 days delinquent, no hearing required) */}
          {candidates.length > 0 && (
            <section style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: '14px 16px', background: '#fafafa', marginTop: 16 }}>
              <h3 className="bc-title" style={{ margin: '0 0 4px', fontSize: 15 }}>{t('admin.enforcement.eligibleSuspensionTitle', { count: candidates.length })}</h3>
              <p style={{ fontSize: 12.5, opacity: 0.72, margin: '0 0 10px' }}>
                {community?.association_type === 'hoa' ? (
                  t('admin.enforcement.eligibleSuspensionDekHoa', { days: SUSPENSION_DELINQUENCY_DAYS.value })
                ) : (
                  t('admin.enforcement.eligibleSuspensionDekCondo', { floor: VOTING_SUSPENSION_MONETARY_FLOOR.value.toLocaleString('en-US'), days: SUSPENSION_DELINQUENCY_DAYS.value, proofDays: VOTING_SUSPENSION_PROOF_DAYS.value, electionDays: VOTING_SUSPENSION_ELECTION_NOTICE_DAYS.value, citation: VOTING_SUSPENSION_MONETARY_FLOOR.citation })
                )}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map(c => (
                  <div key={c.case_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(0,0,0,0.08)', borderLeft: '4px solid #B54708', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.unit_label}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{t('admin.enforcement.candidateDaysDelinquent', { days: c.days })}{c.balance ? ` · ${fmt$(c.balance)} ${t('admin.enforcement.owed')}` : ''}</div>
                    </div>
                    <button className="admin-primary-btn" onClick={() => recordSuspension({
                      resident_id: c.resident_id, profile_id: c.profile_id, unit_label: c.unit_label,
                      rights: 'both', basis: 'delinquency_90', requires_hearing: false,
                      amount_owed: c.balance || null,
                    })}>{t('admin.enforcement.btnRecordSuspension')}</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Suspension list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {suspensions.length === 0 && <div className="admin-note">{t('admin.enforcement.noSuspensions')}</div>}
            {suspensions.map(s => (
              <SuspensionCard
                key={s.id} s={s}
                onActivate={() => patchSuspension(s.id, { status: 'active', started_at: todayYmd(), approved_at: todayYmd() }, t('admin.enforcement.suspensionActivatedMsg'))}
                onLift={() => patchSuspension(s.id, { status: 'lifted', ended_at: todayYmd() }, t('admin.enforcement.suspensionLiftedMsg'))}
              />
            ))}
          </div>
          </div>
        </>
      )}
    </div>
  )
}

function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}

// ----------------------------------------------------------------------------
// Contested-fine row: owner's reason + evidence, the 14-day notice / hearing
// controls, and the committee decision (uphold / reduce / dismiss).
// ----------------------------------------------------------------------------
function ContestedFineRow({ v, hearing, committeeOk, onSendNotice, onScheduleHearing, onOpenEvidence, onDecide }: {
  v: ViolationRow
  hearing: HearingRow | undefined
  committeeOk: boolean
  onSendNotice: () => void
  onScheduleHearing: (date: string) => void
  onOpenEvidence: (path: string) => void
  onDecide: (v: ViolationRow, decision: 'upheld' | 'dismissed' | 'reduced', note: string, reducedAmount?: number | null) => void
}) {
  const t = useT()
  const [mode, setMode] = useState<null | 'uphold' | 'reduce' | 'dismiss'>(null)
  const [note, setNote] = useState('')
  const [reduced, setReduced] = useState('')
  const [date, setDate] = useState('')
  const noticed = !!hearing?.notice_sent_at
  const ready = hearingReadyDate(hearing)

  const submit = () => {
    if (mode === 'reduce') onDecide(v, 'reduced', note, Number(reduced) || 0)
    else if (mode === 'dismiss') onDecide(v, 'dismissed', note)
    else if (mode === 'uphold') onDecide(v, 'upheld', note)
    setMode(null); setNote(''); setReduced('')
  }

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: '14px 16px', background: '#fff', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>
          {v.resident_label || t('admin.enforcement.ownerFallback')} · {v.amount != null ? fmt$(v.amount) : '—'}
          {v.rule_title ? ` · ${v.rule_title}` : ''}
        </div>
        <span style={chip('#B54708')}>{t('admin.enforcement.contestedChip')} {v.dispute_filed_at || ''}</span>
      </div>
      {v.dispute_reason && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#0A2440', background: '#FAFAFA', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '8px 10px' }}>
          <span style={{ fontWeight: 600 }}>{t('admin.enforcement.ownerReasonLabel')} </span>{v.dispute_reason}
        </div>
      )}
      {v.dispute_attachment_path && (
        <button type="button" className="admin-btn-ghost" style={{ marginTop: 8 }}
          onClick={() => onOpenEvidence(v.dispute_attachment_path!)}>
          {t('admin.enforcement.viewEvidence')}{v.dispute_attachment_name ? ` · ${v.dispute_attachment_name}` : ''}
        </button>
      )}

      {/* Hearing notice / schedule */}
      <div style={{ marginTop: 10, fontSize: 12.5, color: 'rgba(10,36,64,0.7)' }}>
        {noticed
          ? <>{t('admin.enforcement.noticeSentOn')} {hearing?.notice_sent_at}{ready ? ` · ${t('admin.enforcement.hearingCanBeHeld')} ${ymd(ready)}` : ''}{hearing?.scheduled_at ? ` · ${t('admin.enforcement.scheduledOn')} ${hearing.scheduled_at}` : ''}</>
          : t('admin.enforcement.noNoticeSent')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {!noticed && <button type="button" className="admin-primary-btn" onClick={onSendNotice}>{t('admin.enforcement.btnSendHearingNotice')}</button>}
        {noticed && !hearing?.scheduled_at && (
          <>
            <input className="admin-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 170 }} />
            <button type="button" className="admin-btn-ghost" disabled={!date} onClick={() => onScheduleHearing(date)}>{t('admin.enforcement.btnScheduleHearing')}</button>
          </>
        )}
      </div>

      {/* Committee decision */}
      {!committeeOk && <div className="admin-note admin-note-warn" style={{ marginTop: 10, fontSize: 12.5 }}>{t('admin.enforcement.committeeNotReadyWarn', { min: FINING_COMMITTEE_MIN.value })}</div>}
      {mode ? (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mode === 'reduce' && (
            <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldReducedAmount')}</span>
              <input className="admin-input" type="number" min="0" step="0.01" value={reduced} onChange={e => setReduced(e.target.value)} /></label>
          )}
          <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldDecisionNote')}</span>
            <textarea className="admin-input" rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="admin-primary-btn" disabled={mode === 'reduce' && !(Number(reduced) > 0)} onClick={submit}>
              {t('admin.enforcement.btnConfirm')} {mode === 'uphold' ? t('admin.enforcement.modeUphold') : mode === 'reduce' ? t('admin.enforcement.modeReduction') : t('admin.enforcement.modeDismissal')}
            </button>
            <button type="button" className="admin-btn-ghost" onClick={() => { setMode(null); setNote(''); setReduced('') }}>{t('admin.enforcement.btnBack')}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="admin-primary-btn" disabled={!committeeOk} onClick={() => setMode('uphold')}>{t('admin.enforcement.btnUpholdFine')}</button>
          <button type="button" className="admin-btn-ghost" disabled={!committeeOk} onClick={() => setMode('reduce')}>{t('admin.enforcement.btnReduceFine')}</button>
          <button type="button" className="admin-btn-ghost" disabled={!committeeOk} onClick={() => setMode('dismiss')}>{t('admin.enforcement.btnDismissFine')}</button>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Committee manager
// ----------------------------------------------------------------------------
function CommitteeManager({ members, communityId, createdBy, onChange, setError }: {
  members: FiningCommitteeMemberRow[]; communityId: string | undefined; createdBy: string | null; onChange: () => void; setError: (s: string) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [independent, setIndependent] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_fining_committee_members').insert({
        community_id: communityId, full_name: name.trim(), is_independent: independent,
        relationship_note: independent ? null : (note.trim() || null), appointed_at: todayYmd(), active: true, created_by: createdBy,
      }))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'enforcement.committee_updated', target_type: 'fining_committee_member' })
      setName(''); setIndependent(true); setNote(''); onChange()
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotAddMember')) }
    finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_fining_committee_members').update({ active: false }).eq('id', id))) as any
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'enforcement.committee_updated', target_type: 'fining_committee_member', target_id: id })
      onChange()
    } catch (err: any) { setError(err?.message || t('admin.enforcement.couldNotRemoveMember')) }
  }

  const active = members.filter(m => m.active !== false)
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '12px 14px', background: '#fff' }}>
      {active.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {active.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
              <span>
                {m.full_name}
                {m.is_independent === false
                  ? <span style={{ ...chip('#B42318'), marginLeft: 8 }}>{t('admin.enforcement.notIndependent')}{m.relationship_note ? ` — ${m.relationship_note}` : ''}</span>
                  : <span style={{ ...chip('#067647'), marginLeft: 8 }}>{t('admin.enforcement.independent')}</span>}
              </span>
              <button className="admin-btn-ghost" onClick={() => remove(m.id)}>{t('admin.enforcement.btnRemove')}</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="admin-field" style={{ maxWidth: 220 }}><span className="admin-field-label">{t('admin.enforcement.fieldMemberName')}</span>
          <input className="admin-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('admin.enforcement.memberNamePlaceholder')} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, paddingBottom: 8 }}>
          <input type="checkbox" checked={independent} onChange={e => setIndependent(e.target.checked)} />
          {t('admin.enforcement.checkIndependentOfBoard')}
        </label>
        {!independent && (
          <label className="admin-field" style={{ maxWidth: 220 }}><span className="admin-field-label">{t('admin.enforcement.fieldRelationship')}</span>
            <input className="admin-input" value={note} onChange={e => setNote(e.target.value)} placeholder={t('admin.enforcement.relationshipPlaceholder')} /></label>
        )}
        <button className="admin-primary-btn" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }} disabled={busy || !name.trim()} onClick={add}>{busy ? t('admin.enforcement.adding') : t('admin.enforcement.btnAddMember')}</button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Violation card (the hearing ladder)
// ----------------------------------------------------------------------------
function ViolationCard({ v, hearing, regime, committeeOk, onSendNotice, onSchedule, onDecision, onLevy, onPatch }: {
  v: ViolationRow; hearing: HearingRow | undefined; regime: 'condo' | 'hoa'; committeeOk: boolean
  onSendNotice: () => void; onSchedule: (date: string) => void; onDecision: (d: any) => void; onLevy: () => void
  onPatch: (patch: Record<string, any>, ok?: string) => void
}) {
  const t = useT()
  const stage = String(v.enforcement_stage ?? 'none') as EnforcementStage
  const color = STAGE_COLOR[stage] || '#475467'
  const fine = fineAccrued(v)
  const ready = hearingReadyDate(hearing)
  const [schedDate, setSchedDate] = useState('')
  const [decideOpen, setDecideOpen] = useState(false)

  let chipText: string | null = null
  let chipColor = '#175CD3'
  if (stage === 'proposed') { chipText = t('admin.enforcement.chipSend14Day'); chipColor = '#175CD3' }
  else if ((stage === 'notice_sent' || stage === 'hearing_set') && ready) {
    const d = calendarDaysUntil(ready, new Date())
    chipText = d > 0 ? t('admin.enforcement.chipHearingWindow', { date: ymd(ready) }) : t('admin.enforcement.chipMayHoldHearing', { date: ymd(ready) })
    chipColor = d > 0 ? '#175CD3' : '#B54708'
  } else if (stage === 'upheld') { chipText = t('admin.enforcement.chipUpheld'); chipColor = '#067647' }
  else if (stage === 'rejected') { chipText = t('admin.enforcement.chipRejected'); chipColor = '#98A2B3' }
  else if (stage === 'levied') { chipText = t('admin.enforcement.chipLevied'); chipColor = '#B42318' }

  const docHref = (type: string) => `/admin/enforcement/${v.id}/document?type=${type}`

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{v.resident_label || v.id.slice(0, 8)}</div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            {v.rule_title || t('admin.enforcement.ruleViolation')} · {STAGE_LABELS[stage]}
            {v.fine_continuing
              ? ` · ${fmt$(v.fine_per_day)}/day → ${fmt$(fine.capped)}${fine.atCap ? ` (${t('admin.enforcement.atCap')})` : ''}`
              : v.amount != null ? ` · ${fmt$(v.amount)}` : ''}
          </div>
        </div>
        {chipText && <span style={chip(chipColor)}>{chipText}</span>}
      </div>

      {/* Stage actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {stage === 'proposed' && (
          <button className="admin-primary-btn" onClick={onSendNotice}>{t('admin.enforcement.btnSendHearingNotice')}</button>
        )}
        {(stage === 'notice_sent' || stage === 'hearing_set') && (
          <>
            <input type="date" className="admin-input" style={{ maxWidth: 170 }} value={schedDate} onChange={e => setSchedDate(e.target.value)} />
            <button className="admin-btn-ghost" disabled={!schedDate} onClick={() => onSchedule(schedDate)}>
              {stage === 'hearing_set' ? t('admin.enforcement.btnReschedule') : t('admin.enforcement.btnScheduleHearing')}
            </button>
            <button className="admin-primary-btn" onClick={() => setDecideOpen(o => !o)}>{decideOpen ? t('admin.enforcement.btnCancel') : t('admin.enforcement.btnRecordDecision')}</button>
            {!committeeOk && <span style={{ fontSize: 12, color: '#B42318' }}>⚠ {t('admin.enforcement.committeeNotQuorate')}</span>}
          </>
        )}
        {stage === 'upheld' && !v.levied_at && (
          <button className="admin-primary-btn" onClick={onLevy}>{t('admin.enforcement.btnMarkLevied')}</button>
        )}
        {/* document links */}
        <a className="admin-btn-ghost" href={docHref('violation_notice')}>{t('admin.enforcement.linkViolationNotice')}</a>
        {(stage !== 'proposed' && stage !== 'none') && <a className="admin-btn-ghost" href={docHref('hearing_notice')}>{t('admin.enforcement.linkHearingNotice')}</a>}
        {(stage === 'upheld' || stage === 'rejected' || stage === 'levied') && <a className="admin-btn-ghost" href={docHref('decision')}>{t('admin.enforcement.linkDecision')}</a>}
      </div>

      {decideOpen && <DecisionForm onSubmit={(d: any) => { setDecideOpen(false); onDecision(d) }} />}

      {/* HOA post-hearing fining clock — findings notice (7d) + payment window (≥30d) */}
      {regime === 'hoa' && (stage === 'upheld' || stage === 'levied') && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed rgba(0,0,0,0.12)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475467', marginBottom: 6 }}>{t('admin.enforcement.hoaFiningClockLabel', { citationFindings: HOA_FINDINGS_NOTICE_DAYS.citation, citationPayment: HOA_FINE_PAYMENT_MIN_DAYS.citation })}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5 }}>
              <span style={{ opacity: 0.7 }}>{t('admin.enforcement.findingsNoticeSent')}{hearing?.held_at ? ` (${t('admin.enforcement.due')} ${ymd(hoaFindingsNoticeDue(hearing.held_at)!)})` : ''}</span>
              <input className="admin-input" style={{ maxWidth: 160 }} type="date" defaultValue={v.findings_sent_at ?? ''}
                onChange={e => onPatch({ findings_sent_at: e.target.value || null }, t('admin.enforcement.findingsNoticeSavedMsg'))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5 }}>
              <span style={{ opacity: 0.7 }}>{t('admin.enforcement.paymentDueBy')}{v.findings_sent_at ? ` (≥ ${ymd(hoaPaymentMinDue(v.findings_sent_at)!)})` : ''}</span>
              <input className="admin-input" style={{ maxWidth: 160 }} type="date" defaultValue={v.fine_due_on ?? ''}
                onChange={e => onPatch({ fine_due_on: e.target.value || null }, t('admin.enforcement.paymentDeadlineSavedMsg'))} />
            </label>
          </div>
          <p style={{ fontSize: 11.5, opacity: 0.7, margin: '6px 0 0' }}>
            {t('admin.enforcement.hoaFiningClockNote', { findingsDays: HOA_FINDINGS_NOTICE_DAYS.value, paymentDays: HOA_FINE_PAYMENT_MIN_DAYS.value })}
          </p>
        </div>
      )}
    </div>
  )
}

function DecisionForm({ onSubmit }: { onSubmit: (d: any) => void }) {
  const t = useT()
  const [present, setPresent] = useState('3')
  const [forV, setForV] = useState('')
  const [against, setAgainst] = useState('')
  const [minutes, setMinutes] = useState('')
  const proposed = { decision: (Number(forV) || 0) > (Number(against) || 0) && (Number(present) || 0) >= FINING_COMMITTEE_MIN.value ? 'upheld' : 'rejected' as const }
  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="admin-field" style={{ maxWidth: 130 }}><span className="admin-field-label">{t('admin.enforcement.fieldMembersPresent')}</span>
          <input className="admin-input" type="number" min="0" value={present} onChange={e => setPresent(e.target.value)} /></label>
        <label className="admin-field" style={{ maxWidth: 110 }}><span className="admin-field-label">{t('admin.enforcement.fieldVotesToUphold')}</span>
          <input className="admin-input" type="number" min="0" value={forV} onChange={e => setForV(e.target.value)} /></label>
        <label className="admin-field" style={{ maxWidth: 110 }}><span className="admin-field-label">{t('admin.enforcement.fieldVotesAgainst')}</span>
          <input className="admin-input" type="number" min="0" value={against} onChange={e => setAgainst(e.target.value)} /></label>
      </div>
      <label className="admin-field" style={{ marginTop: 8 }}><span className="admin-field-label">{t('admin.enforcement.fieldMinutesNotes')}</span>
        <textarea className="admin-input" rows={2} value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
        <button className="admin-primary-btn"
          disabled={Number(present) < FINING_COMMITTEE_MIN.value || Number(forV) <= Number(against)}
          onClick={() => onSubmit({ decision: 'upheld', present: Number(present) || 0, forV: Number(forV) || 0, against: Number(against) || 0, minutes })}>{t('admin.enforcement.btnRecordUpheld')}</button>
        <button className="admin-btn-ghost"
          disabled={Number(present) < FINING_COMMITTEE_MIN.value || Number(against) < Number(forV)}
          onClick={() => onSubmit({ decision: 'rejected', present: Number(present) || 0, forV: Number(forV) || 0, against: Number(against) || 0, minutes })}>{t('admin.enforcement.btnRecordRejected')}</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{t('admin.enforcement.votesSummary', { outcome: proposed.decision === 'upheld' ? t('admin.enforcement.voteOutcomeUpholds') : t('admin.enforcement.voteOutcomeDoesNotUphold') })}</span>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Suspension form + card
// ----------------------------------------------------------------------------
function SuspensionForm({ residents, onRecord }: { residents: any[]; onRecord: (s: any) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [residentId, setResidentId] = useState('')
  const [rights, setRights] = useState<SuspensionRights>('voting')
  const [basis, setBasis] = useState<SuspensionBasis>('delinquency_90')
  const [amount, setAmount] = useState('')
  const [since, setSince] = useState('')

  if (!open) return <button className="admin-btn-ghost" onClick={() => setOpen(true)}>{t('admin.enforcement.btnOpenRecordSuspension')}</button>

  const submit = () => {
    const res = residents.find(r => r.id === residentId)
    const label = res ? `${res.full_name || t('admin.enforcement.ownerFallback')}${res.unit_number ? ` · ${res.unit_number}` : ''}`.trim() : null
    onRecord({
      resident_id: res?.id ?? null, profile_id: res?.profile_id ?? null, unit_label: label,
      rights, basis, requires_hearing: basis === 'rule_violation',
      amount_owed: amount === '' ? null : Number(amount), delinquent_since: since || null,
    })
    setOpen(false); setResidentId(''); setRights('voting'); setBasis('delinquency_90'); setAmount(''); setSince('')
  }

  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <div className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldOwnerSuspension')}</span>
          <Dropdown<string>
            value={residentId}
            onChange={v => setResidentId(v)}
            ariaLabel={t('admin.enforcement.fieldOwnerSuspension')}
            options={[
              { value: '', label: t('admin.enforcement.selectPlaceholder') },
              ...residents.map(r => ({ value: r.id, label: [r.full_name || t('admin.enforcement.ownerFallback'), r.unit_number ? `${t('admin.enforcement.unitPrefix')} ${r.unit_number}` : null, r.address].filter(Boolean).join(' · ') })),
            ]}
          /></div>
        <div className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldRightsSuspended')}</span>
          <Dropdown<string>
            value={rights}
            onChange={v => setRights(v as SuspensionRights)}
            ariaLabel={t('admin.enforcement.fieldRightsSuspended')}
            options={Object.entries(SUSPENSION_RIGHTS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          /></div>
        <div className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldBasis')}</span>
          <Dropdown<string>
            value={basis}
            onChange={v => setBasis(v as SuspensionBasis)}
            ariaLabel={t('admin.enforcement.fieldBasis')}
            options={Object.entries(SUSPENSION_BASIS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          /></div>
        <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldAmountOwed')}</span>
          <input className="admin-input" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="admin-field"><span className="admin-field-label">{t('admin.enforcement.fieldDelinquentSince')}</span>
          <input className="admin-input" type="date" value={since} onChange={e => setSince(e.target.value)} /></label>
      </div>
      {basis === 'rule_violation' && (
        <p style={{ fontSize: 12, color: '#B54708', margin: '8px 0 0' }}>
          {t('admin.enforcement.ruleViolationHearingWarn')}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="admin-primary-btn" disabled={!residentId} onClick={submit}>{t('admin.enforcement.btnRecordSuspension')}</button>
        <button className="admin-btn-ghost" onClick={() => setOpen(false)}>{t('admin.enforcement.btnCancel')}</button>
      </div>
    </div>
  )
}

function SuspensionCard({ s, onActivate, onLift }: { s: SuspensionRow; onActivate: () => void; onLift: () => void }) {
  const t = useT()
  const st = String(s.status ?? 'proposed')
  const color = st === 'active' ? '#B42318' : st === 'lifted' ? '#98A2B3' : '#175CD3'
  const basis = String(s.basis ?? 'delinquency_90') as SuspensionBasis
  const needsHearing = basis === 'rule_violation' || s.requires_hearing === true
  const hearingMissing = needsHearing && !s.hearing_id
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{s.unit_label || s.id.slice(0, 8)}</div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            {SUSPENSION_RIGHTS_LABELS[(s.rights ?? 'voting') as SuspensionRights]} · {SUSPENSION_BASIS_LABELS[basis]}
            {s.started_at ? ` · ${t('admin.enforcement.since')} ${s.started_at}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={chip(color)}>{st}</span>
          {hearingMissing && <span style={chip('#B42318')}>{t('admin.enforcement.hearingRequired')}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {st === 'proposed' && (
          <button className="admin-primary-btn" disabled={hearingMissing} onClick={onActivate} title={hearingMissing ? t('admin.enforcement.activateTooltip') : ''}>{t('admin.enforcement.btnActivate')}</button>
        )}
        {st !== 'lifted' && <button className="admin-btn-ghost" onClick={onLift}>{t('admin.enforcement.btnLiftSuspension')}</button>}
        <a className="admin-btn-ghost" href={`/admin/enforcement/suspension/${s.id}/notice`}>{t('admin.enforcement.linkSuspensionNotice')}</a>
      </div>
    </div>
  )
}
