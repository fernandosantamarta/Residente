'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { useBoardData } from '@/hooks/useBoardData'
import { useBoardDecisions } from '@/hooks/useBoardDecisions'

// Board — meet-your-board surface, a section of the Easy Voice hub.
// Real data (no new migration): members from board/admin profiles, upcoming
// + minutes from ev_meetings, updates from board_decisions. Committees have
// no data model yet, so that block stays hidden until one exists.

type UpdateKind = 'approval' | 'contract' | 'budget' | 'announce'

// Map a board_decisions row to the update-card shape. board_decisions
// columns vary, so read defensively.
function decisionToUpdate(d: any): { id: string; kind: UpdateKind; title: string; date: string; sub: string } {
  const status = String(d.status || '').toLowerCase()
  const kind: UpdateKind =
    status.includes('contract') ? 'contract'
    : status.includes('budget') ? 'budget'
    : status.includes('announce') ? 'announce'
    : 'approval'
  const amount = d.amount != null ? '$' + Math.round(Number(d.amount)).toLocaleString('en-US') : ''
  const sub = d.summary || d.note || [d.vendor, amount].filter(Boolean).join(' · ') || ''
  return { id: d.id, kind, title: d.title || 'Board decision', date: d.decided_on || d.created_at || '', sub }
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
  const { members, upcoming, minutes } = useBoardData()
  const { decisions } = useBoardDecisions(6) as { decisions: any[] | null }
  const updates = (decisions ?? []).map(decisionToUpdate)

  return (
    <section id="board" className="brd-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">Your Board</h2>
        <p className="voice-page-sub">
          Meet your board, view updates, and stay informed about decisions
          that shape our community.
        </p>
      </div>

      <div className="brd-grid">
        {/* MAIN COLUMN */}
        <div className="brd-col">
          {/* Upcoming Meeting hero card */}
          <section className="brd-card brd-upcoming">
            <div className="brd-up-head">
              <span className="brd-up-eyebrow">Upcoming Board Meeting</span>
            </div>
            {upcoming ? (
              <>
                <div className="brd-up-when">
                  {fmtLongDate(isoDay(upcoming.scheduled_at))} &middot; {isoTime(upcoming.scheduled_at)}
                </div>
                <div className="brd-up-where">{upcoming.location || upcoming.virtual_link || 'Location TBD'}</div>
                <div className="brd-up-actions">
                  <Link href="/app/voice" className="brd-cta-secondary">View meeting</Link>
                  {upcoming.virtual_link && (
                    <a href={upcoming.virtual_link} target="_blank" rel="noreferrer" className="brd-cta-primary">Join Meeting</a>
                  )}
                </div>
              </>
            ) : (
              <div className="brd-up-where">No upcoming board meeting scheduled yet.</div>
            )}
            <Link href="#minutes" className="brd-up-all">View all meetings &rarr;</Link>
          </section>

          {/* Board Members */}
          <section className="brd-card">
            <div className="brd-card-head">
              <h2 className="brd-card-title">Board Members</h2>
              <Link href="#" className="brd-card-link">View all members</Link>
            </div>
            <div className="brd-members">
              {members.length === 0 ? (
                <div className="brd-member-role">No board members listed yet.</div>
              ) : members.map(m => (
                <div key={m.id} className="brd-member">
                  <div className="brd-member-avatar" aria-hidden="true">{m.initials}</div>
                  <div className="brd-member-name">{m.name}</div>
                  <div className="brd-member-role">{m.role}</div>
                  {m.email && (
                    <a href={`mailto:${m.email}`} className="brd-member-mail" aria-label={`Email ${m.name}`}>
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
              <h2 className="brd-card-title">Recent Board Meeting Minutes</h2>
              <Link href="/app/documents" className="brd-card-link">View all</Link>
            </div>
            <div className="brd-minutes">
              {minutes.length === 0 ? (
                <div className="brd-member-role">No published minutes yet.</div>
              ) : minutes.map(m => (
                <Link key={m.id} href="/app/voice" className="brd-min-row">
                  <span className="brd-min-date">
                    <span className="brd-min-mo">{new Date(m.scheduled_at).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
                    <span className="brd-min-day">{new Date(m.scheduled_at).getDate()}</span>
                  </span>
                  <span className="brd-min-body">
                    <span className="brd-min-title">{m.title}</span>
                    <span className="brd-min-sum">{m.type === 'annual' ? 'Annual meeting' : m.type === 'special' ? 'Special meeting' : m.type === 'committee' ? 'Committee meeting' : 'Board meeting'}</span>
                  </span>
                  <span className={`brd-pill ${m.minutes_status === 'approved' ? 'brd-pill-on' : 'brd-pill-off'}`}>
                    {m.minutes_status === 'approved' ? 'Approved' : 'Published'}
                  </span>
                  <span className="brd-min-action">View &rarr;</span>
                </Link>
              ))}
            </div>
          </section>

          {/* How Decisions Are Made */}
          <section className="brd-card brd-how">
            <div className="brd-card-head">
              <h2 className="brd-card-title">How Decisions Are Made</h2>
              <span className="brd-card-meta">Four steps, always public</span>
            </div>
            <div className="brd-how-grid">
              <HowStep n={1} title="Proposal"      desc="A resident or board member raises an idea — anyone can submit one through Voice." icon={<IconLightbulb />} />
              <HowStep n={2} title="Discussion"    desc="The board debates at the next public meeting. Residents are welcome to speak." icon={<IconChat />} />
              <HowStep n={3} title="Vote"          desc="Board votes by quorum. Outcome is recorded in the minutes within 48 hours." icon={<IconGavel />} />
              <HowStep n={4} title="Communication" desc="Every resident gets a notice. The decision lands here and in Documents." icon={<IconMegaphone />} />
            </div>
          </section>
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="brd-aside">
          <section className="brd-card brd-tile-tight">
            <div className="brd-card-head">
              <h3 className="brd-tile-title">Board Updates</h3>
              <Link href="#" className="brd-card-link">View all</Link>
            </div>
            <div className="brd-updates">
              {updates.length === 0 ? (
                <div className="brd-member-role">No board updates yet.</div>
              ) : updates.map(u => (
                <Link key={u.id} href="/app/voice" className="brd-update">
                  <span className={`brd-update-dot brd-update-${u.kind}`} aria-hidden="true">
                    {updateIcon(u.kind)}
                  </span>
                  <span className="brd-update-body">
                    <span className="brd-update-title">{u.title}</span>
                    {u.sub && <span className="brd-update-sub">{u.sub}</span>}
                    {u.date && <span className="brd-update-date">{fmtDate(isoDay(u.date))}</span>}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          {/* Committees: no data model yet — hidden until a committees table
              exists. The block + committeeIcon() stay in code for when it is. */}
        </aside>
      </div>
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
