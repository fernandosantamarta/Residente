'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n'

// Admin Easy Track sub-nav. Mirrors the resident Easy Track hub (Pay ·
// Violations · Vendors · Reports): on the admin side it groups the people and
// money the board "tracks" — the resident roster, enforcement (violations &
// fines), vendors, and the financial reports/exports. Pill styling matches the
// other admin sub-tabs (.seg-tabs in globals.css).
export type AdminTrackTab = 'residents' | 'violations' | 'vendors' | 'reports'

const TABS: { key: AdminTrackTab; href: string }[] = [
  { key: 'residents',  href: '/admin/residents' },
  { key: 'violations', href: '/admin/violations' },
  { key: 'vendors',    href: '/admin/vendor' },
  { key: 'reports',    href: '/admin/reports' },
]

export function EasyTrackTabs({ active }: { active: AdminTrackTab }) {
  const t = useT()

  const tabLabels: Record<AdminTrackTab, string> = {
    residents:  t('admin.easyTrackTabs.tabResidents'),
    violations: t('admin.easyTrackTabs.tabViolations'),
    vendors:    t('admin.easyTrackTabs.tabVendors'),
    reports:    t('admin.easyTrackTabs.tabReports'),
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
