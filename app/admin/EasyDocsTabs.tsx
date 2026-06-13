'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n'

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
      <Link href="/admin/violations" role="tab" aria-selected={active === 'violations'}
            className={`seg-tab${active === 'violations' ? ' active' : ''}`}>
        {t('admin.easyDocsTabs.violations')}
      </Link>
    </div>
  )
}
