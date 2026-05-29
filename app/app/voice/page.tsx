'use client'

import { useState } from 'react'
import { MeetingsSection } from './_sections/MeetingsSection'
import { BoardSection } from './_sections/BoardSection'
import { ContactSection } from './_sections/ContactSection'
import { SegTabs, SegTab } from '../SectionTabs'

// Easy Voice — the resident hub that merges the former Voice (Meetings &
// Votes), Board, and Contact tabs. The segmented control switches between
// them; only the active section renders. /app/board and /app/contact
// redirect here (with #board / #contact) for backward compatibility.
const TABS: SegTab[] = [
  { id: 'board',    label: 'Board' },
  { id: 'meetings', label: 'Meetings & Votes' },
  { id: 'contact',  label: 'Contact' },
]

export default function EasyVoice() {
  const [tab, setTab] = useState('board')

  return (
    <div className="ev-wrap">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Voice</h1>
        <p className="voice-page-sub">
          Meetings &amp; votes, your board, and a direct line to them — all in one place.
        </p>
      </div>

      <SegTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Easy Voice sections" />

      {tab === 'meetings' && <MeetingsSection />}
      {tab === 'board' && <BoardSection />}
      {tab === 'contact' && <ContactSection />}
    </div>
  )
}
