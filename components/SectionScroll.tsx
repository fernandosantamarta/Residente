'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { sectionSlug } from '@/lib/sectionSlug'

// When the URL carries a section hash (e.g. /admin/budget#expense-ledger), find
// the card whose heading slugifies to that hash and scroll to it. Matching by
// rendered heading text means we don't have to hand-add an id to every section
// across the admin — the search index and this handler agree via sectionSlug().
//
// Admin pages fetch their data before the sections render, so we retry for a
// few seconds until the heading appears, then scroll + briefly highlight it.
export function SectionScroll() {
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    let tries = 0

    const run = () => {
      if (cancelled) return
      const want = decodeURIComponent((window.location.hash || '').replace(/^#/, ''))
      if (!want) return
      const heads = Array.from(
        document.querySelectorAll<HTMLElement>('.admin-main h1, .admin-main h2'),
      )
      const match = heads.find(h => sectionSlug(h.textContent || '') === want)
      if (match) {
        const card = (match.closest('.card') as HTMLElement) || match
        card.scrollIntoView({ behavior: 'smooth', block: 'start' })
        card.classList.add('admin-section-flash')
        window.setTimeout(() => card.classList.remove('admin-section-flash'), 1700)
        return
      }
      if (tries++ < 40) window.setTimeout(run, 75) // ~3s of retries while data loads
    }

    const start = window.setTimeout(run, 60)
    // Same-page jumps (already on the route, only the hash changes) don't remount,
    // so listen for hashchange too.
    const onHash = () => { tries = 0; run() }
    window.addEventListener('hashchange', onHash)
    return () => {
      cancelled = true
      window.clearTimeout(start)
      window.removeEventListener('hashchange', onHash)
    }
  }, [pathname])

  return null
}
