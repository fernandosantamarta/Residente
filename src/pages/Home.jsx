export default function Home() {
  return (
    <>
      <div className="hero-head">
        <h1 className="headline">Sunset Lakes</h1>
        <div className="sub">
          166 homes<span className="bullet">·</span>Miramar, FL<span className="bullet">·</span>47% through the year
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
              <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="11"/>
              <circle cx="100" cy="100" r="88" fill="none" stroke="url(#gradMain)" strokeWidth="11" strokeLinecap="round" strokeDasharray="553" strokeDashoffset="132.7"/>
              <circle cx="100" cy="100" r="72" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="11"/>
              <circle cx="100" cy="100" r="72" fill="none" stroke="url(#gradMain)" strokeWidth="11" strokeLinecap="round" strokeDasharray="452.4" strokeDashoffset="108.6"/>
              <circle cx="100" cy="100" r="56" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="11"/>
              <circle cx="100" cy="100" r="56" fill="none" stroke="url(#gradWarn)" strokeWidth="11" strokeLinecap="round" strokeDasharray="351.86" strokeDashoffset="31.67"/>
              <circle cx="100" cy="100" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="11"/>
              <circle cx="100" cy="100" r="40" fill="none" stroke="url(#gradMain)" strokeWidth="11" strokeLinecap="round" strokeDasharray="251.33" strokeDashoffset="213.63"/>
            </g>
          </svg>
          <div className="ring-center-label">
            <div className="pct">76%</div>
            <div className="lbl">Annual Budget</div>
          </div>
        </div>

        <div className="money">
          <div className="label">Spent this year</div>
          <div className="amount">$47,200</div>
          <div className="of">of $62,000<span style={{ color: 'var(--text-faint)' }}>  ·  </span>76% spent this year</div>
          <div className="pace-chip">
            <span className="warn-ic">!</span>
            <span>Over pace</span>
          </div>
          <div style={{ display: 'flex', gap: 28, marginTop: 16, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Expected pace</div>
              <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.4px', color: 'var(--text-dim)' }}>47%</div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Actual pace</div>
              <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.4px', background: 'var(--grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>76%</div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Delta</div>
              <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.4px', color: 'var(--pink)' }}>+29pp</div>
            </div>
          </div>
        </div>
      </div>

      <div className="burn">
        <div className="burn-header">
          <div>
            <div className="section-title">Year-to-date Burn</div>
            <div className="section-sub" style={{ marginTop: 4 }}>Cumulative spend vs. expected pace · Fiscal 2026</div>
          </div>
          <div className="burn-legend">
            <span><span className="sw-grad"></span> Cumulative spend</span>
            <span><span className="sw-dot"></span> Expected pace</span>
          </div>
        </div>

        <div className="burn-chart">
          <div className="burn-grid">
            <div className="line"><span>$62k</span></div>
            <div className="line"><span>$47k</span></div>
            <div className="line"><span>$31k</span></div>
            <div className="line"><span>$15k</span></div>
            <div className="line"><span>$0</span></div>
          </div>

          <div className="burn-bars">
            <BarCol month="Jan" cls="filled" h={17} />
            <BarCol month="Feb" cls="filled" h={36} />
            <BarCol month="Mar" cls="filled" h={56} />
            <BarCol month="Apr" cls="overshoot" h={76} thisMonth />
            {['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => (
              <BarCol key={m} month={m} cls="empty" h={4} />
            ))}
          </div>

          <div className="pace-line">
            <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
              <line x1="0" y1="120" x2="1200" y2="0" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="6 5"/>
              <circle cx="400" cy="80" r="3" fill="#FFFFFF" opacity="0.5"/>
            </svg>
          </div>
        </div>
      </div>

      <div className="cat-row">
        <CatCard label="Landscape" amount="$12.8k" pct={76} of="$16,800" />
        <CatCard label="Security"  amount="$8.4k"  pct={62} of="$13,500" />
        <CatCard label="Amenities" amount="$14.5k" pct={91} of="$15,900" warn />
        <CatCard label="Reserves"  amount="$1.5k"  pct={15} of="$10,000" />
      </div>
    </>
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

function CatCard({ label, amount, pct, of, warn }) {
  const dashOffset = 125.66 - (125.66 * pct / 100)
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
      <div className="cat-amount">{amount}</div>
      <div className="cat-pct"><span className="pct-pill">{pct}%</span> of {of}</div>
    </div>
  )
}
