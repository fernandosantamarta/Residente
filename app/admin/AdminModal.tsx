'use client'

import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Admin clean-theme popup shell. Portals to <body> so the dimmed backdrop escapes
// the admin column's stacking context, and re-declares `admin cset` on the card
// wrapper so the clean-theme CSS variables resolve outside the page's .admin
// ancestor. Esc / click-outside close. Shared by the Easy Documents sections
// (Documents · Rules · Violations) for their add/edit popups.
export function AdminModal({ title, sub, onClose, children }: {
  title: string
  sub?: string
  onClose: () => void
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!mounted) return null
  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(24, 9, 2, 0.46)',
      display: 'grid', placeItems: 'center', padding: 20, zIndex: 1000,
    }}>
      <div className="admin cset" onClick={e => e.stopPropagation()}
        style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
            <button type="button" className="vdel" onClick={onClose} aria-label="Close"
              style={{ fontSize: 24, lineHeight: 1 }}>&times;</button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
