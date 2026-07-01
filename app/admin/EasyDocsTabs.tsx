'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n'

// Admin Easy Documents sub-nav: Documents · Rules.
//
// Both are sections of /admin/documents. When this bar is rendered there
// (onSelect provided), they're instant in-page buttons — no navigation, no lag.
// When rendered elsewhere (no onSelect), they're links back to /admin/documents
// (the #hash picks the section on arrival).
//
// Violations moved to Easy Track (with the resident roster + fines/reports), to
// mirror the resident-side Easy Track hub.
export type AdminDocsTab = 'rules' | 'documents'

export function EasyDocsTabs({
  active,
  onSelect,
}: {
  active: AdminDocsTab
  onSelect?: (t: 'rules' | 'documents') => void
}) {
  const t = useT()
  const pageTabs: { key: 'rules' | 'documents'; label: string }[] = [
    { key: 'documents', label: t('admin.easyDocsTabs.documents') },
    { key: 'rules',     label: t('admin.easyDocsTabs.rules') },
  ]
  return (
    <div className="seg-tabs admin-seg-tabs" role="tablist">
      {pageTabs.map(tab => {
        const cls = `seg-tab${active === tab.key ? ' active' : ''}`
        return onSelect ? (
          <button key={tab.key} type="button" role="tab" aria-selected={active === tab.key}
                  className={cls} onClick={() => onSelect(tab.key)}>
            {tab.label}
          </button>
        ) : (
          <Link key={tab.key} href={`/admin/documents#${tab.key}`} role="tab"
                aria-selected={active === tab.key} className={cls}>
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
