'use client'

import { useCallback, useEffect, useRef, useState, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { signOut, hasSupabase } from '@/lib/supabase'
import { useAuth } from '../providers'
import { useMyResident } from '@/hooks/useMyResident'
import { kindToUpTag, upcomingFrom, useScheduleEvents } from '@/lib/schedule'
import { useUnreadNoticeCount, useMyNotices } from '@/hooks/useNotices'
import { SiteFooterSlim } from '@/components/SiteFooter'
import { NOTICE_KIND_LABELS, noticeHref, NoticeKind } from '@/lib/voice'
import { useCommunityData } from '@/hooks/useCommunityData'
import { useWeather } from '@/hooks/useWeather'
import { usePlatformAdmin } from '@/hooks/usePlatform'
import { usePreferences } from '@/lib/preferences'
import { useT } from '@/lib/i18n'
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

type NavItem = { href: string; label: string; icon: ReactNode; pulse?: boolean; exact?: boolean; match?: string[] }

// Resident left rail. Easy Track merges pay, vendors, and reports into one
// tab; Easy Voice merges meetings & votes, the board, and contact requests
// (maintenance issues, appeals, questions) into one tab.
const NAV: NavItem[] = [
  { href: '/app',           label: 'Home',       exact: true, icon: <><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></> },
  { href: '/app/track',     label: 'Easy Track', icon: <><path d="M3 3v18h18"/><path d="m7 14 3-3 3 3 5-5"/></> },
  { href: '/app/voice',     label: 'Easy Voice', icon: <><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></> },
  { href: '/app/documents', label: 'Easy Documents', match: ['/app/rules'], icon: <><path d="M4 4h12l4 4v12H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></> },
  { href: '/app/schedule',  label: 'Easy Schedule',  icon: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></> },
]
// Settings is intentionally not in NAV — the bottom-left user-block in
// rail-footer is the entry point, matching the profile-tab pattern.

const isActive = (pathname: string, item: NavItem) => {
  const hrefs = [item.href, ...(item.match ?? [])]
  if (item.exact) return hrefs.some(h => pathname === h)
  return hrefs.some(h => pathname === h || pathname.startsWith(h + '/'))
}

const fmtTime = () => {
  const d = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${time} · ${date}`
}

export default function CockpitLayout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const { community } = useCommunityData()
  const { weather } = useWeather(community?.location)
  const isPlatformAdmin = usePlatformAdmin()
  const [prefs] = usePreferences()
  const t = useT()
  const pathname = usePathname() || '/app'
  const router = useRouter()
  const searchParams = useSearchParams()
  // /app?preview=1 — unauthenticated demo view. Renders the cockpit with
  // its demo community (Sunset Lakes) so we can screenshot for the
  // landing and share a live walkthrough URL with prospects. Demo data
  // already flows through useCommunityData when no community is linked,
  // so the only change is skipping the auth redirect.
  const isPreview = searchParams?.get('preview') === '1'
  // Home nav dot: a notification indicator — light it only when there are
  // unread notices (a new calendar event, an opened vote, an announcement, a
  // fine). Reading everything in the bell clears it. We deliberately do NOT
  // tie it to the dues balance: dues are surfaced on Home already, and folding
  // them in here left the dot stuck on for anyone who owed money. Both hooks
  // tolerate a null profile and MUST run before the auth-guard early-return
  // below so the hook count stays stable across logout. Preview forces it on
  // for demo screenshots.
  const { count: unreadCount } = useUnreadNoticeCount()
  useMyResident() // keep mounted before the auth guard for stable hook order
  const homeHasAlert = isPreview || unreadCount > 0
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

  // Apply Accessibility prefs at the document root so CSS can target
  // [data-text-size="large"] / [data-contrast="high"] globally. MUST run
  // before the auth-guard early-return below — otherwise logout (session→null)
  // renders fewer hooks than the logged-in pass and React crashes the page
  // ("Rendered fewer hooks than expected").
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (prefs.large_text)  root.setAttribute('data-text-size', 'large'); else root.removeAttribute('data-text-size')
    if (prefs.high_contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast')
    if (prefs.reduced_motion) root.setAttribute('data-reduced-motion', 'reduce'); else root.removeAttribute('data-reduced-motion')
  }, [prefs.large_text, prefs.high_contrast, prefs.reduced_motion])

  // Tint the mobile browser's status bar a warm sunset tone while in the
  // cockpit so it blends with the hero photo instead of the cream app default.
  // (In a normal Safari tab the page can't render under the status bar, so the
  // photo can't cover it — the theme-color tint is what removes the white
  // strip. In standalone/PWA mode the photo bleeds up via the safe-area CSS.)
  // Restored on unmount so /admin, /login and the landing keep the cream bar.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const prev = meta.getAttribute('content')
    // Cream status bar across the cockpit (Fernando didn't want the orange/sunset
    // tint). Reads as a clean cream top strip above the hero photo / content.
    meta.setAttribute('content', '#FDF7F5')
    return () => { if (prev) meta.setAttribute('content', prev) }
  }, [navOpen])

  if (hasSupabase && !session && !isPreview) return null  // don't flash cockpit during redirect

  // Self-typed profile name (from /app/settings → Profile Information)
  // beats the auth full_name. This is the resident's chosen display.
  const effectiveFullName = prefs.full_name || profile?.full_name || ''
  const userInitials = initialsFrom(effectiveFullName) || 'FM'
  const userUnit = profile?.unit_number ? `Unit ${profile.unit_number}` : 'Unit —'

  return (
    <>
      <CockpitIntro />
    <div className="cockpit" style={!showRightRail ? { gridTemplateColumns: '220px 1fr' } : undefined}>
      <aside className={`rail-left${navOpen ? ' open' : ''}`}>
        {isPreview ? (
          <Link href="/" className="brand brand-back" aria-label="Back to home">
            <span aria-hidden="true" className="brand-back-arrow">←</span>
            <div className="brand-word">Back to home</div>
          </Link>
        ) : (
          <div className="brand">
            <img src="/residente-logo.png" alt="" className="brand-logo" />
            <div className="brand-word">Residente</div>
          </div>
        )}

        <nav className="nav">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={isPreview ? `${item.href}?preview=1` : item.href}
              className={`nav-item${isActive(pathname, item) ? ' active' : ''}`}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {item.icon}
              </svg>
              <span>{item.label}</span>
              {item.href === '/app' && homeHasAlert && <span className="pulse-dot"></span>}
            </Link>
          ))}
          {(showAdmin || isPlatformAdmin) && (
            <>
              {/* Board/platform tools — set apart from the resident tabs, and
                  desktop-only: on phones we show a note instead of the links. */}
              <div aria-hidden="true" style={{ height: 1, background: 'var(--border)', margin: '14px 14px 6px' }} />
              {showAdmin && (
                <Link
                  href="/admin"
                  className={`nav-item nav-desktop-only${pathname.startsWith('/admin') ? ' active' : ''}`}
                >
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/>
                  </svg>
                  <span>{t('nav.admin')}</span>
                </Link>
              )}
              {isPlatformAdmin && (
                <Link href="/platform" className="nav-item nav-desktop-only" style={{ color: '#FF6B3D', fontWeight: 700 }}>
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                  <span>Platform Console</span>
                </Link>
              )}
              <div className="nav-desktop-note">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                </svg>
                <span>{showAdmin && isPlatformAdmin
                  ? 'Open Admin & the Platform Console on a desktop.'
                  : isPlatformAdmin
                  ? 'Open the Platform Console on a desktop.'
                  : 'Open Admin on a desktop.'}</span>
              </div>
            </>
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
              {weather ? `${weather.temp}° ${weather.condition}` : '—'}
            </span>
          </div>
          {isPreview ? (
            <div className="user-block" style={{ cursor: 'default' }}>
              <div className="user-avatar">D</div>
              <div className="user-meta">
                <span className="label">Viewing</span>
                <span className="val">Demo</span>
              </div>
            </div>
          ) : (
            <>
              <Link href="/app/settings" className="user-block">
                <div
                  className={`user-avatar${prefs.profile_image ? ' has-image' : ''}`}
                  style={prefs.profile_image ? { backgroundImage: `url(${prefs.profile_image})` } : undefined}
                >
                  {!prefs.profile_image && userInitials}
                </div>
                <div className="user-meta">
                  <span className="label">{t('rail.signedInAs')}</span>
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
                <span>{t('rail.signOut')}</span>
              </button>
            </>
          )}
        </div>
      </aside>

      <div className={`nav-backdrop${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

      <main className="center">
        <div className="topbar">
          <div className="kicker">
            {/* Hide the menu button + community label while the drawer is open —
                they otherwise overlap the drawer's "Residente" header. The drawer
                closes via the backdrop or the More tab. */}
            {!navOpen && (
              <button
                className="hamburger"
                onClick={() => setNavOpen(true)}
                aria-label="Open menu"
                aria-expanded={false}
              >
                <span /><span /><span />
              </button>
            )}
            {!navOpen && <span className="live-dot" aria-label="Live" title="Live"></span>}
            {!navOpen && <span className="kicker-text">{communityName} · {fyLabel}</span>}
          </div>
          <div className="topbar-right">
            <NotificationBell />
          </div>
        </div>

        {children}
        <SiteFooterSlim />
      </main>

      {showRightRail && <RightRail />}

      {/* Mobile bottom tab bar — primary navigation on phones, matching the
          native-app pattern. Replaces the hamburger as the main entry point;
          the "More" tab opens the existing drawer (Schedule, Settings, Admin,
          Platform, sign out). Hidden ≥768px via CSS. */}
      <nav className="bottom-nav" aria-label="Primary">
        <Link href={isPreview ? '/app?preview=1' : '/app'} className={`bn-item${pathname === '/app' ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></svg>
          <span>Home</span>
          {homeHasAlert && <span className="bn-dot" aria-hidden="true" />}
        </Link>
        <Link href={isPreview ? '/app/track?preview=1' : '/app/track'} className={`bn-item${pathname.startsWith('/app/track') ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
          <span>Pay</span>
        </Link>
        <Link href={isPreview ? '/app/voice?preview=1' : '/app/voice'} className={`bn-item${pathname.startsWith('/app/voice') ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Requests</span>
        </Link>
        <Link href={isPreview ? '/app/documents?preview=1' : '/app/documents'} className={`bn-item${(pathname.startsWith('/app/documents') || pathname.startsWith('/app/rules')) ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h12l4 4v12H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>
          <span>Documents</span>
        </Link>
        <button type="button" className={`bn-item${navOpen ? ' active' : ''}`} onClick={() => setNavOpen(true)} aria-label="More">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
          <span>More</span>
        </button>
      </nav>
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
  const t = useT()
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
        <div className="up-title">{t('rail.upNext')}</div>
        <Link href="/app/schedule" className="up-see-all">{t('rail.viewAll')}</Link>
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
        <div className="household-title">{t('rail.yourResidence')}</div>
        <div className="household-row">
          <span className="h-label">{t('rail.unit')}</span>
          <span className="h-val unit">{unitLabel}</span>
        </div>
        <div className="household-divider"></div>
        <div className="household-row">
          <span className="h-label">{t('rail.whatYouOwe')}</span>
          <span className={`h-val h-val-amount ${balance ? 'due' : 'ok'}`}>
            {balance === null ? '—' : fmtAmt(balance)}
          </span>
        </div>
        <div className="household-row">
          <span className="h-label">{t('rail.due')}</span>
          <span className="h-val">{nextDueLabel()}</span>
        </div>
        <div className="household-row">
          <span className="h-label">{t('rail.for')}</span>
          <span className="h-val">{nextDueMonth()}</span>
        </div>
        <div className="household-row">
          <span className="h-label">{t('rail.duesStatus')}</span>
          <span className={`h-val h-val-pill ${dues === 'paid' ? 'ok' : 'due'}`}>
            {resident ? DUES_LABEL[dues] : '—'}
          </span>
        </div>
        <Link href="/app/track#pay" className="household-cta household-cta-dark">
          {t('rail.makePayment')}
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
  const t = useT()
  const { count, reload: reloadCount } = useUnreadNoticeCount()
  const [open, setOpen] = useState(false)
  const { notices, loading, markAllRead } = useMyNotices()

  // Closing the panel clears the unread batch — "checked them, now they're
  // gone." markAllRead is a no-op when nothing is unread, so re-closing an
  // already-empty panel is free. Reload the badge count right after so the
  // number disappears immediately instead of waiting on the realtime tick.
  const closePanel = useCallback(() => {
    setOpen(false)
    markAllRead().then(reloadCount)
  }, [markAllRead, reloadCount])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.bell-wrap')) closePanel()
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open, closePanel])

  const onPick = async (recipientId: string, n: { meeting_id?: string | null; vote_id?: string | null }) => {
    // Await the read-write BEFORE navigating. router.push() tears this
    // component down and aborts any in-flight fetch, so a fire-and-forget
    // update here was getting cancelled — the notices never persisted as
    // read. The optimistic update already cleared them visually; this makes
    // it stick on the server too.
    setOpen(false)
    await markAllRead()
    router.push(noticeHref(n))
  }

  return (
    <div className="bell-wrap">
      <button className="bell" onClick={() => (open ? closePanel() : setOpen(true))} aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 2.5a6 6 0 0 0-6 6V12c0 2.4-.9 3.6-2.3 4.7-.7.5-.7 1.5.1 1.9.4.2.8.3 1.2.3h14c.4 0 .8-.1 1.2-.3.8-.4.8-1.4.1-1.9C18.9 15.6 18 14.4 18 12V8.5a6 6 0 0 0-6-6z"/>
          <path d="M10 20.5a2 2 0 0 0 4 0"/>
        </svg>
        {count > 0 && <span className="bell-badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="menu">
          <div className="bell-panel-head">{t('bell.notifications')}</div>
          {loading && <div className="bell-panel-empty">{t('bell.loading')}</div>}
          {!loading && notices.length === 0 && (
            <div className="bell-panel-empty">{t('bell.caughtUp')}</div>
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
            onClick={closePanel}
          >
            {t('bell.seeAll')}
          </Link>
        </div>
      )}
    </div>
  )
}
