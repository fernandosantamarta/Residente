// Shared "requires attorney review" notice for the compliance pages, styled as
// the clean wsrow card (white .card + tinted glyph badge + title + dim body) the
// Compliance hub and Easy Documents already use — instead of the old left-accent
// admin-note stripe. Not a link, so no arrow and no hover treatment.

import { ATTORNEY_REVIEW_BANNER } from '@/lib/compliance/rules-core'
import { useT } from '@/lib/i18n'

// The shared constant is one string: "⚠ REQUIRES ATTORNEY REVIEW — <body>".
// Drop the leading marker so the card can show a bold title + dim body.
const BODY = ATTORNEY_REVIEW_BANNER.split('—').slice(1).join('—').trim() || ATTORNEY_REVIEW_BANNER

export function AttorneyNote() {
  const t = useT()
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="wsrow-glyph" style={{ color: '#B5713A', background: '#B5713A18' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <div className="wsrow-main">
          <div className="wsrow-title">{t('admin.attorneyNote.requiresAttorneyReview')}</div>
          <div className="wsrow-desc">{BODY}</div>
        </div>
      </div>
    </div>
  )
}
