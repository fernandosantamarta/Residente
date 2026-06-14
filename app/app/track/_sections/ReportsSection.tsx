'use client'

import Link from 'next/link'
import { ReactNode, useMemo, useState } from 'react'
import { useGeneratedReports } from '@/hooks/useGeneratedReports'
import { usePublishedReports } from '@/hooks/usePublishedReports'
import { useT } from '@/lib/i18n'
import { RequestDialog } from './RequestDialog'
import { DetailDialog } from './DetailDialog'
import { Dropdown } from '@/components/Dropdown'

// Reports — board-published reports the resident can browse, now a section
// of the Easy Track hub. Featured row, recent log, scheduled queue, plus
// two small overview tiles (financial + maintenance) and a quick-actions /
// categories sidebar.
//
// Data is in-code demo for now; when the reports table is wired,
// swap REPORTS for a real query.

type Category =
  | 'financial' | 'maintenance' | 'operations' | 'community'
  | 'safety' | 'vendor' | 'compliance' | 'board'

type Report = {
  id: string
  title: string
  category: Category
  date: string
  status: 'published' | 'updated' | 'draft'
  size?: string
  blurb?: string
  featured?: boolean
  storagePath?: string   // present on board-published reports with a PDF file
}


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

// Demo fallback — shown ONLY when there's no real community data (e.g. the
// logged-out /app/track?preview=1 demo). A real community always renders its
// own reports/budget/dues; this just lets the page be seen and clicked through.
const DEMO_REPORTS: Report[] = [
  { id: 'r1', title: 'Monthly Financial Summary', category: 'financial',   date: '2026-05-01', status: 'published', size: '2.1 MB', blurb: 'Income, expenses, reserves.', featured: true },
  { id: 'r2', title: 'Board Meeting Minutes',     category: 'board',       date: '2026-05-15', status: 'published', size: '0.8 MB', blurb: 'Decisions, votes, action items.', featured: true },
  { id: 'r3', title: 'Maintenance Report',        category: 'maintenance', date: '2026-04-28', status: 'published', size: '1.5 MB', blurb: 'Completed jobs and pending tickets.', featured: true },
  { id: 'r4', title: 'Resident Survey',           category: 'community',   date: '2026-05-25', status: 'updated',   size: '0.6 MB', blurb: 'Quarterly satisfaction pulse.', featured: true },
  { id: 'r5', title: 'Reserve Study Summary',     category: 'financial',   date: '2026-05-12', status: 'published', size: '3.0 MB' },
  { id: 'r6', title: 'Delinquency Report',        category: 'financial',   date: '2026-05-10', status: 'published', size: '0.5 MB' },
  { id: 'r7', title: 'Amenity Usage Report',      category: 'operations',  date: '2026-05-05', status: 'published', size: '1.1 MB' },
  { id: 'r8', title: 'Vendor Performance Report', category: 'vendor',      date: '2026-05-03', status: 'published', size: '0.9 MB' },
  { id: 'r9', title: 'Insurance Audit',           category: 'compliance',  date: '2026-04-22', status: 'published', size: '1.7 MB' },
  { id: 'r10', title: 'Fire Drill Report',        category: 'safety',      date: '2026-04-18', status: 'published', size: '0.4 MB' },
]
const DEMO_FIN_SEGMENTS = [
  { label: 'Operating Expenses', amount: 48000, color: '#E14909' },
  { label: 'Reserve Funds',      amount: 18000, color: '#0A2440' },
  { label: 'Marketing',          amount:  6500, color: '#C76F45' },
  { label: 'Misc',               amount:  3500, color: '#7D8C5C' },
]
const DEMO_DUES = { collected: 48000, outstanding: 6500, paid: 150, due: 12, late: 4, households: 166, rate: 88 }

export function ReportsSection() {
  const t = useT()
  const catLabel = (k: Category) => t(`vendors.repCat.${k}`)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<'all' | Category>('all')
  const [request, setRequest] = useState<null | 'request' | 'schedule'>(null)
  // Which overview detail (if any) is open in a popup. null = closed.
  const [detail, setDetail] = useState<null | 'financial' | 'dues'>(null)
  // A specific report opened in a popup (click a card/row). null = closed.
  const [openR, setOpenR] = useState<Report | null>(null)
  // "View all" — the full report list in a popup. false = closed.
  const [allOpen, setAllOpen] = useState(false)

  // Two real sources, merged:
  //   - pub: board-published reports from the `reports` table (downloadable PDFs).
  //   - gen: auto-generated summaries from the community's own data (budget,
  //     residents, payments, board decisions) — nothing hand-published.
  // Falls back to the in-code demo seed only when neither has any data
  // (no community linked / Supabase off).
  const gen = useGeneratedReports()
  const pub = usePublishedReports()
  const hasReal = pub.reports.length > 0 || gen.hasData
  // Real community → real reports. No data (preview/demo) → demo seed so the
  // page is populated and every popup can be opened and seen.
  const reports: Report[] = hasReal
    ? [...(pub.reports as Report[]), ...(gen.hasData ? (gen.reports as Report[]) : [])]
    : DEMO_REPORTS

  // Open a report — show its detail in a popup, in place. No page navigation.
  // (Published reports also expose a "Download PDF" action inside the popup.)
  const openReport = (r: Report) => setOpenR(r)

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
      return (r.title + ' ' + (r.blurb || '') + ' ' + catLabel(r.category)).toLowerCase().includes(q)
    }).sort((a, b) => b.date.localeCompare(a.date))
  }, [search, active, reports, t])

  const featured = filtered.filter(r => r.featured).slice(0, 4)
  const recent = filtered.filter(r => !r.featured).slice(0, 5)

  // Financial Overview pie — real budget categories, or empty (the render
  // shows an empty state rather than fabricated numbers).
  const useReal = gen.hasData && gen.finance.segments.length > 0
  const FIN_SEGMENTS = useReal ? gen.finance.segments : DEMO_FIN_SEGMENTS
  const FIN_TOTAL = useReal ? gen.finance.total : DEMO_FIN_SEGMENTS.reduce((s, x) => s + x.amount, 0)

  // Dues Collection — real aggregates from Residents + Payments, demo otherwise.
  const dues = gen.hasData ? gen.dues : DEMO_DUES

  return (
    <section id="reports" className="rep-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">{t('vendors.reportsTitle')}</h2>
        <p className="voice-page-sub">
          {t('vendors.reportsSubtitle')}
        </p>
      </div>

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
            placeholder={t('vendors.reportsSearchPlaceholder')}
          />
        </div>
        <Dropdown<string>
          value={active}
          onChange={v => setActive(v as any)}
          ariaLabel={t('vendors.allCategories')}
          options={[
            { value: 'all', label: t('vendors.allCategories') },
            ...CATEGORY_GRID.map(c => ({ value: c.key, label: catLabel(c.key) })),
          ]}
        />
      </div>

      <div className="rep-grid">
        {/* MAIN COLUMN */}
        <div className="rep-col">
          {/* Featured Reports */}
          <section className="rep-card">
            <div className="rep-card-head">
              <h2 className="rep-card-title">{t('vendors.featuredReports')}</h2>
              <button type="button" className="rep-card-link rep-cta-btn"
                onClick={() => setAllOpen(true)}>{t('vendors.viewAll')}</button>
            </div>
            <div className="rep-featured">
              {featured.map(r => (
                <a key={r.id} href="#" className="rep-fcard"
                  onClick={e => { e.preventDefault(); openReport(r) }}>
                  <span className={`rep-fcard-icon rep-fc-${r.category}`}>
                    {categoryIcon(r.category)}
                  </span>
                  <span className={`rep-fcard-tag rep-tag-${r.category}`}>{catLabel(r.category)}</span>
                  <span className="rep-fcard-title">{r.title}</span>
                  {r.blurb && <span className="rep-fcard-blurb">{r.blurb}</span>}
                  <span className="rep-fcard-meta">
                    {r.status === 'updated' ? t('vendors.updatedDate', { date: fmtDate(r.date) }) : fmtDate(r.date)}
                    {r.size && <> &middot; {t('vendors.pdfSize', { size: r.size })}</>}
                  </span>
                </a>
              ))}
            </div>
          </section>

          {/* Recent Reports table */}
          <section className="rep-card">
            <div className="rep-card-head">
              <h2 className="rep-card-title">{t('vendors.recentReports')}</h2>
              <button type="button" className="rep-card-link rep-cta-btn"
                onClick={() => setAllOpen(true)}>{t('vendors.viewAll')}</button>
            </div>
            <div className="rep-table">
              <div className="rep-row rep-row-head">
                <span>{t('vendors.colReport')}</span>
                <span>{t('vendors.colCategory')}</span>
                <span>{t('vendors.colDate')}</span>
                <span>{t('vendors.colStatus')}</span>
                <span></span>
              </div>
              {recent.length === 0 ? (
                <div className="rep-empty">{t('vendors.noReportsMatch')}</div>
              ) : (
                recent.map(r => (
                  <div key={r.id} className="rep-row">
                    <span className="rep-row-title">{r.title}</span>
                    <span><span className={`rep-tag rep-tag-${r.category}`}>{catLabel(r.category)}</span></span>
                    <span className="rep-row-date">{fmtDate(r.date)}</span>
                    <span><StatusPill kind={r.status} /></span>
                    <a href="#" className="rep-row-action"
                      onClick={e => { e.preventDefault(); openReport(r) }}>
                      {r.storagePath ? t('vendors.download') : t('vendors.view')}
                    </a>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Overview row — Financial pie + Maintenance counters */}
          <div className="rep-overview-row">
            <section className="rep-card rep-overview">
              <div className="rep-card-head">
                <h3 className="rep-tile-title">{t('vendors.financialOverview')}</h3>
                <span className="rep-tile-meta">May 2026</span>
              </div>
              {FIN_SEGMENTS.length === 0 ? (
                <div className="rep-empty">{t('vendors.budgetEmpty')}</div>
              ) : (
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
              )}
              <button type="button" className="rep-cta-link rep-cta-btn"
                onClick={() => setDetail('financial')} disabled={FIN_SEGMENTS.length === 0}>
                {t('vendors.viewDetailedReport')} &rarr;
              </button>
            </section>

            <section className="rep-card rep-overview">
              <div className="rep-card-head">
                <h3 className="rep-tile-title">{t('vendors.duesCollection')}</h3>
                <span className="rep-tile-meta">{t('vendors.pctCollected', { rate: dues.rate })}</span>
              </div>
              <div className="rep-maint">
                <div className="rep-maint-stat rep-maint-done">
                  <div className="rep-maint-n">{dues.paid}</div>
                  <div className="rep-maint-l">{t('vendors.paid')}</div>
                </div>
                <div className="rep-maint-stat rep-maint-pend">
                  <div className="rep-maint-n">{dues.due}</div>
                  <div className="rep-maint-l">{t('vendors.due')}</div>
                </div>
                <div className="rep-maint-stat rep-maint-total">
                  <div className="rep-maint-n">{dues.late}</div>
                  <div className="rep-maint-l">{t('vendors.late')}</div>
                </div>
              </div>
              <button type="button" className="rep-cta-link rep-cta-btn"
                onClick={() => setDetail('dues')}>{t('vendors.viewDetailedReport')} &rarr;</button>
            </section>
          </div>

          {/* Scheduled Reports — demo only. Live reports refresh automatically
              from the community's data, so there's nothing to schedule. */}
          <section className="rep-card">
            <div className="rep-card-head">
              <h2 className="rep-card-title">{t('vendors.alwaysCurrent')}</h2>
            </div>
            <p className="rep-fcard-blurb" style={{ padding: '4px 2px 2px' }}>
              {t('vendors.alwaysCurrentBody')}
            </p>
          </section>
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="rep-aside">
          <section className="rep-card rep-tile-tight">
            <h3 className="rep-tile-title">{t('vendors.quickActions')}</h3>
            <div className="rep-quick">
              <QuickRow icon={<IconPlus />}
                title={t('vendors.requestReport')}
                desc={t('vendors.requestReportDesc')}
                onClick={() => setRequest('request')} />
              <QuickRow icon={<IconCalendar />}
                title={t('vendors.scheduleReport')}
                desc={t('vendors.scheduleReportDesc')}
                onClick={() => setRequest('schedule')} />
              <QuickRow icon={<IconCog />}
                title={t('vendors.reportsSettings')}
                desc={t('vendors.reportsSettingsDesc')}
                href="/app/settings" />
              <QuickRow icon={<IconBell />}
                title={t('vendors.notifications')}
                desc={t('vendors.notificationsDesc')}
                href="/app/settings" />
            </div>
          </section>

          <section className="rep-card rep-tile-tight">
            <h3 className="rep-tile-title">{t('vendors.reportCategories')}</h3>
            <ul className="rep-cats">
              <li>
                <button type="button" className={`rep-cat-row${active === 'all' ? ' on' : ''}`}
                  onClick={() => setActive('all')}>
                  <span className="rep-cat-icon">{categoryIcon('all' as any)}</span>
                  <span className="rep-cat-label">{t('vendors.allReports')}</span>
                  <span className="rep-cat-count">{reports.length}</span>
                </button>
              </li>
              {CATEGORY_GRID.map(c => (
                <li key={c.key}>
                  <button type="button" className={`rep-cat-row${active === c.key ? ' on' : ''}`}
                    onClick={() => setActive(c.key)}>
                    <span className={`rep-cat-icon rep-cat-icon-${c.key}`}>{categoryIcon(c.key)}</span>
                    <span className="rep-cat-label">{catLabel(c.key)}</span>
                    <span className="rep-cat-count">{counts[c.key] || 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {request && (
        <RequestDialog
          eyebrow={t('vendors.reportsTitle')}
          title={request === 'schedule' ? t('vendors.scheduleDialogTitle') : t('vendors.requestReportDialogTitle')}
          defaultSubject={request === 'schedule' ? t('vendors.scheduleSubject') : t('vendors.reportRequestSubject')}
          bodyPlaceholder={request === 'schedule'
            ? t('vendors.scheduleBodyPlaceholder')
            : t('vendors.reportRequestBodyPlaceholder')}
          onClose={() => setRequest(null)}
        />
      )}

      {detail === 'financial' && (
        <DetailDialog
          eyebrow={t('vendors.repCat.financial')}
          title={t('vendors.financialOverview')}
          period="May 2026"
          onClose={() => setDetail(null)}
        >
          <div className="rd-detail-top">
            <PieChart segments={FIN_SEGMENTS} total={FIN_TOTAL} />
            <div className="rd-detail-headline">
              <span className="rd-detail-h-label">{t('vendors.annualBudget')}</span>
              <span className="rd-detail-h-amt">${FIN_TOTAL.toLocaleString('en-US')}</span>
              <span className="rd-detail-h-sub">{FIN_SEGMENTS.length === 1
                ? t('vendors.acrossCategoriesOne', { count: FIN_SEGMENTS.length })
                : t('vendors.acrossCategoriesOther', { count: FIN_SEGMENTS.length })}</span>
            </div>
          </div>

          <div className="rd-bd-table">
            <div className="rd-bd-row rd-bd-head">
              <span>{t('vendors.colCategory')}</span>
              <span>{t('vendors.colAmount')}</span>
              <span>{t('vendors.colShare')}</span>
            </div>
            {FIN_SEGMENTS.map(s => (
              <div className="rd-bd-row" key={s.label}>
                <span className="rd-bd-cat">
                  <span className="rep-fin-dot" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="rd-bd-amt">${s.amount.toLocaleString('en-US')}</span>
                <span className="rd-bd-share">
                  {FIN_TOTAL > 0 ? Math.round((s.amount / FIN_TOTAL) * 100) : 0}%
                </span>
              </div>
            ))}
            <div className="rd-bd-row rd-bd-total">
              <span>{t('vendors.total')}</span>
              <span className="rd-bd-amt">${FIN_TOTAL.toLocaleString('en-US')}</span>
              <span className="rd-bd-share">100%</span>
            </div>
          </div>

          <p className="rd-detail-foot-note">
            {t('vendors.financialFootNote')}
          </p>
        </DetailDialog>
      )}

      {detail === 'dues' && (
        <DetailDialog
          eyebrow={t('vendors.repCat.financial')}
          title={t('vendors.duesCollection')}
          period="May 2026"
          onClose={() => setDetail(null)}
          settingsHref="#pay"
          settingsLabel={t('vendors.goToDuesPayments')}
        >
          <div className="rd-detail-top">
            <div className="rd-detail-headline">
              <span className="rd-detail-h-label">{t('vendors.collectedThisPeriod')}</span>
              <span className="rd-detail-h-amt">${dues.collected.toLocaleString('en-US')}</span>
              <span className="rd-detail-h-sub">{t('vendors.duesCollectedOutstanding', { rate: dues.rate, outstanding: '$' + dues.outstanding.toLocaleString('en-US') })}</span>
            </div>
          </div>

          <div className="rep-maint" style={{ marginBottom: 4 }}>
            <div className="rep-maint-stat rep-maint-done">
              <div className="rep-maint-n">{dues.paid}</div>
              <div className="rep-maint-l">{t('vendors.paid')}</div>
            </div>
            <div className="rep-maint-stat rep-maint-pend">
              <div className="rep-maint-n">{dues.due}</div>
              <div className="rep-maint-l">{t('vendors.due')}</div>
            </div>
            <div className="rep-maint-stat rep-maint-total">
              <div className="rep-maint-n">{dues.late}</div>
              <div className="rep-maint-l">{t('vendors.late')}</div>
            </div>
          </div>

          <div className="rd-bd-table">
            <div className="rd-bd-row"><span className="rd-bd-cat">{t('vendors.households')}</span><span className="rd-bd-amt">{dues.households}</span><span /></div>
            <div className="rd-bd-row"><span className="rd-bd-cat">{t('vendors.collectionRate')}</span><span className="rd-bd-amt">{dues.rate}%</span><span /></div>
            <div className="rd-bd-row"><span className="rd-bd-cat">{t('vendors.collected')}</span><span className="rd-bd-amt">${dues.collected.toLocaleString('en-US')}</span><span /></div>
            <div className="rd-bd-row rd-bd-total"><span>{t('vendors.outstanding')}</span><span className="rd-bd-amt">${dues.outstanding.toLocaleString('en-US')}</span><span /></div>
          </div>

          <p className="rd-detail-foot-note">
            {t('vendors.duesFootNote')}
          </p>
        </DetailDialog>
      )}

      {openR && (
        <DetailDialog
          eyebrow={catLabel(openR.category)}
          title={openR.title}
          period={openR.status === 'updated' ? t('vendors.updatedDate', { date: fmtDate(openR.date) }) : fmtDate(openR.date)}
          onClose={() => setOpenR(null)}
        >
          <div className="rd-report-meta">
            <span className={`rep-tag rep-tag-${openR.category}`}>{catLabel(openR.category)}</span>
            <StatusPill kind={openR.status} />
            {openR.size && <span className="rd-report-size">{t('vendors.pdfSize', { size: openR.size })}</span>}
          </div>
          {openR.blurb && <p className="rd-report-blurb">{openR.blurb}</p>}
          {openR.storagePath ? (
            <button type="button" className="ven-cta-primary rd-report-dl"
              onClick={() => openR.storagePath && pub.download(openR.storagePath)}>
              {t('vendors.downloadPdf')}
            </button>
          ) : (
            <p className="rd-detail-foot-note">
              {t('vendors.reportLiveFootNote')}
            </p>
          )}
        </DetailDialog>
      )}

      {allOpen && (
        <DetailDialog
          eyebrow={t('vendors.reportsTitle')}
          title={t('vendors.allReports')}
          period={filtered.length === 1
            ? t('vendors.countReportOne', { count: filtered.length })
            : t('vendors.countReportOther', { count: filtered.length })}
          size="wide"
          onClose={() => setAllOpen(false)}
        >
          <div className="rd-list">
            {filtered.length === 0 ? (
              <p className="rd-detail-foot-note" style={{ marginTop: 0 }}>{t('vendors.noReportsMatch')}</p>
            ) : filtered.map(r => (
              <button type="button" className="rd-list-row" key={r.id}
                onClick={() => { setAllOpen(false); setOpenR(r) }}>
                <span className={`rep-fcard-icon rep-fc-${r.category}`}>{categoryIcon(r.category)}</span>
                <span className="rd-list-body">
                  <span className="rd-list-title">{r.title}</span>
                  <span className="rd-list-meta">
                    {catLabel(r.category)} · {r.status === 'updated' ? t('vendors.updatedDate', { date: fmtDate(r.date) }) : fmtDate(r.date)}
                    {r.size && <> · {r.size}</>}
                  </span>
                </span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        </DetailDialog>
      )}
    </section>
  )
}

// -- sub-components ------------------------------------------------

function StatusPill({ kind }: { kind: Report['status'] }) {
  const t = useT()
  const cls = kind === 'published' ? 'rep-pill-pub'
            : kind === 'updated' ? 'rep-pill-upd'
            : 'rep-pill-draft'
  const label = kind === 'published' ? t('vendors.statusPublished') : kind === 'updated' ? t('vendors.statusUpdated') : t('vendors.statusDraft')
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
