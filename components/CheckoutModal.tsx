'use client'

import { useEffect, useState } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { TrialCountdown } from './TrialCountdown'
import { useT } from '@/lib/i18n'

// Generic in-app Stripe Embedded Checkout modal. `fetchClientSecret` returns the
// embedded session's client_secret from whichever checkout edge fn this is for,
// so the same modal powers every checkout (subscription, dues, fines, amenities,
// autopay). On completion Stripe fires onComplete (sessions are created with
// redirect_on_completion:'never'), so we close + let the caller refresh in place.
let stripeCache: Promise<Stripe | null> | null = null
async function getStripe(): Promise<Stripe | null> {
  if (stripeCache) return stripeCache
  try {
    const res = await fetch('/api/stripe/config')
    const { publishableKey } = await res.json()
    if (!publishableKey) return null
    stripeCache = loadStripe(publishableKey)
    return stripeCache
  } catch {
    return null
  }
}

export function CheckoutModal({ fetchClientSecret, onClose, onComplete, title, countdownTo }: {
  fetchClientSecret: () => Promise<string>
  onClose: () => void
  onComplete?: () => void
  title?: string
  countdownTo?: Date | null
}) {
  const t = useT()
  const [stripe, setStripe] = useState<Promise<Stripe | null> | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let cancelled = false
    getStripe().then((s) => {
      if (cancelled) return
      if (s) setStripe(Promise.resolve(s)); else setErr(true)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="cho-overlay" onClick={onClose}>
      <div className="cho-modal" onClick={(e) => e.stopPropagation()}>
        <button className="cho-close" onClick={onClose} aria-label={t('admin.billing.close')}>×</button>
        {title && <div className="cho-title">{title}</div>}
        {countdownTo && <TrialCountdown to={countdownTo} />}
        <div className="cho-body">
          {err ? (
            <div className="cho-msg">{t('checkout.unavailable')}</div>
          ) : stripe ? (
            <EmbeddedCheckoutProvider stripe={stripe} options={{ fetchClientSecret, onComplete }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          ) : (
            <div className="cho-msg">{t('checkout.loading')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
