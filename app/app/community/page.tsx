'use client'

import { useState } from 'react'
import { DetailDialog } from '../track/_sections/DetailDialog'
import { useT } from '@/lib/i18n'

// Editorial magazine layout for /community. Renders inside Layout's center
// column — the cockpit chrome (left rail, topbar) comes from Layout.jsx.
// All styles namespaced under .community-page in index.css so the generic
// class names (.feature, .article, .footer, .divider) don't collide with
// other routes.

const ARTICLES = [
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

const CATEGORIES = [
  {
    pct: 76, dashoffset: 63.33,
    name: 'Landscape', amount: '$12,800',
    note: 'Oak Ridge Nursery has been the primary vendor since 2023.',
  },
  {
    pct: 62, dashoffset: 100.28,
    name: 'Security', amount: '$8,400',
    note: 'A measured year. Two incidents reported, both resolved.',
  },
  {
    pct: 91, dashoffset: 23.75,
    name: 'Amenities', amount: '$14,500',
    note: "Pool, clubhouse, and gym. The line item that's burning fastest.",
    warn: true,
  },
  {
    pct: 15, dashoffset: 224.31,
    name: 'Reserves', amount: '$1,500',
    note: 'The slowest-growing line — and maybe the most important.',
  },
]

export default function Community() {
  const t = useT()
  const [openArticle, setOpenArticle] = useState<(typeof ARTICLES)[number] | null>(null)
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
          <div className="kicker-ed">{t('community.feature.kicker')}</div>
          <h1 className="comm-feature-headline"><span className="gradient-text">Sunset Lakes</span></h1>
          <p className="comm-feature-dek">
            {t('community.feature.dek')}
          </p>
          <div className="comm-byline">
            <span>{t('community.byline.byBoard')}</span>
            <span className="comm-byline-dot" />
            <span>{t('community.byline.reported')}</span>
            <span className="comm-byline-dot" />
            <span>{t('community.byline.readingTime')}</span>
            <span className="comm-byline-dot" />
            <span>{t('community.byline.homes')}</span>
          </div>
        </div>

        <div className="comm-feature-right">
          <div className="comm-rings-wrap">
            <svg className="comm-rings-svg" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6"/>
              <circle cx="100" cy="100" r="90" fill="none" stroke="url(#commRingGrad)" strokeWidth="6"
                      strokeDasharray="565.49" strokeDashoffset="135.72" strokeLinecap="round"/>
              <circle cx="100" cy="100" r="72" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5"/>
              <circle cx="100" cy="100" r="72" fill="none" stroke="url(#commRingGrad)" strokeWidth="5"
                      strokeDasharray="452.39" strokeDashoffset="108.57" strokeLinecap="round"/>
              <circle cx="100" cy="100" r="56" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5"/>
              <circle cx="100" cy="100" r="56" fill="none" stroke="url(#commRingGrad)" strokeWidth="5"
                      strokeDasharray="351.86" strokeDashoffset="133.71" strokeLinecap="round"/>
              <circle cx="100" cy="100" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5"/>
              <circle cx="100" cy="100" r="40" fill="none" stroke="url(#commRingWarn)" strokeWidth="5"
                      strokeDasharray="251.33" strokeDashoffset="22.62" strokeLinecap="round"/>
            </svg>
            <div className="comm-ring-center">
              <div className="comm-ring-pct gradient-text">76%</div>
              <div className="comm-ring-lbl">{t('community.ring.ofYearsBudget')}</div>
            </div>
          </div>

          <div className="comm-money">
            <div className="comm-money-amt gradient-text">$47,200</div>
            <div className="comm-money-sub">{t('community.money.sub')}</div>
            <span className="comm-warn-chip">{t('community.money.overPace')}</span>
          </div>
        </div>
      </section>

      <div className="comm-divider"><span className="comm-divider-mark">§</span></div>

      <section className="comm-categories">
        <div className="comm-section-head">
          <div className="kicker-ed">{t('community.categories.kicker')}</div>
          <h2 className="comm-section-title">{t('community.categories.title')}</h2>
        </div>

        <div className="comm-cat-grid">
          {CATEGORIES.map(c => (
            <div key={c.name} className={`comm-cat-col${c.warn ? ' warn' : ''}`}>
              <div className="comm-mini-ring-wrap">
                <svg className="comm-mini-ring-svg" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6"/>
                  <circle cx="50" cy="50" r="42" fill="none" stroke={`url(#${c.warn ? 'commRingWarn' : 'commRingGrad'})`} strokeWidth="6"
                          strokeDasharray="263.89" strokeDashoffset={c.dashoffset} strokeLinecap="round"/>
                </svg>
                <div className={`comm-mini-ring-pct${c.warn ? ' warn-text' : ''}`}>{c.pct}%</div>
              </div>
              <div className="comm-cat-name">{c.name}</div>
              <div className={`comm-cat-amount${c.warn ? ' warn' : ''}`}>{c.amount}</div>
              <div className="comm-cat-note">{c.note}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="comm-divider"><span className="comm-divider-mark">§</span></div>

      <section className="comm-board">
        <div className="comm-section-head">
          <div className="kicker-ed">{t('community.board.kicker')}</div>
          <h2 className="comm-section-title">{t('community.board.title')}</h2>
        </div>

        <div className="comm-articles-grid">
          {ARTICLES.map((a, i) => (
            <article key={i} className={`comm-article${a.feature ? ' feature' : ''} comm-article-btn`}
              role="button" tabIndex={0}
              onClick={() => setOpenArticle(a)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenArticle(a) } }}>
              <div className="comm-article-top">
                <span className="comm-article-section">{a.section}</span>
                <span className={`comm-chip chip-${a.status.kind}`}>{a.status.label}</span>
              </div>
              <h3 className="comm-article-headline">{a.headline}</h3>
              <p className="comm-article-dek">{a.dek}</p>
              <div className="comm-article-byline">
                <span className="comm-article-avatar">{a.avatar}</span>
                <span className="comm-byline-vendor">{a.vendor}</span>
                <span className="comm-byline-sep">·</span>
                <span className="comm-byline-dim">{a.votes}</span>
                <span className="comm-byline-sep">·</span>
                <span className="comm-byline-amt">{a.amount}</span>
                <span className="comm-byline-sep">·</span>
                <span className="comm-byline-dim">{a.when}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="comm-footer">
        <div className="comm-footer-masthead">Residente · Sunset Lakes · Q2 2026 · Issue 07</div>
        <div className="comm-footer-note">{t('community.footer.note')}</div>
        <div className="comm-footer-links">
          <a href="#unsubscribe">{t('community.footer.unsubscribe')}</a>
          <span className="comm-footer-divider">·</span>
          <a href="#past-issues">{t('community.footer.pastIssues')}</a>
          <span className="comm-footer-divider">·</span>
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
          <p className="rd-report-blurb">{openArticle.dek}</p>
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
