'use client'

import Link from 'next/link'

// Admin Easy Documents sub-nav: Rules · Documents · Violations.
//
// Rules and Documents are two sections of /admin/documents. When this bar is
// rendered there (onSelect provided), they're instant in-page buttons — no
// navigation, no lag. When rendered on the Violations route (no onSelect),
// they're links back to /admin/documents (the #hash picks the section on
// arrival). Violations is always its own route.
export type AdminDocsTab = 'rules' | 'documents' | 'violations'

export function EasyDocsTabs({
  active,
  onSelect,
}: {
  active: AdminDocsTab
  onSelect?: (t: 'rules' | 'documents') => void
}) {
  const pageTabs: { key: 'rules' | 'documents'; label: string }[] = [
    { key: 'documents', label: 'Documents' },
    { key: 'rules',     label: 'Rules' },
  ]
  return (
    <div className="seg-tabs admin-seg-tabs" role="tablist">
      {pageTabs.map(t => {
        const cls = `seg-tab${active === t.key ? ' active' : ''}`
        return onSelect ? (
          <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
                  className={cls} onClick={() => onSelect(t.key)}>
            {t.label}
          </button>
        ) : (
          <Link key={t.key} href={`/admin/documents#${t.key}`} role="tab"
                aria-selected={active === t.key} className={cls}>
            {t.label}
          </Link>
        )
      })}
      <Link href="/admin/violations" role="tab" aria-selected={active === 'violations'}
            className={`seg-tab${active === 'violations' ? ' active' : ''}`}>
        Violations
      </Link>
    </div>
  )
}
