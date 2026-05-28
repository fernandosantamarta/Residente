'use client'

import { ReactNode, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { hasSupabase } from '@/lib/supabase'
import { AdminErrorBoundary } from '@/components/AdminErrorBoundary'
import { useAuth } from '../providers'
import { CommunitySwitcher } from '../CommunitySwitcher'

// Board-only admin section. Gated by role check — only board_member/admin
// (or local dev without Supabase) reach here.
// Shared sections follow the resident rail order (app/app/layout.tsx NAV):
// Board, Voice, Contact, Rules, Documents, Schedule, Vendors. Admin-only
// sections lead with the setup pair (Community, Residents); Violations sits
// right after Rules since it enforces them.
const ADMIN_NAV = [
  { href: '/admin/community',  label: 'Community' },
  { href: '/admin/residents',  label: 'Residents' },
  { href: '/admin/board',      label: 'Board' },
  { href: '/admin/voice',      label: 'Voice' },
  { href: '/admin/requests',   label: 'Contact' },
  { href: '/admin/rules',      label: 'Rules' },
  { href: '/admin/violations', label: 'Violations' },
  { href: '/admin/documents',  label: 'Documents' },
  { href: '/admin/schedule',   label: 'Schedule' },
  { href: '/admin/vendor',     label: 'Vendors' },
]

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const router = useRouter()
  const pathname = usePathname() || '/admin'

  // Auth + role gate
  useEffect(() => {
    if (hasSupabase && !session) { router.replace('/login'); return }
    const isBoard = !hasSupabase || ['board_member', 'admin'].includes(profile?.role || '')
    if (!isBoard) router.replace('/app')
  }, [session, profile, router])

  if (hasSupabase && !session) return null

  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-brand">
          <img src="/residente-logo.png" alt="" className="brand-logo admin-brand-logo" />
          <span className="admin-brand-word">Residente</span>
          <span className="admin-tag">Admin</span>
          <CommunitySwitcher />
        </div>
        <Link href="/app" className="admin-back">&larr; Back to app</Link>
      </header>

      <nav className="admin-nav">
        {ADMIN_NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-nav-item${pathname === item.href || pathname.startsWith(item.href + '/') ? ' active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <main className="admin-main">
        <AdminErrorBoundary>{children}</AdminErrorBoundary>
      </main>
    </div>
  )
}
