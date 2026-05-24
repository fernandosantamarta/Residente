'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useVoiceMeeting } from '@/hooks/useVoiceMeetings'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { MEETING_TYPES, DOC_TYPES, VOTE_TYPES } from '@/lib/voice'

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

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { meeting, loading, error, reload } = useVoiceMeeting(id)

  if (loading) return <div className="voice-wrap"><div className="voice-placeholder">Loading…</div></div>
  if (error)   return <div className="voice-wrap"><div className="voice-err">{error}</div></div>
  if (!meeting) return null

  const typeLabel = MEETING_TYPES.find(t => t.value === meeting.type)?.label ?? meeting.type
  const docs = (meeting.ev_meeting_docs ?? []).sort((a, b) => {
    const order = ['agenda', 'minutes', 'supporting', 'notice_record']
    return order.indexOf(a.type) - order.indexOf(b.type)
  })
  const votes = meeting.ev_votes ?? []

  return (
    <div className="voice-wrap">
      <Link href="/app/voice" className="voice-back-btn">← All meetings</Link>

      <div className="voice-detail-header">
        <div className="voice-meeting-type">{typeLabel}</div>
        <h2 className="voice-detail-title">{meeting.title}</h2>
        <div className="voice-detail-meta">
          <span>{fmtDt(meeting.scheduled_at)}</span>
          {meeting.location && <span>· {meeting.location}</span>}
        </div>
        {meeting.virtual_link && (
          <a className="voice-virtual-btn" href={meeting.virtual_link} target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            Join virtual meeting
          </a>
        )}
        {meeting.quorum_confirmed && (
          <span className="voice-badge-quorum">Quorum confirmed</span>
        )}
      </div>

      {votes.length > 0 && (
        <section className="voice-section">
          <div className="voice-section-label">Votes</div>
          {votes.map(v => (
            <ResidentVoteCard key={v.id} vote={v} onVoted={reload} />
          ))}
        </section>
      )}

      {docs.length > 0 && (
        <section className="voice-section">
          <div className="voice-section-label">Documents</div>
          {docs.map(d => <ResidentDocRow key={d.id} doc={d} />)}
        </section>
      )}

      {votes.length === 0 && docs.length === 0 && (
        <div className="voice-placeholder">No votes or documents posted yet for this meeting.</div>
      )}
    </div>
  )
}

function ResidentVoteCard({ vote: v, onVoted }) {
  const { profile } = useAuth() || {}
  const [casting, setCasting] = useState(false)
  const [castErr, setCastErr] = useState(null)
  const [myVote, setMyVote] = useState(null)
  const isOpen = v.status === 'open'
  const typeLabel = VOTE_TYPES.find(t => t.value === v.type)?.label ?? v.type
  const isSecret = v.ballot_type === 'secret'
  const total = (v.yes_count ?? 0) + (v.no_count ?? 0) + (v.abstain_count ?? 0)

  const cast = async (answer) => {
    if (!hasSupabase || !profile) return
    setCasting(true)
    setCastErr(null)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_ballots').insert({
          vote_id:     v.id,
          profile_id:  profile.id,
          unit_number: profile.unit_number,
          answer,
        })
      )
      if (error) {
        if (error.code === '23505') {
          setCastErr('Your unit has already cast a ballot for this vote.')
        } else {
          throw error
        }
        return
      }
      setMyVote(answer)
      onVoted()
    } catch (e) {
      setCastErr(e?.message ?? 'Could not cast your ballot. Try again.')
    } finally {
      setCasting(false)
    }
  }

  return (
    <div className={`voice-vote-card${isOpen ? ' open' : ''}`}>
      <div className="voice-vote-card-head">
        <div>
          <div className="voice-vote-card-title">{v.title}</div>
          <div className="voice-vote-card-meta">{typeLabel} · {isSecret ? '🔒 Secret ballot' : 'Open ballot'}</div>
        </div>
        <span className={`voice-status voice-status-${v.status}`}>
          {v.status === 'open' ? 'Vote open' : v.status === 'published' ? 'Results' : v.status}
        </span>
      </div>

      {v.description && <p className="voice-vote-card-desc">{v.description}</p>}

      {isOpen && !myVote && (
        <div className="voice-ballot-btns">
          {['yes', 'no', 'abstain'].map(a => (
            <button
              key={a}
              className={`voice-ballot-btn voice-ballot-${a}`}
              onClick={() => cast(a)}
              disabled={casting}
            >
              {a === 'yes' ? '✓ Yes' : a === 'no' ? '✗ No' : '— Abstain'}
            </button>
          ))}
        </div>
      )}

      {(myVote || (!isOpen && v.status !== 'draft')) && (
        <div>
          {myVote && (
            <div className="voice-my-vote">Your vote: <strong>{myVote}</strong> — recorded</div>
          )}
          {(v.status === 'tallied' || v.status === 'published') && (
            <div className="voice-results">
              {!isSecret || v.status === 'published' ? (
                <>
                  <TallyBar label="Yes" count={v.yes_count ?? 0} total={total} cls="yes" />
                  <TallyBar label="No"  count={v.no_count  ?? 0} total={total} cls="no" />
                  {(v.abstain_count ?? 0) > 0 && (
                    <TallyBar label="Abstain" count={v.abstain_count ?? 0} total={total} cls="abs" />
                  )}
                  {v.result && (
                    <div className={`voice-result voice-result-${v.result}`}>
                      {v.result === 'pass' ? 'Motion passed' : 'Motion failed'}
                    </div>
                  )}
                </>
              ) : (
                <div className="voice-secret-pending">Results will be published after the vote closes.</div>
              )}
            </div>
          )}
        </div>
      )}

      {castErr && <div className="voice-err" style={{ marginTop: 8 }}>{castErr}</div>}
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
