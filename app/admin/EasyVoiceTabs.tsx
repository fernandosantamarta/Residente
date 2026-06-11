'use client'

import Link from 'next/link'
import { useAwaitingMessages, useArcPending } from '@/hooks/useAwaitingMessages'

// Shared sub-nav for the admin Easy Voice area — the merged home of the former
// Board+Roles, Voice (meetings/votes), and Contact admin sections. Board leads.
// 'roster' is retired (owner roster moved to Easy Track → Residents) and 'roles'
// is retired (merged into the Board page); both stay in the type so their
// redirect stubs still compile.
export type EasyVoiceTab = 'meetings' | 'votes' | 'roster' | 'board' | 'roles' | 'contact' | 'architectural'

const TABS: { key: EasyVoiceTab; href: string; label: string }[] = [
  { key: 'board',         href: '/admin/board',        label: 'Board' },
  { key: 'meetings',      href: '/admin/voice',        label: 'Meetings' },
  { key: 'votes',         href: '/admin/voice/votes',  label: 'Votes' },
  { key: 'architectural', href: '/admin/arc',          label: 'Architectural' },
  { key: 'contact',       href: '/admin/requests',     label: 'Contact' },
]

export function EasyVoiceTabs({ active }: { active: EasyVoiceTab }) {
  // Pill segmented look matches the resident sub-tabs (components/SegTabs.tsx).
  // These stay <Link>s — each admin sub-tab is its own route, so navigation
  // already shows one section at a time. The Contact tab carries a live count of
  // messages awaiting the board's reply, so you know where to go.
  const awaiting = useAwaitingMessages()
  const arcPending = useArcPending()
  const badgeFor = (key: EasyVoiceTab): { n: number; title: string } | null => {
    if (key === 'contact' && awaiting > 0) return { n: awaiting, title: `${awaiting} message${awaiting === 1 ? '' : 's'} awaiting your reply` }
    if (key === 'architectural' && arcPending > 0) return { n: arcPending, title: `${arcPending} ARC request${arcPending === 1 ? '' : 's'} awaiting a decision` }
    return null
  }
  return (
    <div className="seg-tabs admin-seg-tabs" role="tablist">
      {TABS.map(t => {
        const badge = badgeFor(t.key)
        return (
          <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key}
                className={`seg-tab${active === t.key ? ' active' : ''}`}>
            {t.label}
            {badge && <span className="admin-nav-badge" title={badge.title}>{badge.n}</span>}
          </Link>
        )
      })}
    </div>
  )
}
