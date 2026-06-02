'use client'

import { useState, useEffect } from 'react'
import { BoardSection } from './_sections/BoardSection'
import { ContactSection } from './_sections/ContactSection'
import { ProposalsRulesSection } from './_sections/ProposalsRulesSection'
import ArcView from '../arc/page'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { useT } from '@/lib/i18n'

// Easy Voice — the resident hub that merges the former Voice (Meetings &
// Votes), Board, and Contact tabs, plus Architectural review (ARC submissions).
// The segmented control switches between them; only the active section renders.
// The Architectural tab reuses the standalone /app/arc route component (also
// reachable at that URL directly); the board-election timeline + recall lives at
// /app/meetings, linked from the Voting tab. A resident's own violations/fines
// live with the rule book in Easy Documents → Rules (MyViolationsPanel), and the
// richer enforcement view (hearings/suspensions) at /app/enforcement.
// /app/board and /app/contact redirect here for back-compat.
const TAB_IDS = ['board', 'proposals', 'architectural', 'contact'] as const

export default function EasyVoice() {
  const t = useT()
  const [tab, setTab] = useState('board')

  const TABS: SegTab[] = [
    { id: 'board',         label: t('voice.tabBoard') },
    { id: 'proposals',     label: 'Voting' },
    { id: 'architectural', label: 'Architectural' },
    { id: 'contact',       label: t('voice.tabContact') },
  ]

  // Honor the URL hash so links like /app/voice#contact (and #architectural)
  // open the right tab instead of always landing on Board.
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

      {tab === 'board' && <BoardSection />}
      {tab === 'proposals' && <ProposalsRulesSection />}
      {tab === 'architectural' && <ArcView />}
      {tab === 'contact' && <ContactSection />}
    </div>
  )
}
