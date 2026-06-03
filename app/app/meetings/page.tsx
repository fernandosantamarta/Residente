'use client'

// Easy Voice — Meetings & elections (resident view, read-only). A self-contained
// route (NOT yet wired into the rail / Easy Voice tabs — see the wire-up note at
// the bottom) so it doesn't collide with in-progress Easy Voice front-end work.
// Residents see upcoming meetings (with their statutory notice + agenda status),
// the board-election timeline (including the "you can run" candidate deadline),
// and any recall in progress — from the community-readable ev_meetings,
// ev_elections, and ev_recalls. FS 718.112(2)(c)-(d) / 720.303(2), 720.306(9)-(10).
//
// Reuses the grid-free con-* containers + theme-color inline rows; local English.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { toDate } from '@/lib/compliance/rules-core'
import type { MeetingRow } from '@/lib/compliance/meetings'
import {
  electionMilestones, ELECTION_STATUS_LABELS, CANDIDATE_NOTICE_DAYS, ELECTION_FIRST_NOTICE_DAYS,
  type ElectionRow, type RecallRow, type ElectionStatus,
} from '@/lib/compliance/elections'

const withTimeout = (p: any, ms = 10000): Promise<any> =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmtDate = (d: any) =>
  d ? new Date(typeof d === 'string' && d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const fmtDateTime = (d: any) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

const MEETING_LABEL: Record<string, string> = {
  board: 'Board meeting', annual: 'Annual / members meeting', special: 'Special meeting', committee: 'Committee meeting',
}

export default function ResidentMeetingsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [elections, setElections] = useState<ElectionRow[]>([])
  const [recalls, setRecalls] = useState<RecallRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    setLoading(true)
    try {
      const grab = async (table: string, order: string) => {
        const { data } = (await withTimeout(
          supabase.from(table).select('*').eq('community_id', communityId).order(order, { ascending: false }),
        )) as any
        return data || []
      }
      setMeetings(await grab('ev_meetings', 'scheduled_at'))
      setElections(await grab('ev_elections', 'election_date'))
      setRecalls(await grab('ev_recalls', 'served_at'))
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const nowMs = toDate(new Date())!.getTime()
  const upcomingMeetings = meetings
    .filter(m => { const s = toDate(m.scheduled_at); return s && s.getTime() >= nowMs })
    .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))
  const pastMeetings = meetings
    .filter(m => { const s = toDate(m.scheduled_at); return s && s.getTime() < nowMs })
    .slice(0, 4)

  // The election to feature: soonest upcoming, else most recent.
  const sortedElections = [...elections].filter(e => String(e.status ?? '') !== 'cancelled')
  const nextElection =
    sortedElections.filter(e => { const d = toDate(e.election_date); return d && d.getTime() >= nowMs })
      .sort((a, b) => (a.election_date || '').localeCompare(b.election_date || ''))[0]
    || sortedElections[0]

  const activeRecalls = recalls.filter(r => ['pending', 'arbitration', 'certified'].includes(String(r.outcome ?? 'pending')) && r.served_at)

  return (
    <section className="con-wrap ev-section">
      <div className="voice-page-head">
        <h1 className="voice-page-title">Meetings <span className="amp">&</span> elections</h1>
        <p className="voice-page-sub">
          Upcoming association meetings and the board-election timeline — including when you can run for the
          board and when ballots go out. Notices are also delivered to you directly.
        </p>
      </div>

      {/* Upcoming meetings */}
      <section className="con-card" style={{ marginBottom: 18 }}>
        <h2 className="con-card-title">Upcoming meetings</h2>
        {loading && <div className="con-empty">Loading…</div>}
        {!loading && upcomingMeetings.length === 0 && <div className="con-empty">No meetings are currently scheduled.</div>}
        {!loading && upcomingMeetings.map(m => {
          const noticed = !!(m.notice_posted_at || m.notice_mailed_at)
          return (
            <div key={m.id} style={ROW_WRAP}>
              <div style={ROW}>
                <div style={{ minWidth: 0 }}>
                  <div style={ROW_TITLE}>{m.title || MEETING_LABEL[String(m.type ?? 'board')] || 'Meeting'}</div>
                  <div style={ROW_META}>
                    {MEETING_LABEL[String(m.type ?? 'board')] || m.type} · {fmtDateTime(m.scheduled_at)}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {noticed && <span style={pill('#067647')}>Notice given</span>}
                    {m.agenda_posted_at && <span style={pill('#175CD3')}>Agenda available</span>}
                    {m.is_budget_meeting && <span style={pill('#0E7490')}>Budget</span>}
                    {m.affects_assessments && <span style={pill('#B54708')}>Assessment</span>}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {!loading && pastMeetings.length > 0 && (
          <>
            <div style={{ ...ROW_META, fontWeight: 600, margin: '14px 0 4px' }}>Recent</div>
            {pastMeetings.map(m => {
              const minutes = !!m.minutes_published_at || ['published', 'approved'].includes(String(m.minutes_status ?? ''))
              return (
                <div key={m.id} style={ROW_WRAP}>
                  <div style={ROW}>
                    <div style={{ minWidth: 0 }}>
                      <div style={ROW_TITLE}>{m.title || MEETING_LABEL[String(m.type ?? 'board')] || 'Meeting'}</div>
                      <div style={ROW_META}>{fmtDate(m.scheduled_at)}</div>
                    </div>
                    <span style={pill(minutes ? '#067647' : '#98A2B3')}>{minutes ? 'Minutes available' : 'Minutes pending'}</span>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </section>

      {/* Board election */}
      <section className="con-card" style={{ marginBottom: activeRecalls.length ? 18 : 0 }}>
        <h2 className="con-card-title">Board election</h2>
        {loading && <div className="con-empty">Loading…</div>}
        {!loading && !nextElection && <div className="con-empty">No election is scheduled right now.</div>}
        {!loading && nextElection && (() => {
          const e = nextElection
          const status = String(e.status ?? 'proposed') as ElectionStatus
          const d = toDate(e.election_date)
          const isUpcoming = d && d.getTime() >= nowMs
          const ms = electionMilestones(e)
          const canStillRun = isUpcoming && ms.candidateBy && ms.candidateBy.getTime() >= nowMs
          return (
            <div>
              <div style={ROW}>
                <div>
                  <div style={ROW_TITLE}>{e.election_date ? `Election ${fmtDate(e.election_date)}` : 'Election'}</div>
                  <div style={ROW_META}>
                    {e.seats ? `${e.seats} seat${e.seats === 1 ? '' : 's'} open · ` : ''}
                    {ELECTION_STATUS_LABELS[status]}
                  </div>
                </div>
                <span style={pill(isUpcoming ? '#7C3AED' : '#98A2B3')}>{isUpcoming ? 'Upcoming' : 'Past'}</span>
              </div>
              {canStillRun && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#5B21B6' }}>Want to serve on the board?</div>
                  <div style={{ fontSize: 13, color: '#0A2440', marginTop: 2 }}>
                    Submit your written notice of intent to be a candidate by <strong>{fmtDate(ms.candidateBy!.toISOString().slice(0, 10))}</strong> (at least {CANDIDATE_NOTICE_DAYS.value} days before the election).
                  </div>
                </div>
              )}
              {isUpcoming && (
                <div style={{ ...ROW_META, marginTop: 10 }}>
                  {e.first_notice_at
                    ? `First notice sent ${fmtDate(e.first_notice_at)}.`
                    : ms.firstNoticeBy ? `First notice of election is due by ${fmtDate(ms.firstNoticeBy.toISOString().slice(0, 10))} (≥${ELECTION_FIRST_NOTICE_DAYS.value} days before).` : ''}
                  {' '}
                  {e.ballots_sent_at
                    ? `Ballots mailed ${fmtDate(e.ballots_sent_at)} — watch your mail.`
                    : ms.secondNoticeLatest ? `Ballots are mailed between ${fmtDate(ms.secondNoticeEarliest!.toISOString().slice(0, 10))} and ${fmtDate(ms.secondNoticeLatest.toISOString().slice(0, 10))}.` : ''}
                </div>
              )}
              {status === 'completed' && (
                <div style={{ ...ROW_META, marginTop: 8 }}>
                  Election held{e.ballots_cast != null ? ` — ${e.ballots_cast}${e.eligible_count ? ` of ${e.eligible_count}` : ''} ballots cast.` : '.'}
                </div>
              )}
            </div>
          )
        })()}
      </section>

      {/* Recall in progress */}
      {!loading && activeRecalls.length > 0 && (
        <section className="con-card">
          <h2 className="con-card-title">Board recall</h2>
          {activeRecalls.map(r => (
            <div key={r.id} style={ROW_WRAP}>
              <div style={ROW}>
                <div>
                  <div style={ROW_TITLE}>Recall served {fmtDate(r.served_at)}</div>
                  <div style={ROW_META}>The board must hold a meeting to certify the recall within 5 business days of service.</div>
                </div>
                <span style={pill(String(r.outcome) === 'certified' ? '#067647' : String(r.outcome) === 'arbitration' ? '#B42318' : '#B54708')}>
                  {String(r.outcome ?? 'pending') === 'certified' ? 'Certified' : String(r.outcome) === 'arbitration' ? 'In arbitration' : 'Pending'}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}
    </section>
  )
}

function pill(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }
}
const ROW_WRAP: React.CSSProperties = { borderBottom: '1px solid rgba(15,28,46,0.07)' }
const ROW: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: '12px 2px' }
const ROW_TITLE: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: '#0A2440' }
const ROW_META: React.CSSProperties = { fontSize: 12.5, color: 'rgba(15,28,46,0.6)', marginTop: 2 }

// ── Wire-up when your Easy Voice front-end work settles ──
// Left rail (app/app/layout.tsx NAV): { href: '/app/meetings', label: 'Meetings', icon: … }
// or surface as Easy Voice hub tabs. Reachable directly at /app/meetings until then.
