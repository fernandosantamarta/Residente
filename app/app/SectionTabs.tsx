'use client'

import { ReactNode, useEffect } from 'react'

export type SegTab = { id: string; label: ReactNode }

// Segmented pill control shared by the Easy Track / Easy Voice / Easy
// Documents hubs. The page owns the active-tab state and renders only the
// matching section — one tab visible at a time.
//
// Deep links keep working: when the URL hash names a tab (e.g. arriving at
// /app/voice#contact, or an in-page <Link href="#pay">), the matching tab
// activates. Selecting a tab rewrites the hash with replaceState so the URL
// stays shareable without stacking history entries (back leaves the page,
// not the tab).
export function SegTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  tabs: SegTab[]
  active: string
  onChange: (id: string) => void
  ariaLabel?: string
}) {
  useEffect(() => {
    const sync = () => {
      const h = decodeURIComponent(window.location.hash.replace(/^#/, ''))
      if (h && tabs.some(t => t.id === h)) onChange(h)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
    // tabs is a module-level constant and onChange is a setState updater —
    // both stable, so this only needs to wire up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const select = (id: string) => {
    onChange(id)
    try {
      window.history.replaceState(null, '', `#${id}`)
    } catch {
      // history unavailable (rare sandbox) — tab still switches in-memory.
    }
  }

  return (
    <div className="seg-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`seg-tab${active === t.id ? ' active' : ''}`}
          onClick={() => select(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
