'use client'

import { useEffect, useState } from 'react'

// Live "Starts in DD HH MM SS" countdown. Shared by the Meetings dashboard
// rail and the Board tab's upcoming-meeting card. First paint is deterministic
// (no Date.now() until mounted) so SSR and client agree.
export function Countdown({ to, label = 'Starts in', compact = false }: { to: string; label?: string; compact?: boolean }) {
  const [now, setNow] = useState<number>(() => +new Date(to) - 1)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [])
  const diff = Math.max(0, +new Date(to) - now)
  const cells = [
    { n: Math.floor(diff / 86400000), l: 'days' },
    { n: Math.floor((diff % 86400000) / 3600000), l: 'hrs' },
    { n: Math.floor((diff % 3600000) / 60000), l: 'min' },
    { n: Math.floor((diff % 60000) / 1000), l: 'sec' },
  ]
  return (
    <div className={`vd-countdown${compact ? ' compact' : ''}`}>
      <div className="vd-countdown-label">{label}</div>
      <div className="vd-countdown-cells">
        {cells.map(c => (
          <span key={c.l} className="vd-cd-cell">
            <span className="vd-cd-num">{String(c.n).padStart(2, '0')}</span>
            <span className="vd-cd-unit">{c.l}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
