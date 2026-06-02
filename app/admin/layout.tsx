'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { hasSupabase, supabase } from '@/lib/supabase'
import { AdminErrorBoundary } from '@/components/AdminErrorBoundary'
import { useAuth } from '../providers'
import { CommunitySwitcher } from '../CommunitySwitcher'
import { usePlatformAdmin } from '@/hooks/usePlatform'

// Board-only admin section. Gated by role check — only board_member/admin
// (or local dev without Supabase) reach here.
// Shared sections follow the resident rail order (app/app/layout.tsx NAV):
// Easy Track, Easy Voice, Easy Documents, Easy Schedule. Each hub merges
// former standalone admin sections and exposes its own sub-tabs on its pages:
//   Easy Track     → Residents, Vendors          (EasyTrackTabs)
//   Easy Voice     → Meetings, Roster, Board, Contact (EasyVoiceTabs)
//   Easy Documents → Rules, Documents, Violations (EasyDocsTabs)
// The admin-only setup section (Community) leads.
type AdminNavItem = { href: string; label: string; match?: string[] }
const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin/community',  label: 'Community' },
  { href: '/admin/compliance', label: 'Compliance', match: ['/admin/estoppel', '/admin/collections'] },
  { href: '/admin/residents',  label: 'Easy Track', match: ['/admin/vendor'] },
  { href: '/admin/voice',      label: 'Easy Voice', match: ['/admin/board', '/admin/requests'] },
  { href: '/admin/documents',  label: 'Easy Documents', match: ['/admin/rules', '/admin/violations'] },
  { href: '/admin/schedule',   label: 'Easy Schedule' },
]

const navActive = (pathname: string, item: AdminNavItem) => {
  const hrefs = [item.href, ...(item.match ?? [])]
  return hrefs.some(h => pathname === h || pathname.startsWith(h + '/'))
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const router = useRouter()
  const pathname = usePathname() || '/admin'
  const isPlatformAdmin = usePlatformAdmin()

  // Auth + role gate
  useEffect(() => {
    if (hasSupabase && !session) { router.replace('/login'); return }
    const isBoard = !hasSupabase || ['board_member', 'admin'].includes(profile?.role || '')
    if (!isBoard) router.replace('/app')
  }, [session, profile, router])

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
          <Link href="/admin/support" className="admin-back">Contact Residente</Link>
          <Link href="/app" className="admin-back">&larr; Back to app</Link>
        </div>
      </header>

      <nav className="admin-nav">
        {ADMIN_NAV.map(item => (
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
      </nav>

      <main className="admin-main">
        <AdminErrorBoundary>{children}</AdminErrorBoundary>
      </main>
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
