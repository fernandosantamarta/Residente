'use client'

import { useEffect, useMemo, useState } from 'react'
import { useVoiceMeetings } from '@/hooks/useVoiceMeetings'
import { useBoardData } from '@/hooks/useBoardData'
import { useBoardDecisions } from '@/hooks/useBoardDecisions'
import { MEETING_TYPES, VOTE_TYPES } from '@/lib/voice'
import { MeetingDetailDialog } from './MeetingDetailDialog'
import { VoteDetailDialog } from './VoteDetailDialog'
import { OpenVoteCard, ResultCard } from './VotingBlock'
import { useCommunityVotes } from '@/hooks/useCommunityVotes'
import { useT } from '@/lib/i18n'

// NOTE: this dashboard uses several English-first labels not yet in lib/i18n
// (Prior meetings, Voting, Results, etc.). Scope call to land the layout first;
// keys can follow for es/pt.

const fmtFull = (iso: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
const fmtDate = (iso: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtTime = (iso: string | null) =>
  !iso ? '' : new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const monthShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
const dayNum = (iso: string) => new Date(iso).getDate()

type SubKey = 'board' | 'upcoming' | 'voting'

// Map a board_decisions row to an update card. Columns vary, read defensively.
function decisionToUpdate(d: any) {
  const amount = d.amount != null ? '$' + Math.round(Number(d.amount)).toLocaleString('en-US') : ''
  const sub = d.summary || d.note || [d.vendor, amount].filter(Boolean).join(' · ') || ''
  return { id: d.id, title: d.title || 'Board decision', date: d.decided_on || d.created_at || '', sub }
}

// Google Calendar quick-add link for "Add to calendar".
function gcalLink(m: any): string {
  const start = new Date(m.scheduled_at)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: m.title ?? 'Meeting',
    dates: `${fmt(start)}/${fmt(end)}`,
    location: m.location ?? '', details: m.virtual_link ? `Join: ${m.virtual_link}` : '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// Meetings & Votes — the spine of Easy Voice, restyled into the combined
// board + meetings + voting dashboard. Lives as a section of the /app/voice hub.
export function MeetingsSection() {
  const t = useT()
  const { meetings, loading, error } = useVoiceMeetings()
  const { votes: communityVotes, reload: reloadVotes } = useCommunityVotes()
  const board = useBoardData()
  const { decisions } = useBoardDecisions(6) as { decisions: any[] | null }
  const [openId, setOpenId] = useState<string | null>(null)
  const [openVote, setOpenVote] = useState<any | null>(null)

  const members    = board.members
  const committees = board.committees
  const updates    = (decisions ?? []).map(decisionToUpdate)

  const { nextMeeting, upcomingRest, past } = useMemo(() => {
    const upcoming = meetings
      .filter(m => m.status !== 'completed')
      .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))
    const past = meetings
      .filter(m => m.status === 'completed')
      .sort((a, b) => +new Date(b.scheduled_at) - +new Date(a.scheduled_at))
    return { nextMeeting: upcoming[0] ?? null, upcomingRest: upcoming.slice(1), past }
  }, [meetings])

  // Votes are standalone now — read by community, not through meetings.
  const openVotes = communityVotes.filter(v => v.status === 'open')
  const results   = communityVotes.filter(v => ['closed', 'tallied', 'published'].includes(v.status))
  const upcomingCount = nextMeeting ? upcomingRest.length + 1 : 0

  // Stat chips jump to their section on this single page.
  const goTo = (id: SubKey) =>
    document.getElementById(`vd-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const stats = [
    { key: 'upcoming', icon: 'calendar', count: upcomingCount,    label: upcomingCount === 1 ? 'Upcoming' : 'Upcoming' },
    { key: 'voting',   icon: 'vote',     count: openVotes.length, label: openVotes.length === 1 ? 'Open vote' : 'Open votes' },
    { key: 'board',    icon: 'people',   count: members.length,   label: 'Board' },
  ] as const

  return (
    <section id="meetings" className="voice-dash ev-section">
      {loading && <div className="voice-placeholder">{t('voice.loadingMeetings')}</div>}
      {error && <div className="voice-err">{error}</div>}

      {!loading && !error && (
        <>
          <div className="vd-chips">
            {stats.map(s => (
              <button key={s.key} className="vd-chip" onClick={() => goTo(s.key as SubKey)}>
                <span className={`vd-chip-ic vd-ic-${s.key === 'upcoming' ? 'meetings' : s.key === 'voting' ? 'votes' : 'proposals'}`}><Icon name={s.icon} /></span>
                <span className="vd-chip-num">{s.count}</span>
                <span className="vd-chip-label">{s.label}</span>
              </button>
            ))}
          </div>

          <div className="vd-grid">
            <div className="vd-main">
              {/* 1 — Board */}
              {members.length > 0 && (
                <section id="vd-board" className="vd-anchor">
                  <h3 className="vd-section-title"><Icon name="people" /> Your Board</h3>
                  <div className="vd-board-grid">
                    {members.map(m => (
                      <div key={m.id} className="vd-board-card">
                        <span className="vd-member-avatar lg">{m.initials}</span>
                        <span className="vd-board-name">{m.name}</span>
                        <span className="vd-board-role">{m.role}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 2 — Upcoming meetings */}
              <section id="vd-upcoming" className="vd-anchor">
                <h3 className="vd-section-title"><Icon name="calendar" /> Upcoming Meetings</h3>
                {nextMeeting ? <UpcomingHeroCard meeting={nextMeeting} onOpen={setOpenId} /> : (
                  <div className="voice-placeholder">No upcoming meetings scheduled.</div>
                )}
                {upcomingRest.length > 0 && (
                  <div className="vd-card">
                    {upcomingRest.map(m => <MeetingMiniRow key={m.id} meeting={m} onOpen={setOpenId} />)}
                  </div>
                )}
              </section>

              {/* 3 — Prior meetings */}
              {past.length > 0 && (
                <section id="vd-prior" className="vd-anchor">
                  <h3 className="vd-section-title"><Icon name="check" /> Prior Meetings</h3>
                  <div className="vd-card">
                    {past.map(m => <RecentMeetingRow key={m.id} meeting={m} onOpen={setOpenId} />)}
                  </div>
                </section>
              )}

              {/* 4 — Votes (open votes + results together) */}
              <section id="vd-voting" className="vd-anchor">
                <h3 className="vd-section-title"><Icon name="vote" /> Votes</h3>
                {openVotes.length === 0 && results.length === 0 ? (
                  <div className="voice-placeholder">No votes yet.</div>
                ) : (
                  <div className="vd-votegrid">
                    {openVotes.map(v => <OpenVoteCard key={v.id} vote={v} onOpen={setOpenVote} />)}
                    {results.map(v => <ResultCard key={v.id} vote={v} onOpen={setOpenVote} />)}
                  </div>
                )}
              </section>
            </div>

            <aside className="vd-rail">
              <UpNext meeting={nextMeeting} onOpen={setOpenId} />
              {updates.length > 0 && (
                <div className="vd-rail-card">
                  <div className="vd-rail-head"><span>Board updates</span></div>
                  {updates.map(u => (
                    <div key={u.id} className="vd-update">
                      <span className="vd-update-dot" />
                      <span className="vd-update-body">
                        <span className="vd-update-title">{u.title}</span>
                        {u.sub && <span className="vd-update-sub">{u.sub}</span>}
                        {u.date && <span className="vd-update-date">{fmtDate(u.date)}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {committees.length > 0 && (
                <div className="vd-rail-card">
                  <div className="vd-rail-head"><span>Committees</span></div>
                  {committees.map(c => (
                    <div key={c.id} className="vd-committee">
                      <span className="vd-committee-body">
                        <span className="vd-committee-name">{c.name}</span>
                        {c.chair && <span className="vd-committee-meta">Chair: {c.chair}</span>}
                      </span>
                      <span className="vd-committee-count">{c.member_count}</span>
                    </div>
                  ))}
                </div>
              )}
              <YourVotes votes={[...openVotes, ...results].slice(0, 4)} onOpen={setOpenVote} />
            </aside>
          </div>
        </>
      )}

      {openId && <MeetingDetailDialog meetingId={openId} onClose={() => setOpenId(null)} />}
      {openVote && (
        <VoteDetailDialog
          vote={openVote}
          onClose={() => setOpenVote(null)}
          onVoted={() => { reloadVotes(); setOpenVote(null) }}
        />
      )}
    </section>
  )
}

/* ---------------- Meetings ---------------- */

function UpcomingHeroCard({ meeting: m, onOpen }: { meeting: any; onOpen: (id: string) => void }) {
  return (
    <div className="vd-hero-meeting">
      <div className="vd-hero-kicker">Next board meeting</div>
      <div className="vd-hero-body">
        <div className="vd-hero-date">
          <span className="vd-hero-month">{monthShort(m.scheduled_at)}</span>
          <span className="vd-hero-day">{dayNum(m.scheduled_at)}</span>
        </div>
        <div className="vd-hero-info">
          <div className="vd-hero-title">{m.title}</div>
          <div className="vd-hero-line"><Icon name="calendar" /> {fmtFull(m.scheduled_at)}</div>
          {m.location && <div className="vd-hero-line"><Icon name="pin" /> {m.location}</div>}
          <div className="vd-hero-actions">
            {m.virtual_link
              ? <a className="vd-btn-primary" href={m.virtual_link} target="_blank" rel="noreferrer"><Icon name="video" /> Join Meeting</a>
              : <button className="vd-btn-primary" onClick={() => onOpen(m.id)}><Icon name="video" /> Details</button>}
            <a className="vd-btn-ghost" href={gcalLink(m)} target="_blank" rel="noreferrer"><Icon name="calendar" /> Add to calendar</a>
          </div>
        </div>
        <div className="vd-hero-art" aria-hidden="true">
          <Icon name="people" />
          <span>Your participation helps keep our community strong.</span>
        </div>
      </div>
    </div>
  )
}

function MeetingMiniRow({ meeting: m, onOpen }: { meeting: any; onOpen: (id: string) => void }) {
  const typeLabel = MEETING_TYPES.find(mt => mt.value === m.type)?.label ?? m.type
  return (
    <button className="vd-recent-row" onClick={() => onOpen(m.id)}>
      <span className="vd-recent-ic"><Icon name="calendar" /></span>
      <span className="vd-recent-body">
        <span className="vd-recent-titlerow">
          <span className="vd-recent-title">{m.title}</span>
          <span className="vd-tag vd-tag-meeting">{typeLabel}</span>
        </span>
        <span className="vd-recent-meta">{fmtDate(m.scheduled_at)} · {fmtTime(m.scheduled_at)}</span>
      </span>
      <span className="vd-recent-action">Details <Icon name="chevron" /></span>
    </button>
  )
}

// A "meeting" that only exists to hold a vote reads the same as a real board
// meeting in this list — distinguish: vote-carriers get a gavel + "Vote" tag.
function RecentMeetingRow({ meeting: m, onOpen }: { meeting: any; onOpen: (id: string) => void }) {
  const votes = m.ev_votes ?? []
  const hasVotes = votes.length > 0
  const typeLabel = MEETING_TYPES.find(mt => mt.value === m.type)?.label ?? m.type
  return (
    <button className="vd-recent-row" onClick={() => onOpen(m.id)}>
      <span className={`vd-recent-ic${hasVotes ? ' is-vote' : ''}`}>
        <Icon name={hasVotes ? 'gavel' : 'check'} />
      </span>
      <span className="vd-recent-body">
        <span className="vd-recent-titlerow">
          <span className="vd-recent-title">{m.title}</span>
          {hasVotes
            ? <span className="vd-tag vd-tag-vote">{votes.length > 1 ? `${votes.length} votes` : 'Vote'}</span>
            : <span className="vd-tag vd-tag-meeting">{typeLabel}</span>}
        </span>
        <span className="vd-recent-meta">{fmtDate(m.scheduled_at)} · {fmtTime(m.scheduled_at)}</span>
      </span>
      <span className="vd-recent-action">{hasVotes ? 'Results' : 'Minutes'} <Icon name="download" /></span>
    </button>
  )
}

/* ---------------- Voting + Results ---------------- */


/* ---------------- Right rail ---------------- */

function UpNext({ meeting: m, onOpen }: { meeting: any; onOpen: (id: string) => void }) {
  if (!m) return null
  return (
    <div className="vd-rail-card vd-upnext">
      <div className="vd-rail-head"><span>Up next</span></div>
      <button className="vd-upnext-meeting" onClick={() => onOpen(m.id)}>
        <span className="vd-hero-date sm">
          <span className="vd-hero-month">{monthShort(m.scheduled_at)}</span>
          <span className="vd-hero-day">{dayNum(m.scheduled_at)}</span>
        </span>
        <span className="vd-upnext-info">
          <span className="vd-upnext-title">{m.title}</span>
          <span className="vd-upnext-meta">{fmtFull(m.scheduled_at)}</span>
          {m.location && <span className="vd-upnext-meta"><Icon name="pin" /> {m.location}</span>}
          <span className="vd-pill vd-pill-warn vd-upnext-pill">Upcoming</span>
        </span>
      </button>
      <Countdown to={m.scheduled_at} />
    </div>
  )
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number>(() => +new Date(to) - 1)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [])
  const diff = Math.max(0, +new Date(to) - now)
  const cells = [
    { n: Math.floor(diff / 86400000), l: 'days' },
    { n: Math.floor((diff % 86400000) / 3600000), l: 'hrs' },
    { n: Math.floor((diff % 3600000) / 60000), l: 'min' },
    { n: Math.floor((diff % 60000) / 1000), l: 'sec' },
  ]
  return (
    <div className="vd-countdown">
      <div className="vd-countdown-label">Starts in</div>
      <div className="vd-countdown-cells">
        {cells.map(c => (
          <span key={c.l} className="vd-cd-cell">
            <span className="vd-cd-num">{String(c.n).padStart(2, '0')}</span>
            <span className="vd-cd-unit">{c.l}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function YourVotes({ votes, onOpen }: { votes: any[]; onOpen: (vote: any) => void }) {
  if (votes.length === 0) return null
  return (
    <div className="vd-rail-card">
      <div className="vd-rail-head"><span>Your votes</span></div>
      {votes.map(v => {
        const open = v.status === 'open'
        return (
          <button key={v.id} className="vd-yourvote" onClick={() => onOpen(v)}>
            <span className="vd-yourvote-body">
              <span className="vd-yourvote-title">{v.title}</span>
              <span className="vd-yourvote-meta">{v.description || (VOTE_TYPES.find(t => t.value === v.type)?.label ?? '')}</span>
            </span>
            {open
              ? <span className="vd-yourvote-cta"><Icon name="clock" /> Vote now</span>
              : <span className="vd-yourvote-done"><Icon name="check" /> Closed</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- Inline icons ---------------- */

function Icon({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'vote':     return <svg viewBox="0 0 24 24" {...p}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    case 'calendar': return <svg viewBox="0 0 24 24" {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'doc':      return <svg viewBox="0 0 24 24" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    case 'pin':      return <svg viewBox="0 0 24 24" {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    case 'video':    return <svg viewBox="0 0 24 24" {...p}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    case 'check':    return <svg viewBox="0 0 24 24" {...p}><polyline points="20 6 9 17 4 12"/></svg>
    case 'x':        return <svg viewBox="0 0 24 24" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    case 'download': return <svg viewBox="0 0 24 24" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    case 'chevron':  return <svg viewBox="0 0 24 24" {...p}><polyline points="9 18 15 12 9 6"/></svg>
    case 'clock':    return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
    case 'people':   return <svg viewBox="0 0 24 24" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    case 'gavel':    return <svg viewBox="0 0 24 24" {...p}><path d="M14 13l-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="M9.5 6.5l8 8"/><path d="M14 4l6 6"/><path d="M11 7l6 6"/><line x1="16" y1="20" x2="22" y2="20"/></svg>
    default:         return null
  }
}
