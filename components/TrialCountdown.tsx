'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'

// Live ticking countdown to a target date (the end of the 3-month free trial).
// Rendered at the top of the subscribe popup to add a little urgency/delight.
function split(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

export function TrialCountdown({ to }: { to: Date }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { d, h, m, s } = split(to.getTime() - now)
  const urgent = to.getTime() - now < 14 * 86400 * 1000
  const boxes = [
    { v: d, l: t('countdown.days') },
    { v: h, l: t('countdown.hours') },
    { v: m, l: t('countdown.mins') },
    { v: s, l: t('countdown.secs') },
  ]
  return (
    <div className={`cd-wrap${urgent ? ' cd-urgent' : ''}`}>
      <div className="cd-label">{t('countdown.label')}</div>
      <div className="cd-boxes">
        {boxes.map((b, i) => (
          <div className="cd-box" key={i}>
            <span className="cd-num">{String(b.v).padStart(2, '0')}</span>
            <span className="cd-unit">{b.l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
