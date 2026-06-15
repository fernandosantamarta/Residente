'use client'

import Link from 'next/link'
import { useAwaitingMessages, useArcPending } from '@/hooks/useAwaitingMessages'
import { useT } from '@/lib/i18n'

// Shared sub-nav for the admin Easy Voice area — the merged home of the former
// Board+Roles, Voice (meetings/votes), and Contact admin sections. Board leads.
// 'roster' is retired (owner roster moved to Easy Track → Residents) and 'roles'
// is retired (merged into the Board page); both stay in the type so their
// redirect stubs still compile.
export type EasyVoiceTab = 'meetings' | 'votes' | 'roster' | 'board' | 'roles' | 'contact' | 'architectural'

const TABS: { key: EasyVoiceTab; href: string; labelKey: string }[] = [
  { key: 'board',         href: '/admin/board',        labelKey: 'admin.easyVoiceTabs.tabBoard' },
  { key: 'meetings',      href: '/admin/voice',        labelKey: 'admin.easyVoiceTabs.tabMeetings' },
  { key: 'votes',         href: '/admin/voice/votes',  labelKey: 'admin.easyVoiceTabs.tabVotes' },
  { key: 'architectural', href: '/admin/arc',          labelKey: 'admin.easyVoiceTabs.tabArchitectural' },
  { key: 'contact',       href: '/admin/requests',     labelKey: 'admin.easyVoiceTabs.tabContact' },
]

export function EasyVoiceTabs({ active }: { active: EasyVoiceTab }) {
  // Pill segmented look matches the resident sub-tabs (components/SegTabs.tsx).
  // These stay <Link>s — each admin sub-tab is its own route, so navigation
  // already shows one section at a time. The Contact tab carries a live count of
  // messages awaiting the board's reply, so you know where to go.
  const t = useT()
  const awaiting = useAwaitingMessages()
  const arcPending = useArcPending()
  const badgeFor = (key: EasyVoiceTab): { n: number; title: string } | null => {
    if (key === 'contact' && awaiting > 0) return { n: awaiting, title: t('admin.easyVoiceTabs.badgeContactTitle', { count: awaiting }) }
    if (key === 'architectural' && arcPending > 0) return { n: arcPending, title: t('admin.easyVoiceTabs.badgeArcTitle', { count: arcPending }) }
    return null
  }
  return (
    <div className="seg-tabs admin-seg-tabs" role="tablist">
      {TABS.map(tab => {
        const badge = badgeFor(tab.key)
        return (
          <Link key={tab.key} href={tab.href} role="tab" aria-selected={active === tab.key}
                className={`seg-tab${active === tab.key ? ' active' : ''}`}>
            {t(tab.labelKey)}
            {badge && <span className="admin-nav-badge" title={badge.title}>{badge.n}</span>}
          </Link>
        )
      })}
    </div>
  )
}
