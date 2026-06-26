'use client'

import { ReactNode, useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { hasSupabase, supabase } from '@/lib/supabase'
import { AdminErrorBoundary } from '@/components/AdminErrorBoundary'
import { AdminSearch } from '@/components/AdminSearch'
import { Dropdown } from '@/components/Dropdown'
import { SectionScroll } from '@/components/SectionScroll'
import { SiteFooterSlim } from '@/components/SiteFooter'
import { useAuth } from '../providers'
import { usePlatformAdmin, usePlatformRoles } from '@/hooks/usePlatform'
import { usePermissions } from '@/hooks/usePermissions'
import { useAwaitingMessages, useArcPending, usePendingApprovals } from '@/hooks/useAwaitingMessages'
import type { Permission } from '@/lib/permissions'
import { useT } from '@/lib/i18n'
import { useTrial } from '@/hooks/useTrial'
import { TrialBanner, TrialGate } from '@/components/TrialNotice'
import { AdminWelcome } from '@/components/AdminWelcome'

// Board-only admin section. Gated by role check — only board_member/admin
// (or local dev without Supabase) reach here.
// Shared sections follow the resident rail order (app/app/layout.tsx NAV):
// Easy Track, Easy Voice, Easy Documents, Easy Schedule. Each hub merges
// former standalone admin sections and exposes its own sub-tabs on its pages:
//   Easy Track     → Residents, Vendors          (EasyTrackTabs)
//   Easy Voice     → Meetings, Roster, Board, Contact (EasyVoiceTabs)
//   Easy Documents → Rules, Documents, Violations (EasyDocsTabs)
// The admin-only setup section (Community) leads.
type AdminNavItem = { href: string; label: string; match?: string[]; exact?: boolean; anyPerm?: Permission[] }
// `label` holds the i18n key (rendered with t()); badge logic keys off href.
const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin',            label: 'admin.nav.overview', exact: true },
  { href: '/admin/community',  label: 'admin.nav.community', anyPerm: ['community.manage'] },
  { href: '/admin/compliance', label: 'admin.nav.compliance', anyPerm: ['compliance.manage', 'financials.view', 'payments.view', 'violations.manage'], match: ['/admin/estoppel', '/admin/collections', '/admin/structural', '/admin/financials', '/admin/governance', '/admin/enforcement', '/admin/meetings', '/admin/elections', '/admin/insurance', '/admin/contracts', '/admin/advisories'] },
  { href: '/admin/budget',     label: 'admin.nav.budget', anyPerm: ['community.manage', 'financials.view'], match: ['/admin/accounting', '/admin/assessments'] },
  { href: '/admin/payables',   label: 'admin.nav.bills', anyPerm: ['financials.view'] },
  { href: '/admin/reports',    label: 'admin.nav.reports', anyPerm: ['financials.view', 'payments.view'] },
  { href: '/admin/residents',  label: 'admin.nav.easyTrack', anyPerm: ['residents.view', 'residents.manage'], match: ['/admin/vendor'] },
  { href: '/admin/board',      label: 'admin.nav.easyVoice', anyPerm: ['voice.manage', 'roles.manage'], match: ['/admin/voice', '/admin/requests', '/admin/roles', '/admin/arc'] },
  { href: '/admin/documents',  label: 'admin.nav.easyDocuments', anyPerm: ['documents.manage', 'violations.manage'], match: ['/admin/rules', '/admin/violations'] },
  { href: '/admin/schedule',   label: 'admin.nav.easySchedule', anyPerm: ['schedule.manage'] },
  { href: '/admin/emergency',  label: 'admin.nav.emergency', anyPerm: ['voice.manage'] },
  { href: '/admin/billing',    label: 'admin.nav.billing', anyPerm: ['community.manage'] },
]

// "View as" team previews — platform-only. Owner (DB role 'owner') = full
// access; the rest are Residente staff lenses; Admin = how the customer's
// board sees it. The 'founder' key is kept for persisted localStorage values.
// (Selection persists; per-team content scoping is a follow-up.)
const VIEW_AS: { key: string; label: string }[] = [
  { key: 'founder', label: 'Owner' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'support', label: 'Support' },
  { key: 'billing', label: 'Billing' },
  { key: 'admin', label: 'Admin' },
]

// Operator sub-role (DB value) → its View-as team. Founders get the full
// switcher; everyone else is pinned to their own team's view.
const ROLE_VIEW: Record<string, { key: string; label: string }> = {
  operator: { key: 'onboarding', label: 'Onboarding' },
  billing:  { key: 'billing', label: 'Billing' },
  support:  { key: 'support', label: 'Support' },
}

const navActive = (pathname: string, item: AdminNavItem) => {
  // The Overview tab points at the admin root, which is a prefix of every other
  // admin route — match it exactly so it isn't perpetually "active".
  if (item.exact) return pathname === item.href
  const hrefs = [item.href, ...(item.match ?? [])]
  return hrefs.some(h => pathname === h || pathname.startsWith(h + '/'))
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const t = useT()
  const { session, profile } = useAuth()
  const router = useRouter()
  const pathname = usePathname() || '/admin'
  const isPlatformAdmin = usePlatformAdmin()
  const platformRoles = usePlatformRoles()
  const { canAny, perms, loading: permLoading } = usePermissions()
  const { state: trial, communityName } = useTrial()

  // Operator mode = a platform operator entered this community from the console
  // (platform_return_to is parked in localStorage until they exit). While visiting
  // we hide the board-facing trial banner + setup popup — the operator isn't the
  // board, and they already have the orange operator bar with an exit button. This
  // also stops the refresh "pile-up" of operator bar + trial banner + setup popup.
  const [operatorMode, setOperatorMode] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const rt = window.localStorage.getItem('platform_return_to')
    setOperatorMode(!!isPlatformAdmin && !!rt && rt !== (profile?.community_id ?? null))
  }, [isPlatformAdmin, profile?.community_id])

  // Tab-overflow → dropdown. The desktop tab row collapses into the section
  // dropdown (next to the search) when the tabs can't fit the nav width — instead
  // of a fixed breakpoint, which broke once there were ~12 tabs. A hidden
  // measurer holds the full-width tab row so the check stays stable when
  // collapsed (no feedback loop). ResizeObserver watches both the nav (width)
  // and the measurer (its width changes as perms resolve / tabs change).
  const navRef = useRef<HTMLElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)
  useEffect(() => {
    const nav = navRef.current, meas = measureRef.current
    if (!nav || !meas) return
    // The tab group is CENTERED, while "Back to app" (left) and the search (right)
    // are pinned in the gutters. So the group collides with the back link once the
    // free space on either side is smaller than the back link — and because it's
    // centered, that gutter must be reserved on BOTH sides. Reserve 2×(back width
    // + a gap) so the tabs drop into the dropdown the moment they'd touch "Back".
    const compute = () => {
      const back = nav.querySelector('.admin-nav-back') as HTMLElement | null
      const GAP = 22
      const reserve = 2 * ((back?.offsetWidth ?? 110) + GAP)
      const needed = meas.scrollWidth + reserve
      // Hysteresis: collapse the moment the tabs would touch, but only expand
      // again with comfortable headroom — so a borderline width (or a scrollbar
      // toggling as the nav height changes) can't flip-flop the two states.
      setNavCollapsed(prev => needed > nav.clientWidth - (prev ? 24 : 0))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(nav); ro.observe(meas)
    return () => ro.disconnect()
  }, [session])

  // Live count of Easy Voice items needing the board's attention — messages
  // awaiting a reply + ARC requests awaiting a decision — drives the nav badge so
  // the board notices from anywhere in the admin.
  const awaitingMsgs = useAwaitingMessages() + useArcPending()

  // Self-serve signups awaiting board approval — badge on the Easy Track nav.
  const pendingApprovals = usePendingApprovals()

  // Badge on "Contact Residente" — tickets where Residente sent the last message
  // (status 'in_progress') that the board hasn't READ yet. "Read" is tracked
  // locally (cr_read_ids): opening a ticket marks it read; a new operator message
  // (status flips back to in_progress) clears the read flag so it shows again.
  const communityId = profile?.community_id
  const [inProgressIds, setInProgressIds] = useState<string[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = () => {
      try { setReadIds(new Set(JSON.parse(localStorage.getItem('cr_read_ids') || '[]'))) }
      catch { setReadIds(new Set()) }
    }
    load()
    window.addEventListener('cr-read-updated', load)
    window.addEventListener('storage', load)
    return () => { window.removeEventListener('cr-read-updated', load); window.removeEventListener('storage', load) }
  }, [])

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) { setInProgressIds([]); return }
    let cancelled = false
    const fetchIds = async () => {
      const { data } = await supabase!.from('platform_requests')
        .select('id').eq('from_community_id', communityId).eq('status', 'in_progress')
      if (!cancelled) setInProgressIds((data || []).map((r: any) => r.id))
    }
    fetchIds()
    const ch = supabase.channel(`contact-residente:${communityId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_requests', filter: `from_community_id=eq.${communityId}` }, (payload: any) => {
        // A fresh operator message flips status to in_progress — clear its read
        // flag so the badge lights up again.
        const row = payload?.new
        if ((payload?.eventType === 'UPDATE' || payload?.eventType === 'INSERT') && row?.status === 'in_progress' && row?.id) {
          try {
            const set = new Set<string>(JSON.parse(localStorage.getItem('cr_read_ids') || '[]'))
            if (set.delete(row.id)) {
              localStorage.setItem('cr_read_ids', JSON.stringify([...set]))
              window.dispatchEvent(new CustomEvent('cr-read-updated'))
            }
          } catch { /* ignore */ }
        }
        fetchIds()
      })
      .subscribe()
    return () => { cancelled = true; supabase!.removeChannel(ch) }
  }, [communityId])

  const residenteUnread = inProgressIds.filter(id => !readIds.has(id)).length

  // Founder/staff "View as" preview selection (persisted). Hidden for regular
  // admins entirely (see the header — only platform admins get the switcher).
  const [viewAs, setViewAs] = useState('founder')
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const v = window.localStorage.getItem('admin_view_as'); if (v) setViewAs(v)
    }
  }, [])
  // Non-owner operators only see their own teams in the bar — one locked pill,
  // or switchable pills when they hold several teams (multi-role). Owners keep
  // the full switcher.
  const teamViews = platformRoles && !platformRoles.includes('owner')
    ? platformRoles.map(r => ROLE_VIEW[r]).filter(Boolean)
    : null
  const teamKeys = teamViews ? teamViews.map(t => t.key).join(',') : ''
  useEffect(() => {
    if (teamViews && teamViews.length && !teamViews.some(t => t.key === viewAs)) setViewAs(teamViews[0].key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKeys, viewAs])
  const chooseView = (v: string) => {
    if (v === viewAs) return
    setViewAs(v)
    if (typeof window !== 'undefined') window.localStorage.setItem('admin_view_as', v)
    // Switching the "View as" role lens resets the sub-nav back to Overview, so
    // you don't land on a sub-page that belonged to the previous role's context.
    router.push('/admin')
  }

  // Auth + access gate. Access = platform admin, community owner (role 'admin'),
  // or a board member whose assigned role grants at least one permission. A
  // board member set to "No role" has an empty permission set and is sent back
  // to the resident app. Waits for perms to load so we don't false-redirect.
  useEffect(() => {
    if (hasSupabase && !session) { router.replace('/login'); return }
    if (!hasSupabase) return
    if (permLoading) return
    const hasAccess = isPlatformAdmin || (!!perms && perms.length > 0)
    if (!hasAccess) { router.replace('/app'); return }
    // A Residente operator with no active community (community_id null) has
    // nothing to render here — their home is the Platform Console.
    if (isPlatformAdmin === true && profile && !profile.community_id) router.replace('/platform')
  }, [session, profile, perms, permLoading, isPlatformAdmin, router])

  if (hasSupabase && !session) return null

  // Visible nav items (perm-filtered) — shared by the desktop tab row and the
  // mobile section dropdown. activeNavHref drives the dropdown's current value.
  const visibleNav = ADMIN_NAV
    .filter(item => !item.anyPerm || permLoading || canAny(item.anyPerm))
  const activeNavHref = (visibleNav.find(item => navActive(pathname, item)) || visibleNav[0])?.href || '/admin'

  return (
    <div className="admin">
      <OperatorBanner isPlatformAdmin={isPlatformAdmin} currentCommunity={profile?.community_id ?? null} />
      {!operatorMode && <TrialBanner state={trial} />}
      {!operatorMode && <AdminWelcome />}
      <header className="admin-top">
        <div className="admin-brand">
          <Link href="/admin" className="admin-brand-home">
            <img src="/residente-logo.png" alt="" className="brand-logo admin-brand-logo" />
            <span className="admin-brand-word">Residente</span>
          </Link>
          <span className="admin-tag">{t('admin.tag')}</span>
        </div>
        {/* Mock-parity bar: a founder/platform-only "View as" team switcher, then
            Contact Residente (pill) + Back to app. Regular admins see no switcher. */}
        <div className="admin-top-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {/* Wait for the roles to resolve so a support operator never flashes
              the full owner switcher while their teams load. */}
          {isPlatformAdmin && !!platformRoles && (
            <div className="admin-viewas" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,0.16)', borderRadius: 999, padding: '4px 6px 4px 13px' }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1.2px', color: 'rgba(255,255,255,0.85)', marginRight: 3 }}>{t('admin.viewAs')}</span>
              {teamViews ? (
                // Non-owner staff: only the teams they're on. One team = a
                // locked pill; several teams = switchable between just those.
                teamViews.length <= 1 ? (
                  <span style={{ borderRadius: 999, padding: '5px 13px', fontSize: 12.5, fontWeight: 700, background: '#fff', color: '#E14909' }}>
                    {teamViews[0]?.label || 'Operator'}
                  </span>
                ) : teamViews.map(v => {
                  const on = viewAs === v.key
                  return (
                    <button key={v.key} type="button" onClick={() => chooseView(v.key)}
                      style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 13px', fontSize: 12.5, fontWeight: 700,
                        background: on ? '#fff' : 'transparent', color: on ? '#E14909' : 'rgba(255,255,255,0.92)' }}>
                      {v.label}
                    </button>
                  )
                })
              ) : VIEW_AS.map(v => {
                const on = viewAs === v.key
                return (
                  <button key={v.key} type="button" onClick={() => chooseView(v.key)}
                    style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 13px', fontSize: 12.5, fontWeight: 700,
                      background: on ? '#fff' : 'transparent', color: on ? '#E14909' : 'rgba(255,255,255,0.92)' }}>
                    {v.label}
                  </button>
                )
              })}
            </div>
          )}
          <Link href="/admin/support" title={residenteUnread > 0 ? t('admin.contactResidenteNew', { count: residenteUnread }) : t('admin.contactResidente')}
            style={{ textDecoration: 'none', fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,0.16)', borderRadius: 999, padding: '7px 15px', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {t('admin.contactResidente')}
            {residenteUnread > 0 && (
              <span className="cr-badge">{residenteUnread}</span>
            )}
          </Link>
        </div>
      </header>

      <nav className={`admin-nav${navCollapsed ? ' admin-nav-collapsed' : ''}`} ref={navRef}>
        <Link href="/app" className="admin-nav-item admin-nav-back">
          <span className="admin-back-long">{t('admin.nav.backToApp')}</span>
          <span className="admin-back-short" aria-hidden="true">{t('admin.nav.back')}</span>
        </Link>
        {visibleNav.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-nav-item${navActive(pathname, item) ? ' active' : ''}`}
          >
            {t(item.label)}
            {item.href === '/admin/board' && awaitingMsgs > 0 && (
              <span className="admin-nav-badge" title={t('admin.voiceBadgeTitle', { count: awaitingMsgs })}>
                {awaitingMsgs}
              </span>
            )}
            {item.href === '/admin/residents' && pendingApprovals > 0 && (
              <span className="admin-nav-badge" title={t('admin.pendingBadgeTitle', { count: pendingApprovals })}>
                {pendingApprovals}
              </span>
            )}
          </Link>
        ))}
        {isPlatformAdmin && (
          <Link href="/platform" className="admin-nav-item admin-nav-platform" style={{ color: '#FF6B3D', fontWeight: 700 }}
            onClick={() => { if (typeof window !== 'undefined') window.localStorage.setItem('admin_return_to', pathname) }}>
            {t('admin.nav.platformConsole')}
          </Link>
        )}
        {/* Mobile section picker — replaces the scrolling tab row on phones.
            Sits at the far right; "Back" stays at the far left. Uses the themed
            Dropdown (not a native <select>) so the open list matches the theme
            instead of the iOS-default picker. */}
        <div className="admin-nav-dd">
          <Dropdown<string>
            value={activeNavHref}
            onChange={(v) => router.push(v)}
            ariaLabel={t('admin.tag')}
            options={visibleNav.map(item => ({ value: item.href, label: t(item.label) }))}
          />
        </div>
        {/* Search lives in the far-right gutter, mirroring "Back to app" on the
            left, so the centered tab row stays balanced. */}
        <AdminSearch />
        {/* Hidden measurer — the full-width tab row at natural size, used only to
            decide whether the real tabs fit. Never visible; never wraps. */}
        <div className="admin-nav-measure" ref={measureRef} aria-hidden="true">
          {visibleNav.map(item => (
            <span key={item.href} className="admin-nav-item">{t(item.label)}</span>
          ))}
          {isPlatformAdmin && <span className="admin-nav-item">{t('admin.nav.platformConsole')}</span>}
        </div>
      </nav>

      <main className="admin-main">
        <SectionScroll />
        {isPlatformAdmin === false && trial.phase === 'expired' && pathname !== '/admin/billing'
          ? <TrialGate communityName={communityName} />
          : <AdminErrorBoundary>{children}</AdminErrorBoundary>}
      </main>
      <SiteFooterSlim />
    </div>
  )
}

// Shown when a Residente operator has dropped into another community to manage
// it (set via the Platform Console). Lets them restore their own community and
// return to the console in one click. Hidden once they're back home.
function OperatorBanner({ isPlatformAdmin, currentCommunity }: { isPlatformAdmin: boolean | null; currentCommunity: string | null }) {
  const t = useT()
  const router = useRouter()
  const [returnTo, setReturnTo] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window !== 'undefined') setReturnTo(window.localStorage.getItem('platform_return_to'))
  }, [currentCommunity])

  if (!isPlatformAdmin || !returnTo || returnTo === currentCommunity) return null

  const exit = async () => {
    // 'none' = the operator has no home community: park at community_id NULL
    // (platform_exit_community) instead of re-entering one.
    try {
      if (supabase) {
        if (returnTo === 'none') await supabase.rpc('platform_exit_community')
        else await supabase.rpc('platform_enter_community', { target: returnTo })
      }
    } catch {}
    if (typeof window !== 'undefined') window.localStorage.removeItem('platform_return_to')
    router.push('/platform')
  }

  return (
    <div style={{ background: '#FF6B3D', color: '#1a0d07', padding: '9px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 600, flexWrap: 'wrap' }}>
      <span>{t('admin.operatorMode')}</span>
      <button onClick={exit} style={{ cursor: 'pointer', background: '#1a0d07', color: '#FF6B3D', border: 'none', padding: '6px 14px', borderRadius: 7, fontWeight: 700, fontSize: 12.5 }}>
        {t('admin.exitToConsole')}
      </button>
    </div>
  )
}
