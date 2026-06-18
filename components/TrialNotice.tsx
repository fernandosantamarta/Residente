'use client'

import Link from 'next/link'
import type { TrialState } from '@/lib/trial'

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Countdown bar shown across the admin while a community is in its 3 free
// months. Turns orange in the final two weeks so the board has runway to get
// payment on a meeting agenda before it bills.
export function TrialBanner({ state }: { state: TrialState }) {
  if (state.phase !== 'trial' || !state.endsAt) return null
  const urgent = state.daysLeft <= 14
  const dayWord = state.daysLeft === 1 ? 'day' : 'days'
  return (
    <div style={{
      background: urgent ? '#E14909' : '#1F2233', color: '#fff',
      padding: '9px 18px', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 600, flexWrap: 'wrap',
    }}>
      <span>
        {urgent ? 'Your free months are almost up. ' : 'You are on your 3 free months. '}
        They end <strong>{fmtDate(state.endsAt)}</strong> · {state.daysLeft} {dayWord} left.
        Add payment to keep your community running.
      </span>
      <Link href="/admin/billing" style={{
        background: '#fff', color: '#E14909', textDecoration: 'none',
        padding: '6px 14px', borderRadius: 7, fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap',
      }}>
        Add payment
      </Link>
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
