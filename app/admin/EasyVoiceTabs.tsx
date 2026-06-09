'use client'

import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'

// Shared sub-nav for the admin Easy Voice area — the merged home of the
// former Board, Voice (meetings/votes), Roles, and Contact admin sections. One
// tap between Meetings, Votes, Board, Roles, and Contact. Rendered at the top
// of each of those pages so they read as tabs of a single section.
// 'roster' is retired — the owner roster + magic-link invites now live in
// Easy Track → Residents. The type keeps it so the redirect stub still compiles.
// Roles & permissions moved here from Easy Track — they sit next to Board.
export type EasyVoiceTab = 'meetings' | 'votes' | 'roster' | 'board' | 'roles' | 'contact'

const TABS: { key: EasyVoiceTab; href: string; label: string }[] = [
  { key: 'meetings', href: '/admin/voice',        label: 'Meetings' },
  { key: 'votes',    href: '/admin/voice/votes',  label: 'Votes' },
  { key: 'board',    href: '/admin/board',        label: 'Board' },
  { key: 'roles',    href: '/admin/roles',        label: 'Roles' },
  { key: 'contact',  href: '/admin/requests',     label: 'Contact' },
]

export function EasyVoiceTabs({ active }: { active: EasyVoiceTab }) {
  // The Roles tab only shows to board members who can manage roles. While perms
  // load we keep it visible so it doesn't flash in late for those who have it.
  const { canAny, loading } = usePermissions()
  const tabs = TABS.filter(t => t.key !== 'roles' || loading || canAny(['roles.manage']))
  // Pill segmented look matches the resident sub-tabs (components/SegTabs.tsx).
  // These stay <Link>s — each admin sub-tab is its own route, so navigation
  // already shows one section at a time.
  return (
    <div className="seg-tabs" role="tablist">
      {tabs.map(t => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key}
              className={`seg-tab${active === t.key ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  )
}
