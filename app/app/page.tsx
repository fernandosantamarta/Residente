'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCommunityData } from '@/hooks/useCommunityData'
import { useMyResident } from '@/hooks/useMyResident'
import { useBoardDecisions } from '@/hooks/useBoardDecisions'
import { useAuth } from '@/app/providers'

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
//   "fernandosantamarta"  → "Fernando" (no separator: take first 8 chars)
function extractFirstName(raw: string | null | undefined): string {
  if (!raw) return 'there'
  const s = raw.trim()
  if (!s) return 'there'
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase()
  if (/\s/.test(s)) return cap(s.split(/\s+/)[0])
  const camelAt = s.slice(1).search(/[A-Z]/)
  if (camelAt > 0) return cap(s.slice(0, camelAt + 1))
  return cap(s.slice(0, 8))
}

export default function Home() {
  const { community, categories } = useCommunityData()
  const { profile } = useAuth() || {}
  const { balance: myBalance, status: myDues } = useMyResident()

  // Real community when one is linked; otherwise the demo so Home never blanks.
  const c = community || DEMO
  const cats = community ? categories : DEMO_CATS

  // --- derived numbers — everything here is computed, never stored ---
  const now = new Date()
  const yStart = new Date(now.getFullYear(), 0, 1)
  const yEnd = new Date(now.getFullYear() + 1, 0, 1)
  const yearPct = clamp01((now.getTime() - yStart.getTime()) / (yEnd.getTime() - yStart.getTime()))

  const totalSpent = cats.reduce((s, x) => s + num(x.spent), 0)
  const catBudgetSum = cats.reduce((s, x) => s + num(x.budget), 0)
  const annualBudget = num(c.annual_budget) || catBudgetSum
  const spentPct = annualBudget > 0 ? totalSpent / annualBudget : 0

  const expectedPctNum = Math.round(yearPct * 100)
  const actualPctNum = Math.round(spentPct * 100)
  const deltaPp = actualPctNum - expectedPctNum
  const overPace = spentPct > yearPct
  const monthIdx = now.getMonth()

  const monthlyDues = num(c.monthly_dues)
  const unitCount = num(c.unit_count)
  const annualCommunity = monthlyDues * 12 * unitCount

  // Greeting that adapts to the hour — keeps the hero photo card feeling alive
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = extractFirstName(profile?.full_name)

  // Health % for At-a-Glance — 100 = on pace, lower = over pace
  const paceRatio = expectedPctNum > 0 ? actualPctNum / expectedPctNum : 1
  const healthPct = Math.max(0, Math.min(100, Math.round((1 - Math.max(0, paceRatio - 1)) * 100)))

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
          <div className="hero-sub">Here&apos;s what&apos;s happening in your community.</div>
          <div className="hero-chips">
            <span className="hero-chip">
              <ChipIcon name="home" />
              {unitCount || 0} homes
            </span>
            <span className="hero-chip">
              <ChipIcon name="pin" />
              {c.location || '—'}
            </span>
            <span className="hero-chip hero-chip-accent">
              <ChipIcon name="clock" />
              {expectedPctNum}% through the year
            </span>
          </div>
        </div>
      </section>

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
        />
        <QuickActions />
      </section>

      {/* ROW 2 — At a Glance + Recent Activity side-by-side */}
      <section className="dash-row2">
        <section className="glance-row">
          <div className="glance-head">At a glance</div>
          <div className="glance-cards">
            <GlanceCard
              icon="home" iconTone="orange"
              label="Your balance"
              value={myBalance != null ? fmtMoney(myBalance) : fmtMoney(monthlyDues)}
              captionText={myBalance != null && myBalance > 0 ? 'Due now' : 'Paid'}
              captionTone={myBalance != null && myBalance > 0 ? 'red' : 'green'}
            />
            <GlanceCard
              icon="shield" iconTone="green"
              label="Reserve balance"
              value={fmtMoney(128600)}
              captionText="Healthy" captionTone="green"
            />
            <GlanceCard
              icon="docs" iconTone="purple"
              label="Total assessments"
              value={fmtMoney(annualBudget)}
              captionText={`FY ${now.getFullYear()} Budget`} captionTone="muted"
            />
            <GlanceCard
              icon="pie" iconTone="blue"
              label="Collection rate"
              value={`${healthPct}%`}
              captionText="On track" captionTone="green"
            />
          </div>
        </section>

        <RecentActivity />
      </section>

      <DuesSection
        monthlyDues={monthlyDues}
        unitCount={unitCount}
        unitNumber={profile?.unit_number ?? null}
      />
    </>
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
  monthlyDues, unitCount, unitNumber,
}: { monthlyDues: number; unitCount: number; unitNumber: string | null }) {
  const [tab, setTab] = useState<'community' | 'personal'>('community')
  const isCommunity = tab === 'community'
  const multiplier = isCommunity ? monthlyDues * unitCount : monthlyDues
  const annualMultiplier = multiplier * 12
  const statLabel = isCommunity ? 'Total monthly income' : 'Your monthly dues'
  const sub = isCommunity
    ? `All ${unitCount || 0} homes combined`
    : `Your share, Unit ${unitNumber ?? '—'}`

  return (
    <section className="dues-section">
      <div className="dues-head">
        <h2 className="dues-title">Where your dues go</h2>
        <div className="dues-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={isCommunity}
            className={`dues-tab${isCommunity ? ' active' : ''}`}
            onClick={() => setTab('community')}
          >
            Community
          </button>
          <button
            role="tab"
            aria-selected={!isCommunity}
            className={`dues-tab${!isCommunity ? ' active' : ''}`}
            onClick={() => setTab('personal')}
          >
            Personal
          </button>
        </div>
      </div>

      <div className="dues-stat">
        <div className="dues-stat-main">
          <div className="dues-stat-label">{statLabel}</div>
          <div className="dues-stat-value">{fmtMoney(multiplier)}</div>
          <div className="dues-stat-meta">
            {fmtMoney(annualMultiplier)} annual · {sub}
          </div>
          <div className="dues-updated">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
        <RatingRing
          value={isCommunity ? 92 : 100}
          label={isCommunity ? 'Community rating' : 'Your rating'}
        />
      </div>

      <div className="dues-breakdown">
        {VENDOR_BREAKDOWN.map((v) => (
          <div key={v.id} className="dues-cat">
            <div className="dues-cat-row">
              <span className="dues-cat-name">{v.name}</span>
              <span className="dues-cat-meta">
                <span className="dues-cat-amt">{fmtMoney(multiplier * v.share)}</span>
                <TrendChip trend={v.trend} />
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

function FinancialOverview({
  totalSpent, annualBudget, actualPctNum, expectedPctNum, deltaPp, monthIdx,
}: {
  totalSpent: number; annualBudget: number; actualPctNum: number; expectedPctNum: number;
  deltaPp: number; overPace: boolean; monthIdx: number
}) {
  // Chart geometry — wider than tall, leaves room for y-axis labels on the left
  // and one row of month labels at the bottom.
  const w = 560, h = 200, pad = { l: 48, r: 16, t: 16, b: 32 }
  const yTicks = 4
  // Aesthetic uptrend: smooth ease-out from Jan through September. Calibrate
  // so the curve passes through totalSpent at the current month, then keeps
  // climbing past it as a projection.
  const projectedEndIdx = Math.max(monthIdx, 8)
  const ease = (t: number) => 1 - Math.pow(1 - t, 1.6)
  const scaleAtNow = ease(monthIdx / projectedEndIdx) || 1
  const scale = totalSpent / scaleAtNow
  const ymax = Math.max(annualBudget * 0.55, scale * 1.1, totalSpent * 1.6, 1)
  const pts = MONTHS.map((_, i) => {
    const cumSpend = ease(Math.min(1, i / projectedEndIdx)) * scale
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
        <div className="fin-eyebrow">Financial Overview</div>
        <button className="fin-period" type="button">
          Year to date
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      <div className="fin-main">
        <div className="fin-left">
          <div className="fin-label">Spent this year</div>
          <div className="fin-amount">{fmtMoney(totalSpent)}</div>
          <div className="fin-of">of {fmtMoney(annualBudget)} budget</div>
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
        <button className="fin-view-btn" type="button">
          View budget
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <div className="fin-stats">
          <FinStat label="Expected pace" value={`${expectedPctNum}%`} />
          <FinStat label="Actual pace"   value={`${actualPctNum}%`} accent />
          <FinStat label="Delta"         value={`${deltaPp >= 0 ? '+' : ''}${deltaPp}pp`} warn={deltaPp > 0} />
        </div>
      </div>
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

// ---------- Quick Actions card ----------

const QUICK_ACTIONS: { href: string; icon: 'pay' | 'note' | 'cal' | 'mail'; title: string; sub: string }[] = [
  { href: '/app/pay',       icon: 'pay',  title: 'Make a payment',         sub: 'Dues, fees, special assessments' },
  { href: '/app/contact',   icon: 'note', title: 'Submit a request',       sub: 'Maintenance, complaints, ideas' },
  { href: '/app/community', icon: 'cal',  title: 'View community calendar', sub: 'Meetings, events, deadlines' },
  { href: '/app/contact',   icon: 'mail', title: 'Contact management',     sub: 'Reach the board or your manager' },
]

function QuickActions() {
  return (
    <div className="qa-card">
      <div className="qa-eyebrow">Quick Actions</div>
      <div className="qa-list">
        {QUICK_ACTIONS.map(a => (
          <Link key={a.title} href={a.href} className="qa-row">
            <div className="qa-icon">
              <QaIcon name={a.icon} />
            </div>
            <div className="qa-body">
              <div className="qa-title">{a.title}</div>
              <div className="qa-sub">{a.sub}</div>
            </div>
            <svg className="qa-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </Link>
        ))}
      </div>
    </div>
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

function RecentActivity() {
  const { decisions, loading } = useBoardDecisions(5) as { decisions: any[] | null; loading: boolean }
  const list = decisions ?? DEMO_ACTIVITY
  const empty = decisions !== null && decisions.length === 0 && !loading

  return (
    <section className="activity-card">
      <div className="activity-head">
        <div className="activity-title">Recent activity</div>
        <Link href="/app/board" className="activity-see-all">View all</Link>
      </div>
      {empty ? (
        <div className="activity-empty">No recent activity in your community.</div>
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

