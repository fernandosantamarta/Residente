'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { hasSupabase, supabase } from '@/lib/supabase'
import { AdminErrorBoundary } from '@/components/AdminErrorBoundary'
import { AdminSearch } from '@/components/AdminSearch'
import { SectionScroll } from '@/components/SectionScroll'
import { SiteFooterSlim } from '@/components/SiteFooter'
import { useAuth } from '../providers'
import { usePlatformAdmin } from '@/hooks/usePlatform'
import { usePermissions } from '@/hooks/usePermissions'
import { useAwaitingMessages, useArcPending } from '@/hooks/useAwaitingMessages'
import type { Permission } from '@/lib/permissions'

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
const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin',            label: 'Overview', exact: true },
  { href: '/admin/community',  label: 'Community', anyPerm: ['community.manage'] },
  { href: '/admin/compliance', label: 'Compliance', anyPerm: ['compliance.manage', 'financials.view', 'payments.view', 'violations.manage'], match: ['/admin/estoppel', '/admin/collections', '/admin/structural', '/admin/financials', '/admin/governance', '/admin/enforcement', '/admin/meetings', '/admin/elections', '/admin/insurance', '/admin/contracts', '/admin/advisories'] },
  { href: '/admin/budget',     label: 'Budget', anyPerm: ['community.manage', 'financials.view'] },
  { href: '/admin/reports',    label: 'Reports', anyPerm: ['financials.view', 'payments.view'] },
  { href: '/admin/residents',  label: 'Easy Track', anyPerm: ['residents.view', 'residents.manage'], match: ['/admin/vendor'] },
  { href: '/admin/board',      label: 'Easy Voice', anyPerm: ['voice.manage', 'roles.manage'], match: ['/admin/voice', '/admin/requests', '/admin/roles', '/admin/arc'] },
  { href: '/admin/documents',  label: 'Easy Documents', anyPerm: ['documents.manage', 'violations.manage'], match: ['/admin/rules', '/admin/violations'] },
  { href: '/admin/schedule',   label: 'Easy Schedule', anyPerm: ['schedule.manage'] },
]

// "View as" team previews — founder/platform-only. Founder = full access; the
// rest are Residente staff lenses; Admin = how the customer's board sees it.
// (Selection persists; per-team content scoping is a follow-up.)
const VIEW_AS: { key: string; label: string }[] = [
  { key: 'founder', label: 'Founder' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'support', label: 'Support' },
  { key: 'billing', label: 'Billing' },
  { key: 'admin', label: 'Admin' },
]

const navActive = (pathname: string, item: AdminNavItem) => {
  // The Overview tab points at the admin root, which is a prefix of every other
  // admin route — match it exactly so it isn't perpetually "active".
  if (item.exact) return pathname === item.href
  const hrefs = [item.href, ...(item.match ?? [])]
  return hrefs.some(h => pathname === h || pathname.startsWith(h + '/'))
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const router = useRouter()
  const pathname = usePathname() || '/admin'
  const isPlatformAdmin = usePlatformAdmin()
  const { canAny, perms, loading: permLoading } = usePermissions()

  // Live count of Easy Voice items needing the board's attention — messages
  // awaiting a reply + ARC requests awaiting a decision — drives the nav badge so
  // the board notices from anywhere in the admin.
  const awaitingMsgs = useAwaitingMessages() + useArcPending()

  // Founder/staff "View as" preview selection (persisted). Hidden for regular
  // admins entirely (see the header — only platform admins get the switcher).
  const [viewAs, setViewAs] = useState('founder')
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const v = window.localStorage.getItem('admin_view_as'); if (v) setViewAs(v)
    }
  }, [])
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
    if (!hasAccess) router.replace('/app')
  }, [session, profile, perms, permLoading, isPlatformAdmin, router])

  if (hasSupabase && !session) return null

  return (
    <div className="admin">
      <OperatorBanner isPlatformAdmin={isPlatformAdmin} currentCommunity={profile?.community_id ?? null} />
      <header className="admin-top">
        <div className="admin-brand">
          <Link href="/admin" className="admin-brand-home">
            <img src="/residente-logo.png" alt="" className="brand-logo admin-brand-logo" />
            <span className="admin-brand-word">Residente</span>
          </Link>
          <span className="admin-tag">Admin</span>
        </div>
        {/* Mock-parity bar: a founder/platform-only "View as" team switcher, then
            Contact Residente (pill) + Back to app. Regular admins see no switcher. */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {isPlatformAdmin && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,0.16)', borderRadius: 999, padding: '4px 6px 4px 13px' }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1.2px', color: 'rgba(255,255,255,0.85)', marginRight: 3 }}>VIEW AS</span>
              {VIEW_AS.map(v => {
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
          <Link href="/admin/support" style={{ textDecoration: 'none', fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,0.16)', borderRadius: 999, padding: '7px 15px' }}>
            Contact Residente
          </Link>
        </div>
      </header>

      <nav className="admin-nav">
        <Link href="/app" className="admin-nav-item admin-nav-back">&larr; Back to app</Link>
        {ADMIN_NAV.filter(item => !item.anyPerm || permLoading || canAny(item.anyPerm)).map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-nav-item${navActive(pathname, item) ? ' active' : ''}`}
          >
            {item.label}
            {item.label === 'Easy Voice' && awaitingMsgs > 0 && (
              <span className="admin-nav-badge" title={`${awaitingMsgs} message${awaitingMsgs === 1 ? '' : 's'} awaiting your reply`}>
                {awaitingMsgs}
              </span>
            )}
          </Link>
        ))}
        {isPlatformAdmin && (
          <Link href="/platform" className="admin-nav-item" style={{ color: '#FF6B3D', fontWeight: 700 }}
            onClick={() => { if (typeof window !== 'undefined') window.localStorage.setItem('admin_return_to', pathname) }}>
            Platform Console
          </Link>
        )}
        {/* Search lives in the far-right gutter, mirroring "Back to app" on the
            left, so the centered tab row stays balanced. */}
        <AdminSearch />
      </nav>

      <main className="admin-main">
        <SectionScroll />
        <AdminErrorBoundary>{children}</AdminErrorBoundary>
      </main>
      <SiteFooterSlim />
    </div>
  )
}

// Shown when a Residente operator has dropped into another community to manage
// it (set via the Platform Console). Lets them restore their own community and
// return to the console in one click. Hidden once they're back home.
function OperatorBanner({ isPlatformAdmin, currentCommunity }: { isPlatformAdmin: boolean | null; currentCommunity: string | null }) {
  const router = useRouter()
  const [returnTo, setReturnTo] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window !== 'undefined') setReturnTo(window.localStorage.getItem('platform_return_to'))
  }, [currentCommunity])

  if (!isPlatformAdmin || !returnTo || returnTo === currentCommunity) return null

  const exit = async () => {
    try { if (supabase) await supabase.rpc('platform_enter_community', { target: returnTo }) } catch {}
    if (typeof window !== 'undefined') window.localStorage.removeItem('platform_return_to')
    router.push('/platform')
  }

  return (
    <div style={{ background: '#FF6B3D', color: '#1a0d07', padding: '9px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 600, flexWrap: 'wrap' }}>
      <span>⚙ Operator mode — you’re managing this community as Residente.</span>
      <button onClick={exit} style={{ cursor: 'pointer', background: '#1a0d07', color: '#FF6B3D', border: 'none', padding: '6px 14px', borderRadius: 7, fontWeight: 700, fontSize: 12.5 }}>
        Exit to Console
      </button>
    </div>
  )
}
