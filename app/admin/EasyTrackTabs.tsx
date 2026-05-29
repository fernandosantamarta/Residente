'use client'

import Link from 'next/link'

// Admin Easy Track sub-nav. Mirrors the resident Easy Track hub: on the admin
// side it groups the two things the board "tracks" — the resident roster and
// vendors — each its own route. Pill styling matches the other admin sub-tabs
// (.seg-tabs in globals.css).
export type AdminTrackTab = 'residents' | 'vendors'

const TABS: { key: AdminTrackTab; href: string; label: string }[] = [
  { key: 'residents', href: '/admin/residents', label: 'Residents' },
  { key: 'vendors',   href: '/admin/vendor',    label: 'Vendors' },
]

export function EasyTrackTabs({ active }: { active: AdminTrackTab }) {
  return (
    <div className="seg-tabs" role="tablist">
      {TABS.map(t => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key}
              className={`seg-tab${active === t.key ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  )
}
