'use client'

// Compact pager for long admin lists (roster, who's-behind). Renders nothing
// when everything fits on one page. Optional `right` slot for an action that
// belongs at the foot of the list (e.g. Export CSV) instead of the header.

import { useT } from '@/lib/i18n'
import type { ReactNode } from 'react'

export function Pager({
  page, pageCount, onPage, right,
}: { page: number; pageCount: number; onPage: (p: number) => void; right?: ReactNode }) {
  const t = useT()
  if (pageCount <= 1 && !right) return null
  return (
    <div className="pager">
      {pageCount > 1 ? (
        <div className="pager-nav">
          <button type="button" className="pager-btn" disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label={t('pager.prev')}>
            <span aria-hidden>&lsaquo;</span> {t('pager.prev')}
          </button>
          <span className="pager-info">{t('pager.of', { page: page + 1, total: pageCount })}</span>
          <button type="button" className="pager-btn" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} aria-label={t('pager.next')}>
            {t('pager.next')} <span aria-hidden>&rsaquo;</span>
          </button>
        </div>
      ) : <span />}
      {right}
    </div>
  )
}
