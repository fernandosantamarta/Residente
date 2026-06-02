'use client'

import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n'

// The site-wide popup primitive. Anything that used to route to a separate page
// to show detail — or to a settings page to perform an action — opens this in
// place instead. Reuses the shared ven-rd-* modal shell (dimmed backdrop, Esc to
// close, click-outside, scrolls when tall).
//
//   View popups   → omit `footer`; a single "Close" button is shown.
//   Action popups → pass a `footer` (e.g. Cancel + Save) and, when the same
//                   thing can also be done in Settings, a `settingsHref` so the
//                   escape hatch is always offered. (That's the structure: do it
//                   here in a popup, OR jump to Settings — never forced to leave.)
export function DetailDialog({
  eyebrow, title, period, children, onClose,
  footer, settingsHref, settingsLabel, size = 'default',
}: {
  eyebrow: string
  title: string
  period?: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  settingsHref?: string
  settingsLabel?: string
  size?: 'default' | 'wide' | 'large'
}) {
  const t = useT()
  // Portal to <body> so the fixed backdrop escapes the main column's
  // `overflow: hidden` / stacking context — otherwise the page (e.g. the slim
  // footer) can bleed into the dialog. Mount-gate keeps SSR happy.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div className="ven-rd-backdrop" onClick={onClose}>
      <div className={`ven-rd-card rd-detail${size === 'wide' ? ' rd-detail-wide' : size === 'large' ? ' rd-detail-lg' : ''}`}
        role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <header className="ven-rd-head">
          <div>
            <div className="ven-rd-eyebrow">{eyebrow}</div>
            <h2 className="ven-rd-title">{title}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label={t('dialogs.close')} onClick={onClose}>×</button>
        </header>

        <div className="ven-rd-body">
          {period && <div className="rd-detail-period">{period}</div>}
          {children}
        </div>

        <footer className="ven-rd-foot">
          {settingsHref ? (
            <a className="rd-settings-link" href={settingsHref}>{settingsLabel ?? t('dialogs.manageInSettings')} &rarr;</a>
          ) : <span />}
          <div className="ven-rd-foot-right">
            {footer ?? (
              <button type="button" className="ven-cta-primary" onClick={onClose}>{t('dialogs.close')}</button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
