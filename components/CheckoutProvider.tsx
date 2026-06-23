'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { CheckoutModal } from './CheckoutModal'
import { embeddedCheckout } from '@/lib/checkout'

// App-wide host for the in-app Stripe Embedded Checkout. Any component calls
// useCheckout().openCheckout({ fn, body, returnUrl }) to pay without leaving the
// app. On completion we navigate to returnUrl (same-origin, e.g.
// /app/track?submitted=1#pay) or run a custom onComplete.
export type CheckoutArgs = {
  fn: string
  body?: Record<string, unknown>
  returnUrl?: string
  onComplete?: () => void
  title?: string
  countdownTo?: Date | null
}

const Ctx = createContext<{ openCheckout: (a: CheckoutArgs) => void }>({ openCheckout: () => {} })
export const useCheckout = () => useContext(Ctx)

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<CheckoutArgs | null>(null)
  return (
    <Ctx.Provider value={{ openCheckout: setArgs }}>
      {children}
      {args && (
        <CheckoutModal
          title={args.title}
          countdownTo={args.countdownTo ?? null}
          createSession={() => embeddedCheckout(args.fn, args.body || {})}
          onClose={() => setArgs(null)}
          onComplete={() => {
            setArgs(null)
            if (args.onComplete) args.onComplete()
            else if (args.returnUrl) window.location.assign(args.returnUrl)
          }}
        />
      )}
    </Ctx.Provider>
  )
}
