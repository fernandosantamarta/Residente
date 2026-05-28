'use client'

import { MeetingsSection } from './_sections/MeetingsSection'
import { BoardSection } from './_sections/BoardSection'
import { ContactSection } from './_sections/ContactSection'

// Easy Voice — the resident hub that merges the former Voice (Meetings &
// Votes), Board, and Contact tabs into one single-scroll surface. The
// quick-jump strip anchors to each section; /app/board and /app/contact
// redirect here for backward compatibility.
export default function EasyVoice() {
  return (
    <div className="ev-wrap">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Voice</h1>
        <p className="voice-page-sub">
          Meetings &amp; votes, your board, and a direct line to them — all in one place.
        </p>
      </div>

      <div className="voice-tabs ev-jump">
        <a className="voice-tab" href="#meetings">Meetings &amp; Votes</a>
        <a className="voice-tab" href="#board">Board</a>
        <a className="voice-tab" href="#contact">Contact</a>
      </div>

      <MeetingsSection />
      <BoardSection />
      <ContactSection />
    </div>
  )
}
