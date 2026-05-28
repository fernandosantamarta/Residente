'use client'

import Link from 'next/link'

// Shared sub-nav for the admin Easy Voice area — the merged home of the
// former Board, Voice (meetings/votes), and Contact admin sections. One tap
// between Meetings, Roster, Board, and Contact. Rendered at the top of each
// of those pages so they read as tabs of a single section.
export type EasyVoiceTab = 'meetings' | 'roster' | 'board' | 'contact'

const TABS: { key: EasyVoiceTab; href: string; label: string }[] = [
  { key: 'meetings', href: '/admin/voice',        label: 'Meetings' },
  { key: 'roster',   href: '/admin/voice/roster', label: 'Roster' },
  { key: 'board',    href: '/admin/board',        label: 'Board' },
  { key: 'contact',  href: '/admin/requests',     label: 'Contact' },
]

export function EasyVoiceTabs({ active }: { active: EasyVoiceTab }) {
  return (
    <div className="voice-tabs">
      {TABS.map(t => (
        <Link key={t.key} href={t.href}
              className={`voice-tab${active === t.key ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  )
}
