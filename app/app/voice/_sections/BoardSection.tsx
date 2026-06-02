'use client'

import { ReactNode, useState } from 'react'
import { useBoardData, type BoardMember, type BoardMeeting, type Committee } from '@/hooks/useBoardData'
import { useBoardDecisions } from '@/hooks/useBoardDecisions'
import { DetailDialog } from '../../track/_sections/DetailDialog'
import { Countdown } from './Countdown'
import { BoardYourVotes } from './VotingBlock'
import { MeetingDetailDialog } from './MeetingDetailDialog'
import { useT } from '@/lib/i18n'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s ?? '')

type Update = { id: string; kind: UpdateKind; title: string; date: string; sub: string }

// Demo fallback — shown only when there's no real community data (e.g. the
// logged-out preview). A real community renders its own board/meetings/updates.
const DEMO_MEMBERS: BoardMember[] = [
  { id: 'bm1', name: 'Maria Santos',  role: 'President',      initials: 'MS', email: 'maria@example.com' },
  { id: 'bm2', name: 'David Chen',    role: 'Vice President', initials: 'DC', email: 'david@example.com' },
  { id: 'bm3', name: 'Aisha Patel',   role: 'Treasurer',      initials: 'AP', email: 'aisha@example.com' },
  { id: 'bm4', name: 'Tom Rivera',    role: 'Secretary',      initials: 'TR', email: 'tom@example.com' },
]
const DEMO_UPCOMING: BoardMeeting = {
  id: 'bmtg-up', title: 'Monthly Board Meeting', type: 'board',
  scheduled_at: '2026-06-15T18:00:00', location: 'Clubhouse Meeting Room',
  virtual_link: null, status: 'scheduled', minutes_status: 'none',
}
const DEMO_MINUTES: BoardMeeting[] = [
  { id: 'bmtg-1', title: 'May Board Meeting',    type: 'board',   scheduled_at: '2026-05-15T18:00:00', location: 'Clubhouse', virtual_link: null, status: 'completed', minutes_status: 'approved' },
  { id: 'bmtg-2', title: 'Annual Meeting 2026',  type: 'annual',  scheduled_at: '2026-04-20T18:00:00', location: 'Clubhouse', virtual_link: null, status: 'completed', minutes_status: 'approved' },
  { id: 'bmtg-3', title: 'Special: Pool Project', type: 'special', scheduled_at: '2026-04-02T18:00:00', location: 'Clubhouse', virtual_link: null, status: 'completed', minutes_status: 'published' },
]
const DEMO_COMMITTEES: Committee[] = [
  { id: 'cm1', name: 'Finance Committee',      chair: 'Aisha Patel',  member_count: 4, icon: 'finance' },
  { id: 'cm2', name: 'Landscaping Committee',  chair: 'Tom Rivera',   member_count: 3, icon: 'leaf' },
  { id: 'cm3', name: 'Architectural Review',   chair: 'David Chen',   member_count: 5, icon: 'home' },
  { id: 'cm4', name: 'Safety & Security',      chair: 'Maria Santos', member_count: 3, icon: 'shield' },
]
const DEMO_UPDATES: Update[] = [
  { id: 'bu1', kind: 'approval', title: 'Landscaping contract approved', date: '2026-05-15', sub: 'GreenScape · $48,000/yr' },
  { id: 'bu2', kind: 'budget',   title: '2026 budget ratified',          date: '2026-04-20', sub: '$1.2M annual operating budget' },
  { id: 'bu3', kind: 'announce', title: 'Pool reopening June 1',          date: '2026-04-02', sub: 'Resurfacing complete' },
]

// Board — meet-your-board surface, a section of the Easy Voice hub.
// Real data (no new migration): members from board/admin profiles, upcoming
// + minutes from ev_meetings, updates from board_decisions. Committees have
// no data model yet, so that block stays hidden until one exists.

type UpdateKind = 'approval' | 'contract' | 'budget' | 'announce'

// Map a board_decisions row to the update-card shape. board_decisions
// columns vary, so read defensively.
function decisionToUpdate(d: any, fallbackTitle: string): { id: string; kind: UpdateKind; title: string; date: string; sub: string } {
  const status = String(d.status || '').toLowerCase()
  const kind: UpdateKind =
    status.includes('contract') ? 'contract'
    : status.includes('budget') ? 'budget'
    : status.includes('announce') ? 'announce'
    : 'approval'
  const amount = d.amount != null ? '$' + Math.round(Number(d.amount)).toLocaleString('en-US') : ''
  const sub = d.summary || d.note || [d.vendor, amount].filter(Boolean).join(' · ') || ''
  return { id: d.id, kind, title: d.title || fallbackTitle, date: d.decided_on || d.created_at || '', sub }
}

const isoTime = (ts: string) => {
  try { return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}
const isoDay = (ts: string) => { try { return new Date(ts).toISOString().slice(0, 10) } catch { return ts } }

const fmtDate = (iso: string) => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}
const fmtLongDate = (iso: string) => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

export function BoardSection() {
  const t = useT()
  const board = useBoardData()
  const { decisions } = useBoardDecisions(6) as { decisions: any[] | null }
  const realUpdates = (decisions ?? []).map(d => decisionToUpdate(d, t('board.decisionFallbackTitle')))

  // Real community data, or the demo fallback so the tab is never empty.
  const members  = board.members.length  ? board.members  : DEMO_MEMBERS
  const minutes  = board.minutes.length  ? board.minutes  : DEMO_MINUTES
  const upcoming = board.upcoming ?? (board.members.length ? null : DEMO_UPCOMING)
  const updates  = realUpdates.length ? realUpdates : DEMO_UPDATES
  const committees = board.committees.length ? board.committees : DEMO_COMMITTEES

  // In-place popups — every row/link opens detail here instead of navigating.
  const [meetingOpen, setMeetingOpen] = useState<BoardMeeting | null>(null)
  const [updateOpen, setUpdateOpen]   = useState<Update | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const [minutesOpen, setMinutesOpen] = useState(false)
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [committeeOpen, setCommitteeOpen] = useState<Committee | null>(null)

  const meetingTypeLabel = (type: string) =>
    type === 'annual' ? t('board.meetingTypeAnnual')
    : type === 'special' ? t('board.meetingTypeSpecial')
    : type === 'committee' ? t('board.meetingTypeCommittee')
    : t('board.meetingTypeBoard')

  return (
    <section id="board" className="brd-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">{t('board.pageTitle')}</h2>
        <p className="voice-page-sub">
          {t('board.pageSub')}
        </p>
      </div>

      <div className="brd-grid">
        {/* MAIN COLUMN */}
        <div className="brd-col">
          {/* Upcoming Meeting hero card */}
          <section className="brd-card brd-upcoming">
            <div className="brd-up-head">
              <span className="brd-up-eyebrow">{t('board.upcomingEyebrow')}</span>
            </div>
            {upcoming ? (
              <div className="brd-up-row">
                <div className="brd-up-main">
                  <div className="brd-up-when">
                    {fmtLongDate(isoDay(upcoming.scheduled_at))} &middot; {isoTime(upcoming.scheduled_at)}
                  </div>
                  <div className="brd-up-where">{upcoming.location || upcoming.virtual_link || t('board.locationTbd')}</div>
                  <div className="brd-up-actions">
                    <button type="button" className="brd-cta-secondary" onClick={() => setMeetingOpen(upcoming)}>{t('board.viewMeeting')}</button>
                    {upcoming.virtual_link && (
                      <a href={upcoming.virtual_link} target="_blank" rel="noreferrer" className="brd-cta-primary">{t('board.joinMeeting')}</a>
                    )}
                  </div>
                </div>
                <div className="vd-scope brd-up-countdown">
                  <Countdown to={upcoming.scheduled_at} />
                </div>
              </div>
            ) : (
              <div className="brd-up-where">{t('board.noUpcomingMeeting')}</div>
            )}
            <button type="button" className="brd-up-all" onClick={() => setMinutesOpen(true)}>{t('board.viewAllMeetings')} &rarr;</button>
          </section>

          {/* Board Members */}
          <section className="brd-card">
            <div className="brd-card-head">
              <h2 className="brd-card-title">{t('board.boardMembers')}</h2>
              <button type="button" className="brd-card-link" onClick={() => setMembersOpen(true)}>{t('board.viewAllMembers')}</button>
            </div>
            <div className="brd-members">
              {members.length === 0 ? (
                <div className="brd-member-role">{t('board.noMembers')}</div>
              ) : members.map(m => (
                <div key={m.id} className="brd-member">
                  <div className="brd-member-avatar" aria-hidden="true">{m.initials}</div>
                  <div className="brd-member-name">{m.name}</div>
                  <div className="brd-member-role">{m.role}</div>
                  {m.email && (
                    <a href={`mailto:${m.email}`} className="brd-member-mail" aria-label={t('board.emailMember', { name: m.name })}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/>
                      </svg>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Recent Meeting Minutes */}
          <section className="brd-card" id="minutes">
            <div className="brd-card-head">
              <h2 className="brd-card-title">{t('board.recentMinutes')}</h2>
              <button type="button" className="brd-card-link" onClick={() => setMinutesOpen(true)}>{t('board.viewAll')}</button>
            </div>
            <div className="brd-minutes">
              {minutes.length === 0 ? (
                <div className="brd-member-role">{t('board.noMinutes')}</div>
              ) : minutes.map(m => (
                <button key={m.id} type="button" className="brd-min-row" onClick={() => setMeetingOpen(m)}>
                  <span className="brd-min-date">
                    <span className="brd-min-mo">{new Date(m.scheduled_at).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
                    <span className="brd-min-day">{new Date(m.scheduled_at).getDate()}</span>
                  </span>
                  <span className="brd-min-body">
                    <span className="brd-min-title">{m.title}</span>
                    <span className="brd-min-sum">{meetingTypeLabel(m.type)}</span>
                  </span>
                  <span className={`brd-pill ${m.minutes_status === 'approved' ? 'brd-pill-on' : 'brd-pill-off'}`}>
                    {m.minutes_status === 'approved' ? t('board.statusApproved') : t('board.statusPublished')}
                  </span>
                  <span className="brd-min-action">{t('board.view')} &rarr;</span>
                </button>
              ))}
            </div>
          </section>

          {/* How Decisions Are Made */}
          <section className="brd-card brd-how">
            <div className="brd-card-head">
              <h2 className="brd-card-title">{t('board.howTitle')}</h2>
              <span className="brd-card-meta">{t('board.howMeta')}</span>
            </div>
            <div className="brd-how-grid">
              <HowStep n={1} title={t('board.howProposalTitle')}      desc={t('board.howProposalDesc')} icon={<IconLightbulb />} />
              <HowStep n={2} title={t('board.howDiscussionTitle')}    desc={t('board.howDiscussionDesc')} icon={<IconChat />} />
              <HowStep n={3} title={t('board.howVoteTitle')}          desc={t('board.howVoteDesc')} icon={<IconGavel />} />
              <HowStep n={4} title={t('board.howCommunicationTitle')} desc={t('board.howCommunicationDesc')} icon={<IconMegaphone />} />
            </div>
          </section>
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="brd-aside">
          <section className="brd-card brd-tile-tight">
            <div className="brd-card-head">
              <h3 className="brd-tile-title">{t('board.boardUpdates')}</h3>
              <button type="button" className="brd-card-link" onClick={() => setUpdatesOpen(true)}>{t('board.viewAll')}</button>
            </div>
            <div className="brd-updates">
              {updates.length === 0 ? (
                <div className="brd-member-role">{t('board.noUpdates')}</div>
              ) : updates.map(u => (
                <button key={u.id} type="button" className="brd-update" onClick={() => setUpdateOpen(u)}>
                  <span className={`brd-update-dot brd-update-${u.kind}`} aria-hidden="true">
                    {updateIcon(u.kind)}
                  </span>
                  <span className="brd-update-body">
                    <span className="brd-update-title">{u.title}</span>
                    {u.sub && <span className="brd-update-sub">{u.sub}</span>}
                    {u.date && <span className="brd-update-date">{fmtDate(isoDay(u.date))}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {committees.length > 0 && (
            <section className="brd-card brd-tile-tight">
              <div className="brd-card-head">
                <h3 className="brd-tile-title">{t('board.committees')}</h3>
              </div>
              <ul className="brd-committees">
                {committees.map(c => (
                  <li key={c.id}>
                    <button type="button" className="brd-committee" onClick={() => setCommitteeOpen(c)}>
                      <span className="brd-committee-icon">{committeeIcon(c.icon)}</span>
                      <span className="brd-committee-body">
                        <span className="brd-committee-name">{c.name}</span>
                        <span className="brd-committee-meta">
                          {c.chair ? `${c.chair} · ` : ''}{c.member_count === 1 ? t('board.memberCountOne', { count: c.member_count }) : t('board.memberCountOther', { count: c.member_count })}
                        </span>
                      </span>
                      <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <BoardYourVotes />
        </aside>
      </div>

      {/* A single meeting (from upcoming or minutes) — detail in place. Real
          meetings (UUID id) open the full detail (docs + summary + video); the
          demo fallback rows (ids like "bmtg-1") use the lightweight dialog so
          they don't hit Supabase with a non-UUID id. */}
      {meetingOpen && (isUuid(meetingOpen.id) ? (
        <MeetingDetailDialog meetingId={meetingOpen.id} onClose={() => setMeetingOpen(null)} />
      ) : (
        <DetailDialog
          eyebrow={meetingTypeLabel(meetingOpen.type)}
          title={meetingOpen.title}
          period={`${fmtLongDate(isoDay(meetingOpen.scheduled_at))} · ${isoTime(meetingOpen.scheduled_at)}`}
          onClose={() => setMeetingOpen(null)}
          size="large"
        >
          <div className="rd-bd-table">
            {meetingOpen.location && (
              <div className="rd-bd-row"><span className="rd-bd-cat">{t('board.location')}</span><span className="rd-bd-amt">{meetingOpen.location}</span><span /></div>
            )}
            <div className="rd-bd-row rd-bd-total"><span>{t('board.minutes')}</span><span className="rd-bd-amt">{meetingOpen.minutes_status === 'approved' ? t('board.statusApproved') : meetingOpen.minutes_status === 'published' ? t('board.statusPublished') : t('board.statusPending')}</span><span /></div>
          </div>
          {meetingOpen.virtual_link && (
            <a className="ven-cta-primary rd-report-dl" href={meetingOpen.virtual_link} target="_blank" rel="noreferrer">{t('board.joinMeetingLower')}</a>
          )}
        </DetailDialog>
      ))}

      {/* A single board update / decision. */}
      {updateOpen && (
        <DetailDialog
          eyebrow={t('board.updateEyebrow')}
          title={updateOpen.title}
          period={updateOpen.date ? fmtDate(isoDay(updateOpen.date)) : undefined}
          onClose={() => setUpdateOpen(null)}
          size="large"
        >
          {updateOpen.sub && <p className="rd-report-blurb">{updateOpen.sub}</p>}
          <p className="rd-detail-foot-note">
            {t('board.updateFootNote')}
          </p>
        </DetailDialog>
      )}

      {/* View all board members. */}
      {membersOpen && (
        <DetailDialog eyebrow={t('board.eyebrowYourBoard')} title={t('board.boardMembers')}
          period={members.length === 1 ? t('board.memberCountOne', { count: members.length }) : t('board.memberCountOther', { count: members.length })}
          onClose={() => setMembersOpen(false)}>
          <div className="rd-list">
            {members.map(m => (
              <div className="rd-list-row" key={m.id} style={{ cursor: 'default' }}>
                <span className="brd-member-avatar" aria-hidden="true">{m.initials}</span>
                <span className="rd-list-body">
                  <span className="rd-list-title">{m.name}</span>
                  <span className="rd-list-meta">{m.role}</span>
                </span>
                {m.email && <a className="rd-settings-link" href={`mailto:${m.email}`}>{t('board.email')}</a>}
              </div>
            ))}
          </div>
        </DetailDialog>
      )}

      {/* View all meeting minutes — each opens its meeting. */}
      {minutesOpen && (
        <DetailDialog eyebrow={t('board.eyebrowYourBoard')} title={t('board.boardMeetings')}
          period={minutes.length === 1 ? t('board.meetingCountOne', { count: minutes.length }) : t('board.meetingCountOther', { count: minutes.length })}
          onClose={() => setMinutesOpen(false)} size="large">
          <div className="rd-list">
            {minutes.map(m => (
              <button type="button" className="rd-list-row" key={m.id}
                onClick={() => { setMinutesOpen(false); setMeetingOpen(m) }}>
                <span className="rd-list-body">
                  <span className="rd-list-title">{m.title}</span>
                  <span className="rd-list-meta">{meetingTypeLabel(m.type)} · {fmtDate(isoDay(m.scheduled_at))}</span>
                </span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        </DetailDialog>
      )}

      {/* View all board updates — each opens its detail. */}
      {updatesOpen && (
        <DetailDialog eyebrow={t('board.eyebrowYourBoard')} title={t('board.boardUpdates')}
          period={updates.length === 1 ? t('board.updateCountOne', { count: updates.length }) : t('board.updateCountOther', { count: updates.length })}
          onClose={() => setUpdatesOpen(false)}>
          <div className="rd-list">
            {updates.map(u => (
              <button type="button" className="rd-list-row" key={u.id}
                onClick={() => { setUpdatesOpen(false); setUpdateOpen(u) }}>
                <span className={`brd-update-dot brd-update-${u.kind}`} aria-hidden="true">{updateIcon(u.kind)}</span>
                <span className="rd-list-body">
                  <span className="rd-list-title">{u.title}</span>
                  {u.sub && <span className="rd-list-meta">{u.sub}</span>}
                </span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        </DetailDialog>
      )}

      {/* A single committee. */}
      {committeeOpen && (
        <DetailDialog eyebrow={t('board.committeeEyebrow')} title={committeeOpen.name}
          onClose={() => setCommitteeOpen(null)}>
          <div className="rd-bd-table">
            {committeeOpen.chair && (
              <div className="rd-bd-row"><span className="rd-bd-cat">{t('board.chair')}</span><span className="rd-bd-amt">{committeeOpen.chair}</span><span /></div>
            )}
            <div className="rd-bd-row rd-bd-total"><span>{t('board.members')}</span><span className="rd-bd-amt">{committeeOpen.member_count}</span><span /></div>
          </div>
          <p className="rd-detail-foot-note">
            {t('board.committeeFootNote')}
          </p>
        </DetailDialog>
      )}
    </section>
  )
}

// -- sub-components ------------------------------------------------

function HowStep({
  n, title, desc, icon,
}: {
  n: number; title: string; desc: string; icon: ReactNode
}) {
  return (
    <div className="brd-how-step">
      <span className="brd-how-num">{n}</span>
      <span className="brd-how-icon">{icon}</span>
      <span className="brd-how-title">{title}</span>
      <span className="brd-how-desc">{desc}</span>
    </div>
  )
}

function updateIcon(k: UpdateKind): ReactNode {
  switch (k) {
    case 'approval': return <Svg><><path d="M5 12l4 4 10-10"/></></Svg>
    case 'contract': return <Svg><><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></></Svg>
    case 'budget':   return <Svg><><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/></></Svg>
    case 'announce': return <Svg><><path d="M3 11l16-6v14L3 13z"/><path d="M7 13v5a2 2 0 0 0 4 0v-3"/></></Svg>
  }
}

function committeeIcon(k: 'finance' | 'leaf' | 'home' | 'shield' | 'megaphone'): ReactNode {
  switch (k) {
    case 'finance':   return <Svg><><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3M14 15h3"/></></Svg>
    case 'leaf':      return <Svg><><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19l7-7"/></></Svg>
    case 'home':      return <Svg><><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></></Svg>
    case 'shield':    return <Svg><><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z"/></></Svg>
    case 'megaphone': return <Svg><><path d="M3 11l16-6v14L3 13z"/><path d="M7 13v5a2 2 0 0 0 4 0v-3"/></></Svg>
  }
}

function IconLightbulb() { return <Svg><><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.6 1 1.5 1 2.3v1h6v-1c0-.8.4-1.7 1-2.3A7 7 0 0 0 12 2z"/></></Svg> }
function IconChat()      { return <Svg><><path d="M21 12a8 8 0 0 1-12 7L3 21l2-5a8 8 0 1 1 16-4z"/></></Svg> }
function IconGavel()     { return <Svg><><path d="m14 4 6 6-3 3-6-6z"/><path d="m11 7-7 7 3 3 7-7"/><path d="M3 21h12"/></></Svg> }
function IconMegaphone() { return <Svg><><path d="M3 11l16-6v14L3 13z"/><path d="M7 13v5a2 2 0 0 0 4 0v-3"/></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
