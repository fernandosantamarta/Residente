'use client'

// Elections & recall workspace — FS 718.112(2)(d) (condo) / FS 720.306(9)-(10)
// (HOA). Tracks the 60-day first-notice → 40-day candidate-deadline → 14–34-day
// second-notice timeline for annual-meeting elections and the 5-business-day
// recall-certification clock. Advisory posture — nothing here runs or invalidates
// an election. Every step the board decides.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate } from '@/lib/compliance/rules-core'
import {
  electionMilestones,
  electionQuorumMet,
  recallActionDeadline,
  recallMajorityMet,
  ELECTION_STATUS_LABELS,
  ELECTION_FIRST_NOTICE_DAYS,
  CANDIDATE_NOTICE_DAYS,
  SECOND_NOTICE_MIN_DAYS,
  SECOND_NOTICE_MAX_DAYS,
  type ElectionRow,
  type RecallRow,
} from '@/lib/compliance/elections'
import { logAudit } from '@/lib/audit'
import { AttorneyNote } from '../AttorneyNote'
import { ComplianceBackLink } from '../ComplianceBackLink'
import { Dropdown } from '@/components/Dropdown'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())

export default function ElectionsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const t = useT()

  const [community, setCommunity] = useState<any>(null)
  const [elections, setElections] = useState<ElectionRow[]>([])
  const [recalls, setRecalls] = useState<RecallRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 4000)
    return () => clearTimeout(t)
  }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // grab() is tolerant — a missing table or query error resolves to [] instead
      // of throwing, so one unbuilt feed never blocks the rest.
      const grab = async (table: string, order?: string) => {
        try {
          let q = supabase.from(table).select('*').eq('community_id', communityId)
          if (order) q = q.order(order, { ascending: false })
          const { data, error } = (await withTimeout(q)) as any
          if (error) return []
          return data || []
        } catch { return [] }
      }
      // Fire all three reads in ONE parallel batch — they're independent (each just
      // filters by community_id), so the page waits for the slowest query, not the sum.
      const [cRes, elx, rec] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        grab('ev_elections', 'election_date'),
        grab('ev_recalls', 'served_at'),
      ])
      const { data: c } = cRes as any
      setCommunity(c || null)
      setElections(elx)
      setRecalls(rec)
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load elections data'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // ---- election mutations ----
  const patchElection = async (id: string, patch: Record<string, any>, ok?: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_elections').update(patch).eq('id', id))) as any
      if (error) throw error
      if (ok) setMsg(ok)
      await load()
    } catch (err: any) { setError(err?.message || 'Could not update election') }
  }

  const recordFirstNotice = async (e: ElectionRow) => {
    await patchElection(e.id, { first_notice_at: todayYmd(), status: 'first_notice_sent' }, t('admin.elections.msgFirstNoticeRecorded'))
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'election.notice_recorded', target_type: 'election', target_id: e.id, metadata: { notice: 'first', date: todayYmd() } })
    }
  }

  const closeCandidates = async (e: ElectionRow) => {
    await patchElection(e.id, { candidate_deadline_at: todayYmd(), status: 'candidates_closed' }, t('admin.elections.msgCandidatesClosed'))
  }

  const recordBallotsMailed = async (e: ElectionRow) => {
    await patchElection(e.id, { ballots_sent_at: todayYmd(), status: 'ballots_sent' }, t('admin.elections.msgBallotsMailedRecorded'))
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'election.notice_recorded', target_type: 'election', target_id: e.id, metadata: { notice: 'second', date: todayYmd() } })
    }
  }

  const recordAffidavit = async (e: ElectionRow) => {
    await patchElection(e.id, { affidavit_filed_at: todayYmd() }, t('admin.elections.msgAffidavitRecorded'))
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'election.notice_recorded', target_type: 'election', target_id: e.id, metadata: { affidavit: true, date: todayYmd() } })
    }
  }

  const completeElection = async (e: ElectionRow, ballotsCast: number) => {
    await patchElection(e.id, { ballots_cast: ballotsCast, status: 'completed' }, t('admin.elections.msgElectionCompleted'))
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'election.completed', target_type: 'election', target_id: e.id, metadata: { ballots_cast: ballotsCast } })
    }
  }

  // ---- schedule election intake ----
  const [eForm, setEForm] = useState<any>({ election_date: '', seats: '', eligible_count: '', notes: '' })
  const setEF = (k: string, val: any) => setEForm((f: any) => ({ ...f, [k]: val }))
  const [eSaving, setESaving] = useState(false)

  const scheduleElection = async (ev: any) => {
    ev.preventDefault()
    if (!eForm.election_date) return
    setESaving(true); setError('')
    try {
      const insert: Record<string, any> = {
        community_id: communityId,
        election_date: eForm.election_date,
        seats: eForm.seats !== '' ? Number(eForm.seats) : null,
        eligible_count: eForm.eligible_count !== '' ? Number(eForm.eligible_count) : null,
        notes: (eForm.notes || '').trim() || null,
        status: 'proposed',
        created_by: profile?.id ?? null,
      }
      const { data, error } = (await withTimeout(supabase.from('ev_elections').insert(insert).select().single())) as any
      if (error) throw error
      if (communityId && data?.id) {
        await logAudit({ community_id: communityId, event_type: 'election.scheduled', target_type: 'election', target_id: data.id, metadata: { election_date: eForm.election_date } })
      }
      setEForm({ election_date: '', seats: '', eligible_count: '', notes: '' })
      setMsg(t('admin.elections.msgElectionScheduled'))
      load()
    } catch (err: any) { setError(err?.message || 'Could not schedule election') }
    finally { setESaving(false) }
  }

  // ---- recall mutations ----
  const patchRecall = async (id: string, patch: Record<string, any>, ok?: string) => {
    setError('')
    try {
      const { error } = (await withTimeout(supabase.from('ev_recalls').update(patch).eq('id', id))) as any
      if (error) throw error
      if (ok) setMsg(ok)
      await load()
    } catch (err: any) { setError(err?.message || 'Could not update recall') }
  }

  const certifyRecall = async (r: RecallRow) => {
    await patchRecall(r.id, { board_certified: true, certified_at: todayYmd(), outcome: 'certified' }, t('admin.elections.msgRecallCertified'))
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'recall.certified', target_type: 'recall', target_id: r.id, metadata: { certified_at: todayYmd() } })
    }
  }

  const rejectRecall = async (r: RecallRow) => {
    await patchRecall(r.id, { outcome: 'rejected' }, t('admin.elections.msgRecallRejected'))
  }

  const escalateRecall = async (r: RecallRow) => {
    await patchRecall(r.id, { outcome: 'arbitration', arbitration_filed_at: todayYmd() }, t('admin.elections.msgRecallEscalated'))
  }

  // ---- log recall intake ----
  const [rForm, setRForm] = useState<any>({ served_at: '', method: 'written_agreement', voting_interests_total: '', signatures: '' })
  const setRF = (k: string, val: any) => setRForm((f: any) => ({ ...f, [k]: val }))
  const [rSaving, setRSaving] = useState(false)

  const logRecall = async (ev: any) => {
    ev.preventDefault()
    if (!rForm.served_at) return
    setRSaving(true); setError('')
    try {
      const insert: Record<string, any> = {
        community_id: communityId,
        served_at: rForm.served_at,
        method: rForm.method,
        voting_interests_total: rForm.voting_interests_total !== '' ? Number(rForm.voting_interests_total) : null,
        signatures: rForm.signatures !== '' ? Number(rForm.signatures) : null,
        outcome: 'pending',
      }
      const { data, error } = (await withTimeout(supabase.from('ev_recalls').insert(insert).select().single())) as any
      if (error) throw error
      if (communityId && data?.id) {
        await logAudit({ community_id: communityId, event_type: 'recall.served', target_type: 'recall', target_id: data.id, metadata: { served_at: rForm.served_at, method: rForm.method } })
      }
      setRForm({ served_at: '', method: 'written_agreement', voting_interests_total: '', signatures: '' })
      setMsg(t('admin.elections.msgRecallLogged'))
      load()
    } catch (err: any) { setError(err?.message || 'Could not log recall') }
    finally { setRSaving(false) }
  }

  return (
    <div className="admin-page cset">
      <ComplianceBackLink />
      <div className="admin-kicker">{t('admin.elections.kicker')}</div>
      <h1 className="admin-h1">{t('admin.elections.pageTitle')} <span className="amp">&</span> {t('admin.elections.pageTitleRecall')}</h1>
      <p className="admin-dek">
        {t('admin.elections.pageDek', {
          firstNoticeDays: ELECTION_FIRST_NOTICE_DAYS.value,
          candidateDays: CANDIDATE_NOTICE_DAYS.value,
          secondNoticeMin: SECOND_NOTICE_MIN_DAYS.value,
          secondNoticeMax: SECOND_NOTICE_MAX_DAYS.value,
        })}
      </p>

      <AttorneyNote />

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.elections.noCommunity')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.elections.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.elections.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* ---- Schedule an election ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.elections.scheduleHeading')}</h2></div></div>
            <form className="admin-form" onSubmit={scheduleElection}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldElectionDate')}</span>
                  <input className="admin-input" type="date" value={eForm.election_date} onChange={e => setEF('election_date', e.target.value)} required /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldSeats')}</span>
                  <input className="admin-input" type="number" min="1" step="1" value={eForm.seats} onChange={e => setEF('seats', e.target.value)} placeholder={t('admin.elections.placeholderSeats')} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldEligibleVoters')}</span>
                  <input className="admin-input" type="number" min="1" step="1" value={eForm.eligible_count} onChange={e => setEF('eligible_count', e.target.value)} placeholder={t('admin.elections.placeholderTotalOwners')} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldNotes')}</span>
                  <input className="admin-input" value={eForm.notes} onChange={e => setEF('notes', e.target.value)} placeholder={t('admin.elections.placeholderNotes')} /></label>
              </div>
              <div className="card-cta">
                {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
                <button type="submit" className="admin-primary-btn" disabled={eSaving || !eForm.election_date}>{eSaving ? t('admin.elections.saving') : t('admin.elections.scheduleBtn')}</button>
              </div>
            </form>
          </div>

          {/* ---- Elections list ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.elections.electionsHeading')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({elections.length})</span></h2></div></div>
            {elections.length === 0 && <div className="admin-note">{t('admin.elections.noElections')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {elections.map(e => (
                <ElectionCard
                  key={e.id}
                  e={e}
                  regime={community?.association_type === 'hoa' ? 'hoa' : 'condo'}
                  onFirstNotice={() => recordFirstNotice(e)}
                  onCloseCandidates={() => closeCandidates(e)}
                  onBallotsMailed={() => recordBallotsMailed(e)}
                  onComplete={(ballotsCast) => completeElection(e, ballotsCast)}
                  onAffidavit={() => recordAffidavit(e)}
                />
              ))}
            </div>
          </div>

          {/* ---- Recalls ---- */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.elections.logRecallHeading')}</h2></div></div>
            <form className="admin-form" onSubmit={logRecall}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                <label className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldDateServed')}</span>
                  <input className="admin-input" type="date" value={rForm.served_at} onChange={e => setRF('served_at', e.target.value)} required /></label>
                <div className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldMethod')}</span>
                  <Dropdown<string>
                    value={rForm.method}
                    onChange={v => setRF('method', v)}
                    ariaLabel={t('admin.elections.fieldMethod')}
                    options={[
                      { value: 'written_agreement', label: t('admin.elections.methodWrittenAgreement') },
                      { value: 'meeting', label: t('admin.elections.methodMeeting') },
                    ]}
                  /></div>
                <label className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldVotingInterests')}</span>
                  <input className="admin-input" type="number" min="1" step="1" value={rForm.voting_interests_total} onChange={e => setRF('voting_interests_total', e.target.value)} placeholder={t('admin.elections.placeholderTotal')} /></label>
                <label className="admin-field"><span className="admin-field-label">{t('admin.elections.fieldSignatures')}</span>
                  <input className="admin-input" type="number" min="0" step="1" value={rForm.signatures} onChange={e => setRF('signatures', e.target.value)} placeholder={t('admin.elections.placeholderCount')} /></label>
              </div>
              <div className="card-cta">
                <button type="submit" className="admin-primary-btn" disabled={rSaving || !rForm.served_at}>{rSaving ? t('admin.elections.saving') : t('admin.elections.logRecallBtn')}</button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-head"><div><h2>{t('admin.elections.recallsHeading')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({recalls.length})</span></h2></div></div>
            {recalls.length === 0 && <div className="admin-note">{t('admin.elections.noRecalls')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recalls.map(r => (
                <RecallCard
                  key={r.id}
                  r={r}
                  onCertify={() => certifyRecall(r)}
                  onReject={() => rejectRecall(r)}
                  onArbitration={() => escalateRecall(r)}
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
// ElectionCard
// ----------------------------------------------------------------------------
function ElectionCard({ e, regime, onFirstNotice, onCloseCandidates, onBallotsMailed, onComplete, onAffidavit }: {
  e: ElectionRow
  regime: 'condo' | 'hoa'
  onFirstNotice: () => void
  onCloseCandidates: () => void
  onBallotsMailed: () => void
  onComplete: (ballotsCast: number) => void
  onAffidavit: () => void
}) {
  const t = useT()
  const status = String(e.status ?? 'proposed')
  const ms = electionMilestones(e)
  const [completingOpen, setCompletingOpen] = useState(false)
  const [ballotsCast, setBallotsCast] = useState('')

  const statusColor: Record<string, string> = {
    proposed: '#175CD3',
    first_notice_sent: '#B54708',
    candidates_closed: '#B54708',
    ballots_sent: '#067647',
    completed: '#067647',
    cancelled: '#98A2B3',
  }
  const color = statusColor[status] || '#475467'

  const electionStatusLabels: Record<string, string> = {
    proposed: t('admin.elections.statusProposed'),
    first_notice_sent: t('admin.elections.statusFirstNoticeSent'),
    candidates_closed: t('admin.elections.statusCandidatesClosed'),
    ballots_sent: t('admin.elections.statusBallotsSent'),
    completed: t('admin.elections.statusCompleted'),
    cancelled: t('admin.elections.statusCancelled'),
  }
  const label = electionStatusLabels[status] ?? (ELECTION_STATUS_LABELS[status as keyof typeof ELECTION_STATUS_LABELS] ?? status)

  // Next pending milestone chip
  let nextChip: { text: string; color: string } | null = null
  if (status === 'proposed' && ms.firstNoticeBy) {
    const d = ymd(ms.firstNoticeBy)
    nextChip = { text: t('admin.elections.nextChipFirstNotice', { date: d }), color: '#B54708' }
  } else if (status === 'first_notice_sent' && ms.candidateBy) {
    const d = ymd(ms.candidateBy)
    nextChip = { text: t('admin.elections.nextChipCandidateDeadline', { date: d }), color: '#B54708' }
  } else if (status === 'candidates_closed' && ms.secondNoticeEarliest && ms.secondNoticeLatest) {
    const e1 = ymd(ms.secondNoticeEarliest)
    const e2 = ymd(ms.secondNoticeLatest)
    nextChip = { text: t('admin.elections.nextChipMailBallot', { from: e1, to: e2 }), color: '#175CD3' }
  } else if (status === 'ballots_sent') {
    nextChip = { text: t('admin.elections.nextChipMarkCompleted'), color: '#067647' }
  }

  const quorumMet = status === 'completed' ? electionQuorumMet(e) : null

  const seatCount = e.seats != null ? e.seats : 0
  const seatSuffix = e.seats != null
    ? ` · ${e.seats} ${e.seats !== 1 ? t('admin.elections.seats') : t('admin.elections.seat')}`
    : ''

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {t('admin.elections.electionTitle')} {e.election_date || e.id.slice(0, 8)}
            {seatSuffix}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            <span style={chip(color)}>{label}</span>
            {e.eligible_count != null && <span style={{ marginLeft: 8 }}>{t('admin.elections.eligibleVotersCount', { count: e.eligible_count })}</span>}
            {e.notes && <span style={{ marginLeft: 8 }}>{e.notes}</span>}
          </div>
        </div>
        {nextChip && <span style={chip(nextChip.color)}>{nextChip.text}</span>}
      </div>

      {/* Milestone timeline */}
      {e.election_date && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <MilestoneTag label={t('admin.elections.milestoneFirstNotice')} date={ms.firstNoticeBy} done={!!e.first_notice_at} doneDate={e.first_notice_at} />
          <MilestoneTag label={t('admin.elections.milestoneCandidateDeadline', { days: CANDIDATE_NOTICE_DAYS.value })} date={ms.candidateBy} done={!!e.candidate_deadline_at} doneDate={e.candidate_deadline_at} />
          <MilestoneTag label={t('admin.elections.milestoneBallotWindow')} date={ms.secondNoticeEarliest} dateTo={ms.secondNoticeLatest} done={!!e.ballots_sent_at} doneDate={e.ballots_sent_at} />
        </div>
      )}

      {/* Quorum result if completed */}
      {status === 'completed' && quorumMet !== null && regime === 'condo' && (
        <div style={{ marginTop: 8, fontSize: 13, color: quorumMet ? '#067647' : '#B42318', fontWeight: 600 }}>
          {quorumMet ? t('admin.elections.quorumMet') : t('admin.elections.quorumNotMet')} — {t('admin.elections.quorumDetail', { cast: e.ballots_cast ?? 0, eligible: e.eligible_count ?? 0 })}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {status === 'proposed' && (
          <button className="admin-primary-btn" onClick={onFirstNotice}>{t('admin.elections.btnRecordFirstNotice')}</button>
        )}
        {status === 'first_notice_sent' && (
          <button className="admin-primary-btn" onClick={onCloseCandidates}>{t('admin.elections.btnCloseCandidates')}</button>
        )}
        {status === 'candidates_closed' && (
          <button className="admin-primary-btn" onClick={onBallotsMailed}>{t('admin.elections.btnRecordBallotsMailed')}</button>
        )}
        {status === 'ballots_sent' && !completingOpen && (
          <button className="admin-primary-btn" onClick={() => setCompletingOpen(true)}>{t('admin.elections.btnMarkCompleted')}</button>
        )}
        {completingOpen && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="admin-field" style={{ maxWidth: 170, margin: 0 }}>
              <span className="admin-field-label">{t('admin.elections.fieldBallotsCast')}</span>
              <input className="admin-input" type="number" min="0" step="1" value={ballotsCast} onChange={e => setBallotsCast(e.target.value)} placeholder={t('admin.elections.placeholderCount')} />
            </label>
            <button className="admin-primary-btn" disabled={!ballotsCast} onClick={() => { setCompletingOpen(false); onComplete(Number(ballotsCast) || 0) }}>{t('admin.elections.btnConfirm')}</button>
            <button className="admin-btn-ghost" onClick={() => setCompletingOpen(false)}>{t('admin.elections.btnCancel')}</button>
          </div>
        )}
        {e.ballots_sent_at && !e.affidavit_filed_at && (
          <button className="admin-btn-ghost" onClick={onAffidavit}>{t('admin.elections.btnRecordAffidavit')}</button>
        )}
        {e.affidavit_filed_at && <span style={chip('#067647')}>{t('admin.elections.affidavitFiled', { date: e.affidavit_filed_at })}</span>}
        <a className="admin-btn-ghost" href={`/admin/elections/${e.id}/document?type=first_notice`}>{t('admin.elections.linkFirstNoticeDoc')}</a>
        <a className="admin-btn-ghost" href={`/admin/elections/${e.id}/document?type=second_notice`}>{t('admin.elections.linkSecondNoticeDoc')}</a>
        <a className="admin-btn-ghost" href={`/admin/elections/${e.id}/document?type=affidavit`}>{t('admin.elections.linkAffidavitDoc')}</a>
      </div>
    </div>
  )
}

function MilestoneTag({ label, date, dateTo, done, doneDate }: {
  label: string; date: Date | null; dateTo?: Date | null; done: boolean; doneDate?: string | null
}) {
  const t = useT()
  if (!date) return null
  const dateStr = ymd(date)
  const dateToStr = dateTo ? ymd(dateTo) : null
  const color = done ? '#067647' : '#B54708'
  return (
    <div style={{ fontSize: 12, background: done ? '#f0fdf4' : '#fefce8', border: `1px solid ${color}22`, borderRadius: 8, padding: '4px 10px', color: done ? '#067647' : '#92400e' }}>
      <span style={{ fontWeight: 600 }}>{label}:</span>{' '}
      {dateToStr ? `${dateStr} – ${dateToStr}` : dateStr}
      {done && doneDate && <span style={{ marginLeft: 6, opacity: 0.8 }}>{t('admin.elections.milestoneRecorded', { date: doneDate })}</span>}
    </div>
  )
}

// ----------------------------------------------------------------------------
// RecallCard
// ----------------------------------------------------------------------------
function RecallCard({ r, onCertify, onReject, onArbitration }: {
  r: RecallRow
  onCertify: () => void
  onReject: () => void
  onArbitration: () => void
}) {
  const t = useT()
  const outcome = String(r.outcome ?? 'pending')
  const deadline = recallActionDeadline(r)
  const majorityMet = recallMajorityMet(r)

  const outcomeColor: Record<string, string> = {
    pending: '#175CD3',
    certified: '#067647',
    rejected: '#98A2B3',
    arbitration: '#B42318',
  }
  const color = outcomeColor[outcome] || '#475467'

  const recallOutcomeLabels: Record<string, string> = {
    pending: t('admin.elections.outcomePending'),
    certified: t('admin.elections.outcomeCertified'),
    rejected: t('admin.elections.outcomeRejected'),
    arbitration: t('admin.elections.outcomeArbitration'),
  }
  const outcomeLabel = recallOutcomeLabels[outcome] ?? outcome

  const deadlineStr = deadline ? ymd(deadline) : null
  const today = todayYmd()
  const isOverdue = deadline && ymd(deadline) < today && outcome === 'pending'

  const recallMethod = r.method === 'written_agreement'
    ? t('admin.elections.methodWrittenAgreement')
    : r.method === 'meeting'
      ? t('admin.elections.methodMeeting')
      : ''

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {t('admin.elections.recallServedTitle', { date: r.served_at || r.id.slice(0, 8) })}
            {recallMethod ? ` · ${recallMethod}` : ''}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            {r.signatures != null && r.voting_interests_total != null && (
              <span>
                {t('admin.elections.recallVotingInterests', { signatures: r.signatures, total: r.voting_interests_total })}
                {majorityMet === true ? <span style={{ color: '#067647', marginLeft: 6, fontWeight: 700 }}>✓ {t('admin.elections.majority')}</span> : majorityMet === false ? <span style={{ color: '#B42318', marginLeft: 6, fontWeight: 700 }}>✗ {t('admin.elections.noMajority')}</span> : null}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={chip(color)}>{outcomeLabel}</span>
          {isOverdue && <span style={chip('#B42318')}>{t('admin.elections.boardOverdue')}</span>}
        </div>
      </div>

      {deadlineStr && outcome === 'pending' && (
        <div style={{ marginTop: 8, fontSize: 13, color: isOverdue ? '#B42318' : '#B54708', fontWeight: 600 }}>
          {t('admin.elections.boardMustActBy', { date: deadlineStr })}
        </div>
      )}
      {r.certified_at && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: '#067647' }}>{t('admin.elections.certifiedOn', { date: r.certified_at })}</div>
      )}
      {r.arbitration_filed_at && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: '#B42318' }}>{t('admin.elections.arbitrationFiledOn', { date: r.arbitration_filed_at })}</div>
      )}

      {outcome === 'pending' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="admin-primary-btn" onClick={onCertify}>{t('admin.elections.btnCertifyRecall')}</button>
          <button className="admin-btn-ghost" onClick={onReject}>{t('admin.elections.btnRefuseReject')}</button>
          <button className="admin-btn-ghost" onClick={onArbitration}>{t('admin.elections.btnEscalateArbitration')}</button>
        </div>
      )}
    </div>
  )
}
