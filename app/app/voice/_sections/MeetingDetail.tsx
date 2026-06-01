'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { MEETING_TYPES, DOC_TYPES, VOTE_TYPES, OPEN_BALLOT_WAIVER_NOTICE } from '@/lib/voice'
import { logAudit } from '@/lib/audit'
import { encryptAnswer } from '@/lib/ballotCrypto'
import { useT } from '@/lib/i18n'

// Shared meeting-detail body. Rendered both by the standalone page
// (/app/voice/[id], so shared/deep links still resolve) AND by the in-place
// MeetingDetailDialog popup launched from the Meetings list — so the
// vote-casting / ballot logic lives in exactly one place.

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const fmtDt = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// `compact` drops the big title block when the popup header already shows the
// title, but keeps the meta row, votes and documents.
export function MeetingDetailBody({ meeting, reload, compact = false }) {
  const t = useT()
  const typeLabel = MEETING_TYPES.find(mt => mt.value === meeting.type)?.label ?? meeting.type
  const docs = (meeting.ev_meeting_docs ?? []).sort((a, b) => {
    const order = ['agenda', 'minutes', 'supporting', 'notice_record']
    return order.indexOf(a.type) - order.indexOf(b.type)
  })
  const votes = meeting.ev_votes ?? []

  return (
    <>
      <div className="voice-detail-header">
        {!compact && <div className="voice-meeting-type">{typeLabel}</div>}
        {!compact && <h2 className="voice-detail-title">{meeting.title}</h2>}
        <div className="voice-detail-meta">
          {compact && <span className="voice-meeting-type">{typeLabel}</span>}
          <span>{fmtDt(meeting.scheduled_at)}</span>
          {meeting.location && <span>· {meeting.location}</span>}
        </div>
        {meeting.virtual_link && (
          <a className="voice-virtual-btn" href={meeting.virtual_link} target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            {t('voice.joinVirtual')}
          </a>
        )}
        {meeting.quorum_confirmed && (
          <span className="voice-badge-quorum">{t('voice.quorumConfirmed')}</span>
        )}
      </div>

      {votes.length > 0 && (
        <section className="voice-section">
          <div className="voice-section-label">{t('voice.votes')}</div>
          {votes.map(v => (
            <ResidentVoteCard key={v.id} vote={v} onVoted={reload} />
          ))}
        </section>
      )}

      {docs.length > 0 && (
        <section className="voice-section">
          <div className="voice-section-label">{t('voice.documents')}</div>
          {docs.map(d => <ResidentDocRow key={d.id} doc={d} />)}
        </section>
      )}

      {votes.length === 0 && docs.length === 0 && (
        <div className="voice-placeholder">{t('voice.noVotesOrDocs')}</div>
      )}
    </>
  )
}

function ResidentVoteCard({ vote: v, onVoted }) {
  const t = useT()
  const { profile } = useAuth() || {}
  const [casting, setCasting] = useState(false)
  const [castErr, setCastErr] = useState(null)
  const [myVote, setMyVote] = useState(null)
  const isOpen = v.status === 'open'
  const typeLabel = VOTE_TYPES.find(vt => vt.value === v.type)?.label ?? v.type
  const isSecret = v.ballot_type === 'secret'
  const total = (v.yes_count ?? 0) + (v.no_count ?? 0) + (v.abstain_count ?? 0)

  const cast = async (answer) => {
    if (!hasSupabase || !profile) return
    setCasting(true)
    setCastErr(null)
    try {
      let row: any = {
        vote_id:     v.id,
        profile_id:  profile.id,
        unit_number: profile.unit_number,
        answer,
      }
      if (isSecret) {
        if (!v.public_key) {
          setCastErr(t('voice.errMissingKey'))
          return
        }
        row = {
          vote_id:           v.id,
          profile_id:        profile.id,
          unit_number:       profile.unit_number,
          answer:            null,
          encrypted_answer:  encryptAnswer(answer, v.public_key),
          encryption_key_id: v.id,
        }
      }
      const { data: ballot, error } = await withTimeout(
        supabase.from('ev_ballots').insert(row).select('id').single()
      )
      if (error) {
        if (error.code === '23505') {
          setCastErr(t('voice.errAlreadyVoted'))
        } else if (/consent required/i.test(error.message ?? '')) {
          // ev_ballot_consent_guard fired — the user hasn't consented yet.
          setCastErr('CONSENT_REQUIRED')
        } else {
          throw error
        }
        return
      }
      logAudit({
        community_id: v.community_id,
        event_type:   'ballot.cast',
        target_type:  'ballot',
        target_id:    ballot?.id ?? null,
        metadata:     { vote_id: v.id, answer, ballot_type: v.ballot_type },
      })
      setMyVote(answer)
      onVoted()
    } catch (e) {
      setCastErr(e?.message ?? t('voice.errCastFailed'))
    } finally {
      setCasting(false)
    }
  }

  return (
    <div className={`voice-vote-card${isOpen ? ' open' : ''}`}>
      <div className="voice-vote-card-head">
        <div>
          <div className="voice-vote-card-title">{v.title}</div>
          <div className="voice-vote-card-meta">{typeLabel} · {isSecret ? t('voice.secretBallot') : t('voice.openBallot')}</div>
        </div>
        <span className={`voice-status voice-status-${v.status}`}>
          {v.status === 'open' ? t('voice.voteOpen') : v.status === 'published' ? t('voice.results') : v.status}
        </span>
      </div>

      {v.description && <p className="voice-vote-card-desc">{v.description}</p>}

      {isOpen && !myVote && (
        <div className="voice-ballot-area">
          {isSecret ? (
            <p className="voice-ballot-notice voice-ballot-notice-secret">
              {t('voice.secretBallotNotice')}
            </p>
          ) : (
            <p className="voice-ballot-notice voice-ballot-notice-open">
              {OPEN_BALLOT_WAIVER_NOTICE}
            </p>
          )}
          <div className="voice-ballot-btns">
            {['yes', 'no', 'abstain'].map(a => (
              <button
                key={a}
                className={`voice-ballot-btn voice-ballot-${a}`}
                onClick={() => cast(a)}
                disabled={casting}
              >
                {a === 'yes' ? t('voice.ballotYes') : a === 'no' ? t('voice.ballotNo') : t('voice.ballotAbstain')}
              </button>
            ))}
          </div>
        </div>
      )}

      {(myVote || (!isOpen && v.status !== 'draft')) && (
        <div>
          {myVote && (
            <div className="voice-my-vote">{t('voice.yourVotePrefix')} <strong>{t(`voice.answer_${myVote}`)}</strong> {t('voice.yourVoteRecorded')}</div>
          )}
          {(v.status === 'tallied' || v.status === 'published') && (
            <div className="voice-results">
              {!isSecret || v.status === 'published' ? (
                <>
                  <TallyBar label={t('voice.answer_yes')} count={v.yes_count ?? 0} total={total} cls="yes" />
                  <TallyBar label={t('voice.answer_no')}  count={v.no_count  ?? 0} total={total} cls="no" />
                  {(v.abstain_count ?? 0) > 0 && (
                    <TallyBar label={t('voice.answer_abstain')} count={v.abstain_count ?? 0} total={total} cls="abs" />
                  )}
                  {v.result && (
                    <div className={`voice-result voice-result-${v.result}`}>
                      {v.result === 'pass' ? t('voice.motionPassed') : t('voice.motionFailed')}
                    </div>
                  )}
                </>
              ) : (
                <div className="voice-secret-pending">{t('voice.secretPending')}</div>
              )}
            </div>
          )}
        </div>
      )}

      {castErr === 'CONSENT_REQUIRED' ? (
        <div className="voice-consent-cta">
          {t('voice.consentRequired')}
          <Link href="/onboard" className="voice-consent-cta-btn">
            {t('voice.consentNow')} &rarr;
          </Link>
        </div>
      ) : castErr ? (
        <div className="voice-err" style={{ marginTop: 8 }}>{castErr}</div>
      ) : null}
    </div>
  )
}

function TallyBar({ label, count, total, cls }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="voice-tally-bar-row">
      <span className="voice-tally-bar-label">{label}</span>
      <div className="voice-tally-bar-track">
        <div className={`voice-tally-bar-fill voice-tally-bar-${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="voice-tally-bar-ct">{count} ({pct}%)</span>
    </div>
  )
}

function ResidentDocRow({ doc: d }) {
  const [loading, setLoading] = useState(false)
  const typeLabel = DOC_TYPES.find(t => t.value === d.type)?.label ?? d.type

  const open = async () => {
    setLoading(true)
    try {
      const { data } = await supabase.storage.from('ev-documents').createSignedUrl(d.storage_path, 300)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    } catch { /* keep */ } finally { setLoading(false) }
  }

  return (
    <button className="voice-doc-res-row" onClick={open} disabled={loading}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>
      </svg>
      <div className="voice-doc-res-body">
        <div className="voice-doc-res-title">{d.title}</div>
        <div className="voice-doc-res-type">{typeLabel}</div>
      </div>
      <svg className="voice-doc-res-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </button>
  )
}
