'use client'

import { useState, useEffect } from 'react'
import { MeetingsSection } from './_sections/MeetingsSection'
import { BoardSection } from './_sections/BoardSection'
import { ContactSection } from './_sections/ContactSection'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { useT } from '@/lib/i18n'

// Easy Voice — the resident hub that merges the former Voice (Meetings &
// Votes), Board, and Contact tabs. The segmented control switches between
// them; only the active section renders. /app/board and /app/contact
// redirect here (with #board / #contact) for backward compatibility.
const TAB_IDS = ['board', 'meetings', 'contact'] as const

export default function EasyVoice() {
  const t = useT()
  const [tab, setTab] = useState('board')

  const TABS: SegTab[] = [
    { id: 'board',    label: t('voice.tabBoard') },
    { id: 'meetings', label: t('voice.tabMeetings') },
    { id: 'contact',  label: t('voice.tabContact') },
  ]

  // Honor the URL hash so links like /app/voice#contact (and #meetings) open
  // the right tab instead of always landing on Board.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '')
      if ((TAB_IDS as readonly string[]).includes(h)) setTab(h)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])

  return (
    <div className="ev-wrap">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Voice</h1>
        <p className="voice-page-sub">
          {t('voice.hubSub')}
        </p>
      </div>

      <SegTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel={t('voice.hubSectionsAria')} />

      {tab === 'meetings' && <MeetingsSection />}
      {tab === 'board' && <BoardSection />}
      {tab === 'contact' && <ContactSection />}
    </div>
  )
}
