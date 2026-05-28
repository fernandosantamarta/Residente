'use client'

import Link from 'next/link'
import { ReactNode, useMemo, useState } from 'react'
import { useGeneratedReports } from '@/hooks/useGeneratedReports'

// Reports page — board-published reports the resident can browse.
// Featured row, recent log, scheduled queue, plus two small overview
// tiles (financial + maintenance) and a quick-actions / categories
// sidebar.
//
// Data is in-code demo for now; when the reports table is wired,
// swap REPORTS for a real query.

type Category =
  | 'financial' | 'maintenance' | 'operations' | 'community'
  | 'safety' | 'vendor' | 'compliance' | 'board'

const CATEGORY_LABEL: Record<Category, string> = {
  financial:   'Financial',
  maintenance: 'Maintenance',
  operations:  'Operations',
  community:   'Community',
  safety:      'Safety',
  vendor:      'Vendor',
  compliance:  'Compliance',
  board:       'Board',
}

type Report = {
  id: string
  title: string
  category: Category
  date: string
  status: 'published' | 'updated' | 'draft'
  size?: string
  blurb?: string
  featured?: boolean
}

const REPORTS: Report[] = [
  { id: 'r1', title: 'Monthly Financial Summary',  category: 'financial',   date: '2026-05-01', status: 'published', size: '2.1 MB', blurb: 'Income, expenses, reserves.', featured: true },
  { id: 'r2', title: 'Board Meeting Minutes',      category: 'board',       date: '2026-05-15', status: 'published', size: '0.8 MB', blurb: 'Decisions, votes, action items.', featured: true },
  { id: 'r3', title: 'Maintenance Report',         category: 'maintenance', date: '2026-04-28', status: 'published', size: '1.5 MB', blurb: 'Completed jobs and pending tickets.', featured: true },
  { id: 'r4', title: 'Resident Survey',            category: 'community',   date: '2026-05-25', status: 'updated',   size: '0.6 MB', blurb: 'Quarterly satisfaction pulse.', featured: true },

  { id: 'r5', title: 'Reserve Study Summary',      category: 'financial',   date: '2026-05-12', status: 'published', size: '3.0 MB' },
  { id: 'r6', title: 'Delinquency Report',         category: 'financial',   date: '2026-05-10', status: 'published', size: '0.5 MB' },
  { id: 'r7', title: 'Amenity Usage Report',       category: 'operations',  date: '2026-05-05', status: 'published', size: '1.1 MB' },
  { id: 'r8', title: 'Vendor Performance Report',  category: 'vendor',      date: '2026-05-03', status: 'published', size: '0.9 MB' },

  { id: 'r9',  title: 'Insurance Audit',           category: 'compliance',  date: '2026-04-22', status: 'published', size: '1.7 MB' },
  { id: 'r10', title: 'Fire Drill Report',         category: 'safety',      date: '2026-04-18', status: 'published', size: '0.4 MB' },
]

const SCHEDULED = [
  { id: 's1', title: 'Monthly Financial Summary', category: 'financial' as Category,   cadence: 'Monthly · 1st',  next: '2026-06-01' },
  { id: 's2', title: 'Maintenance Status Report', category: 'maintenance' as Category, cadence: 'Weekly · Mon',  next: '2026-06-02' },
  { id: 's3', title: 'Delinquency Roll-Up',       category: 'financial' as Category,   cadence: 'Monthly · 5th',  next: '2026-06-05' },
  { id: 's4', title: 'Vendor Performance',        category: 'vendor' as Category,      cadence: 'Quarterly',      next: '2026-07-01' },
]

const CATEGORY_GRID: { key: Category; icon: CatIconName }[] = [
  { key: 'financial',   icon: 'finance' },
  { key: 'maintenance', icon: 'wrench' },
  { key: 'operations',  icon: 'ops' },
  { key: 'community',   icon: 'people' },
  { key: 'safety',      icon: 'shield' },
  { key: 'vendor',      icon: 'truck' },
  { key: 'compliance',  icon: 'doc' },
]

type CatIconName = 'finance' | 'wrench' | 'ops' | 'people' | 'shield' | 'truck' | 'doc' | 'board' | 'pie' | 'survey'

const fmtDate = (iso: string) => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

export default function Reports() {
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<'all' | Category>('all')

  // Auto-generated from the community's own data (Community budget,
  // Residents, Payments, Board decisions) — nothing is hand-published.
  // Falls back to the in-code demo seed when no community is loaded.
  const gen = useGeneratedReports()
  const reports: Report[] = gen.hasData ? (gen.reports as Report[]) : REPORTS

  const counts = useMemo(() => {
    const map: Partial<Record<Category, number>> = {}
    for (const r of reports) map[r.category] = (map[r.category] || 0) + 1
    return map
  }, [reports])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter(r => {
      if (active !== 'all' && r.category !== active) return false
      if (!q) return true
      return (r.title + ' ' + (r.blurb || '') + ' ' + CATEGORY_LABEL[r.category]).toLowerCase().includes(q)
    }).sort((a, b) => b.date.localeCompare(a.date))
  }, [search, active, reports])

  const featured = filtered.filter(r => r.featured).slice(0, 4)
  const recent = filtered.filter(r => !r.featured).slice(0, 5)

  // Financial Overview pie — real budget categories when a community is
  // loaded, else a demo allocation that reads clean on the chart.
  const DEMO_FIN_SEGMENTS: { label: string; amount: number; color: string }[] = [
    { label: 'Operating Expenses', amount: 48000, color: '#E14909' },
    { label: 'Reserve Funds',      amount: 18000, color: '#0A2440' },
    { label: 'Marketing',          amount:  6500, color: '#C76F45' },
    { label: 'Misc',               amount:  3500, color: '#7D8C5C' },
  ]
  const useReal = gen.hasData && gen.finance.segments.length > 0
  const FIN_SEGMENTS = useReal ? gen.finance.segments : DEMO_FIN_SEGMENTS
  const FIN_TOTAL = useReal ? gen.finance.total : DEMO_FIN_SEGMENTS.reduce((s, x) => s + x.amount, 0)

  // Dues Collection tile — real aggregates from Residents + Payments, demo otherwise.
  const DEMO_DUES = { collected: 48000, outstanding: 6500, paid: 150, due: 12, late: 4, households: 166, rate: 88 }
  const dues = gen.hasData ? gen.dues : DEMO_DUES

  return (
    <div className="rep-wrap">
      <section className="rep-hero">
        <div className="rep-hero-content">
          <h1 className="rep-hero-title">Reports</h1>
          <div className="rep-hero-sub">
            Stay informed with community updates, financials, and operational reports.
          </div>
        </div>
      </section>

      <div className="rep-toolbar">
        <div className="rep-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <input
            name="report-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reports…"
          />
        </div>
        <select name="report-category" className="rep-select" value={active}
          onChange={e => setActive(e.target.value as any)}>
          <option value="all">All Categories</option>
          {CATEGORY_GRID.map(c => (
            <option key={c.key} value={c.key}>{CATEGORY_LABEL[c.key]}</option>
          ))}
        </select>
      </div>

      <div className="rep-grid">
        {/* MAIN COLUMN */}
        <div className="rep-col">
          {/* Featured Reports */}
          <section className="rep-card">
            <div className="rep-card-head">
              <h2 className="rep-card-title">Featured Reports</h2>
              <Link href="#" className="rep-card-link">View all</Link>
            </div>
            <div className="rep-featured">
              {featured.map(r => (
                <a key={r.id} href="#" className="rep-fcard">
                  <span className={`rep-fcard-icon rep-fc-${r.category}`}>
                    {categoryIcon(r.category)}
                  </span>
                  <span className={`rep-fcard-tag rep-tag-${r.category}`}>{CATEGORY_LABEL[r.category]}</span>
                  <span className="rep-fcard-title">{r.title}</span>
                  {r.blurb && <span className="rep-fcard-blurb">{r.blurb}</span>}
                  <span className="rep-fcard-meta">
                    {r.status === 'updated' ? `Updated ${fmtDate(r.date)}` : fmtDate(r.date)}
                    {r.size && <> &middot; PDF · {r.size}</>}
                  </span>
                </a>
              ))}
            </div>
          </section>

          {/* Recent Reports table */}
          <section className="rep-card">
            <div className="rep-card-head">
              <h2 className="rep-card-title">Recent Reports</h2>
              <Link href="#" className="rep-card-link">View all</Link>
            </div>
            <div className="rep-table">
              <div className="rep-row rep-row-head">
                <span>Report</span>
                <span>Category</span>
                <span>Date</span>
                <span>Status</span>
                <span></span>
              </div>
              {recent.length === 0 ? (
                <div className="rep-empty">No reports match these filters.</div>
              ) : (
                recent.map(r => (
                  <div key={r.id} className="rep-row">
                    <span className="rep-row-title">{r.title}</span>
                    <span><span className={`rep-tag rep-tag-${r.category}`}>{CATEGORY_LABEL[r.category]}</span></span>
                    <span className="rep-row-date">{fmtDate(r.date)}</span>
                    <span><StatusPill kind={r.status} /></span>
                    <a href="#" className="rep-row-action">View</a>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Overview row — Financial pie + Maintenance counters */}
          <div className="rep-overview-row">
            <section className="rep-card rep-overview">
              <div className="rep-card-head">
                <h3 className="rep-tile-title">Financial Overview</h3>
                <span className="rep-tile-meta">May 2026</span>
              </div>
              <div className="rep-fin-body">
                <PieChart segments={FIN_SEGMENTS} total={FIN_TOTAL} />
                <ul className="rep-fin-legend">
                  {FIN_SEGMENTS.map(s => (
                    <li key={s.label}>
                      <span className="rep-fin-dot" style={{ background: s.color }} aria-hidden="true" />
                      <span className="rep-fin-label">{s.label}</span>
                      <span className="rep-fin-amt">${s.amount.toLocaleString('en-US')}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Link href="#" className="rep-cta-link">View Detailed Report &rarr;</Link>
            </section>

            <section className="rep-card rep-overview">
              <div className="rep-card-head">
                <h3 className="rep-tile-title">Dues Collection</h3>
                <span className="rep-tile-meta">{dues.rate}% collected</span>
              </div>
              <div className="rep-maint">
                <div className="rep-maint-stat rep-maint-done">
                  <div className="rep-maint-n">{dues.paid}</div>
                  <div className="rep-maint-l">Paid</div>
                </div>
                <div className="rep-maint-stat rep-maint-pend">
                  <div className="rep-maint-n">{dues.due}</div>
                  <div className="rep-maint-l">Due</div>
                </div>
                <div className="rep-maint-stat rep-maint-total">
                  <div className="rep-maint-n">{dues.late}</div>
                  <div className="rep-maint-l">Late</div>
                </div>
              </div>
              <Link href="/app/pay" className="rep-cta-link">Go to dues &amp; payments &rarr;</Link>
            </section>
          </div>

          {/* Scheduled Reports — demo only. Live reports refresh automatically
              from the community's data, so there's nothing to schedule. */}
          {!gen.hasData ? (
            <section className="rep-card">
              <div className="rep-card-head">
                <h2 className="rep-card-title">Scheduled Reports</h2>
                <Link href="#" className="rep-card-link">Manage Scheduled Reports</Link>
              </div>
              <div className="rep-table">
                <div className="rep-row rep-row-head rep-row-sched">
                  <span>Report</span>
                  <span>Category</span>
                  <span>Cadence</span>
                  <span>Next run</span>
                  <span></span>
                </div>
                {SCHEDULED.map(s => (
                  <div key={s.id} className="rep-row rep-row-sched">
                    <span className="rep-row-title">{s.title}</span>
                    <span><span className={`rep-tag rep-tag-${s.category}`}>{CATEGORY_LABEL[s.category]}</span></span>
                    <span className="rep-row-date">{s.cadence}</span>
                    <span className="rep-row-date">{fmtDate(s.next)}</span>
                    <a href="#" className="rep-row-action">Edit</a>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="rep-card">
              <div className="rep-card-head">
                <h2 className="rep-card-title">Always current</h2>
              </div>
              <p className="rep-fcard-blurb" style={{ padding: '4px 2px 2px' }}>
                These reports are generated live from your community&rsquo;s budget,
                residents, payments, and board activity — they refresh on their own,
                nothing to schedule or upload.
              </p>
            </section>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="rep-aside">
          <section className="rep-card rep-tile-tight">
            <h3 className="rep-tile-title">Quick Actions</h3>
            <div className="rep-quick">
              <QuickRow icon={<IconPlus />}
                title="Request a Report"
                desc="Ask the board for a custom one-off."
                onClick={() => alert('Report-request form will open here.')} />
              <QuickRow icon={<IconCalendar />}
                title="Schedule a Report"
                desc="Set up recurring reports on a cadence."
                onClick={() => alert('Scheduling editor will open here.')} />
              <QuickRow icon={<IconCog />}
                title="Reports Settings"
                desc="Who receives what, and when."
                href="/app/settings" />
              <QuickRow icon={<IconBell />}
                title="Notifications"
                desc="Get pinged when a new report drops."
                href="/app/settings" />
            </div>
          </section>

          <section className="rep-card rep-tile-tight">
            <h3 className="rep-tile-title">Report Categories</h3>
            <ul className="rep-cats">
              <li>
                <button type="button" className={`rep-cat-row${active === 'all' ? ' on' : ''}`}
                  onClick={() => setActive('all')}>
                  <span className="rep-cat-icon">{categoryIcon('all' as any)}</span>
                  <span className="rep-cat-label">All Reports</span>
                  <span className="rep-cat-count">{reports.length}</span>
                </button>
              </li>
              {CATEGORY_GRID.map(c => (
                <li key={c.key}>
                  <button type="button" className={`rep-cat-row${active === c.key ? ' on' : ''}`}
                    onClick={() => setActive(c.key)}>
                    <span className={`rep-cat-icon rep-cat-icon-${c.key}`}>{categoryIcon(c.key)}</span>
                    <span className="rep-cat-label">{CATEGORY_LABEL[c.key]}</span>
                    <span className="rep-cat-count">{counts[c.key] || 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

// -- sub-components ------------------------------------------------

function StatusPill({ kind }: { kind: Report['status'] }) {
  const cls = kind === 'published' ? 'rep-pill-pub'
            : kind === 'updated' ? 'rep-pill-upd'
            : 'rep-pill-draft'
  const label = kind === 'published' ? 'Published' : kind === 'updated' ? 'Updated' : 'Draft'
  return <span className={`rep-pill ${cls}`}>{label}</span>
}

function QuickRow({
  icon, title, desc, href, onClick,
}: {
  icon: ReactNode; title: string; desc: string; href?: string; onClick?: () => void
}) {
  const inner = (
    <>
      <span className="rep-quick-icon">{icon}</span>
      <span className="rep-quick-body">
        <span className="rep-quick-title">{title}</span>
        <span className="rep-quick-desc">{desc}</span>
      </span>
      <svg className="rep-quick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </>
  )
  return href
    ? <Link href={href} className="rep-quick-row">{inner}</Link>
    : <button type="button" className="rep-quick-row" onClick={onClick}>{inner}</button>
}

// Donut chart — single SVG, cumulative arc segments. Center hole
// shows the total. Pure SVG, no chart library.
function PieChart({
  segments, total,
}: {
  segments: { label: string; amount: number; color: string }[]
  total: number
}) {
  const size = 140
  const radius = 56
  const stroke = 22
  const c = 2 * Math.PI * radius
  let cumulative = 0
  return (
    <svg className="rep-pie" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(15, 28, 46, 0.06)" strokeWidth={stroke} />
      {segments.map((s, i) => {
        const frac = s.amount / total
        const dasharray = `${frac * c} ${c}`
        const dashoffset = -cumulative * c
        cumulative += frac
        return (
          <circle key={i}
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={dasharray}
            strokeDashoffset={dashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )
      })}
      <text x={size / 2} y={size / 2 - 4} textAnchor="middle"
        fontSize="11" fill="#0A2440" fontWeight="700" letterSpacing="1.2">
        TOTAL
      </text>
      <text x={size / 2} y={size / 2 + 14} textAnchor="middle"
        fontSize="16" fill="#0A2440" fontWeight="700" fontFamily="Fraunces, Georgia, serif">
        ${(total / 1000).toFixed(1)}k
      </text>
    </svg>
  )
}

// -- icons ---------------------------------------------------------

function categoryIcon(c: Category | 'all'): ReactNode {
  switch (c) {
    case 'all':         return <Svg><><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/></></Svg>
    case 'financial':   return <Svg><><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3M14 15h3"/></></Svg>
    case 'maintenance': return <Svg><><path d="M14 6 19 1l4 4-5 5z" /><path d="m17 4-9 9-4 4 1 1 4-4 9-9"/></></Svg>
    case 'operations':  return <Svg><><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></></Svg>
    case 'community':   return <Svg><><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M15 19c0-2 2-3.5 4-3.5s3 1.2 3 3"/></></Svg>
    case 'safety':      return <Svg><><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></></Svg>
    case 'vendor':      return <Svg><><path d="M3 7h18l-1.4 11.2A2 2 0 0 1 17.6 20H6.4a2 2 0 0 1-2-1.8z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></></Svg>
    case 'compliance':  return <Svg><><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14l2 2 4-4"/></></Svg>
    case 'board':       return <Svg><><path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-6h4v6"/></></Svg>
  }
}

function IconPlus()     { return <Svg><><path d="M12 5v14M5 12h14"/></></Svg> }
function IconCalendar() { return <Svg><><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></></Svg> }
function IconCog()      { return <Svg><><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></></Svg> }
function IconBell()     { return <Svg><><path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 19a2 2 0 0 0 4 0"/></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
