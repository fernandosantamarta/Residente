'use client'

import { useState, useEffect } from 'react'
import { BoardSection } from './_sections/BoardSection'
import { ContactSection } from './_sections/ContactSection'
import { ProposalsRulesSection } from './_sections/ProposalsRulesSection'
import ArcView from '../arc/page'
import ViolationsView from '../enforcement/page'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { useT } from '@/lib/i18n'

// Easy Voice — the resident hub that merges the former Voice (Meetings &
// Votes), Board, and Contact tabs, plus the FL-compliance owner views
// (Architectural review + the resident's own violations/fines/suspensions).
// The segmented control switches between them; only the active section renders.
// The Architectural + Violations tabs reuse the standalone /app/arc and
// /app/enforcement route components (also reachable at those URLs directly);
// the board-election timeline + recall lives at /app/meetings, linked from the
// Voting tab. /app/board and /app/contact redirect here for back-compat.
const TAB_IDS = ['board', 'proposals', 'architectural', 'violations', 'contact'] as const

export default function EasyVoice() {
  const t = useT()
  const [tab, setTab] = useState('board')

  const TABS: SegTab[] = [
    { id: 'board',         label: t('voice.tabBoard') },
    { id: 'proposals',     label: 'Voting' },
    { id: 'architectural', label: 'Architectural' },
    { id: 'violations',    label: 'Violations' },
    { id: 'contact',       label: t('voice.tabContact') },
  ]

  // Honor the URL hash so links like /app/voice#contact (and #architectural /
  // #violations) open the right tab instead of always landing on Board.
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
      {tab === 'violations' && <ViolationsView />}
      {tab === 'contact' && <ContactSection />}
    </div>
  )
}
