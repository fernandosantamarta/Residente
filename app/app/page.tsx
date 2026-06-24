'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCommunityData } from '@/hooks/useCommunityData'
import { useMyResident } from '@/hooks/useMyResident'
import { RentDemandBanner } from '@/components/RentDemandBanner'
import { useExpenses, cumulativeByMonth } from '@/hooks/useExpenses'
import { computeCommunityRating } from '@/lib/community-health'
import { useBoardDecisions } from '@/hooks/useBoardDecisions'
import { useVoiceMeetings } from '@/hooks/useVoiceMeetings'
import { useAuth } from '@/app/providers'
import { stripeEnabled, supabase } from '@/lib/supabase'
import { usePreferences } from '@/lib/preferences'
import { useScheduleEvents } from '@/lib/schedule'
import { useCheckout } from '@/components/CheckoutProvider'
import { useT } from '@/lib/i18n'
import { DetailDialog } from './track/_sections/DetailDialog'
import { RequestFormDialog } from './voice/_sections/RequestForm'

// Demo fallback — shown only when the user has no community linked yet (or
// local dev without Supabase), so the dashboard never renders blank.
const DEMO = { name: 'Sunset Lakes', location: 'Miramar, FL', unit_count: 166, annual_budget: 62000, monthly_dues: 38 }
const DEMO_CATS = [
  { id: 'd1', name: 'Landscape', budget: 16800, spent: 12800 },
  { id: 'd2', name: 'Security',  budget: 13500, spent: 8400 },
  { id: 'd3', name: 'Amenities', budget: 15900, spent: 14500 },
  { id: 'd4', name: 'Reserves',  budget: 10000, spent: 1500 },
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Static weather placeholder for now. Wire to a real API later.
const WEATHER = { temp: 82, condition: 'Sunny' }

// Share of dues that goes to each vendor + month-over-month trend.
// share sums to 1.0; trend is signed percent change (e.g. 0.04 = up 4%).
const VENDOR_BREAKDOWN: readonly { id: string; name: string; share: number; trend: number }[] = [
  { id: 'landscape',  name: 'Landscaping',          share: 0.25, trend:  0.04 },
  { id: 'security',   name: 'Security',             share: 0.20, trend: -0.02 },
  { id: 'pool',       name: 'Pool maintenance',     share: 0.11, trend:  0.08 },
  { id: 'clubhouse',  name: 'Clubhouse upkeep',     share: 0.07, trend:  0.00 },
  { id: 'insurance',  name: 'Insurance',            share: 0.13, trend:  0.03 },
  { id: 'reserves',   name: 'Capital reserves',     share: 0.15, trend: -0.05 },
  { id: 'admin',      name: 'Admin & management',   share: 0.09, trend:  0.01 },
]

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const num = (v: unknown) => Number(v) || 0
const fmtMoney = (n: number) => '$' + Math.round(num(n)).toLocaleString('en-US')

// Pulls a clean first name out of profile.full_name. Handles:
//   "Fernando Santamarta" → "Fernando"
//   "FernandoSantamarta"  → "Fernando" (camelCase split)
//   "andresvega"          → "Andresvega" (no separator: show the whole word —
//                           we can't know where the first name ends, and a
//                           fixed-length slice produced wrong names like
//                           "Andresve", so never truncate.)
function extractFirstName(raw: string | null | undefined): string {
  if (!raw) return 'there'
  const s = raw.trim()
  if (!s) return 'there'
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase()
  if (/\s/.test(s)) return cap(s.split(/\s+/)[0])
  const camelAt = s.slice(1).search(/[A-Z]/)
  if (camelAt > 0) return cap(s.slice(0, camelAt + 1))
  return cap(s)
}

export default function Home() {
  const t = useT()
  const { community, categories, loading: communityLoading } = useCommunityData()
  const { profile } = useAuth() || {}
  const { balance: myBalance, status: myDues, isTenant, loading: residentLoading } = useMyResident()
  const { expenses, loading: expensesLoading } = useExpenses()

  // Real community when one is linked; otherwise the demo (marketing preview
  // for logged-out visitors). A real signed-in community NEVER sees demo
  // content — it gets its real data and clean empty states.
  const demo = !community
  const c = community || DEMO
  const cats = community ? categories : DEMO_CATS

  // While a signed-in resident's real data is still loading, `community` is null
  // and `demo` flips true — which would paint demo values (Sunset Lakes, sample
  // dues/rating) for a beat before swapping to the real data. Show a skeleton
  // for that window instead. Gated on having a community_id so the genuinely
  // community-less / logged-out preview goes straight to the demo with no
  // skeleton flash (those hooks start loading:true for a frame before their
  // effect resolves to false). `profile` is already resolved here — the auth
  // provider blocks render until it is.
  const dataLoading =
    !!profile?.community_id && (communityLoading || residentLoading || expensesLoading)

  // --- derived numbers — everything here is computed, never stored ---
  const now = new Date()
  const yStart = new Date(now.getFullYear(), 0, 1)
  const yEnd = new Date(now.getFullYear() + 1, 0, 1)
  const yearPct = clamp01((now.getTime() - yStart.getTime()) / (yEnd.getTime() - yStart.getTime()))

  const catSpent = cats.reduce((s, x) => s + num(x.spent), 0)
  const catBudgetSum = cats.reduce((s, x) => s + num(x.budget), 0)
  const annualBudget = num(c.annual_budget) || catBudgetSum
  const monthIdx = now.getMonth()

  // Real spend from the dated expense ledger when the board has logged any;
  // otherwise fall back to the per-category manual "spent" totals. The chart
  // plots the real cumulative curve and the headline reflects spend-to-date.
  const expenseCum = cumulativeByMonth(expenses, now.getFullYear())
  const expensesToDate = expenseCum[monthIdx]
  const hasExpenses = expenses.length > 0 && expensesToDate > 0
  const totalSpent = hasExpenses ? expensesToDate : catSpent
  const spentPct = annualBudget > 0 ? totalSpent / annualBudget : 0

  const expectedPctNum = Math.round(yearPct * 100)
  const actualPctNum = Math.round(spentPct * 100)
  const deltaPp = actualPctNum - expectedPctNum
  const overPace = spentPct > yearPct

  const monthlyDues = num(c.monthly_dues)
  const unitCount = num(c.unit_count)
  const annualCommunity = monthlyDues * 12 * unitCount

  // Reserve balance — remaining (budget − spent) of the categories the board
  // flagged as reserves; falls back to name-matched "Reserve" categories when
  // the is_reserve flag hasn't been set. Real, not the old hardcoded figure.
  const reserveCats = cats.filter((x: any) => x.is_reserve)
  const reserveSource = reserveCats.length ? reserveCats : cats.filter((x: any) => /reserve/i.test(x.name || ''))
  const reserveTotal = reserveSource.reduce((s, x) => s + (num(x.budget) - num(x.spent)), 0)

  // Greeting that adapts to the hour — keeps the hero photo card feeling alive
  const hour = now.getHours()
  const greeting = hour < 12 ? t('home.greetingMorning') : hour < 18 ? t('home.greetingAfternoon') : t('home.greetingEvening')
  const firstName = extractFirstName(profile?.full_name)

  // Health % for At-a-Glance — 100 = on pace, lower = over pace
  const paceRatio = expectedPctNum > 0 ? actualPctNum / expectedPctNum : 1
  const healthPct = Math.max(0, Math.min(100, Math.round((1 - Math.max(0, paceRatio - 1)) * 100)))

  // Real grading scores for "Where your dues go". Community = how the community's
  // money is being run (budget pace, with a reserve-funded bonus). Personal = the
  // resident's own standing (paid up = 100, each month of arrears costs points).
  // Demo (logged-out preview) keeps the illustrative sample figures.
  const communityRating = demo
    ? 92
    : computeCommunityRating({ community: c, categories: cats, expenses, now })
  const personalRating = demo
    ? 100
    : (myBalance == null || myBalance <= 0
        ? 100
        : Math.max(0, 100 - Math.round((myBalance / Math.max(monthlyDues, 1)) * 25)))

  return (
    <>
      {/* HERO — full-width sunset photo with text/chips overlaid on the left.
          The photo extends DOWN and the dash-row1 cards overlap its bottom. */}
      <section className="hero-bleed">
        <img src="/sunset.jpg" alt="" className="hero-bleed-img" aria-hidden="true" />
        <div className="hero-bleed-fade" aria-hidden="true"></div>
        <div className="hero-bleed-content">
          <h1 className="hero-title">
            {greeting},<br/>
            <span className="hero-title-em">{firstName}</span>
          </h1>
          <div className="hero-sub">{t('home.heroSub')}</div>
          <div className="hero-chips">
            {dataLoading ? (
              <>
                <span className="hsk-chip" aria-hidden="true" />
                <span className="hsk-chip" aria-hidden="true" />
                <span className="hsk-chip" aria-hidden="true" />
              </>
            ) : (
              <>
                <span className="hero-chip">
                  <ChipIcon name="home" />
                  {t('home.heroHomes', { count: unitCount || 0 })}
                </span>
                <span className="hero-chip">
                  <ChipIcon name="pin" />
                  {c.location || '—'}
                </span>
                <span className="hero-chip hero-chip-accent">
                  <ChipIcon name="clock" />
                  {t('home.heroThroughYear', { count: expectedPctNum })}
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Tenant rent demand — renders only when the signed-in tenant has an
          active demand directing rent to the association (FS 720.3085(8)). */}
      <RentDemandBanner />

      {dataLoading ? (
        <HomeBodySkeleton />
      ) : (
        <>
          {/* OPEN VOTES — sits directly on top of Financial Overview when there's
              a vote awaiting the resident. Time-bound work deserves the first
              slot of the day; the band disappears entirely when no votes are
              open, so the dashboard quietly rearranges to demand attention only
              when it should. */}
          {/* `demo && !profile`: only a genuinely logged-out marketing visitor sees the
              sample vote. A signed-in resident (profile set, community still loading on
              first paint) must NOT flash the demo "Pool vendor" vote — they get their
              real open votes, which are empty until meetings load (so no flicker). */}
          {/* Tenants are non-voting — no open-votes band. */}
          {!isTenant && <OpenVotesBand demo={demo && !profile} />}

          {/* ROW 1 — Financial Overview (with embedded trend chart) + Quick Actions */}
          <section className="dash-row1">
            <FinancialOverview
              totalSpent={totalSpent}
              annualBudget={annualBudget}
              actualPctNum={actualPctNum}
              expectedPctNum={expectedPctNum}
              deltaPp={deltaPp}
              overPace={overPace}
              monthIdx={monthIdx}
              cats={cats}
              monthlyCumulative={hasExpenses ? expenseCum : null}
            />
            <QuickActions />
          </section>

          {/* ROW 2 — At a Glance + Recent Activity side-by-side */}
          <section className="dash-row2">
            <section className="glance-row">
              <div className="glance-head">{t('home.atAGlance')}</div>
              <div className="glance-cards">
                {/* "Your balance" is the owner's dues — hidden for tenants. */}
                {!isTenant && (
                <GlanceCard
                  icon="home" iconTone="orange"
                  label={t('home.glanceYourBalance')}
                  value={myBalance != null ? fmtMoney(myBalance) : fmtMoney(monthlyDues)}
                  captionText={myBalance != null && myBalance > 0 ? t('home.glanceDueNow') : t('home.glancePaid')}
                  captionTone={myBalance != null && myBalance > 0 ? 'red' : 'green'}
                />
                )}
                <GlanceCard
                  icon="shield" iconTone="green"
                  label={t('home.glanceReserveBalance')}
                  value={fmtMoney(reserveTotal)}
                  captionText={reserveTotal > 0 ? t('home.glanceHealthy') : t('home.glanceReserveNone')}
                  captionTone={reserveTotal > 0 ? 'green' : 'muted'}
                />
                <GlanceCard
                  icon="docs" iconTone="purple"
                  label={t('home.glanceTotalAssessments')}
                  value={fmtMoney(annualBudget)}
                  captionText={t('home.glanceFyBudget', { year: now.getFullYear() })} captionTone="muted"
                />
                <GlanceCard
                  icon="pie" iconTone="blue"
                  label={t('home.glanceBudgetPace')}
                  value={`${healthPct}%`}
                  captionText={overPace ? t('home.glanceOverPace') : t('home.glanceOnTrack')}
                  captionTone={overPace ? 'red' : 'green'}
                />
              </div>
            </section>

            <RecentActivity demo={demo} />
          </section>

          {/* "Where your dues go" — owner-facing dues breakdown; hidden for tenants. */}
          {!isTenant && (
          <DuesSection
            monthlyDues={monthlyDues}
            unitCount={unitCount}
            unitNumber={profile?.unit_number ?? null}
            demo={demo}
            cats={cats}
            communityRating={communityRating}
            personalRating={personalRating}
          />
          )}
        </>
      )}
    </>
  )
}

// Greyed placeholder for the data-driven body while a signed-in resident's real
// community/dues/expenses load — keeps the warm hero but avoids painting the demo
// fallback for a beat. Mirrors the real layout (row1 / row2 / dues) so the swap
// to real content doesn't jump much.
function HomeBodySkeleton() {
  return (
    <div className="hsk" aria-hidden="true">
      <section className="dash-row1">
        <div className="hsk-card hsk-card-tall" />
        <div className="hsk-card hsk-card-tall" />
      </section>
      <section className="dash-row2">
        <section className="glance-row">
          <div className="hsk-bar hsk-bar-head" />
          <div className="glance-cards">
            <div className="hsk-card hsk-glance" />
            <div className="hsk-card hsk-glance" />
            <div className="hsk-card hsk-glance" />
            <div className="hsk-card hsk-glance" />
          </div>
        </section>
        <div className="hsk-card hsk-card-tall" />
      </section>
      <div className="hsk-card hsk-card-xl" />
    </div>
  )
}

// ---------- Hero photo decorative bits ----------

type ChipIconName =
  | 'home' | 'pin' | 'clock' | 'calendar'
  | 'sun' | 'cloud' | 'partly-cloudy' | 'rain' | 'storm' | 'snow' | 'moon'

function ChipIcon({ name }: { name: ChipIconName }) {
  const paths: Record<ChipIconName, React.ReactNode> = {
    home:           <><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></>,
    pin:            <><path d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></>,
    clock:          <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    calendar:       <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
    sun:            <><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></>,
    cloud:          <><path d="M6.5 19a4.5 4.5 0 0 1 .5-8.95A6 6 0 0 1 19 11a4 4 0 0 1 0 8H6.5z"/></>,
    'partly-cloudy':<><circle cx="8" cy="10" r="3"/><path d="M8 2v2M8 16v2M2 10h2M14 10h2M3.8 5.8l1.4 1.4M10.8 12.8l1.4 1.4M3.8 14.2 5.2 12.8M12.2 7.2 10.8 5.8"/><path d="M11 18a3.5 3.5 0 0 1 .4-6.97A5 5 0 0 1 21 13a3 3 0 0 1 0 6h-9.6z"/></>,
    rain:           <><path d="M6.5 14a4.5 4.5 0 0 1 .5-8.95A6 6 0 0 1 19 6a4 4 0 0 1 0 8H6.5z"/><path d="M8 17v3M12 17v4M16 17v3"/></>,
    storm:          <><path d="M6.5 12a4.5 4.5 0 0 1 .5-8.95A6 6 0 0 1 19 4a4 4 0 0 1 0 8H6.5z"/><path d="m13 14-3 5h4l-2 4"/></>,
    snow:           <><path d="M6.5 14a4.5 4.5 0 0 1 .5-8.95A6 6 0 0 1 19 6a4 4 0 0 1 0 8H6.5z"/><circle cx="8" cy="19" r="0.5"/><circle cx="12" cy="20" r="0.5"/><circle cx="16" cy="19" r="0.5"/></>,
    moon:           <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
  }
  return (
    <svg className="chip-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

// Resolve a weather condition string into the matching chip icon name.
function weatherIcon(condition: string): ChipIconName {
  const c = condition.toLowerCase()
  if (c.includes('storm') || c.includes('thunder')) return 'storm'
  if (c.includes('snow'))                            return 'snow'
  if (c.includes('rain') || c.includes('shower'))    return 'rain'
  if (c.includes('partly'))                          return 'partly-cloudy'
  if (c.includes('cloud') || c.includes('overcast')) return 'cloud'
  if (c.includes('clear') && c.includes('night'))    return 'moon'
  if (c.includes('night'))                           return 'moon'
  return 'sun'
}

// ---------- Financial Overview card ----------

// ---------- Where your dues go (tabbed) ----------

function DuesSection({
  monthlyDues, unitCount, unitNumber, demo, cats, communityRating, personalRating,
}: { monthlyDues: number; unitCount: number; unitNumber: string | null; demo: boolean; cats: any[]; communityRating: number; personalRating: number }) {
  const t = useT()
  // Real community: derive the allocation from its own budget categories.
  // Demo (logged-out preview): the illustrative vendor sample.
  const catTotal = cats.reduce((s, x) => s + num(x.budget), 0)
  const breakdown = demo
    ? VENDOR_BREAKDOWN
    : (catTotal > 0
        ? cats.filter(x => num(x.budget) > 0).map((x, i) => ({
            id: x.id ?? `c${i}`, name: x.name, share: num(x.budget) / catTotal, trend: 0,
            // Real signal (no MoM history is stored): how much of this
            // category's annual budget has actually been spent.
            spentPct: num(x.budget) > 0 ? num(x.spent) / num(x.budget) : null,
          }))
        : [])
  const [tab, setTab] = useState<'community' | 'personal'>('community')
  const isCommunity = tab === 'community'
  const multiplier = isCommunity ? monthlyDues * unitCount : monthlyDues
  const annualMultiplier = multiplier * 12
  const statLabel = isCommunity ? t('home.duesTotalMonthlyIncome') : t('home.duesYourMonthlyDues')
  const sub = isCommunity
    ? t('home.duesAllHomesCombined', { count: unitCount || 0 })
    : t('home.duesYourShareUnit', { unit: unitNumber ?? '—' })

  return (
    <section className="dues-section">
      <div className="dues-head">
        <h2 className="dues-title">{t('home.duesTitle')}</h2>
        <div className="dues-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={isCommunity}
            className={`dues-tab${isCommunity ? ' active' : ''}`}
            onClick={() => setTab('community')}
          >
            {t('home.duesTabCommunity')}
          </button>
          <button
            role="tab"
            aria-selected={!isCommunity}
            className={`dues-tab${!isCommunity ? ' active' : ''}`}
            onClick={() => setTab('personal')}
          >
            {t('home.duesTabPersonal')}
          </button>
        </div>
      </div>

      <div className="dues-stat">
        <div className="dues-stat-main">
          <div className="dues-stat-label">{statLabel}</div>
          <div className="dues-stat-value">{fmtMoney(multiplier)}</div>
          <div className="dues-stat-meta">
            <span className="dues-meta-annual">{t('home.duesAnnualOnly', { amount: fmtMoney(annualMultiplier) })}</span>
            <span className="dues-meta-sep"> · </span>
            <span className="dues-meta-sub">{sub}</span>
          </div>
          <div className="dues-updated">
            {t('home.duesLastUpdated', { date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) })}
          </div>
        </div>
        <RatingRing
          value={isCommunity ? communityRating : personalRating}
          label={isCommunity ? t('home.duesCommunityRating') : t('home.duesYourRating')}
        />
      </div>

      <div className="dues-breakdown">
        {breakdown.length === 0 ? (
          <div className="activity-empty">{t('home.duesEmpty')}</div>
        ) : breakdown.map((v) => (
          <div key={v.id} className="dues-cat">
            <div className="dues-cat-row">
              <span className="dues-cat-name">{v.name}</span>
              <span className="dues-cat-meta">
                <span className="dues-cat-amt">{fmtMoney(multiplier * v.share)}</span>
                {(v as any).spentPct != null
                  ? <SpentChip pct={(v as any).spentPct} />
                  : <TrendChip trend={v.trend} />}
              </span>
            </div>
            <div className="dues-bar"><div className="dues-bar-fill" style={{ width: `${v.share * 100}%` }}/></div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RatingRing({ value, label }: { value: number; label: string }) {
  const r = 32
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = c * (1 - pct / 100)
  return (
    <div className="rating-ring">
      <svg viewBox="0 0 80 80" className="rating-ring-svg">
        <circle cx="40" cy="40" r={r}
          stroke="rgba(225, 73, 9, 0.18)" strokeWidth="6" fill="none"/>
        <circle cx="40" cy="40" r={r}
          stroke="#E14909" strokeWidth="6" fill="none"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"/>
      </svg>
      <div className="rating-ring-num">{pct}</div>
      <div className="rating-ring-label">{label}</div>
    </div>
  )
}

function TrendChip({ trend }: { trend: number }) {
  if (trend === 0) {
    return (
      <span className="trend-chip trend-flat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        0%
      </span>
    )
  }
  const up = trend > 0
  const pct = Math.round(Math.abs(trend) * 100)
  return (
    <span className={`trend-chip ${up ? 'trend-up' : 'trend-down'}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {up
          ? <><polyline points="6 14 12 8 18 14"/></>
          : <><polyline points="6 10 12 16 18 10"/></>
        }
      </svg>
      {pct}%
    </span>
  )
}

// Real per-category signal: share of this category's annual budget already
// spent. Green under pace, amber as it nears the cap, red once over budget.
function SpentChip({ pct }: { pct: number }) {
  const t = useT()
  const p = Math.round((Number(pct) || 0) * 100)
  const tone = p > 100 ? 'over' : p >= 85 ? 'near' : 'ok'
  return <span className={`spent-chip spent-${tone}`}>{t('home.duesPctSpent', { pct: p })}</span>
}

function FinancialOverview({
  totalSpent, annualBudget, actualPctNum, expectedPctNum, deltaPp, monthIdx, cats, monthlyCumulative,
}: {
  totalSpent: number; annualBudget: number; actualPctNum: number; expectedPctNum: number;
  deltaPp: number; overPace: boolean; monthIdx: number; cats: any[]
  monthlyCumulative?: number[] | null
}) {
  const t = useT()
  // "View budget" opens the full category breakdown in a popup (in-place, no nav).
  const [budgetOpen, setBudgetOpen] = useState(false)
  // Chart geometry — wider than tall, leaves room for y-axis labels on the left
  // and one row of month labels at the bottom.
  const w = 560, h = 200, pad = { l: 48, r: 16, t: 16, b: 32 }
  const yTicks = 4
  // Real cumulative spend from the expense ledger when present (plot only
  // through the current month). Otherwise a synthesized ease-out curve
  // calibrated to pass through totalSpent at the current month and project on.
  const realCurve = !!(monthlyCumulative && monthlyCumulative.length === 12)
  const ease = (tt: number) => 1 - Math.pow(1 - tt, 1.6)
  const projectedEndIdx = realCurve ? monthIdx : Math.max(monthIdx, 8)
  let series: number[]
  if (realCurve) {
    series = monthlyCumulative as number[]
  } else {
    const scaleAtNow = ease(monthIdx / projectedEndIdx) || 1
    const scale = totalSpent / scaleAtNow
    series = MONTHS.map((_, i) => ease(Math.min(1, i / projectedEndIdx)) * scale)
  }
  const seriesMax = Math.max(...series, totalSpent, 1)
  const ymax = Math.max(annualBudget * 0.55, seriesMax * 1.1, totalSpent * 1.6, 1)
  const pts = MONTHS.map((_, i) => {
    const cumSpend = series[i]
    const x = pad.l + ((w - pad.l - pad.r) * i) / (MONTHS.length - 1)
    const y = (h - pad.b) - ((h - pad.t - pad.b) * (cumSpend / ymax))
    return { x, y, v: cumSpend }
  })
  const livePts = pts.slice(0, projectedEndIdx + 1)
  // Catmull-Rom → cubic Bezier so the line reads as a smooth curve, not
  // a polyline.
  const linePath = livePts.length === 0
    ? ''
    : livePts.reduce((acc, p, i) => {
        if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
        const p0 = livePts[i - 2] ?? livePts[i - 1]
        const p1 = livePts[i - 1]
        const p2 = p
        const p3 = livePts[i + 1] ?? p
        const cp1x = p1.x + (p2.x - p0.x) / 6
        const cp1y = p1.y + (p2.y - p0.y) / 6
        const cp2x = p2.x - (p3.x - p1.x) / 6
        const cp2y = p2.y - (p3.y - p1.y) / 6
        return `${acc} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
      }, '')
  const areaPath = livePts.length > 0
    ? `${linePath} L ${livePts[livePts.length - 1].x} ${h - pad.b} L ${livePts[0].x} ${h - pad.b} Z`
    : ''
  const peak = pts[projectedEndIdx]
  const fmtTickShort = (n: number) =>
    n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`

  return (
    <div className="fin-card">
      <div className="fin-head">
        <div className="fin-eyebrow">{t('home.finOverview')}</div>
        <button className="fin-period" type="button">
          {t('home.finYearToDate')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      <div className="fin-main">
        <div className="fin-left">
          <div className="fin-label">{t('home.finSpentThisYear')}</div>
          <div className="fin-amount">{fmtMoney(totalSpent)}</div>
          <div className="fin-of">{t('home.finOfBudget', { amount: fmtMoney(annualBudget) })}</div>
          <div className="fin-progress">
            <div className="fin-progress-track">
              <div
                className="fin-progress-bar"
                style={{ width: `${Math.min(100, actualPctNum)}%` }}
              />
            </div>
            <div className="fin-progress-pct">{actualPctNum}%</div>
          </div>
        </div>

        <div className="fin-right">
          <svg className="fin-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="finArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF6B2B" stopOpacity="0.70"/>
                <stop offset="60%" stopColor="#FF6B2B" stopOpacity="0.30"/>
                <stop offset="100%" stopColor="#FF6B2B" stopOpacity="0.05"/>
              </linearGradient>
              {/* Outer orange halo — wide, soft, takes care of the "lightning" aura */}
              <filter id="finGlow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="10" result="big"/>
                <feGaussianBlur stdDeviation="5" result="med"/>
                <feMerge>
                  <feMergeNode in="big"/>
                  <feMergeNode in="big"/>
                  <feMergeNode in="big"/>
                  <feMergeNode in="med"/>
                  <feMergeNode in="med"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              {/* Inner bright core — tighter, hotter, makes the line look incandescent */}
              <filter id="finCore" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="1.4"/>
              </filter>
            </defs>
            {Array.from({ length: yTicks + 1 }, (_, i) => {
              const t = i / yTicks
              const y = (h - pad.b) - (h - pad.t - pad.b) * t
              return (
                <g key={i}>
                  <line
                    x1={pad.l} x2={w - pad.r} y1={y} y2={y}
                    stroke="rgba(255,255,255,0.06)" strokeWidth="1"
                  />
                  <text
                    x={pad.l / 2} y={y + 4}
                    fontSize="12" textAnchor="middle"
                    fill="#FFFFFF"
                    fontWeight="700"
                    fontFamily="Inter, sans-serif"
                    letterSpacing="0.3"
                  >
                    {fmtTickShort(ymax * t)}
                  </text>
                </g>
              )
            })}
            {areaPath && <path d={areaPath} fill="url(#finArea)"/>}
            {/* Outer halo: thick orange line with heavy glow blur */}
            <path
              d={linePath}
              fill="none"
              stroke="#FF6B2B"
              strokeWidth="4.5"
              strokeOpacity="0.95"
              strokeLinejoin="round"
              strokeLinecap="round"
              filter="url(#finGlow)"
            />
            {/* Hot mid layer: brighter orange, slightly thinner, mild blur */}
            <path
              d={linePath}
              fill="none"
              stroke="#FFB070"
              strokeWidth="2.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              filter="url(#finCore)"
            />
            {/* Bright incandescent core: near-white, hairline */}
            <path
              d={linePath}
              fill="none"
              stroke="#FFF1E0"
              strokeWidth="1.1"
              strokeOpacity="0.95"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle
              cx={peak.x} cy={peak.y}
              r="7"
              fill="#FF6B2B"
              stroke="#FFFFFF"
              strokeWidth="2.5"
            />
            {MONTHS.map((m, i) => {
              if (i % 2 !== 0) return null
              const x = pad.l + ((w - pad.l - pad.r) * i) / (MONTHS.length - 1)
              return (
                <text key={m} x={x} y={h - 6} fontSize="12" textAnchor="middle"
                  fill="#FFFFFF" fontWeight="700"
                  fontFamily="Inter, sans-serif" letterSpacing="0.8">
                  {m.toUpperCase()}
                </text>
              )
            })}
          </svg>
        </div>
      </div>

      <div className="fin-foot">
        <button className="fin-view-btn" type="button" onClick={() => setBudgetOpen(true)}>
          {t('home.finViewBudget')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <div className="fin-stats">
          <FinStat label={t('home.finExpectedPace')} value={`${expectedPctNum}%`} />
          <FinStat label={t('home.finActualPace')}   value={`${actualPctNum}%`} accent />
          <FinStat label={t('home.finDelta')}         value={`${deltaPp >= 0 ? '+' : ''}${deltaPp}pp`} warn={deltaPp > 0} />
        </div>
      </div>

      {/* View budget — full category breakdown in a popup. */}
      {budgetOpen && (
        <DetailDialog
          eyebrow={t('home.finOverview')}
          title={t('home.budgetDialogTitle')}
          period={t('home.budgetDialogPeriod', { spent: fmtMoney(totalSpent), budget: fmtMoney(annualBudget), pct: actualPctNum })}
          size="wide"
          onClose={() => setBudgetOpen(false)}
        >
          {cats.length === 0 ? (
            <p className="rd-detail-foot-note" style={{ marginTop: 0 }}>
              {t('home.budgetDialogEmpty')}
            </p>
          ) : (
            <div className="rd-bd-table rd-bd-cols4">
              <div className="rd-bd-row rd-bd-head">
                <span>{t('home.budgetColCategory')}</span><span>{t('home.budgetColSpent')}</span><span>{t('home.budgetColBudget')}</span><span>{t('home.budgetColUsed')}</span>
              </div>
              {cats.map((x: any, i: number) => {
                const b = num(x.budget), s = num(x.spent)
                const pct = b > 0 ? Math.round((s / b) * 100) : 0
                return (
                  <div className="rd-bd-row" key={x.id ?? i}>
                    <span className="rd-bd-cat">{x.name}</span>
                    <span className="rd-bd-amt">{fmtMoney(s)}</span>
                    <span className="rd-bd-amt">{fmtMoney(b)}</span>
                    <span className="rd-bd-amt">{pct}%</span>
                  </div>
                )
              })}
              <div className="rd-bd-row rd-bd-total">
                <span>{t('home.budgetTotal')}</span>
                <span className="rd-bd-amt">{fmtMoney(totalSpent)}</span>
                <span className="rd-bd-amt">{fmtMoney(annualBudget)}</span>
                <span className="rd-bd-amt">{actualPctNum}%</span>
              </div>
            </div>
          )}
        </DetailDialog>
      )}
    </div>
  )
}

function FinStat({ label, value, accent, warn }:
  { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="fin-stat">
      <div className="fin-stat-label">{label}</div>
      <div className={`fin-stat-value${accent ? ' accent' : ''}${warn ? ' warn' : ''}`}>{value}</div>
    </div>
  )
}

// ---------- Open votes band ----------

// Demo data — replace with useVoiceMeetings() once we're wiring real votes.
// Each entry is a single open motion the resident hasn't cast on yet.
type OpenVote = {
  meetingId: string
  voteId: string
  motion: string
  closesAt: string         // ISO date ('' when unknown)
  votedCount: number
  totalCount: number | null // null for real votes — no fixed electorate total
}

const DEMO_OPEN_VOTES: OpenVote[] = [
  {
    meetingId: 'demo-meeting-1',
    voteId: 'demo-vote-1',
    motion: 'Pool vendor: Miramar Aquatics — $8,900/yr',
    closesAt: '2026-10-30',
    votedCount: 2,
    totalCount: 3,
  },
]

function fmtCloses(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Meta line under each motion: meeting date when known, plus the live tally.
// Real votes have no fixed electorate total, so we show "N votes cast" rather
// than the demo's "N of M board members".
function voteMeta(v: OpenVote, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const parts: string[] = []
  if (v.closesAt) parts.push(t('home.voteCloses', { date: fmtCloses(v.closesAt) }))
  if (v.totalCount != null) {
    parts.push(t('home.voteBoardTally', { voted: v.votedCount, total: v.totalCount }))
  } else if (v.votedCount > 0) {
    parts.push(
      v.votedCount === 1
        ? t('home.voteCastOne', { count: v.votedCount })
        : t('home.voteCastMany', { count: v.votedCount })
    )
  }
  return parts.join(' · ')
}

function OpenVotesBand({ demo }: { demo: boolean }) {
  const t = useT()
  // Demo shows sample votes for the marketing preview; a real community pulls
  // its actual open votes (status === 'open') from its meetings.
  const { meetings } = useVoiceMeetings()
  const votes: OpenVote[] = demo
    ? DEMO_OPEN_VOTES
    : (meetings as any[]).flatMap(m =>
        (m.ev_votes || [])
          .filter((v: any) => v.status === 'open')
          .map((v: any) => ({
            meetingId: m.id,
            voteId: v.id,
            motion: v.title || t('home.voteUntitled'),
            closesAt: m.scheduled_at ? String(m.scheduled_at).slice(0, 10) : '',
            votedCount: (v.yes_count || 0) + (v.no_count || 0) + (v.abstain_count || 0),
            totalCount: null,
          }))
      )
  if (votes.length === 0) return null

  const single = votes.length === 1
  const v0 = votes[0]

  return (
    <section className="open-votes-band" data-count={votes.length}>
      {single ? (
        <div className="ovb-row">
          <div className="ovb-left">
            <div className="ovb-eyebrow">
              <span className="ovb-dot" aria-hidden="true" />
              {t('home.voteNeeded')}
            </div>
            <div className="ovb-body">
              <div className="ovb-motion">{v0.motion}</div>
              <div className="ovb-meta">{voteMeta(v0, t)}</div>
            </div>
          </div>
          <Link href={`/app/voice/${v0.meetingId}`} className="ovb-cta">
            {t('home.voteCastCta')}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
            </svg>
          </Link>
        </div>
      ) : (
        <>
          <div className="ovb-eyebrow">
            <span className="ovb-dot" aria-hidden="true" />
            {t('home.voteNeedYouMany', { count: votes.length })}
          </div>
          <div className="ovb-list">
            {votes.map(v => (
              <Link key={v.voteId} href={`/app/voice/${v.meetingId}`} className="ovb-list-row">
                <div className="ovb-body">
                  <div className="ovb-motion">{v.motion}</div>
                  <div className="ovb-meta">{voteMeta(v, t)}</div>
                </div>
                <svg className="ovb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </Link>
            ))}
          </div>
          <Link href="/app/voice" className="ovb-see-all">{t('home.voteSeeAll', { count: votes.length })}</Link>
        </>
      )}
    </section>
  )
}

// ---------- Quick Actions card ----------

type QaItem = { icon: 'pay' | 'note' | 'cal' | 'mail'; title: string; sub: string; href?: string; onClick?: () => void }

function QuickActions() {
  const t = useT()
  // Pay happens in a popup right here; the rest navigate. Submit a request and
  // Contact management both land on Contact but pre-select a different category
  // (?cat=), so they're not the same destination.
  const { isTenant } = useMyResident()
  const [payOpen, setPayOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const items: QaItem[] = [
    // "Make payment" is owner-only — dues are the owner's obligation.
    ...(isTenant ? [] : [{ icon: 'pay' as const, title: t('home.qaMakePayment'), sub: t('home.qaMakePaymentSub'), onClick: () => setPayOpen(true) }]),
    { icon: 'note', title: t('home.qaSubmitRequest'),  sub: t('home.qaSubmitRequestSub'),  onClick: () => setRequestOpen(true) },
    { icon: 'mail', title: t('home.qaContact'),        sub: t('home.qaContactSub'), onClick: () => setContactOpen(true) },
    { icon: 'cal',  title: t('home.qaViewCalendar'),   sub: t('home.qaViewCalendarSub'),     onClick: () => setCalOpen(true) },
  ]
  const inner = (a: QaItem) => (
    <>
      <div className="qa-icon"><QaIcon name={a.icon} /></div>
      <div className="qa-body">
        <div className="qa-title">{a.title}</div>
        <div className="qa-sub">{a.sub}</div>
      </div>
      <svg className="qa-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </>
  )
  return (
    <div className="qa-card">
      <div className="qa-eyebrow">{t('home.qaTitle')}</div>
      <div className="qa-list">
        {items.map(a => a.href
          ? <Link key={a.title} href={a.href} className="qa-row">{inner(a)}</Link>
          : <button key={a.title} type="button" className="qa-row" onClick={a.onClick}>{inner(a)}</button>
        )}
      </div>
      {payOpen && <QuickPayDialog onClose={() => setPayOpen(false)} />}
      {requestOpen && <RequestFormDialog title={t('home.qaSubmitRequest')} initialCategory="maintenance" onClose={() => setRequestOpen(false)} />}
      {contactOpen && <RequestFormDialog title={t('home.qaContact')} initialCategory="account" onClose={() => setContactOpen(false)} />}
      {calOpen && <CommunityCalendarDialog onClose={() => setCalOpen(false)} />}
    </div>
  )
}

// Compact month calendar in a popup — community events + holidays, click a day
// to see what's on it. Full calendar (filters, month nav depth) is one click away.
function CommunityCalendarDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const events = useScheduleEvents()
  // Pinned to May 2026 to match the demo data; arrows move the month.
  const [cur, setCur] = useState({ y: 2026, m: 4 })
  const [selected, setSelected] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; date: string; events: any[] } | null>(null)

  const showTip = (e: React.MouseEvent, date: string, evs: any[]) => {
    if (!evs.length) { setTip(null); return }
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    const tw = 240, gap = 14
    let x = e.clientX + gap
    if (x + tw + 8 > vw) x = e.clientX - tw - gap
    setTip({ x: Math.max(8, x), y: e.clientY + gap, date, events: evs })
  }

  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const byDate: Record<string, any[]> = {}
  for (const e of events) (byDate[e.date] ||= []).push(e)

  const monthLabel = new Date(cur.y, cur.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const firstDow = new Date(cur.y, cur.m, 1).getDay()
  const days = new Date(cur.y, cur.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const go = (d: number) => { let m = cur.m + d, y = cur.y; if (m < 0) { m = 11; y-- } if (m > 11) { m = 0; y++ } setCur({ y, m }); setSelected(null) }

  const selectedEvents = selected ? (byDate[selected] || []) : []

  return (
    <DetailDialog
      eyebrow={t('home.calEyebrow')}
      title={t('home.calTitle')}
      size="wide"
      onClose={onClose}
      settingsHref="/app/schedule"
      settingsLabel={t('home.calOpenFull')}
    >
      <div className="mc-head">
        <button type="button" className="mc-nav" aria-label={t('home.calPrevMonth')} onClick={() => go(-1)}>&lsaquo;</button>
        <span className="mc-month">{monthLabel}</span>
        <button type="button" className="mc-nav" aria-label={t('home.calNextMonth')} onClick={() => go(1)}>&rsaquo;</button>
      </div>
      <div className="mc-grid mc-dow">
        {t('home.calDowLetters').split(',').map((d, i) => <span key={i} className="mc-dow-cell">{d}</span>)}
      </div>
      <div className="mc-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="mc-cell mc-empty" />
          const key = iso(cur.y, cur.m, d)
          const evs = byDate[key] || []
          return (
            <button type="button" key={i}
              className={`mc-cell${evs.length ? ' has' : ''}${selected === key ? ' on' : ''}`}
              onClick={() => setSelected(evs.length ? key : null)}
              onMouseEnter={e => showTip(e, key, evs)}
              onMouseMove={e => showTip(e, key, evs)}
              onMouseLeave={() => setTip(null)}>
              <span className="mc-day">{d}</span>
              {evs.length > 0 && <span className="mc-dots">{evs.slice(0, 3).map((e, j) => <span key={j} className={`mc-dot sched-dot kind-${e.kind}`} />)}</span>}
            </button>
          )
        })}
      </div>
      {selected && (
        <div className="mc-events">
          <div className="mc-events-head">{new Date(selected + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          {selectedEvents.map(e => (
            <div key={e.id} className="mc-event">
              <span className={`mc-dot sched-dot kind-${e.kind}`} />
              <span className="mc-event-title">{e.title}</span>
              {e.time && <span className="mc-event-time">{e.time}</span>}
            </div>
          ))}
        </div>
      )}

      {tip && (
        <div className="mc-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="mc-tip-head">{new Date(tip.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          {tip.events.map(e => (
            <div key={e.id} className="mc-tip-row">
              <span className={`mc-dot sched-dot kind-${e.kind}`} />
              <span className="mc-tip-title">{e.title}</span>
              {e.time && <span className="mc-tip-time">{e.time}</span>}
            </div>
          ))}
        </div>
      )}
    </DetailDialog>
  )
}

// Pay from Home in a popup. Pick a saved card, set the amount, pay — real Stripe
// Checkout when configured, demo confirmation otherwise. The full Pay page stays
// one click away.
function QuickPayDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { resident, balance } = useMyResident() as any
  const [prefs] = usePreferences()
  const methods = prefs.payment_methods.map((pm, i) => ({ ...pm, is_default: i === 0 }))
  const due = balance == null ? 1250 : balance
  const [amount, setAmount] = useState(String(Math.round(due)))
  const [cardId, setCardId] = useState(methods[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const pay = async () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError(t('home.payErrAmount')); return }
    if (methods.length && !cardId) { setError(t('home.payErrMethod')); return }
    if (stripeEnabled && supabase && resident) {
      setError('')
      openCheckout({
        fn: 'create-checkout',
        body: { resident_id: resident.id, amount: amt },
        onComplete: () => setDone(true),
      })
    } else {
      setDone(true)
    }
  }

  return (
    <DetailDialog
      eyebrow={t('home.payEyebrow')}
      title={t('home.qaMakePayment')}
      onClose={onClose}
      settingsHref="/app/track#pay"
      settingsLabel={t('home.payOpenFull')}
      footer={done ? (
        <button type="button" className="qp-pay-btn" onClick={onClose}>{t('home.payDone')}</button>
      ) : (
        <>
          <button type="button" className="ven-cta-secondary" onClick={onClose}>{t('home.payCancel')}</button>
          <button type="button" className="qp-pay-btn" onClick={pay} disabled={busy}>
            {busy ? t('home.payStarting') : t('home.payPayAmount', { amount: Number(amount || 0).toLocaleString('en-US') })}
          </button>
        </>
      )}
    >
      {done ? (
        <p className="rd-report-blurb">{t('home.paySubmitted', { amount: Number(amount).toLocaleString('en-US') })}</p>
      ) : (
        <>
          <div className="rd-detail-top">
            <div className="rd-detail-headline">
              <span className="rd-detail-h-label">{t('home.payCurrentBalance')}</span>
              <span className="rd-detail-h-amt">{fmtMoney(due)}</span>
            </div>
          </div>

          <div className="rd-form">
            <label className="rd-form-field">
              <span className="rd-form-label">{t('home.payAmountToPay')}</span>
              <input className="rd-form-input" inputMode="decimal" value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
            </label>

            <div className="rd-form-field">
              <span className="rd-form-label">{t('home.payPaymentMethod')}</span>
              {methods.length === 0 ? (
                <a className="rd-settings-link" href="/app/track#pay">{t('home.payAddCard')}</a>
              ) : (
                <div className="qp-cards">
                  {methods.map(pm => (
                    <button type="button" key={pm.id}
                      className={`qp-card${cardId === pm.id ? ' on' : ''}`}
                      onClick={() => setCardId(pm.id)}>
                      <span className="qp-card-radio" aria-hidden="true" />
                      <span className="qp-card-label">{pm.brand} ···· {pm.last4}</span>
                      <span className="qp-card-kind">{pm.kind === 'card' ? t('home.payKindCard') : t('home.payKindBank')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="rd-form-err">{error}</p>}
          </div>
        </>
      )}
    </DetailDialog>
  )
}

function QaIcon({ name }: { name: 'pay' | 'note' | 'cal' | 'mail' }) {
  const paths = {
    pay:  <><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/></>,
    note: <><path d="M5 4h11l4 4v12H5z"/><path d="M9 12h6M9 16h6"/></>,
    cal:  <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></>,
  } as const
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

// ---------- At-a-Glance chips ----------

function GlanceCard({ icon, iconTone, value, label, captionText, captionTone }: {
  icon: 'wallet' | 'heart' | 'vault' | 'check' | 'home' | 'shield' | 'docs' | 'pie';
  iconTone?: 'orange' | 'green' | 'navy' | 'purple' | 'blue';
  value: string;
  label: string;
  captionText?: string;
  captionTone?: 'orange' | 'green' | 'red' | 'muted';
}) {
  const paths = {
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/></>,
    heart:  <><path d="M20.8 8.6a5.5 5.5 0 0 0-9.3-3 5.5 5.5 0 0 0-9.3 3c0 6.6 9.3 11.7 9.3 11.7s9.3-5.1 9.3-11.7z"/></>,
    vault:  <><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="12" r="3"/><path d="M15 9h3M15 13h3M15 17h3"/></>,
    check:  <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    home:   <><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></>,
    shield: <><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></>,
    docs:   <><rect x="6" y="4" width="13" height="16" rx="2"/><rect x="3" y="7" width="13" height="13" rx="2" fill="currentColor" fillOpacity="0.18"/><path d="M7 12h6M7 16h4"/></>,
    pie:    <><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>,
  } as const
  return (
    <div className="glance-card">
      <div className={`glance-icon tone-${iconTone || 'orange'}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {paths[icon]}
        </svg>
      </div>
      <div className="glance-label">{label}</div>
      <div className="glance-value">{value}</div>
      {captionText ? (
        <div className={`glance-caption tone-${captionTone || 'muted'}`}>{captionText}</div>
      ) : null}
    </div>
  )
}

// ---------- Recent Activity ----------

function RecentActivity({ demo }: { demo: boolean }) {
  const t = useT()
  const { decisions, loading } = useBoardDecisions(5) as { decisions: any[] | null; loading: boolean }
  const list = decisions ?? (demo ? DEMO_ACTIVITY : [])
  const empty = !demo && decisions !== null && decisions.length === 0 && !loading

  return (
    <section className="activity-card">
      <div className="activity-head">
        <div className="activity-title">{t('home.activityTitle')}</div>
        <Link href="/app/voice#board" className="activity-see-all">{t('home.activityViewAll')}</Link>
      </div>
      {empty ? (
        <div className="activity-empty">{t('home.activityEmpty')}</div>
      ) : (
        <div className="activity-list">
          {list.slice(0, 4).map((a: any, i: number) => {
            const tone = ACTIVITY_TONE[a.status as keyof typeof ACTIVITY_TONE] || 'navy'
            const dateText = a.decided_on
              ? new Date(a.decided_on + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : ''
            return (
              <div key={a.id ?? i} className="activity-row">
                <div className={`activity-icon tone-${tone}`}>
                  <ActivityIcon name={ACTIVITY_ICON[a.status as keyof typeof ACTIVITY_ICON] || 'doc'} />
                </div>
                <div className="activity-body">
                  <div className="activity-row-title">{a.title}</div>
                  {a.vendor && <div className="activity-row-sub">{a.vendor}</div>}
                </div>
                <div className="activity-right">
                  {a.amount != null && (
                    <div className={`activity-amount tone-${tone}`}>{fmtMoney(a.amount)}</div>
                  )}
                  <div className="activity-date">{dateText}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const STATUS_LABEL = {
  approved:   'Approved',
  pending:    'Pending',
  paid:       'Paid',
  discussion: 'In discussion',
} as const

const ACTIVITY_TONE = {
  approved:   'green',
  paid:       'green',
  pending:    'orange',
  discussion: 'navy',
} as const

const ACTIVITY_ICON = {
  approved:   'check',
  paid:       'check',
  pending:    'leaf',
  discussion: 'doc',
} as const

function ActivityIcon({ name }: { name: 'check' | 'leaf' | 'doc' | 'paint' }) {
  const paths = {
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    leaf:  <><path d="M11 20A7 7 0 0 1 4 13c0-4 3-9 9-10 2 5 1 11-2 14a7 7 0 0 1 0 3z"/><path d="M2 21c4-3 7-6 10-12"/></>,
    doc:   <><rect x="4" y="3" width="14" height="18" rx="2"/><path d="M8 8h6M8 12h6M8 16h4"/></>,
    paint: <><path d="M5 4h14v6H5z"/><path d="M7 10v3a2 2 0 0 0 2 2h2v4h2v-4h2a2 2 0 0 0 2-2v-3"/></>,
  } as const
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

const DEMO_ACTIVITY = [
  { id: 'a1', title: 'Approved annual landscaping contract', vendor: 'Oak Ridge Nursery',   amount: 19820, decided_on: '2026-05-21', status: 'approved' },
  { id: 'a2', title: 'Pool resurfacing — bids under review',  vendor: 'Miramar Aquatics',   amount: 14500, decided_on: '2026-05-18', status: 'pending'  },
  { id: 'a3', title: 'Gate motor replacement invoice paid',   vendor: 'SecureGate Co',      amount: 1840,  decided_on: '2026-05-15', status: 'paid'     },
  { id: 'a4', title: 'Reserve study commissioned for 2027 budget', vendor: null,            amount: null,  decided_on: '2026-05-13', status: 'discussion' },
  { id: 'a5', title: 'Holiday lighting contract renewed',     vendor: 'FestivaLux',         amount: 2400,  decided_on: '2026-05-09', status: 'approved' },
]

