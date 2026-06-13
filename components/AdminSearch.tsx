'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { usePermissions } from '@/hooks/usePermissions'
import type { Permission } from '@/lib/permissions'
import { sectionSlug } from '@/lib/sectionSlug'
import { useT } from '@/lib/i18n'

// English label/group → i18n key suffix (camelCase). The data arrays keep their
// English labels (used for the section-slug hrefs + keyword matching); display
// text is looked up as adminSearch.l.<sk> / adminSearch.g.<sk>.
const sk = (s: string) =>
  s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ')
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')

// Permission groups mirror the nav's per-tab `anyPerm` (app/admin/layout.tsx):
// a destination shows only if the user's role grants at least one. Sub-pages
// inherit their parent hub's group, matching how the nav gates each hub.
const P = {
  community:  ['community.manage'] as Permission[],
  compliance: ['compliance.manage', 'financials.view', 'payments.view', 'violations.manage'] as Permission[],
  budget:     ['community.manage', 'financials.view'] as Permission[],
  reports:    ['financials.view', 'payments.view'] as Permission[],
  track:      ['residents.view', 'residents.manage'] as Permission[],
  voice:      ['voice.manage', 'roles.manage'] as Permission[],
  docs:       ['documents.manage', 'violations.manage'] as Permission[],
  schedule:   ['schedule.manage'] as Permission[],
}

// Flat index of every admin destination — top-level tabs plus the sub-pages
// buried inside the hubs (Compliance workspaces, Easy Track / Voice / Documents
// sub-tabs). `keywords` widens matching beyond the visible label so e.g. "lien"
// finds Collections and "reserves" finds Financial reporting. `perm` is the
// role gate — omitted means always visible (Overview).
type Dest = { label: string; href: string; group: string; keywords?: string; perm?: Permission[] }

const DESTINATIONS: Dest[] = [
  // Top-level
  { label: 'Overview', href: '/admin', group: 'Admin', keywords: 'home dashboard welcome' },
  { label: 'Community settings', href: '/admin/community', group: 'Admin', keywords: 'dues compliance association details danger zone', perm: P.community },
  { label: 'Compliance dashboard', href: '/admin/compliance', group: 'Admin', keywords: 'statutory florida clocks', perm: P.compliance },
  { label: 'Budget', href: '/admin/budget', group: 'Admin', keywords: 'operating budget categories bank expenses', perm: P.budget },
  { label: 'Reports', href: '/admin/reports', group: 'Admin', keywords: 'financial collections who behind', perm: P.reports },
  { label: 'Easy Track', href: '/admin/residents', group: 'Easy Track', keywords: 'residents roster owners', perm: P.track },
  { label: 'Easy Voice', href: '/admin/board', group: 'Easy Voice', keywords: 'board meetings roster contact', perm: P.voice },
  { label: 'Easy Documents', href: '/admin/documents', group: 'Easy Documents', keywords: 'rules documents violations rule book', perm: P.docs },
  { label: 'Easy Schedule', href: '/admin/schedule', group: 'Easy Schedule', keywords: 'community calendar events amenities', perm: P.schedule },

  // Compliance workspaces
  { label: 'Collections & liens', href: '/admin/collections', group: 'Compliance', keywords: 'delinquent late assessment intent lien foreclosure', perm: P.compliance },
  { label: 'Estoppel certificates', href: '/admin/estoppel', group: 'Compliance', keywords: 'closing payoff fee delivery clock', perm: P.compliance },
  { label: 'Financial reporting & reserves', href: '/admin/financials', group: 'Compliance', keywords: 'audit annual report budget reserve funding', perm: P.compliance },
  { label: 'Procurement & contracts', href: '/admin/contracts', group: 'Compliance', keywords: 'bids vendors management agreement', perm: P.compliance },
  { label: 'Directors & management', href: '/admin/governance', group: 'Compliance', keywords: 'term limits certification conflict cam licensing', perm: P.compliance },
  { label: 'Meetings & notice', href: '/admin/meetings', group: 'Compliance', keywords: 'agenda minutes notice clock 48 hour 14 day', perm: P.compliance },
  { label: 'Elections & recall', href: '/admin/elections', group: 'Compliance', keywords: 'ballot quorum recall timeline', perm: P.compliance },
  { label: 'Violations, fines & hearings', href: '/admin/enforcement', group: 'Compliance', keywords: 'fine committee hearing suspension', perm: P.compliance },
  { label: 'Structural integrity', href: '/admin/structural', group: 'Compliance', keywords: 'milestone inspection sirs condo building', perm: P.compliance },
  { label: 'Architectural review', href: '/admin/arc', group: 'Compliance', keywords: 'arc request alteration approval', perm: P.compliance },
  { label: 'Official records', href: '/admin/documents#documents', group: 'Compliance', keywords: 'retention records inspection request', perm: P.compliance },
  { label: 'Insurance', href: '/admin/insurance', group: 'Compliance', keywords: 'appraisal replacement cost fidelity bond', perm: P.compliance },
  { label: 'Advisories & event clocks', href: '/admin/advisories', group: 'Compliance', keywords: 'turnover receivership proxy petition', perm: P.compliance },

  // Easy Track
  { label: 'Residents', href: '/admin/residents', group: 'Easy Track', keywords: 'roster owners units import', perm: P.track },
  { label: 'Trusted vendors', href: '/admin/vendor', group: 'Easy Track', keywords: 'vendors contractors guidelines', perm: P.track },

  // Easy Voice
  { label: 'Board', href: '/admin/board', group: 'Easy Voice', keywords: 'members roles decisions committee', perm: P.voice },
  { label: 'Meetings', href: '/admin/voice', group: 'Easy Voice', keywords: 'agenda minutes notify', perm: P.voice },
  { label: 'Contact', href: '/admin/requests', group: 'Easy Voice', keywords: 'requests messages residents', perm: P.voice },

  // Easy Documents
  { label: 'Documents', href: '/admin/documents#documents', group: 'Easy Documents', keywords: 'archive upload governing docs', perm: P.docs },
  { label: 'Rules', href: '/admin/documents#rules', group: 'Easy Documents', keywords: 'rule book guidelines', perm: P.docs },
  { label: 'Violations', href: '/admin/violations', group: 'Easy Documents', keywords: 'fines enforcement notices', perm: P.docs },
]

// In-page sections — search jumps straight to the card, not just the page. The
// href hash is the heading's slug; SectionScroll matches it to the rendered
// heading text on arrival. `group` names the page the section lives on so the
// result's right-side tag reads e.g. "Budget". Keep labels matching the actual
// <h2> text (decoded) so sectionSlug() lines up on both ends.
const sec = (label: string, route: string, group: string, perm?: Permission[], keywords?: string): Dest =>
  ({ label, href: `${route}#${sectionSlug(label)}`, group, perm, keywords })

const SECTIONS: Dest[] = [
  // Community
  sec('Association details', '/admin/community', 'Community', P.community, 'name location type fiscal'),
  sec('Monthly dues', '/admin/community', 'Community', P.community, 'per home billed'),
  sec('Billing & compliance', '/admin/community', 'Community', P.community, 'interest late fee lien officer address'),

  // Budget
  sec('Annual operating budget', '/admin/budget', 'Budget', P.budget, 'headline figure'),
  sec('Budget vs actual', '/admin/budget', 'Budget', P.budget, 'plaid tracking'),
  sec('Budget categories', '/admin/budget', 'Budget', P.budget, 'lines allocations'),
  sec('Expense ledger', '/admin/budget', 'Budget', P.budget, 'expenses spend manual log entries'),

  // Reports
  sec('Available reports', '/admin/reports', 'Reports', P.reports, 'export download'),
  sec('Collections snapshot', '/admin/reports', 'Reports', P.reports, 'delinquency'),
  sec("Who's behind on payments", '/admin/reports', 'Reports', P.reports, 'delinquent owners aging'),

  // Compliance hub
  sec('Needs attention', '/admin/compliance', 'Compliance', P.compliance, 'alerts deadlines clocks'),
  sec('Workspaces', '/admin/compliance', 'Compliance', P.compliance, 'sections'),

  // Compliance workspaces — inner sections
  sec('Open a case', '/admin/collections', 'Collections', P.compliance, 'new delinquent'),
  sec('Open cases', '/admin/collections', 'Collections', P.compliance, 'active ladder'),
  sec('Competitive-bid threshold', '/admin/contracts', 'Contracts', P.compliance, 'bids percent'),
  sec('Record a contract', '/admin/contracts', 'Contracts', P.compliance, 'vendor agreement'),
  sec('Schedule an election', '/admin/elections', 'Elections', P.compliance, 'ballot timeline'),
  sec('Log a recall served on the board', '/admin/elections', 'Elections', P.compliance, 'recall'),
  sec('Independent fining committee', '/admin/enforcement', 'Enforcement', P.compliance, 'fines hearing'),
  sec('Propose a fine', '/admin/enforcement', 'Enforcement', P.compliance, 'violation penalty'),
  sec('New request', '/admin/estoppel', 'Estoppel', P.compliance, 'certificate closing'),
  sec('Collect payments', '/admin/financials', 'Financials', P.compliance, 'dues stripe'),
  sec('Compliance filings', '/admin/financials', 'Financials', P.compliance, 'annual report'),
  sec('Financial settings', '/admin/financials', 'Financials', P.compliance, 'audit reserves'),
  sec('Conflicts of interest', '/admin/governance', 'Governance', P.compliance, 'directors disclosure'),
  sec('Schedule / log a meeting', '/admin/meetings', 'Meetings', P.compliance, 'notice agenda minutes'),
  sec('Add a building', '/admin/structural', 'Structural', P.compliance, 'milestone sirs'),
  sec('DBPR (Division) filings', '/admin/structural', 'Structural', P.compliance, 'division filing'),
  sec('Record an assessment', '/admin/structural', 'Structural', P.compliance, 'inspection report'),

  // Easy Track
  sec('Import your roster', '/admin/residents', 'Easy Track', P.track, 'paste csv owners units'),
  sec('Add a vendor', '/admin/vendor', 'Easy Track', P.track, 'contractor'),
  sec('Vendor guidelines', '/admin/vendor', 'Easy Track', P.track, 'rules'),
  sec('Vendor list', '/admin/vendor', 'Easy Track', P.track, 'directory'),

  // Easy Voice
  sec('Board members', '/admin/board', 'Easy Voice', P.voice, 'directors roles'),
  sec('Committees', '/admin/board', 'Easy Voice', P.voice, 'committee assignment'),
  sec('Decision feed', '/admin/board', 'Easy Voice', P.voice, 'log history'),
  sec('Log a decision', '/admin/board', 'Easy Voice', P.voice, 'vote record'),
  sec('All meetings', '/admin/voice', 'Easy Voice', P.voice, 'agenda minutes'),
  sec('Meeting settings', '/admin/voice', 'Easy Voice', P.voice, 'config'),
  sec('Meeting documents', '/admin/voice', 'Easy Voice', P.voice, 'packet attachments'),
  sec('Notice history', '/admin/voice', 'Easy Voice', P.voice, 'sent notices'),
  sec('Send a notice to all residents', '/admin/voice', 'Easy Voice', P.voice, 'broadcast announcement'),
  sec('Queue', '/admin/requests', 'Easy Voice', P.voice, 'contact messages requests'),

  // Easy Documents
  sec('Archive', '/admin/documents', 'Easy Documents', P.docs, 'uploaded files'),
  sec('Florida compliance', '/admin/documents', 'Easy Documents', P.docs, 'required posting'),
  sec('Records-inspection requests', '/admin/documents', 'Easy Documents', P.docs, 'owner request'),
  sec('Rule book', '/admin/documents', 'Easy Documents', P.docs, 'rules guidelines'),
  sec('Violation log', '/admin/violations', 'Easy Documents', P.docs, 'fines notices'),

  // Easy Schedule
  sec('Add an event', '/admin/schedule', 'Easy Schedule', P.schedule, 'calendar new'),
  sec("Events you've added", '/admin/schedule', 'Easy Schedule', P.schedule, 'list calendar'),
  sec('Bulk upload', '/admin/schedule', 'Easy Schedule', P.schedule, 'import csv'),
  sec('Your amenities', '/admin/schedule', 'Easy Schedule', P.schedule, 'pool clubhouse'),
  sec('Reservations', '/admin/schedule', 'Easy Schedule', P.schedule, 'bookings'),
  sec('Book for a resident', '/admin/schedule', 'Easy Schedule', P.schedule, 'reserve amenity'),

  // Account
  sec('Manage subscription', '/admin/billing', 'Billing', P.community, 'plan payment invoice'),
  sec('Send us a message', '/admin/support', 'Support', undefined, 'contact help'),
  sec('Your messages', '/admin/support', 'Support', undefined, 'support thread'),
]

const ALL: Dest[] = [...DESTINATIONS, ...SECTIONS]

const SearchIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </svg>
)

export function AdminSearch() {
  const router = useRouter()
  const t = useT()
  const trLabel = (d: Dest) => t('adminSearch.l.' + sk(d.label))
  const trGroup = (d: Dest) => t('adminSearch.g.' + sk(d.group))
  const { canAny, loading: permLoading } = usePermissions()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Only surface pages the user's role can reach — same gate the nav tabs use.
  // While perms load we hold results back rather than flashing forbidden pages
  // (a navigable result the user can't open is worse than a brief empty list).
  const visible = useMemo(
    () => (permLoading ? [] : ALL.filter(d => !d.perm || canAny(d.perm))),
    [permLoading, canAny],
  )

  // Global keys: ⌘K/Ctrl+K toggles, Esc closes, and — the type-to-search bit —
  // any bare letter or number opens the palette seeded with that character, so
  // you can just start typing. Skipped when a modifier is held or focus is
  // already in a field, so it never hijacks real typing or other shortcuts.
  useEffect(() => {
    const typingInField = () => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) setOpen(false)
        else { setQ(''); setOpen(true) }
        return
      }
      if (e.key === 'Escape') { setOpen(false); return }
      if (!open && !e.metaKey && !e.ctrlKey && !e.altKey && /^[a-z0-9]$/i.test(e.key) && !typingInField()) {
        e.preventDefault()
        setQ(e.key)
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Reset the highlighted row and focus the input each time it opens. The query
  // is seeded by whatever opened it (cleared for the icon/⌘K, set to the typed
  // character for type-to-search), so it's intentionally not reset here.
  useEffect(() => {
    if (open) { setActive(0); const t = setTimeout(() => inputRef.current?.focus(), 20); return () => clearTimeout(t) }
  }, [open])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return visible
    // Match the translated label/group AND the English label/group/keywords, so
    // search works whether the user types in their language or English.
    return visible.filter(d =>
      `${trLabel(d)} ${trGroup(d)} ${d.label} ${d.group} ${d.keywords ?? ''}`.toLowerCase().includes(term))
  }, [q, visible, t])

  useEffect(() => { setActive(0) }, [q])

  const go = (d?: Dest) => {
    const dest = d ?? results[active]
    if (!dest) return
    setOpen(false)
    router.push(dest.href)
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go() }
  }

  return (
    <>
      <button type="button" className="admin-nav-search-btn" aria-label={t('adminSearch.searchAdmin')} onClick={() => { setQ(''); setOpen(true) }}>
        <SearchIcon />
      </button>

      {open && (
        <div className="admin-search-overlay" onMouseDown={() => setOpen(false)}>
          <div className="admin-search-panel" role="dialog" aria-label={t('adminSearch.searchAdmin')} onMouseDown={e => e.stopPropagation()}>
            <div className="admin-search-input-row">
              <SearchIcon />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder={t('adminSearch.placeholder')}
                aria-label={t('adminSearch.searchPages')}
              />
              <kbd className="admin-search-kbd">esc</kbd>
            </div>
            <div className="admin-search-results">
              {results.length === 0 && <div className="admin-search-empty">{t('adminSearch.noMatch', { q })}</div>}
              {results.map((d, i) => (
                <button
                  key={`${d.href}-${d.label}`}
                  type="button"
                  className={`admin-search-item${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(d)}
                >
                  <span className="admin-search-item-label">{trLabel(d)}</span>
                  <span className="admin-search-item-group">{trGroup(d)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
