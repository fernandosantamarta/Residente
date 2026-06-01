'use client'

import { useState } from 'react'
import { useVoiceMeetings } from '@/hooks/useVoiceMeetings'
import { MEETING_TYPES } from '@/lib/voice'
import { MeetingDetailDialog } from './MeetingDetailDialog'

const fmtDt = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Meetings & Votes — the spine of Easy Voice. Lives as a section of the
// merged /app/voice hub alongside Board and Contact.
export function MeetingsSection() {
  const { meetings, loading, error } = useVoiceMeetings()
  // Which meeting is open in the detail popup. null = closed.
  const [openId, setOpenId] = useState<string | null>(null)

  const upcoming = meetings.filter(m => m.status !== 'completed')
  const past     = meetings.filter(m => m.status === 'completed')

  return (
    <section id="meetings" className="voice-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">Meetings &amp; Votes</h2>
        <p className="voice-page-sub">View upcoming meetings, cast your vote, and access all meeting documents.</p>
      </div>

      {loading && <div className="voice-placeholder">Loading meetings…</div>}
      {error && <div className="voice-err">{error}</div>}

      {!loading && !error && meetings.length === 0 && (
        <div className="voice-placeholder">No meetings scheduled yet.</div>
      )}

      {upcoming.length > 0 && (
        <section className="voice-section">
          <div className="voice-section-label">Upcoming</div>
          {upcoming.map(m => (
            <ResidentMeetingRow key={m.id} meeting={m} onOpen={() => setOpenId(m.id)} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="voice-section">
          <div className="voice-section-label">Past meetings</div>
          {past.map(m => (
            <ResidentMeetingRow key={m.id} meeting={m} onOpen={() => setOpenId(m.id)} />
          ))}
        </section>
      )}

      {openId && (
        <MeetingDetailDialog meetingId={openId} onClose={() => setOpenId(null)} />
      )}
    </section>
  )
}

function ResidentMeetingRow({ meeting: m, onOpen }) {
  const typeLabel = MEETING_TYPES.find(t => t.value === m.type)?.label ?? m.type
  const votes = m.ev_votes ?? []
  const openVotes = votes.filter(v => v.status === 'open').length
  const isPast = m.status === 'completed'

  return (
    <button type="button" onClick={onOpen} className={`voice-res-row${isPast ? ' past' : ''}`}>
      <div className="voice-res-date">
        <span className="voice-res-month">
          {new Date(m.scheduled_at).toLocaleDateString('en-US', { month: 'short' })}
        </span>
        <span className="voice-res-day">
          {new Date(m.scheduled_at).getDate()}
        </span>
      </div>
      <div className="voice-res-body">
        <div className="voice-res-type">{typeLabel}</div>
        <div className="voice-res-title">{m.title}</div>
        <div className="voice-res-meta">{fmtDt(m.scheduled_at)}</div>
        {m.location && <div className="voice-res-meta">{m.location}</div>}
      </div>
      <div className="voice-res-right">
        {openVotes > 0 && (
          <span className="voice-badge-vote">Vote open</span>
        )}
        <svg className="voice-res-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </button>
  )
}
