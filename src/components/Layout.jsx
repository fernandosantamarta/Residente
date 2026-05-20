import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { signOut, hasSupabase } from '../lib/supabase'
import { useAuth } from '../App'

// Take "Fernando Santamaria" → "FS"; safe on null/undefined/single-name.
const initialsFrom = (name) => {
  if (!name) return '—'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  const first = parts[0][0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase().slice(0, 2) || '—'
}

const NAV = [
  { to: '/',          label: 'Home',      icon: <><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></> },
  { to: '/pay',       label: 'Pay',       icon: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></> },
  { to: '/board',     label: 'Board',     icon: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M15 19c0-2 2-3.5 4-3.5s3 1.2 3 3"/></>, pulse: true },
  { to: '/rules',     label: 'Rules',     icon: <><path d="M4 4h12l4 4v12H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></> },
  { to: '/documents', label: 'Documents', icon: <><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></> },
  { to: '/contact',   label: 'Contact',   icon: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></> },
  { to: '/community', label: 'Community', icon: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></> },
]

const fmtTime = () => {
  const d = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${time} · ${date}`
}

export default function Layout() {
  const location = useLocation()
  const showRightRail = location.pathname === '/'
  const [navOpen, setNavOpen] = useState(false)
  const auth = useAuth() || {}
  const profile = auth.profile
  // Board members (and local dev without Supabase) get the Admin link.
  const showAdmin = !hasSupabase || ['board_member', 'admin'].includes(profile?.role)

  // Close the mobile nav drawer whenever the route changes — otherwise the
  // overlay would stay open after the user taps a nav link.
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  // Real user identity from Supabase profile (loaded by App.jsx on auth).
  // Falls back to placeholders while the profile request is in flight so
  // the rail doesn't render blank on first paint.
  const userInitials = initialsFrom(profile?.full_name) || 'FM'
  const userUnit = profile?.unit_number
    ? `Unit ${profile.unit_number}`
    : 'Unit —'

  return (
    <div className="cockpit" style={!showRightRail ? { gridTemplateColumns: '240px 1fr' } : undefined}>
      <aside className={`rail-left${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-dot"></div>
          <div className="brand-word">Residente</div>
        </div>

        <nav className="nav">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {item.icon}
              </svg>
              <span>{item.label}</span>
              {item.pulse && <span className="pulse-dot"></span>}
            </NavLink>
          ))}
        </nav>

        <div className="rail-footer">
          {showAdmin && (
            <Link to="/admin" className="rail-admin-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/>
              </svg>
              <span>Admin</span>
            </Link>
          )}
          <div className="user-block">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-meta">
              <span className="label">Signed in as</span>
              <span className="val">{userUnit}</span>
            </div>
          </div>
          <button
            className="logout-btn"
            onClick={() => signOut()}
            aria-label="Sign out"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div
        className={`nav-backdrop${navOpen ? ' open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <main className="center">
        <div className="topbar">
          <div className="kicker">
            <button
              className={`hamburger${navOpen ? ' open' : ''}`}
              onClick={() => setNavOpen(v => !v)}
              aria-label={navOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={navOpen}
            >
              <span /><span /><span />
            </button>
            <span className="brand-dot"></span>
            <span>Residente · Q2 2026</span>
          </div>
          <div className="topbar-right">
            <div className="time-chip">{fmtTime()}</div>
            <div className="bell">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
              </svg>
              <span className="bell-badge">3</span>
            </div>
          </div>
        </div>

        <Outlet />
      </main>

      {showRightRail && <RightRail />}
    </div>
  )
}

function RightRail() {
  return (
    <aside className="rail-right">
      <div className="feed-head">
        <div className="feed-title">This Week on the Board</div>
        <div className="see-all">See all</div>
      </div>

      <div className="feed">
        <FeedRow avatar="OR" text={<>Approved landscaping · <span className="vendor">Oak Ridge Nursery</span> · <span className="amt">$5,200</span></>} meta={<>2 days ago <span className="dot">·</span> <span className="status yes">3/3 yes</span></>} />
        <FeedRow avatar="MA" v="v2" text={<>New pool vendor proposal · <span className="vendor">Miramar Aquatics</span> · <span className="amt">$8,900/yr</span></>} meta={<>3 days ago <span className="dot">·</span> <span className="status pending">Pending 1/3</span></>} />
        <FeedRow avatar="SG" v="v3" text={<>Gate repair invoice · <span className="vendor">SecureGate Co</span> · <span className="amt">$1,840</span></>} meta={<>5 days ago <span className="dot">·</span> <span className="status paid">Paid ✓</span></>} />
        <FeedRow avatar="BD" v="v4" text={<>Amenity reserve warning · <span className="vendor">Board motion</span></>} meta={<>1 week ago <span className="dot">·</span> <span className="status discussion">Discussion</span></>} />
        <FeedRow avatar="FL" v="v5" text={<>Holiday lighting contract · <span className="vendor">FestivaLux</span> · <span className="amt">$2,400</span></>} meta={<>2 weeks ago <span className="dot">·</span> <span className="status pending">2/3 yes, pending</span></>} />
      </div>

      <div className="household">
        <div className="household-title">Your household</div>
        <div className="household-row">
          <span className="h-label">Unit</span>
          <span className="unit-tag">412</span>
        </div>
        <div className="household-divider"></div>
        <div className="household-row">
          <span className="h-label">Current balance</span>
          <span className="h-val ok">$0 · Paid</span>
        </div>
        <div className="household-row">
          <span className="h-label">Next assessment</span>
          <span className="h-val due">Jul 1 · $412</span>
        </div>
      </div>
    </aside>
  )
}

function FeedRow({ avatar, v, text, meta }) {
  return (
    <div className="feed-row">
      <div className={`vendor-avatar${v ? ' ' + v : ''}`}>{avatar}</div>
      <div className="feed-body">
        <div className="feed-text">{text}</div>
        <div className="feed-meta">{meta}</div>
      </div>
    </div>
  )
}
