'use client'

import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'

// Admin Easy Track sub-nav. Mirrors the resident Easy Track hub: on the admin
// side it groups the people the board "tracks" — the resident roster, vendors,
// and the board roles & permissions. Pill styling matches the other admin
// sub-tabs (.seg-tabs in globals.css).
export type AdminTrackTab = 'residents' | 'vendors' | 'roles'

const TABS: { key: AdminTrackTab; href: string; label: string }[] = [
  { key: 'residents', href: '/admin/residents', label: 'Residents' },
  { key: 'vendors',   href: '/admin/vendor',    label: 'Vendors' },
  { key: 'roles',     href: '/admin/roles',     label: 'Roles' },
]

export function EasyTrackTabs({ active }: { active: AdminTrackTab }) {
  // The Roles tab only shows to board members who can manage roles. While perms
  // load we keep it visible so it doesn't flash in late for those who have it.
  const { canAny, loading } = usePermissions()
  const tabs = TABS.filter(t => t.key !== 'roles' || loading || canAny(['roles.manage']))
  return (
    <div className="seg-tabs" role="tablist">
      {tabs.map(t => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key}
              className={`seg-tab${active === t.key ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  )
}
