'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { BoardSection } from './_sections/BoardSection'
import { ContactSection } from './_sections/ContactSection'
import { ProposalsRulesSection } from './_sections/ProposalsRulesSection'
// Phone variant — today's single combined quick-links card (desktop keeps 3 cards).
import { ProposalsRulesSection as ProposalsRulesSectionMobile } from './_sections/ProposalsRulesSection.mobile'
import ArcView from '../arc/page'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { useMyPendingReplies } from '@/hooks/useAwaitingMessages'
import { useMyResident } from '@/hooks/useMyResident'
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
// This page reads search params (?cat=) at the top level; opt out of static
// prerendering so Next doesn't require a Suspense boundary for useSearchParams.
// The page is client/auth-gated and dynamic anyway.
export const dynamic = 'force-dynamic'

const TAB_IDS = ['board', 'proposals', 'architectural', 'contact'] as const

export default function EasyVoice() {
  const t = useT()
  const [tab, setTab] = useState('board')
  const pendingReplies = useMyPendingReplies()
  const { isTenant } = useMyResident()
  const searchParams = useSearchParams()
  const catParam = searchParams.get('cat')

  // Tenants (leased units) are non-voting and don't submit architectural
  // requests — those belong to the owner. They keep Board + Contact (requests).
  const TABS: SegTab[] = [
    { id: 'board',         label: t('voice.tabBoard') },
    ...(isTenant ? [] : [
      { id: 'proposals',     label: 'Voting' },
      { id: 'architectural', label: 'Architectural' },
    ] as SegTab[]),
    { id: 'contact',       label: (
      <>
        {t('voice.tabContact')}
        {pendingReplies > 0 && <span className="con-pending-badge">{pendingReplies}</span>}
      </>
    ) },
  ]

  // If a tenant lands on a now-hidden tab (via hash/deep-link), fall back to Board.
  useEffect(() => {
    if (isTenant && (tab === 'proposals' || tab === 'architectural')) setTab('board')
  }, [isTenant, tab])

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

  // A ?cat= deep-link (e.g. "Propose a rule" → /app/voice?cat=rule_proposal#contact)
  // targets the Contact form. Client-side navigation within this page doesn't
  // reliably fire `hashchange`, so switch to the Contact tab when the cat param
  // is present — then ContactSection preselects the category and focuses the
  // subject field.
  useEffect(() => {
    if (catParam) setTab('contact')
  }, [catParam])

  return (
    <div className="ev-wrap">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Voice</h1>
        <p className="voice-page-sub">
          {t('voice.hubSub')}
        </p>
      </div>

      <div className="voice-segtabs">
        <SegTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel={t('voice.hubSectionsAria')} />
      </div>

      {tab === 'board' && <BoardSection />}
      {tab === 'proposals' && !isTenant && (<>
        <div className="rsv-web"><ProposalsRulesSection /></div>
        <div className="rsv-mob"><ProposalsRulesSectionMobile /></div>
      </>)}
      {tab === 'architectural' && !isTenant && <ArcView />}
      {tab === 'contact' && <ContactSection />}
    </div>
  )
}
