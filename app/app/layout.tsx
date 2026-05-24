'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut, hasSupabase } from '@/lib/supabase'
import { useAuth } from '../providers'
import { useBoardDecisions } from '@/hooks/useBoardDecisions'
import { useMyResident } from '@/hooks/useMyResident'
import { DUES_LABEL } from '@/lib/dues'
import { CommunitySvg, InteriorSvg } from '../page'

// "Fernando Santamaria" → "FS". Safe on null/single-name.
const initialsFrom = (name?: string | null): string => {
  if (!name) return '—'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  const first = parts[0][0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase().slice(0, 2) || '—'
}

type NavItem = { href: string; label: string; icon: ReactNode; pulse?: boolean; exact?: boolean }

const NAV: NavItem[] = [
  { href: '/app',           label: 'Home',      exact: true, icon: <><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></> },
  { href: '/app/pay',       label: 'Pay',       icon: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></> },
  { href: '/app/board',     label: 'Board',     pulse: true, icon: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M15 19c0-2 2-3.5 4-3.5s3 1.2 3 3"/></> },
  { href: '/app/rules',     label: 'Rules',     icon: <><path d="M4 4h12l4 4v12H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></> },
  { href: '/app/documents', label: 'Documents', icon: <><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></> },
  { href: '/app/contact',   label: 'Contact',   icon: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></> },
  { href: '/app/community', label: 'Community', icon: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></> },
]

const isActive = (pathname: string, href: string, exact?: boolean) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')

const fmtTime = () => {
  const d = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${time} · ${date}`
}

export default function CockpitLayout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const pathname = usePathname() || '/app'
  const router = useRouter()
  const showRightRail = pathname === '/app'
  const [navOpen, setNavOpen] = useState(false)
  const showAdmin = !hasSupabase || ['board_member', 'admin'].includes(profile?.role || '')

  // Auth gate — bounce unauthed users to /login. Mirrors the old App.jsx
  // `requireAuth ? <Navigate to="/login" /> : <Layout />` guard.
  useEffect(() => {
    if (hasSupabase && !session) router.replace('/login')
  }, [session, router])

  useEffect(() => { setNavOpen(false) }, [pathname])

  if (hasSupabase && !session) return null  // don't flash cockpit during redirect

  const userInitials = initialsFrom(profile?.full_name) || 'FM'
  const userUnit = profile?.unit_number ? `Unit ${profile.unit_number}` : 'Unit —'

  return (
    <>
      <CockpitIntro />
    <div className="cockpit" style={!showRightRail ? { gridTemplateColumns: '240px 1fr' } : undefined}>
      <aside className={`rail-left${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-dot"></div>
          <div className="brand-word">Residente</div>
        </div>

        <nav className="nav">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive(pathname, item.href, item.exact) ? ' active' : ''}`}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {item.icon}
              </svg>
              <span>{item.label}</span>
              {item.pulse && <span className="pulse-dot"></span>}
            </Link>
          ))}
          {showAdmin && (
            <Link
              href="/admin"
              className={`nav-item${pathname.startsWith('/admin') ? ' active' : ''}`}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/>
              </svg>
              <span>Admin</span>
            </Link>
          )}
        </nav>

        <div className="rail-footer">
          <Link href="/app/settings" className="user-block">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-meta">
              <span className="label">Signed in as</span>
              <span className="val">{userUnit}</span>
            </div>
            <svg className="user-block-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </Link>
          <button className="logout-btn" onClick={() => signOut()} aria-label="Sign out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className={`nav-backdrop${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

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

        {children}
      </main>

      {showRightRail && <RightRail />}
    </div>
    </>
  )
}

// One-time sign-in zoom: replays the landing's cinematic dolly-in
// (community → focal house → door → interior) as a welcome animation
// the first time the cockpit mounts in a browser session. Uses
// sessionStorage so internal cockpit navigation doesn't replay it.
function CockpitIntro() {
  const [phase, setPhase] = useState<'init' | 'playing' | 'done'>('init')
  const [p, setP] = useState(0)              // 0..1 zoom progress
  const startRef = useRef<number | null>(null)

  // Play every time the cockpit layout mounts (i.e. every sign-in and
  // every page refresh on /app/*). Only skip if the user has
  // reduced-motion set in their OS preferences. The sessionStorage
  // "play once per session" gate was removed at the user's request —
  // they want the welcome-home moment every time.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setPhase('done'); return }
    setPhase('playing')
  }, [])

  // Drive p from 0 → 1 over 2.6s, then linger briefly so the interior
  // reveal is visible, then fade out. Total ~3.6s.
  useEffect(() => {
    if (phase !== 'playing') return
    const DUR_ZOOM = 2600
    const DUR_HOLD = 700
    let raf = 0
    const tick = (ts: number) => {
      if (startRef.current == null) startRef.current = ts
      const elapsed = ts - startRef.current
      if (elapsed < DUR_ZOOM) {
        setP(elapsed / DUR_ZOOM)
        raf = requestAnimationFrame(tick)
      } else {
        setP(1)
        setTimeout(() => setPhase('done'), DUR_HOLD)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [phase])

  if (phase === 'done') return null

  // Same zoom curve and crossfade timing as the landing hero.
  const ZOOM_END = 0.78
  const zp = Math.min(1, p / ZOOM_END)
  const zoom = Math.pow(12, zp)
  const vbW = 2400 / zoom
  const vbH = 1500 / zoom
  const vbX = 1200 - vbW / 2
  const vbY = 750 - vbH / 2
  const viewBox = `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`
  const interiorOpacity = Math.max(0, Math.min(1, (p - ZOOM_END) / (1 - ZOOM_END)))
  // Once p has hit 1 and we're in the hold phase, start fading out the
  // whole overlay so the cockpit can show through.
  const overlayOpacity = phase === 'playing' && p >= 1 ? 0 : 1

  return (
    <div
      className="cockpit-intro"
      style={{ opacity: overlayOpacity, pointerEvents: phase === 'playing' ? 'auto' : 'none' }}
      aria-hidden="true"
    >
      <div className="cockpit-intro-stage">
        <CommunitySvg viewBox={viewBox} />
        <div className="cockpit-intro-interior" style={{ opacity: interiorOpacity }}>
          <InteriorSvg />
        </div>
        <div className="cockpit-intro-caption">
          <span style={{ opacity: Math.max(0, 1 - p / 0.4) }}>Welcome home.</span>
          <span style={{ opacity: Math.max(0, (p - 0.55) / 0.25) }}>You&apos;re in the loop.</span>
        </div>
      </div>
    </div>
  )
}

const STATUS_META: Record<string, { cls: string; label: string }> = {
  approved:   { cls: 'yes',        label: 'Approved' },
  pending:    { cls: 'pending',    label: 'Pending' },
  paid:       { cls: 'paid',       label: 'Paid ✓' },
  discussion: { cls: 'discussion', label: 'Discussion' },
}
const vendorInitials = (s?: string | null) => {
  if (!s) return '··'
  const p = String(s).trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '··'
}
const relTime = (dateStr?: string | null) => {
  if (!dateStr) return ''
  const days = Math.round((Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  const months = Math.max(1, Math.round(days / 30))
  return months === 1 ? '1 month ago' : `${months} months ago`
}
const fmtAmt = (n: number | string | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

function RightRail() {
  const { profile } = useAuth()
  const { decisions, loading } = useBoardDecisions(5) as { decisions: any[] | null; loading: boolean }
  const { resident, balance, status: dues } = useMyResident() as { resident: any; balance: number | null; status: 'paid' | 'due' | 'late' }
  const unitLabel = resident?.address || (profile?.unit_number ? `Unit ${profile.unit_number}` : '—')

  return (
    <aside className="rail-right">
      <div className="feed-head">
        <div className="feed-title">This Week on the Board</div>
        <div className="see-all">See all</div>
      </div>

      <div className="feed">
        {decisions === null && !loading && <DemoFeed />}
        {decisions !== null && decisions.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '6px 0' }}>
            No board activity logged yet.
          </div>
        )}
        {decisions !== null && decisions.map((d: any, i: number) => {
          const meta = STATUS_META[d.status] || STATUS_META.discussion
          return (
            <FeedRow
              key={d.id}
              avatar={vendorInitials(d.vendor || d.title)}
              v={i > 0 ? `v${i + 1}` : undefined}
              text={<>
                {d.title}
                {d.vendor && <> · <span className="vendor">{d.vendor}</span></>}
                {d.amount != null && <> · <span className="amt">{fmtAmt(d.amount)}</span></>}
              </>}
              meta={<>{relTime(d.decided_on)} <span className="dot">·</span> <span className={`status ${meta.cls}`}>{meta.label}</span></>}
            />
          )
        })}
      </div>

      <div className="household">
        <div className="household-title">Your household</div>
        <div className="household-row">
          <span className="h-label">Unit</span>
          <span className="h-val">{unitLabel}</span>
        </div>
        <div className="household-divider"></div>
        <div className="household-row">
          <span className="h-label">What you owe</span>
          <span className={`h-val ${balance ? 'due' : 'ok'}`}>
            {balance === null ? '—' : fmtAmt(balance)}
          </span>
        </div>
        <div className="household-row">
          <span className="h-label">Dues status</span>
          <span className={`h-val ${dues === 'paid' ? 'ok' : 'due'}`}>
            {resident ? DUES_LABEL[dues] : '—'}
          </span>
        </div>
      </div>
    </aside>
  )
}

function DemoFeed() {
  return (
    <>
      <FeedRow avatar="OR" text={<>Approved landscaping · <span className="vendor">Oak Ridge Nursery</span> · <span className="amt">$5,200</span></>} meta={<>2 days ago <span className="dot">·</span> <span className="status yes">3/3 yes</span></>} />
      <FeedRow avatar="MA" v="v2" text={<>New pool vendor proposal · <span className="vendor">Miramar Aquatics</span> · <span className="amt">$8,900/yr</span></>} meta={<>3 days ago <span className="dot">·</span> <span className="status pending">Pending 1/3</span></>} />
      <FeedRow avatar="SG" v="v3" text={<>Gate repair invoice · <span className="vendor">SecureGate Co</span> · <span className="amt">$1,840</span></>} meta={<>5 days ago <span className="dot">·</span> <span className="status paid">Paid ✓</span></>} />
      <FeedRow avatar="BD" v="v4" text={<>Amenity reserve warning · <span className="vendor">Board motion</span></>} meta={<>1 week ago <span className="dot">·</span> <span className="status discussion">Discussion</span></>} />
      <FeedRow avatar="FL" v="v5" text={<>Holiday lighting contract · <span className="vendor">FestivaLux</span> · <span className="amt">$2,400</span></>} meta={<>2 weeks ago <span className="dot">·</span> <span className="status pending">2/3 yes, pending</span></>} />
    </>
  )
}

function FeedRow({ avatar, v, text, meta }: { avatar: string; v?: string; text: ReactNode; meta: ReactNode }) {
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
