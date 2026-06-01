'use client'

import { useEffect } from 'react'
import { useVoiceMeeting } from '@/hooks/useVoiceMeetings'
import { MEETING_TYPES } from '@/lib/voice'
import { MeetingDetailBody } from './MeetingDetail'
import { useT } from '@/lib/i18n'

// In-place popup for a single meeting — opened from the Meetings list instead
// of routing to /app/voice/[id]. Reuses the shared ven-rd-* modal shell and the
// shared MeetingDetailBody (same votes/docs/ballot logic as the page).
export function MeetingDetailDialog({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const t = useT()
  const { meeting, loading, error, reload } = useVoiceMeeting(meetingId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeLabel = meeting
    ? (MEETING_TYPES.find(mt => mt.value === meeting.type)?.label ?? meeting.type)
    : ''

  return (
    <div className="ven-rd-backdrop" onClick={onClose}>
      <div className="ven-rd-card rd-detail rd-detail-wide" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <header className="ven-rd-head">
          <div>
            <div className="ven-rd-eyebrow">{typeLabel || t('voice.meeting')}</div>
            <h2 className="ven-rd-title">{meeting?.title ?? t('voice.meeting')}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label={t('voice.close')} onClick={onClose}>×</button>
        </header>

        <div className="ven-rd-body">
          {loading && <div className="voice-placeholder">{t('voice.loading')}</div>}
          {error && <div className="voice-err">{error}</div>}
          {!loading && !error && meeting && (
            <MeetingDetailBody meeting={meeting} reload={reload} compact />
          )}
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
