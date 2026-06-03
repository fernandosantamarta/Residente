'use client'

// Elections & recall workspace — FS 718.112(2)(d) (condo) / FS 720.306(9)-(10)
// (HOA). Tracks the 60-day first-notice → 40-day candidate-deadline → 14–34-day
// second-notice timeline for annual-meeting elections and the 5-business-day
// recall-certification clock. Advisory posture — nothing here runs or invalidates
// an election. Every step the board decides.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd, toDate, ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
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

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const todayYmd = () => ymd(new Date())

export default function ElectionsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id

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
      const grab = async (table: string, order?: string) => {
        try {
          let q = supabase.from(table).select('*').eq('community_id', communityId)
          if (order) q = q.order(order, { ascending: false })
          const { data, error } = (await withTimeout(q)) as any
          if (error) return []
          return data || []
        } catch { return [] }
      }
      const { data: c } = (await withTimeout(
        supabase.from('communities').select('*').eq('id', communityId).single()
      )) as any
      setCommunity(c || null)
      setElections(await grab('ev_elections', 'election_date'))
      setRecalls(await grab('ev_recalls', 'served_at'))
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
    await patchElection(e.id, { first_notice_at: todayYmd(), status: 'first_notice_sent' }, 'First notice recorded.')
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'election.notice_recorded', target_type: 'election', target_id: e.id, metadata: { notice: 'first', date: todayYmd() } })
    }
  }

  const closeCandidates = async (e: ElectionRow) => {
    await patchElection(e.id, { candidate_deadline_at: todayYmd(), status: 'candidates_closed' }, 'Candidate window closed.')
  }

  const recordBallotsMailed = async (e: ElectionRow) => {
    await patchElection(e.id, { ballots_sent_at: todayYmd(), status: 'ballots_sent' }, 'Ballots mailed recorded.')
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'election.notice_recorded', target_type: 'election', target_id: e.id, metadata: { notice: 'second', date: todayYmd() } })
    }
  }

  const completeElection = async (e: ElectionRow, ballotsCast: number) => {
    await patchElection(e.id, { ballots_cast: ballotsCast, status: 'completed' }, 'Election marked completed.')
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
      setMsg('Election scheduled.')
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
    await patchRecall(r.id, { board_certified: true, certified_at: todayYmd(), outcome: 'certified' }, 'Recall certified.')
    if (communityId) {
      await logAudit({ community_id: communityId, event_type: 'recall.certified', target_type: 'recall', target_id: r.id, metadata: { certified_at: todayYmd() } })
    }
  }

  const rejectRecall = async (r: RecallRow) => {
    await patchRecall(r.id, { outcome: 'rejected' }, 'Recall rejected by board.')
  }

  const escalateRecall = async (r: RecallRow) => {
    await patchRecall(r.id, { outcome: 'arbitration', arbitration_filed_at: todayYmd() }, 'Recall escalated to arbitration.')
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
      setMsg('Recall logged. The board must act within 5 business days.')
      load()
    } catch (err: any) { setError(err?.message || 'Could not log recall') }
    finally { setRSaving(false) }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Elections <span className="amp">&</span> recall</h1>
      <p className="admin-dek">
        Track the statutory election timeline — the {ELECTION_FIRST_NOTICE_DAYS.value}-day first notice,
        the {CANDIDATE_NOTICE_DAYS.value}-day candidate deadline, and the {SECOND_NOTICE_MIN_DAYS.value}–{SECOND_NOTICE_MAX_DAYS.value}-day
        ballot window — and the recall clock. Advisory only; nothing here runs or
        invalidates an election.
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>{ATTORNEY_REVIEW_BANNER}</div>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet. Run the setup SQL, then reload.</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* ---- Schedule an election ---- */}
          <form className="admin-form" onSubmit={scheduleElection} style={{ marginTop: 18 }}>
            <h2 className="bc-title" style={{ marginBottom: 8 }}>Schedule an election</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">Election date</span>
                <input className="admin-input" type="date" value={eForm.election_date} onChange={e => setEF('election_date', e.target.value)} required /></label>
              <label className="admin-field"><span className="admin-field-label">Seats up for election</span>
                <input className="admin-input" type="number" min="1" step="1" value={eForm.seats} onChange={e => setEF('seats', e.target.value)} placeholder="e.g. 3" /></label>
              <label className="admin-field"><span className="admin-field-label">Eligible voters</span>
                <input className="admin-input" type="number" min="1" step="1" value={eForm.eligible_count} onChange={e => setEF('eligible_count', e.target.value)} placeholder="total owners" /></label>
              <label className="admin-field"><span className="admin-field-label">Notes (optional)</span>
                <input className="admin-input" value={eForm.notes} onChange={e => setEF('notes', e.target.value)} placeholder="e.g. Annual meeting" /></label>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={eSaving || !eForm.election_date}>{eSaving ? 'Saving…' : 'Schedule election'}</button>
              {error && status === 'ready' && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          {/* ---- Elections list ---- */}
          <h2 className="bc-title" style={{ margin: '26px 0 10px' }}>Elections ({elections.length})</h2>
          {elections.length === 0 && <div className="admin-note">No elections on file.</div>}
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
              />
            ))}
          </div>

          {/* ---- Recalls ---- */}
          <form className="admin-form" onSubmit={logRecall} style={{ marginTop: 30 }}>
            <h2 className="bc-title" style={{ marginBottom: 8 }}>Log a recall served on the board</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">Date served</span>
                <input className="admin-input" type="date" value={rForm.served_at} onChange={e => setRF('served_at', e.target.value)} required /></label>
              <label className="admin-field"><span className="admin-field-label">Method</span>
                <select className="admin-input" value={rForm.method} onChange={e => setRF('method', e.target.value)}>
                  <option value="written_agreement">Written agreement</option>
                  <option value="meeting">Meeting</option>
                </select></label>
              <label className="admin-field"><span className="admin-field-label">Total voting interests</span>
                <input className="admin-input" type="number" min="1" step="1" value={rForm.voting_interests_total} onChange={e => setRF('voting_interests_total', e.target.value)} placeholder="total" /></label>
              <label className="admin-field"><span className="admin-field-label">Signatures / votes for recall</span>
                <input className="admin-input" type="number" min="0" step="1" value={rForm.signatures} onChange={e => setRF('signatures', e.target.value)} placeholder="count" /></label>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={rSaving || !rForm.served_at}>{rSaving ? 'Saving…' : 'Log recall'}</button>
            </div>
          </form>

          <h2 className="bc-title" style={{ margin: '18px 0 10px' }}>Recalls ({recalls.length})</h2>
          {recalls.length === 0 && <div className="admin-note">No recalls on file.</div>}
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
function ElectionCard({ e, regime, onFirstNotice, onCloseCandidates, onBallotsMailed, onComplete }: {
  e: ElectionRow
  regime: 'condo' | 'hoa'
  onFirstNotice: () => void
  onCloseCandidates: () => void
  onBallotsMailed: () => void
  onComplete: (ballotsCast: number) => void
}) {
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
  const label = ELECTION_STATUS_LABELS[status as keyof typeof ELECTION_STATUS_LABELS] ?? status

  // Next pending milestone chip
  let nextChip: { text: string; color: string } | null = null
  if (status === 'proposed' && ms.firstNoticeBy) {
    const d = ymd(ms.firstNoticeBy)
    nextChip = { text: `First notice by ${d}`, color: '#B54708' }
  } else if (status === 'first_notice_sent' && ms.candidateBy) {
    const d = ymd(ms.candidateBy)
    nextChip = { text: `Candidate deadline ${d}`, color: '#B54708' }
  } else if (status === 'candidates_closed' && ms.secondNoticeEarliest && ms.secondNoticeLatest) {
    const e1 = ymd(ms.secondNoticeEarliest)
    const e2 = ymd(ms.secondNoticeLatest)
    nextChip = { text: `Mail ballot ${e1}–${e2}`, color: '#175CD3' }
  } else if (status === 'ballots_sent') {
    nextChip = { text: 'Mark completed', color: '#067647' }
  }

  const quorumMet = status === 'completed' ? electionQuorumMet(e) : null

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Election {e.election_date || e.id.slice(0, 8)}
            {e.seats != null ? ` · ${e.seats} seat${e.seats !== 1 ? 's' : ''}` : ''}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            <span style={chip(color)}>{label}</span>
            {e.eligible_count != null && <span style={{ marginLeft: 8 }}>{e.eligible_count} eligible voters</span>}
            {e.notes && <span style={{ marginLeft: 8 }}>{e.notes}</span>}
          </div>
        </div>
        {nextChip && <span style={chip(nextChip.color)}>{nextChip.text}</span>}
      </div>

      {/* Milestone timeline */}
      {e.election_date && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <MilestoneTag label="First notice by" date={ms.firstNoticeBy} done={!!e.first_notice_at} doneDate={e.first_notice_at} />
          <MilestoneTag label={`Candidate deadline (−${CANDIDATE_NOTICE_DAYS.value}d)`} date={ms.candidateBy} done={!!e.candidate_deadline_at} doneDate={e.candidate_deadline_at} />
          <MilestoneTag label={`Ballot window`} date={ms.secondNoticeEarliest} dateTo={ms.secondNoticeLatest} done={!!e.ballots_sent_at} doneDate={e.ballots_sent_at} />
        </div>
      )}

      {/* Quorum result if completed */}
      {status === 'completed' && quorumMet !== null && regime === 'condo' && (
        <div style={{ marginTop: 8, fontSize: 13, color: quorumMet ? '#067647' : '#B42318', fontWeight: 600 }}>
          {quorumMet ? '✓ Quorum met' : '✗ Quorum NOT met'} — {e.ballots_cast ?? 0} of {e.eligible_count ?? 0} eligible voters cast a ballot (20% required for condo)
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {status === 'proposed' && (
          <button className="admin-primary-btn" onClick={onFirstNotice}>Record first notice</button>
        )}
        {status === 'first_notice_sent' && (
          <button className="admin-primary-btn" onClick={onCloseCandidates}>Close candidates</button>
        )}
        {status === 'candidates_closed' && (
          <button className="admin-primary-btn" onClick={onBallotsMailed}>Record ballots mailed</button>
        )}
        {status === 'ballots_sent' && !completingOpen && (
          <button className="admin-primary-btn" onClick={() => setCompletingOpen(true)}>Mark completed</button>
        )}
        {completingOpen && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="admin-field" style={{ maxWidth: 170, margin: 0 }}>
              <span className="admin-field-label">Ballots cast</span>
              <input className="admin-input" type="number" min="0" step="1" value={ballotsCast} onChange={e => setBallotsCast(e.target.value)} placeholder="count" />
            </label>
            <button className="admin-primary-btn" disabled={!ballotsCast} onClick={() => { setCompletingOpen(false); onComplete(Number(ballotsCast) || 0) }}>Confirm</button>
            <button className="admin-btn-ghost" onClick={() => setCompletingOpen(false)}>Cancel</button>
          </div>
        )}
        <a className="admin-btn-ghost" href={`/admin/elections/${e.id}/document?type=first_notice`} target="_blank" rel="noopener noreferrer">First notice doc</a>
        <a className="admin-btn-ghost" href={`/admin/elections/${e.id}/document?type=second_notice`} target="_blank" rel="noopener noreferrer">Ballot / second notice</a>
      </div>
    </div>
  )
}

function MilestoneTag({ label, date, dateTo, done, doneDate }: {
  label: string; date: Date | null; dateTo?: Date | null; done: boolean; doneDate?: string | null
}) {
  if (!date) return null
  const dateStr = ymd(date)
  const dateToStr = dateTo ? ymd(dateTo) : null
  const color = done ? '#067647' : '#B54708'
  return (
    <div style={{ fontSize: 12, background: done ? '#f0fdf4' : '#fefce8', border: `1px solid ${color}22`, borderRadius: 8, padding: '4px 10px', color: done ? '#067647' : '#92400e' }}>
      <span style={{ fontWeight: 600 }}>{label}:</span>{' '}
      {dateToStr ? `${dateStr} – ${dateToStr}` : dateStr}
      {done && doneDate && <span style={{ marginLeft: 6, opacity: 0.8 }}>✓ recorded {doneDate}</span>}
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

  const deadlineStr = deadline ? ymd(deadline) : null
  const today = todayYmd()
  const isOverdue = deadline && ymd(deadline) < today && outcome === 'pending'

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Recall served {r.served_at || r.id.slice(0, 8)}
            {r.method === 'written_agreement' ? ' · Written agreement' : r.method === 'meeting' ? ' · Meeting' : ''}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
            {r.signatures != null && r.voting_interests_total != null && (
              <span>
                {r.signatures} of {r.voting_interests_total} voting interests
                {majorityMet === true ? <span style={{ color: '#067647', marginLeft: 6, fontWeight: 700 }}>✓ majority</span> : majorityMet === false ? <span style={{ color: '#B42318', marginLeft: 6, fontWeight: 700 }}>✗ no majority</span> : null}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={chip(color)}>{outcome}</span>
          {isOverdue && <span style={chip('#B42318')}>board overdue</span>}
        </div>
      </div>

      {deadlineStr && outcome === 'pending' && (
        <div style={{ marginTop: 8, fontSize: 13, color: isOverdue ? '#B42318' : '#B54708', fontWeight: 600 }}>
          Board must act by {deadlineStr} (5 full business days after service)
        </div>
      )}
      {r.certified_at && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: '#067647' }}>Certified {r.certified_at}</div>
      )}
      {r.arbitration_filed_at && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: '#B42318' }}>Arbitration filed {r.arbitration_filed_at}</div>
      )}

      {outcome === 'pending' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="admin-primary-btn" onClick={onCertify}>Certify recall</button>
          <button className="admin-btn-ghost" onClick={onReject}>Refuse / reject</button>
          <button className="admin-btn-ghost" onClick={onArbitration}>Escalate to arbitration</button>
        </div>
      )}
    </div>
  )
}
