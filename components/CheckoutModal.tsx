'use client'

import { useEffect, useState } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { TrialCountdown } from './TrialCountdown'
import { useT } from '@/lib/i18n'

// Generic in-app Stripe Embedded Checkout modal — powers EVERY checkout
// (subscription, dues, autopay, amenities, fines). `createSession` calls the
// relevant edge fn in embedded mode and returns the session's client_secret plus,
// for Stripe Connect flows, the connected `account` (so loadStripe scopes to the
// HOA's account). Sessions are created with redirect_on_completion:'never', so
// onComplete fires in-app and we let the caller close + refresh — no redirect out.
let pkCache: string | null = null
async function getPk(): Promise<string | null> {
  if (pkCache) return pkCache
  try {
    const res = await fetch('/api/stripe/config')
    const { publishableKey } = await res.json()
    pkCache = publishableKey || null
    return pkCache
  } catch {
    return null
  }
}

export function CheckoutModal({ createSession, onClose, onComplete, title, countdownTo }: {
  createSession: () => Promise<{ clientSecret: string; account?: string | null }>
  onClose: () => void
  onComplete?: () => void
  title?: string
  countdownTo?: Date | null
}) {
  const t = useT()
  const [ready, setReady] = useState<{ stripe: Promise<Stripe | null>; clientSecret: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pk = await getPk()
        if (!pk) throw new Error(t('checkout.unavailable'))
        const { clientSecret, account } = await createSession()
        if (cancelled) return
        setReady({ stripe: loadStripe(pk, account ? { stripeAccount: account } : undefined), clientSecret })
      } catch (e) {
        if (!cancelled) setErr((e as Error)?.message || t('checkout.unavailable'))
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cho-overlay" onClick={onClose}>
      <div className="cho-modal" onClick={(e) => e.stopPropagation()}>
        <button className="cho-close" onClick={onClose} aria-label={t('admin.billing.close')}>×</button>
        {countdownTo && <TrialCountdown to={countdownTo} />}
        <div className="cho-body">
          {err ? (
            <div className="cho-msg">{err}</div>
          ) : ready ? (
            <EmbeddedCheckoutProvider stripe={ready.stripe} options={{ clientSecret: ready.clientSecret, onComplete }}>
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
