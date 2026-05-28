'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { signOut, hasSupabase } from '@/lib/supabase'
import { useAuth } from '../providers'
import { useMyResident } from '@/hooks/useMyResident'
import { kindToUpTag, upcomingFrom, useScheduleEvents } from '@/lib/schedule'
import { useUnreadNoticeCount, useMyNotices } from '@/hooks/useNotices'
import { NOTICE_KIND_LABELS, noticeHref, NoticeKind } from '@/lib/voice'
import { useCommunityData } from '@/hooks/useCommunityData'
import { usePreferences } from '@/lib/preferences'
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

// Resident left rail. Contact (under Voice) is where residents submit
// requests — maintenance issues, appeals, questions.
const NAV: NavItem[] = [
  { href: '/app',           label: 'Home',      exact: true, icon: <><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></> },
  { href: '/app/pay',       label: 'Pay',       icon: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></> },
  { href: '/app/board',     label: 'Board',     pulse: true, icon: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M15 19c0-2 2-3.5 4-3.5s3 1.2 3 3"/></> },
  { href: '/app/voice',     label: 'Voice',     icon: <><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></> },
  { href: '/app/contact',   label: 'Contact',   icon: <><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-5a9 9 0 0 1 18 0v5a1 1 0 0 1-1 1h-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/></> },
  { href: '/app/rules',     label: 'Rules',     icon: <><path d="M4 4h12l4 4v12H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></> },
  { href: '/app/documents', label: 'Documents', icon: <><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></> },
  { href: '/app/schedule',  label: 'Schedule',  icon: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></> },
  { href: '/app/vendor',    label: 'Vendor',    icon: <><path d="M3 7h18l-1.4 11.2A2 2 0 0 1 17.6 20H6.4a2 2 0 0 1-2-1.8z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></> },
  { href: '/app/reports',   label: 'Reports',   icon: <><path d="M4 4h16v16H4z"/><path d="M8 16v-4M12 16v-7M16 16v-2"/></> },
]
// Settings is intentionally not in NAV — the bottom-left user-block in
// rail-footer is the entry point, matching the profile-tab pattern.

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
  const { community } = useCommunityData()
  const [prefs] = usePreferences()
  const pathname = usePathname() || '/app'
  const router = useRouter()
  const searchParams = useSearchParams()
  // /app?preview=1 — unauthenticated demo view. Renders the cockpit with
  // its demo community (Sunset Lakes) so we can screenshot for the
  // landing and share a live walkthrough URL with prospects. Demo data
  // already flows through useCommunityData when no community is linked,
  // so the only change is skipping the auth redirect.
  const isPreview = searchParams?.get('preview') === '1'
  const showRightRail = pathname === '/app'
  const [navOpen, setNavOpen] = useState(false)
  const showAdmin = !hasSupabase || ['board_member', 'admin'].includes(profile?.role || '')
  const communityName = community?.name || 'Sunset Lakes'
  const now = new Date()
  const quarter = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
  // Always show the current quarter; if the DB has a fiscal_year that
  // already includes a Q, prefer that.
  const fyLabel = community?.fiscal_year && /\bQ\d/.test(community.fiscal_year)
    ? community.fiscal_year
    : quarter

  // Auth gate — bounce unauthed users to /login. Mirrors the old App.jsx
  // `requireAuth ? <Navigate to="/login" /> : <Layout />` guard. Skipped
  // when ?preview=1 so the unauthenticated demo view can render.
  useEffect(() => {
    if (hasSupabase && !session && !isPreview) router.replace('/login')
  }, [session, router, isPreview])

  useEffect(() => { setNavOpen(false) }, [pathname])

  if (hasSupabase && !session && !isPreview) return null  // don't flash cockpit during redirect

  // Self-typed profile name (from /app/settings → Profile Information)
  // beats the auth full_name. This is the resident's chosen display.
  const effectiveFullName = prefs.full_name || profile?.full_name || ''
  const userInitials = initialsFrom(effectiveFullName) || 'FM'
  const userUnit = profile?.unit_number ? `Unit ${profile.unit_number}` : 'Unit —'

  // Apply Accessibility prefs at the document root so CSS can target
  // [data-text-size="large"] / [data-contrast="high"] globally.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (prefs.large_text)  root.setAttribute('data-text-size', 'large'); else root.removeAttribute('data-text-size')
    if (prefs.high_contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast')
  }, [prefs.large_text, prefs.high_contrast])

  return (
    <>
      <CockpitIntro />
    <div className="cockpit" style={!showRightRail ? { gridTemplateColumns: '220px 1fr' } : undefined}>
      <aside className={`rail-left${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/residente-logo.png" alt="" className="brand-logo" />
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
          <div className="rail-meta">
            <span className="rail-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>
              </svg>
              {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            <span className="rail-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>
              </svg>
              82° Sunny
            </span>
          </div>
          <Link href="/app/settings" className="user-block">
            <div
              className={`user-avatar${prefs.profile_image ? ' has-image' : ''}`}
              style={prefs.profile_image ? { backgroundImage: `url(${prefs.profile_image})` } : undefined}
            >
              {!prefs.profile_image && userInitials}
            </div>
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
            <span className="live-dot" aria-label="Live" title="Live"></span>
            <span className="kicker-text">{communityName} · {fyLabel}</span>
          </div>
          <div className="topbar-right">
            <NotificationBell />
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
// sessionStorage so internal cockpit navigation, refreshes, and
// admin-to-cockpit hops don't replay it.
const INTRO_PLAYED_KEY = 'residente-intro-played'
function CockpitIntro() {
  const [phase, setPhase] = useState<'init' | 'playing' | 'done'>('init')
  const [p, setP] = useState(0)              // 0..1 zoom progress
  const startRef = useRef<number | null>(null)
  const [prefs] = usePreferences()

  // Play once per browser tab/session. Subsequent page refreshes
  // inside the same tab, and trips between /admin and /app, skip
  // the intro. Also skip if the user has reduced-motion set —
  // either via /app/settings → Accessibility or OS preferences.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (osReduced || prefs.reduced_motion) { setPhase('done'); return }
    try {
      if (window.sessionStorage.getItem(INTRO_PLAYED_KEY) === '1') {
        setPhase('done')
        return
      }
      window.sessionStorage.setItem(INTRO_PLAYED_KEY, '1')
    } catch {
      // sessionStorage unavailable (incognito edge cases) — fall
      // through to playing rather than blocking the mount.
    }
    setPhase('playing')
  }, [prefs.reduced_motion])

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

const fmtAmt = (n: number | string | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

// HOA convention: dues for month N are due on the 1st of month N.
// If we're already past the 1st, the next bill is for next month.
function nextDueDate(): Date {
  const now = new Date()
  if (now.getDate() === 1) return new Date(now.getFullYear(), now.getMonth(), 1)
  return new Date(now.getFullYear(), now.getMonth() + 1, 1)
}
function nextDueLabel(): string {
  return nextDueDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function nextDueMonth(): string {
  return nextDueDate().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const UP_TAG_LABEL: Record<string, string> = {
  pending: 'pending',
  renewed: 'renewed',
  hosted:  'hosted',
}

function shortDate(s: string) {
  const d = new Date(s + 'T00:00:00')
  return {
    day: d.toLocaleDateString('en-US', { day: '2-digit' }),
    mo:  d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
  }
}

function RightRail() {
  const { profile } = useAuth()
  const { resident, balance, status: dues } = useMyResident() as { resident: any; balance: number | null; status: 'paid' | 'due' | 'late' }
  const unitLabel = resident?.address || (profile?.unit_number ? `Unit ${profile.unit_number}` : 'Unit —')

  // UP NEXT — wired to the same schedule events the /app/schedule
  // calendar uses, so this rail always matches what the resident
  // sees on the full calendar. Upcoming = date >= today, sorted
  // ascending, first 4.
  const allEvents = useScheduleEvents()
  const todayISO = new Date().toISOString().slice(0, 10)
  const items = upcomingFrom(allEvents, todayISO, 4).map(e => ({
    id: e.id,
    date: e.date,
    title: e.title,
    vendor: e.vendor ?? null,
    amount: null as number | null,
    tag: kindToUpTag(e.kind),
    href: e.href,
  }))

  return (
    <aside className="rail-right">
      <div className="up-head">
        <div className="up-title">Up next</div>
        <Link href="/app/schedule" className="up-see-all">View all</Link>
      </div>

      <div className="up-list">
        {items.map((it) => {
          const { day, mo } = shortDate(it.date)
          const row = (
            <>
              <div className="up-date">
                <div className="up-date-day">{day}</div>
                <div className="up-date-mo">{mo}</div>
              </div>
              <div className="up-body">
                <div className="up-row-title">{it.title}</div>
                <div className="up-row-meta">
                  {it.vendor && <span className="up-vendor">{it.vendor}</span>}
                  {it.amount != null && <>
                    {it.vendor && <span className="up-dot">·</span>}
                    <span className="up-amt">{fmtAmt(it.amount)}</span>
                  </>}
                </div>
              </div>
              <div className={`up-tag tag-${it.tag}`}>{UP_TAG_LABEL[it.tag] || it.tag}</div>
            </>
          )
          return it.href ? (
            <Link key={it.id} href={it.href} className="up-row up-row-link">{row}</Link>
          ) : (
            <div key={it.id} className="up-row">{row}</div>
          )
        })}
      </div>

      <div className="household">
        <div className="household-title">Your residence</div>
        <div className="household-row">
          <span className="h-label">Unit</span>
          <span className="h-val unit">{unitLabel}</span>
        </div>
        <div className="household-divider"></div>
        <div className="household-row">
          <span className="h-label">What you owe</span>
          <span className={`h-val h-val-amount ${balance ? 'due' : 'ok'}`}>
            {balance === null ? '—' : fmtAmt(balance)}
          </span>
        </div>
        <div className="household-row">
          <span className="h-label">Due</span>
          <span className="h-val">{nextDueLabel()}</span>
        </div>
        <div className="household-row">
          <span className="h-label">For</span>
          <span className="h-val">{nextDueMonth()}</span>
        </div>
        <div className="household-row">
          <span className="h-label">Dues status</span>
          <span className={`h-val h-val-pill ${dues === 'paid' ? 'ok' : 'due'}`}>
            {resident ? DUES_LABEL[dues] : '—'}
          </span>
        </div>
        <Link href="/app/pay" className="household-cta household-cta-dark">
          Make a payment
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
          </svg>
        </Link>
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

function NotificationBell() {
  const router = useRouter()
  const { count } = useUnreadNoticeCount()
  const [open, setOpen] = useState(false)
  const { notices, loading, markRead } = useMyNotices()

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.bell-wrap')) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  const onPick = (recipientId: string, n: { meeting_id?: string | null; vote_id?: string | null }) => {
    markRead(recipientId)
    setOpen(false)
    router.push(noticeHref(n))
  }

  return (
    <div className="bell-wrap">
      <button className="bell" onClick={() => setOpen(v => !v)} aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 2.5a6 6 0 0 0-6 6V12c0 2.4-.9 3.6-2.3 4.7-.7.5-.7 1.5.1 1.9.4.2.8.3 1.2.3h14c.4 0 .8-.1 1.2-.3.8-.4.8-1.4.1-1.9C18.9 15.6 18 14.4 18 12V8.5a6 6 0 0 0-6-6z"/>
          <path d="M10 20.5a2 2 0 0 0 4 0"/>
        </svg>
        {count > 0 && <span className="bell-badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="menu">
          <div className="bell-panel-head">Notifications</div>
          {loading && <div className="bell-panel-empty">Loading…</div>}
          {!loading && notices.length === 0 && (
            <div className="bell-panel-empty">You're all caught up.</div>
          )}
          {!loading && notices.map((r: any) => {
            const n = r.notice
            if (!n) return null
            const unread = !r.read_at
            return (
              <button
                key={r.id}
                className={`bell-row${unread ? ' unread' : ''}`}
                onClick={() => onPick(r.id, n)}
              >
                <div className="bell-row-kind">{NOTICE_KIND_LABELS[n.kind as NoticeKind] ?? n.kind}</div>
                <div className="bell-row-subject">{n.subject || '(no subject)'}</div>
                {n.body && <div className="bell-row-body">{n.body}</div>}
              </button>
            )
          })}
          <Link
            href="/app/notifications"
            className="bell-panel-footer"
            onClick={() => setOpen(false)}
          >
            See all notifications →
          </Link>
        </div>
      )}
    </div>
  )
}
