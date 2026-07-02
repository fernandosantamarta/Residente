'use client'

// Cross-links into the deeper statutory workspaces — the compliance-center
// row pattern (.wslist/.wsrow), reused by the everyday tabs that host those
// workspaces after the admin consolidation (docs/ADMIN-CONSOLIDATION-PLAN.md).
// Wraps itself in `cset` (nested, per the AdminModal gotcha) so the clean-theme
// row styles resolve on pages that aren't themselves cset.

import Link from 'next/link'

export type WorkspaceLink = { href: string; label: string; desc: string; color: string }

export function WorkspaceLinks({ title, items }: { title: string; items: WorkspaceLink[] }) {
  if (!items.length) return null
  return (
    <div className="cset">
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h2>{title}</h2></div></div>
        <div className="wslist">
          {items.map(w => (
            <Link key={w.href} href={w.href} className="wsrow">
              <span className="wsrow-glyph" style={{ color: w.color, background: w.color + '18' }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" />
                </svg>
              </span>
              <div className="wsrow-main">
                <div className="wsrow-title">{w.label}</div>
                <div className="wsrow-desc">{w.desc}</div>
              </div>
              <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
