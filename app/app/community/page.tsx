'use client'

import { useState } from 'react'
import { DetailDialog } from '../track/_sections/DetailDialog'
import { useCommunityData } from '@/hooks/useCommunityData'
import { useExpenses, cumulativeByMonth } from '@/hooks/useExpenses'
import { useBoardDecisions } from '@/hooks/useBoardDecisions'
import { useT } from '@/lib/i18n'

// Editorial magazine layout for /community — fed by REAL records end-to-end:
// the community's own name, its budget categories (expense-ledger spend when
// the board logs dated expenses, manual spent otherwise — same switch as the
// Home dues card), and the board's actual decisions. The "Sunset Lakes"
// sample below renders ONLY in the logged-out preview (no community linked).
// Renders inside Layout's center column; styles namespaced .community-page.

type Article = {
  section: string
  status: { label: string; kind: string }
  headline: string
  dek: string
  avatar: string
  vendor: string
  votes: string
  amount: string
  when: string
  feature?: boolean
}

const DEMO_ARTICLES: Article[] = [
  {
    section: 'Amenities · Lead Story',
    status: { label: 'Resolved · 3/3 yes', kind: 'warn' },
    headline: 'The Amenities Fund Just Crossed 90%.',
    dek: 'With six months left in the year, the board voted to pause discretionary spending on the clubhouse renovation. Reserve draws are off the table until Q3 close.',
    avatar: 'OR',
    vendor: 'Oak Ridge Nursery',
    votes: '3/3 votes',
    amount: '$5,200',
    when: 'Board · 2 days ago',
    feature: true,
  },
  {
    section: 'Vendors · Pool',
    status: { label: 'Pending', kind: 'pending' },
    headline: 'A New Pool Vendor Enters the Chat.',
    dek: "Miramar Aquatics submitted a bid that undercuts last year's contract by 14%. The board is still reading the fine print.",
    avatar: 'MA',
    vendor: 'Miramar Aquatics',
    votes: '1/3 votes',
    amount: '$8,900/yr',
    when: '3 days ago',
  },
  {
    section: 'Infrastructure · Gates',
    status: { label: 'Resolved', kind: 'resolved' },
    headline: 'The West Gate, Fixed (For Now).',
    dek: 'SecureGate Co replaced the motor. Residents reported the squeak is gone. Invoice paid this morning.',
    avatar: 'SG',
    vendor: 'SecureGate Co',
    votes: 'Invoice cleared',
    amount: '$1,840',
    when: '5 days ago',
  },
  {
    section: 'Seasonal · Holiday',
    status: { label: 'Pending', kind: 'pending' },
    headline: 'Holiday Lights Are Back on the Agenda.',
    dek: 'FestivaLux returns with the same contract as last year. One board member wants a quote from a second vendor first.',
    avatar: 'FL',
    vendor: 'FestivaLux',
    votes: '2/3 votes',
    amount: '$2,400',
    when: '2 weeks ago',
  },
  {
    section: 'From the Board · Note',
    status: { label: 'Advisory', kind: 'pending' },
    headline: 'A Quiet Quarter for Landscape.',
    dek: 'Oak Ridge kept the palms trimmed and the fountains running. The line item landed at 76% — right on pace with the calendar.',
    avatar: 'OR',
    vendor: 'Oak Ridge Nursery',
    votes: 'No action required',
    amount: '$12,800 YTD',
    when: 'Ongoing',
  },
]

const DEMO_CATEGORIES = [
  {
    pct: 76,
    name: 'Landscape', amount: '$12,800',
    note: 'Oak Ridge Nursery has been the primary vendor since 2023.',
    warn: false,
  },
  {
    pct: 62,
    name: 'Security', amount: '$8,400',
    note: 'A measured year. Two incidents reported, both resolved.',
    warn: false,
  },
  {
    pct: 91,
    name: 'Amenities', amount: '$14,500',
    note: "Pool, clubhouse, and gym. The line item that's burning fastest.",
    warn: true,
  },
  {
    pct: 15,
    name: 'Reserves', amount: '$1,500',
    note: 'The slowest-growing line — and maybe the most important.',
    warn: false,
  },
]

const num = (v: unknown) => Number(v) || 0
const fmt$ = (n: number) => '$' + Math.round(num(n)).toLocaleString('en-US')
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const initialsOf = (s: string) => {
  const parts = String(s || '').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || 'B') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// Board-decision status → article chip, matching the Home activity feed.
const DECISION_CHIP: Record<string, { label: string; kind: string }> = {
  approved:   { label: 'Approved',      kind: 'resolved' },
  paid:       { label: 'Paid',          kind: 'resolved' },
  pending:    { label: 'Pending',       kind: 'pending' },
  discussion: { label: 'In discussion', kind: 'pending' },
}

// The four concentric rings' fixed geometry (radius → circumference).
const RING_GEO = [
  { r: 90, dash: 565.49, w: 6 },
  { r: 72, dash: 452.39, w: 5 },
  { r: 56, dash: 351.86, w: 5 },
  { r: 40, dash: 251.33, w: 5 },
]

export default function Community() {
  const t = useT()
  const { community, categories } = useCommunityData()
  const { expenses } = useExpenses()
  const { decisions } = useBoardDecisions(6)
  const [openArticle, setOpenArticle] = useState<Article | null>(null)

  // Real community when linked; the demo magazine only for the logged-out preview.
  const demo = !community
  const now = new Date()
  const communityName = demo ? 'Sunset Lakes' : String(community.name || '').replace(/[\s,]+$/, '')

  // ---- Real spend math (mirrors the Home card: ledger-preferred) ----
  const cats: any[] = demo ? [] : (categories || [])
  const catBudgetSum = cats.reduce((s, x) => s + num(x.budget), 0)
  const annualBudget = num(community?.annual_budget) || catBudgetSum
  const expenseCum = cumulativeByMonth(expenses, now.getFullYear())
  const expensesToDate = expenseCum[now.getMonth()]
  const hasExpenses = expenses.length > 0 && expensesToDate > 0
  const ledgerByCat = (() => {
    if (!hasExpenses) return null
    const m = new Map<string, number>()
    for (const e of expenses) {
      if (!e.category_id) continue
      const d = new Date(e.spent_on + 'T00:00:00')
      if (d.getFullYear() !== now.getFullYear()) continue
      m.set(e.category_id, (m.get(e.category_id) || 0) + e.amount)
    }
    return m
  })()
  const spentOf = (x: any) => (ledgerByCat ? (ledgerByCat.get(x.id) ?? 0) : num(x.spent))
  const totalSpent = hasExpenses ? expensesToDate : cats.reduce((s, x) => s + num(x.spent), 0)
  const spentPctNum = annualBudget > 0 ? Math.round((totalSpent / annualBudget) * 100) : 0
  const yStart = new Date(now.getFullYear(), 0, 1).getTime()
  const yEnd = new Date(now.getFullYear() + 1, 0, 1).getTime()
  const yearPctNum = Math.round(clamp01((now.getTime() - yStart) / (yEnd - yStart)) * 100)
  const overPace = spentPctNum > yearPctNum

  // Top categories by budget — the mini-ring grid + the inner feature rings.
  const topCats = demo
    ? DEMO_CATEGORIES
    : [...cats]
        .filter(x => num(x.budget) > 0)
        .sort((a, b) => num(b.budget) - num(a.budget))
        .slice(0, 4)
        .map(x => {
          const spent = spentOf(x)
          const ratio = clamp01(spent / num(x.budget))
          return {
            pct: Math.round(ratio * 100),
            name: String(x.name || '—'),
            amount: fmt$(spent),
            note: t('community.catBudgetNote', { budget: fmt$(num(x.budget)) }),
            warn: ratio > 0.9,
          }
        })

  // Feature rings: overall pace outermost, then the top three categories.
  const ringPcts = demo
    ? [76, 76, 76, 91]
    : [spentPctNum, ...topCats.slice(0, 3).map(c => c.pct)]

  // ---- Articles: the board's REAL decisions (demo sample in preview only) ----
  const fmtWhen = (d: string | null | undefined) =>
    d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const articles: Article[] = demo
    ? DEMO_ARTICLES
    : (decisions ?? []).map((a: any, i: number) => {
        const chip = DECISION_CHIP[a.status] || { label: String(a.status || '—'), kind: 'pending' }
        return {
          section: a.vendor ? t('community.sectionVendors') : t('community.sectionBoard'),
          status: chip,
          headline: String(a.title || '—'),
          dek: String(a.description || a.notes || ''),
          avatar: initialsOf(a.vendor || communityName),
          vendor: a.vendor || t('community.byline.byBoard'),
          votes: chip.label,
          amount: a.amount != null ? fmt$(a.amount) : '—',
          when: fmtWhen(a.decided_on),
          feature: i === 0,
        }
      })

  const quarter = Math.floor(now.getMonth() / 3) + 1
  const homesCount = num(community?.unit_count)

  return (
    <div className="community-page">
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="commRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="gm1" />
            <stop offset="50%" className="gm2" />
            <stop offset="100%" className="gm3" />
          </linearGradient>
          <linearGradient id="commRingWarn" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="gw1" />
            <stop offset="100%" className="gw2" />
          </linearGradient>
        </defs>
      </svg>

      <section className="comm-feature">
        <div className="comm-feature-left">
          <div className="kicker-ed">{demo ? t('community.feature.kicker') : t('community.featureKickerYear', { year: String(now.getFullYear()) })}</div>
          <h1 className="comm-feature-headline"><span className="gradient-text">{communityName}</span></h1>
          <p className="comm-feature-dek">
            {demo
              ? t('community.feature.dek')
              : t('community.featureDekReal', { spentPct: String(spentPctNum), yearPct: String(yearPctNum) })}
          </p>
          <div className="comm-byline">
            <span>{t('community.byline.byBoard')}</span>
            <span className="comm-byline-dot" />
            <span>{demo ? t('community.byline.reported') : t('community.bylineUpdated', { date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) })}</span>
            {(demo || homesCount > 0) && (
              <>
                <span className="comm-byline-dot" />
                <span>{demo ? t('community.byline.homes') : t('community.bylineHomes', { count: String(homesCount) })}</span>
              </>
            )}
          </div>
        </div>

        <div className="comm-feature-right">
          <div className="comm-rings-wrap">
            <svg className="comm-rings-svg" viewBox="0 0 200 200">
              {RING_GEO.map((g, i) => {
                const pct = clamp01((ringPcts[i] ?? 0) / 100)
                const warn = i === RING_GEO.length - 1 && (demo || overPace)
                return (
                  <g key={g.r}>
                    <circle cx="100" cy="100" r={g.r} fill="none" stroke={`rgba(255,255,255,${i === 0 ? 0.06 : 0.05})`} strokeWidth={g.w} />
                    <circle cx="100" cy="100" r={g.r} fill="none" stroke={`url(#${warn ? 'commRingWarn' : 'commRingGrad'})`} strokeWidth={g.w}
                            strokeDasharray={g.dash} strokeDashoffset={g.dash * (1 - pct)} strokeLinecap="round" />
                  </g>
                )
              })}
            </svg>
            <div className="comm-ring-center">
              <div className="comm-ring-pct gradient-text">{demo ? 76 : spentPctNum}%</div>
              <div className="comm-ring-lbl">{t('community.ring.ofYearsBudget')}</div>
            </div>
          </div>

          <div className="comm-money">
            <div className="comm-money-amt gradient-text">{demo ? '$47,200' : fmt$(totalSpent)}</div>
            <div className="comm-money-sub">
              {demo
                ? t('community.money.sub')
                : t('community.moneySubReal', { budget: fmt$(annualBudget), spentPct: String(spentPctNum), yearPct: String(yearPctNum) })}
            </div>
            {(demo || overPace) && <span className="comm-warn-chip">{t('community.money.overPace')}</span>}
          </div>
        </div>
      </section>

      <div className="comm-divider"><span className="comm-divider-mark">§</span></div>

      <section className="comm-categories">
        <div className="comm-section-head">
          <div className="kicker-ed">{t('community.categories.kicker')}</div>
          <h2 className="comm-section-title">{t('community.categories.title')}</h2>
        </div>

        {topCats.length === 0 ? (
          <div className="comm-cat-note" style={{ opacity: 0.75 }}>{t('community.categoriesEmpty')}</div>
        ) : (
          <div className="comm-cat-grid">
            {topCats.map(c => (
              <div key={c.name} className={`comm-cat-col${c.warn ? ' warn' : ''}`}>
                <div className="comm-mini-ring-wrap">
                  <svg className="comm-mini-ring-svg" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6"/>
                    <circle cx="50" cy="50" r="42" fill="none" stroke={`url(#${c.warn ? 'commRingWarn' : 'commRingGrad'})`} strokeWidth="6"
                            strokeDasharray="263.89" strokeDashoffset={263.89 * (1 - clamp01(c.pct / 100))} strokeLinecap="round"/>
                  </svg>
                  <div className={`comm-mini-ring-pct${c.warn ? ' warn-text' : ''}`}>{c.pct}%</div>
                </div>
                <div className="comm-cat-name">{c.name}</div>
                <div className={`comm-cat-amount${c.warn ? ' warn' : ''}`}>{c.amount}</div>
                <div className="comm-cat-note">{c.note}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="comm-divider"><span className="comm-divider-mark">§</span></div>

      <section className="comm-board">
        <div className="comm-section-head">
          <div className="kicker-ed">{t('community.board.kicker')}</div>
          <h2 className="comm-section-title">{t('community.board.title')}</h2>
        </div>

        {articles.length === 0 ? (
          <div className="comm-cat-note" style={{ opacity: 0.75 }}>{t('community.boardEmpty')}</div>
        ) : (
          <div className="comm-articles-grid">
            {articles.map((a, i) => (
              <article key={i} className={`comm-article${a.feature ? ' feature' : ''} comm-article-btn`}
                role="button" tabIndex={0}
                onClick={() => setOpenArticle(a)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenArticle(a) } }}>
                <div className="comm-article-top">
                  <span className="comm-article-section">{a.section}</span>
                  <span className={`comm-chip chip-${a.status.kind}`}>{a.status.label}</span>
                </div>
                <h3 className="comm-article-headline">{a.headline}</h3>
                {a.dek && <p className="comm-article-dek">{a.dek}</p>}
                <div className="comm-article-byline">
                  <span className="comm-article-avatar">{a.avatar}</span>
                  <span className="comm-byline-vendor">{a.vendor}</span>
                  <span className="comm-byline-sep">·</span>
                  <span className="comm-byline-amt">{a.amount}</span>
                  <span className="comm-byline-sep">·</span>
                  <span className="comm-byline-dim">{a.when}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="comm-footer">
        <div className="comm-footer-masthead">Residente · {communityName} · Q{quarter} {now.getFullYear()}</div>
        <div className="comm-footer-note">{demo ? t('community.footer.note') : t('community.footerNoteReal')}</div>
        <div className="comm-footer-links">
          {demo && (
            <>
              <a href="#unsubscribe">{t('community.footer.unsubscribe')}</a>
              <span className="comm-footer-divider">·</span>
              <a href="#past-issues">{t('community.footer.pastIssues')}</a>
              <span className="comm-footer-divider">·</span>
            </>
          )}
          <a href="/app/voice#contact">{t('community.footer.contactBoard')}</a>
        </div>
      </footer>

      {openArticle && (
        <DetailDialog
          eyebrow={openArticle.section}
          title={openArticle.headline}
          period={openArticle.when}
          onClose={() => setOpenArticle(null)}
        >
          <div className="rd-report-meta">
            <span className={`comm-chip chip-${openArticle.status.kind}`}>{openArticle.status.label}</span>
          </div>
          {openArticle.dek && <p className="rd-report-blurb">{openArticle.dek}</p>}
          <div className="rd-bd-table">
            <div className="rd-bd-row"><span className="rd-bd-cat">{t('community.dialog.vendor')}</span><span className="rd-bd-amt">{openArticle.vendor}</span><span /></div>
            <div className="rd-bd-row"><span className="rd-bd-cat">{t('community.dialog.status')}</span><span className="rd-bd-amt">{openArticle.votes}</span><span /></div>
            <div className="rd-bd-row rd-bd-total"><span>{t('community.dialog.amount')}</span><span className="rd-bd-amt">{openArticle.amount}</span><span /></div>
          </div>
        </DetailDialog>
      )}
    </div>
  )
}
