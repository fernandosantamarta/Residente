'use client'

import { useEffect } from 'react'
import { ResidentVoteCard } from './MeetingDetail'
import { useT } from '@/lib/i18n'

// In-place popup for a single standalone vote — opened from a vote card.
// Reuses ResidentVoteCard so casting (open + secret ballot, consent guard,
// results) runs through the exact same path as meeting-attached votes.
export function VoteDetailDialog({ vote, onClose, onVoted }: { vote: any; onClose: () => void; onVoted: () => void }) {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="ven-rd-backdrop" onClick={onClose}>
      <div className="ven-rd-card rd-detail" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <header className="ven-rd-head">
          <div>
            <div className="ven-rd-eyebrow">Vote</div>
            <h2 className="ven-rd-title">{vote?.title ?? 'Vote'}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label={t('voice.close')} onClick={onClose}>×</button>
        </header>

        <div className="ven-rd-body">
          <ResidentVoteCard vote={vote} onVoted={onVoted} />
        </div>

        <footer className="ven-rd-foot">
          <div className="ven-rd-foot-right">
            <button type="button" className="ven-cta-primary" onClick={onClose}>{t('voice.close')}</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
