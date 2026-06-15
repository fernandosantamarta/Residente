'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n'

// Admin Easy Track sub-nav. Mirrors the resident Easy Track hub: on the admin
// side it groups the people the board "tracks" — the resident roster and
// vendors. (Roles & permissions moved to Easy Voice, next to Board.) Pill
// styling matches the other admin sub-tabs (.seg-tabs in globals.css).
export type AdminTrackTab = 'residents' | 'vendors'

const TABS: { key: AdminTrackTab; href: string }[] = [
  { key: 'residents', href: '/admin/residents' },
  { key: 'vendors',   href: '/admin/vendor' },
]

export function EasyTrackTabs({ active }: { active: AdminTrackTab }) {
  const t = useT()

  const tabLabels: Record<AdminTrackTab, string> = {
    residents: t('admin.easyTrackTabs.tabResidents'),
    vendors:   t('admin.easyTrackTabs.tabVendors'),
  }

  return (
    <div className="seg-tabs admin-seg-tabs" role="tablist">
      {TABS.map(tab => (
        <Link key={tab.key} href={tab.href} role="tab" aria-selected={active === tab.key}
              className={`seg-tab${active === tab.key ? ' active' : ''}`}>
          {tabLabels[tab.key]}
        </Link>
      ))}
    </div>
  )
}
