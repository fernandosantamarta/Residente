import { useCommunityData } from '../hooks/useCommunityData'
import { useMyResident } from '../hooks/useMyResident'
import { useAuth } from '../App'

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
// Concentric ring radii + their circumferences (2·π·r) for the budget dial.
const RINGS = [
  { r: 88, c: 552.92 },
  { r: 72, c: 452.39 },
  { r: 56, c: 351.86 },
  { r: 40, c: 251.33 },
]
const WARN_AT = 0.85 // a category spent ≥ 85% of its budget shows the warn gradient

const clamp01 = (n) => Math.max(0, Math.min(1, n))
const num = (v) => Number(v) || 0
const fmtMoney = (n) => '$' + Math.round(num(n)).toLocaleString('en-US')
const fmtK = (n) => (num(n) >= 1000 ? '$' + (num(n) / 1000).toFixed(1) + 'k' : '$' + Math.round(num(n)))
const fmtAxis = (n) => (num(n) < 500 ? '$0' : '$' + Math.round(num(n) / 1000) + 'k')

export default function Home() {
  const { community, categories } = useCommunityData()
  const { profile } = useAuth() || {}
  const { resident } = useMyResident()

  // Real community when one is linked; otherwise the demo so Home never blanks.
  const c = community || DEMO
  const cats = community ? categories : DEMO_CATS

  // --- derived numbers — everything here is computed, never stored ---
  const now = new Date()
  const yStart = new Date(now.getFullYear(), 0, 1)
  const yEnd = new Date(now.getFullYear() + 1, 0, 1)
  const yearPct = clamp01((now - yStart) / (yEnd - yStart))

  const totalSpent = cats.reduce((s, x) => s + num(x.spent), 0)
  const catBudgetSum = cats.reduce((s, x) => s + num(x.budget), 0)
  const annualBudget = num(c.annual_budget) || catBudgetSum
  const spentPct = annualBudget > 0 ? totalSpent / annualBudget : 0

  const expectedPctNum = Math.round(yearPct * 100)
  const actualPctNum = Math.round(spentPct * 100)
  const deltaPp = actualPctNum - expectedPctNum
  const overPace = spentPct > yearPct
  const monthIdx = now.getMonth()
  const unit = profile?.unit_number ? String(profile.unit_number) : '—'
  const myBalance = resident ? num(resident.balance) : null
  const myDues = resident?.dues_status || 'paid'

  return (
    <>
      <div className="hero-head">
        <h1 className="headline">{c.name || 'My Community'}</h1>
        <div className="sub">
          {num(c.unit_count)} homes<span className="bullet">·</span>
          {c.location || '—'}<span className="bullet">·</span>
          {expectedPctNum}% through the year
        </div>
      </div>

      <div className="hero-row">
        <div className="rings-wrap">
          <svg width="420" height="420" viewBox="0 0 200 200">
            <defs>
              <linearGradient id="gradMain" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FF3B5F"/>
                <stop offset="50%" stopColor="#B83377"/>
                <stop offset="100%" stopColor="#4F2B8C"/>
              </linearGradient>
              <linearGradient id="gradWarn" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FF3B5F"/>
                <stop offset="100%" stopColor="#FF8BA8"/>
              </linearGradient>
            </defs>
            <g transform="rotate(-90 100 100)">
              {RINGS.map((ring, i) => {
                const cat = cats[i]
                const p = cat ? clamp01(num(cat.budget) > 0 ? num(cat.spent) / num(cat.budget) : 0) : 0
                const gradId = p >= WARN_AT ? 'gradWarn' : 'gradMain'
                return (
                  <g key={ring.r}>
                    <circle cx="100" cy="100" r={ring.r} fill="none"
                      stroke="rgba(255,255,255,0.05)" strokeWidth="11"/>
                    {cat && (
                      <circle cx="100" cy="100" r={ring.r} fill="none"
                        stroke={`url(#${gradId})`} strokeWidth="11" strokeLinecap="round"
                        strokeDasharray={ring.c} strokeDashoffset={ring.c * (1 - p)}/>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
          <div className="ring-center-label">
            <div className="pct">{actualPctNum}%</div>
            <div className="lbl">Annual Budget</div>
          </div>
        </div>

        <div className="money">
          <div className="label">Spent this year</div>
          <div className="amount">{fmtMoney(totalSpent)}</div>
          <div className="of">
            of {fmtMoney(annualBudget)}
            <span style={{ color: 'var(--text-faint)' }}>  ·  </span>
            {actualPctNum}% spent this year
          </div>
          <div className="pace-chip">
            {overPace
              ? <><span className="warn-ic">!</span><span>Over pace</span></>
              : <span>On pace</span>}
          </div>
          <div style={{ display: 'flex', gap: 28, marginTop: 16, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Expected pace</div>
              <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.4px', color: 'var(--text-dim)' }}>{expectedPctNum}%</div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Actual pace</div>
              <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.4px', background: 'var(--grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{actualPctNum}%</div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Delta</div>
              <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.4px', color: deltaPp > 0 ? 'var(--pink)' : 'var(--text-dim)' }}>
                {deltaPp >= 0 ? '+' : ''}{deltaPp}pp
              </div>
            </div>
          </div>
        </div>
      </div>

      <YourMoney community={c} categories={cats} unit={unit}
        balance={myBalance} duesStatus={myDues} />

      <div className="burn">
        <div className="burn-header">
          <div>
            <div className="section-title">Year-to-date Burn</div>
            <div className="section-sub" style={{ marginTop: 4 }}>
              Cumulative spend vs. expected pace · Fiscal {c.fiscal_year || now.getFullYear()}
            </div>
          </div>
          <div className="burn-legend">
            <span><span className="sw-grad"></span> Cumulative spend</span>
            <span><span className="sw-dot"></span> Expected pace</span>
          </div>
        </div>

        <div className="burn-chart">
          <div className="burn-grid">
            <div className="line"><span>{fmtAxis(annualBudget)}</span></div>
            <div className="line"><span>{fmtAxis(annualBudget * 0.75)}</span></div>
            <div className="line"><span>{fmtAxis(annualBudget * 0.5)}</span></div>
            <div className="line"><span>{fmtAxis(annualBudget * 0.25)}</span></div>
            <div className="line"><span>$0</span></div>
          </div>

          <div className="burn-bars">
            {MONTHS.map((m, i) => {
              const isCurrent = i === monthIdx
              const h = isCurrent ? Math.max(4, Math.min(100, spentPct * 100)) : 4
              const cls = isCurrent ? (overPace ? 'overshoot' : 'filled') : 'empty'
              return <BarCol key={m} month={m} cls={cls} h={h} thisMonth={isCurrent} />
            })}
          </div>

          <div className="pace-line">
            <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
              <line x1="0" y1="120" x2="1200" y2="0" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="6 5"/>
              <circle cx={((monthIdx + 0.5) / 12) * 1200} cy={120 - yearPct * 120} r="3" fill="#FFFFFF" opacity="0.5"/>
            </svg>
          </div>
        </div>
      </div>

      <div className="cat-row">
        {cats.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', width: '100%', padding: '20px 4px', color: 'var(--text-dim)', fontSize: 14 }}>
            No budget categories yet — add them in Admin → Community.
          </div>
        ) : (
          cats.map(cat => (
            <CatCard key={cat.id || cat.name} label={cat.name} spent={num(cat.spent)} budget={num(cat.budget)} />
          ))
        )}
      </div>
    </>
  )
}

// Personal lens — turns the community budget into "your share" via dues per
// unit. Assumes equal dues; tiered dues would need per-resident data later.
function YourMoney({ community, categories, unit, balance, duesStatus }) {
  const monthlyDues = num(community.monthly_dues)
  const unitCount = num(community.unit_count)
  const canCompute = monthlyDues > 0 && unitCount > 0

  return (
    <div className="you-panel">
      <div className="you-head">
        <div>
          <div className="you-title">Your money</div>
          <div className="you-sub">Your dues, and exactly where they go</div>
        </div>
        {canCompute && (
          <div className="you-sub">
            {unit !== '—' && <>Unit {unit} · </>}{fmtMoney(monthlyDues)}/mo
          </div>
        )}
      </div>

      {balance != null && (balance > 0 ? (
        <div className="you-owe warn">
          <span className="you-owe-label">You currently owe</span>
          <span className="you-owe-amt">{fmtMoney(balance)}</span>
          <span className="you-owe-tag">{duesStatus === 'late' ? 'Late' : 'Due'}</span>
        </div>
      ) : (
        <div className="you-owe ok">
          <span className="you-owe-label">Dues</span>
          <span className="you-owe-amt">Paid up</span>
          <span className="you-owe-check">✓</span>
        </div>
      ))}

      {!canCompute ? (
        <div className="you-hint">
          Add <strong>homes / units</strong> and <strong>dues per unit</strong> on
          the Admin → Community page to see your share of the budget.
        </div>
      ) : (
        <>
          <div className="you-stats">
            <div className="you-stat">
              <div className="you-stat-label">You contribute</div>
              <div className="you-stat-val">
                {fmtMoney(monthlyDues * 12)}<span className="you-stat-unit"> /yr</span>
              </div>
            </div>
            <div className="you-stat">
              <div className="you-stat-label">Community collects</div>
              <div className="you-stat-val grad">
                {fmtMoney(monthlyDues * 12 * unitCount)}<span className="you-stat-unit"> /yr</span>
              </div>
            </div>
          </div>

          <div className="you-rows-label">Where your share goes</div>
          {categories.length === 0 ? (
            <div className="you-hint">No budget categories yet — add them in Admin → Community.</div>
          ) : (
            categories.map(cat => {
              const cb = num(cat.budget), cs = num(cat.spent)
              const pct = cb > 0 ? Math.round((cs / cb) * 100) : 0
              const warn = pct >= WARN_AT * 100
              return (
                <div className="you-row" key={cat.id || cat.name}>
                  <span className="you-row-label">{cat.name}</span>
                  <span className="you-row-amt">{fmtMoney(cs / unitCount)} of {fmtMoney(cb / unitCount)}</span>
                  <div className="you-bar-track">
                    <div className={`you-bar-fill${warn ? ' warn' : ''}`}
                      style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <span className={`you-row-pct${warn ? ' warn' : ''}`}>{pct}%</span>
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}

function BarCol({ month, cls, h, thisMonth }) {
  return (
    <div className={`bar-col${thisMonth ? ' this-month' : ''}`}>
      <div className={`bar ${cls}`} style={{ height: `${h}%` }}></div>
      <span className="bar-label">{month}</span>
    </div>
  )
}

function CatCard({ label, spent, budget }) {
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0
  const warn = pct >= WARN_AT * 100
  const dashOffset = 125.66 - (125.66 * Math.min(pct, 100) / 100)
  const gradId = warn ? 'gradWarn' : 'gradMain'
  return (
    <div className={`cat-card${warn ? ' warn' : ''}`}>
      <div className="cat-top">
        <div className="cat-label">{label}</div>
        <svg className="cat-mini-ring" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4"/>
          <g transform="rotate(-90 24 24)">
            <circle cx="24" cy="24" r="20" fill="none" stroke={`url(#${gradId})`} strokeWidth="4" strokeLinecap="round" strokeDasharray="125.66" strokeDashoffset={dashOffset}/>
          </g>
        </svg>
      </div>
      <div className="cat-amount">{fmtK(spent)}</div>
      <div className="cat-pct"><span className="pct-pill">{pct}%</span> of {fmtMoney(budget)}</div>
    </div>
  )
}
