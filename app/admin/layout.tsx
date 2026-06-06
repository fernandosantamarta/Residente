'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { hasSupabase, supabase } from '@/lib/supabase'
import { AdminErrorBoundary } from '@/components/AdminErrorBoundary'
import { SiteFooterSlim } from '@/components/SiteFooter'
import { useAuth } from '../providers'
import { CommunitySwitcher } from '../CommunitySwitcher'
import { usePlatformAdmin } from '@/hooks/usePlatform'
import { usePermissions } from '@/hooks/usePermissions'
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
  { href: '/admin/compliance', label: 'Compliance', anyPerm: ['compliance.manage', 'financials.view', 'payments.view', 'violations.manage'], match: ['/admin/estoppel', '/admin/collections', '/admin/structural', '/admin/financials', '/admin/governance', '/admin/enforcement', '/admin/meetings', '/admin/elections', '/admin/arc', '/admin/insurance'] },
  { href: '/admin/reports',    label: 'Reports', anyPerm: ['financials.view', 'payments.view'] },
  { href: '/admin/residents',  label: 'Easy Track', anyPerm: ['residents.view', 'residents.manage'], match: ['/admin/vendor'] },
  { href: '/admin/voice',      label: 'Easy Voice', anyPerm: ['voice.manage'], match: ['/admin/board', '/admin/requests'] },
  { href: '/admin/documents',  label: 'Easy Documents', anyPerm: ['documents.manage', 'violations.manage'], match: ['/admin/rules', '/admin/violations'] },
  { href: '/admin/schedule',   label: 'Easy Schedule', anyPerm: ['schedule.manage'] },
  { href: '/admin/roles',      label: 'Roles', anyPerm: ['roles.manage'] },
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
          <CommunitySwitcher />
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16 }}>
          <Link href="/app" className="admin-back">&larr; Back to app</Link>
        </div>
      </header>

      <nav className="admin-nav" style={{ position: 'relative' }}>
        {ADMIN_NAV.filter(item => !item.anyPerm || permLoading || canAny(item.anyPerm)).map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-nav-item${navActive(pathname, item) ? ' active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
        {isPlatformAdmin && (
          <Link href="/platform" className="admin-nav-item" style={{ color: '#FF6B3D', fontWeight: 700 }}>
            Platform Console
          </Link>
        )}
        <Link href="/admin/support" className="admin-nav-item" style={{ position: 'absolute', right: 32, top: 14 }}>
          Contact Residente
        </Link>
      </nav>

      <main className="admin-main">
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
