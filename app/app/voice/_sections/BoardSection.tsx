'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

// Board — meet-your-board surface, now a section of the Easy Voice hub.
// Upcoming-meeting hero card, board updates aside, member row, committees
// list, recent minutes table, How Decisions Are Made footer.
//
// Data is in-code demo for now; when the board_members,
// board_meetings, board_minutes, and committees tables are wired,
// swap the constants for real queries.

const UPCOMING = {
  date: '2026-05-22',
  time: '6:30 PM',
  location: 'Clubhouse Conference Room & Zoom',
  agenda: [
    'Budget review',
    'Vendor proposals',
    'Pool renovation update',
    'Upcoming community events',
  ],
}

type UpdateKind = 'approval' | 'contract' | 'budget' | 'announce'
const UPDATES: { id: string; kind: UpdateKind; title: string; date: string; sub: string }[] = [
  { id: 'u1', kind: 'approval', title: 'Pool Renovation Approved',  date: '2026-05-10', sub: 'Construction begins July 1.' },
  { id: 'u2', kind: 'contract', title: 'New Landscape Contract',    date: '2026-05-04', sub: 'GreenScape renewed through 2027.' },
  { id: 'u3', kind: 'budget',   title: 'Budget 2026 Approved',      date: '2026-04-28', sub: 'Dues increase 3% to fund reserves.' },
  { id: 'u4', kind: 'announce', title: 'Annual Picnic on the Books', date: '2026-04-19', sub: 'Save the date: June 14, Pavilion.' },
]

type Member = {
  id: string
  name: string
  role: string
  initials: string
  email?: string
}
const MEMBERS: Member[] = [
  { id: 'm1', name: 'Jonas Parker',  role: 'President',  initials: 'JP', email: 'jonas@sunsetlakes.com' },
  { id: 'm2', name: 'Sarah Johnson', role: 'Vice President', initials: 'SJ', email: 'sarah@sunsetlakes.com' },
  { id: 'm3', name: 'Michael Chen',  role: 'Treasurer',  initials: 'MC', email: 'michael@sunsetlakes.com' },
  { id: 'm4', name: 'Priya Patel',   role: 'Secretary',  initials: 'PP', email: 'priya@sunsetlakes.com' },
  { id: 'm5', name: 'Kara Dawson',   role: 'Director',   initials: 'KD', email: 'kara@sunsetlakes.com' },
]

type Committee = {
  id: string
  name: string
  chair: string
  members: number
  icon: 'finance' | 'leaf' | 'home' | 'shield' | 'megaphone'
}
const COMMITTEES: Committee[] = [
  { id: 'c1', name: 'Finance Committee',         chair: 'Michael Chen', members: 4, icon: 'finance' },
  { id: 'c2', name: 'Landscape Committee',       chair: 'Sarah Johnson', members: 3, icon: 'leaf' },
  { id: 'c3', name: 'Architectural Committee',   chair: 'Kara Dawson', members: 4, icon: 'home' },
  { id: 'c4', name: 'Security Committee',        chair: 'Jonas Parker', members: 3, icon: 'shield' },
  { id: 'c5', name: 'Communications Committee',  chair: 'Priya Patel', members: 2, icon: 'megaphone' },
]

type MinutesStatus = 'approved' | 'draft'
const MINUTES: { id: string; date: string; title: string; summary: string; status: MinutesStatus; tags: string[] }[] = [
  { id: 'min1', date: '2026-04-24', title: 'Board Meeting Minutes', summary: 'Budget review, pool renovation vote, vendor updates.',     status: 'approved', tags: ['Budget', 'Pool'] },
  { id: 'min2', date: '2026-03-27', title: 'Board Meeting Minutes', summary: 'Annual financial review, committee chair confirmations.',  status: 'approved', tags: ['Financials'] },
  { id: 'min3', date: '2026-02-28', title: 'Board Meeting Minutes', summary: 'Spring event planning, vendor performance review.',        status: 'approved', tags: ['Events'] },
  { id: 'min4', date: '2026-01-31', title: 'Board Meeting Minutes', summary: 'Q1 priorities, new committee charter, security upgrades.', status: 'approved', tags: ['Q1', 'Security'] },
]

const fmtDate = (iso: string) => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}
const fmtLongDate = (iso: string) => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

export function BoardSection() {
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
              <button type="button" className="brd-up-save">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>
                </svg>
                Save to reminders
              </button>
            </div>
            <div className="brd-up-when">
              {fmtLongDate(UPCOMING.date)} &middot; {UPCOMING.time}
            </div>
            <div className="brd-up-where">{UPCOMING.location}</div>
            <div className="brd-up-agenda-label">Agenda includes</div>
            <ul className="brd-up-agenda">
              {UPCOMING.agenda.map(item => (
                <li key={item}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="brd-up-actions">
              <button type="button" className="brd-cta-secondary">View Agenda</button>
              <button type="button" className="brd-cta-primary">Join Meeting</button>
            </div>
            <Link href="#minutes" className="brd-up-all">View all meetings &rarr;</Link>
          </section>

          {/* Board Members */}
          <section className="brd-card">
            <div className="brd-card-head">
              <h2 className="brd-card-title">Board Members</h2>
              <Link href="#" className="brd-card-link">View all members</Link>
            </div>
            <div className="brd-members">
              {MEMBERS.map(m => (
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
              {MINUTES.map(m => (
                <a key={m.id} href="#" className="brd-min-row">
                  <span className="brd-min-date">
                    <span className="brd-min-mo">{new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
                    <span className="brd-min-day">{new Date(m.date + 'T00:00:00').getDate()}</span>
                  </span>
                  <span className="brd-min-body">
                    <span className="brd-min-title">{m.title}</span>
                    <span className="brd-min-sum">{m.summary}</span>
                    <span className="brd-min-tags">
                      {m.tags.map(t => <span key={t} className="brd-min-tag">{t}</span>)}
                    </span>
                  </span>
                  <span className={`brd-pill ${m.status === 'approved' ? 'brd-pill-on' : 'brd-pill-off'}`}>
                    {m.status === 'approved' ? 'Approved' : 'Draft'}
                  </span>
                  <span className="brd-min-action">View &rarr;</span>
                </a>
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
              {UPDATES.map(u => (
                <a key={u.id} href="#" className="brd-update">
                  <span className={`brd-update-dot brd-update-${u.kind}`} aria-hidden="true">
                    {updateIcon(u.kind)}
                  </span>
                  <span className="brd-update-body">
                    <span className="brd-update-title">{u.title}</span>
                    <span className="brd-update-sub">{u.sub}</span>
                    <span className="brd-update-date">{fmtDate(u.date)}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>

          <section className="brd-card brd-tile-tight">
            <div className="brd-card-head">
              <h3 className="brd-tile-title">Committees</h3>
              <Link href="#" className="brd-card-link">View all</Link>
            </div>
            <ul className="brd-committees">
              {COMMITTEES.map(c => (
                <li key={c.id}>
                  <Link href="#" className="brd-committee">
                    <span className="brd-committee-icon">{committeeIcon(c.icon)}</span>
                    <span className="brd-committee-body">
                      <span className="brd-committee-name">{c.name}</span>
                      <span className="brd-committee-meta">{c.chair} &middot; {c.members} {c.members === 1 ? 'member' : 'members'}</span>
                    </span>
                    <svg className="brd-committee-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
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

function committeeIcon(k: Committee['icon']): ReactNode {
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
