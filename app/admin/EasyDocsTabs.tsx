'use client'

import Link from 'next/link'

// Admin Easy Documents sub-nav. Rules and Documents live on /admin/documents
// (switched in-page via the #rules / #documents hash); Violations is its own
// route folded in here so it reads as part of Easy Documents, not a separate
// top-level section. Pill styling matches the resident sub-tabs and admin
// Easy Voice (components/SegTabs.tsx + .seg-tabs in globals.css).
export type AdminDocsTab = 'rules' | 'documents' | 'violations'

const TABS: { key: AdminDocsTab; href: string; label: string }[] = [
  { key: 'rules',      href: '/admin/documents#rules',     label: 'Rules' },
  { key: 'documents',  href: '/admin/documents#documents', label: 'Documents' },
  { key: 'violations', href: '/admin/violations',          label: 'Violations' },
]

export function EasyDocsTabs({ active }: { active: AdminDocsTab }) {
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
