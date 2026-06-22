'use client'

import Link from 'next/link'
import type { TrialState } from '@/lib/trial'

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Countdown bar shown across the admin while a community is in its 3 free
// months. Warm + inviting early on (a gift, not a nag); shifts to an urgent
// orange in the final two weeks. Styling lives in admin.css (.trial-banner*) so
// it can own the iOS safe-area inset — it's the topmost element on the page, so
// it must clear the status bar / notch (the header below then drops its inset).
export function TrialBanner({ state }: { state: TrialState }) {
  if (state.phase !== 'trial' || !state.endsAt) return null
  const urgent = state.daysLeft <= 14
  const dayWord = state.daysLeft === 1 ? 'day' : 'days'
  return (
    <div className="trial-banner" data-urgent={urgent ? '1' : undefined}>
      <div className="trial-banner-main">
        <span className="trial-banner-badge" aria-hidden="true">{urgent ? '⏳' : '🎁'}</span>
        <span className="trial-banner-text">
          <strong className="trial-banner-lead">
            {urgent
              ? `${state.daysLeft} ${dayWord} left of your free trial`
              : 'You’re on 3 months free'}
          </strong>
          <span className="trial-banner-sub">
            {urgent
              ? <>Add payment to keep your community running before<br />{fmtDate(state.endsAt)}</>
              : <>{state.daysLeft} {dayWord} left. Add payment anytime before<br />{fmtDate(state.endsAt)}</>}
          </span>
        </span>
      </div>
      <Link href="/admin/billing" className="trial-banner-cta">Add payment</Link>
    </div>
  )
}

// Soft block shown once the 3 free months have ended and no payment is on
// file. Data is untouched in the database — this only gates the UI until the
// board adds payment. The billing page itself is never gated (see the layout).
export function TrialGate({ communityName }: { communityName: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 20px' }}>
      <div style={{
        maxWidth: 560, textAlign: 'center', background: '#fff', borderRadius: 18,
        padding: '40px 36px', boxShadow: '0 20px 50px rgba(20,24,40,0.12)',
      }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '1.5px', color: '#E14909', marginBottom: 14 }}>
          YOUR FREE MONTHS HAVE ENDED
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1F2233', margin: '0 0 14px', lineHeight: 1.2 }}>
          Add payment to keep {communityName} running.
        </h1>
        <p style={{ fontSize: 16, color: '#5C5747', lineHeight: 1.5, margin: '0 0 26px' }}>
          Your 3 free months are up. Everything in your community is safe and waiting.
          Add a bank account or card and you are right back in, exactly where you left off.
        </p>
        <Link href="/admin/billing" style={{
          display: 'inline-block', background: '#E14909', color: '#fff', textDecoration: 'none',
          padding: '13px 26px', borderRadius: 10, fontWeight: 700, fontSize: 15,
        }}>
          Add payment to continue
        </Link>
      </div>
    </div>
  )
}
