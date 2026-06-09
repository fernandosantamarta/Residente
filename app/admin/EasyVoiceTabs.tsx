'use client'

import Link from 'next/link'

// Shared sub-nav for the admin Easy Voice area — the merged home of the former
// Board+Roles, Voice (meetings/votes), and Contact admin sections. Board leads.
// 'roster' is retired (owner roster moved to Easy Track → Residents) and 'roles'
// is retired (merged into the Board page); both stay in the type so their
// redirect stubs still compile.
export type EasyVoiceTab = 'meetings' | 'votes' | 'roster' | 'board' | 'roles' | 'contact'

const TABS: { key: EasyVoiceTab; href: string; label: string }[] = [
  { key: 'board',    href: '/admin/board',        label: 'Board' },
  { key: 'meetings', href: '/admin/voice',        label: 'Meetings' },
  { key: 'votes',    href: '/admin/voice/votes',  label: 'Votes' },
  { key: 'contact',  href: '/admin/requests',     label: 'Contact' },
]

export function EasyVoiceTabs({ active }: { active: EasyVoiceTab }) {
  // Pill segmented look matches the resident sub-tabs (components/SegTabs.tsx).
  // These stay <Link>s — each admin sub-tab is its own route, so navigation
  // already shows one section at a time.
  return (
    <div className="seg-tabs" role="tablist">
      {TABS.map(t => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key}
              className={`seg-tab${active === t.key ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  )
}
