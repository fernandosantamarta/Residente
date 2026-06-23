'use client'

// Tenant rent-demand banner — the ONE place a tenant sees a payment screen.
// When the association has issued a rent demand against the unit (owner is
// delinquent), the tenant is directed to pay rent to the HOA until the balance
// clears (FS 720.3085(8) / 718.116(11)). Paying runs the same Stripe Connect
// dues checkout against the unit's resident_id — the tenant RLS lets them read
// their unit, so the payment lands on the unit and reduces the owner's balance.
// Renders nothing unless the signed-in user has an active demand.

import { useState } from 'react'
import { useMyRentDemand } from '@/hooks/useMyRentDemand'
import { useCheckout } from '@/components/CheckoutProvider'
import { useT } from '@/lib/i18n'

const fmt$ = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

export function RentDemandBanner() {
  const t = useT()
  const { demand, loading } = useMyRentDemand()
  const { openCheckout } = useCheckout()
  const directed = Number(demand?.obligation_at_demand) || 0
  const [amount, setAmount] = useState('')
  const [paid, setPaid] = useState(false)

  if (loading || !demand) return null

  const pay = () => {
    const amt = Number(amount) || directed
    if (amt <= 0) return
    openCheckout({
      fn: 'create-checkout',
      body: { resident_id: demand.resident_id, amount: amt },
      title: t('rentDemand.payTitle'),
      onComplete: () => setPaid(true),
    })
  }

  return (
    <section className="rdmd-banner">
      <div className="rdmd-head">
        <span className="rdmd-badge">{t('rentDemand.badge')}</span>
        <h2 className="rdmd-title">{t('rentDemand.title')}</h2>
      </div>
      <p className="rdmd-body">
        {t('rentDemand.body', { amount: fmt$(directed) })}
      </p>
      {paid ? (
        <div className="rdmd-paid">{t('rentDemand.thanks')}</div>
      ) : (
        <div className="rdmd-pay">
          <label className="rdmd-amount">
            <span className="rdmd-amount-prefix">$</span>
            <input type="number" min="0" step="0.01" inputMode="decimal"
              placeholder={String(Math.round(directed) || '')}
              value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <button type="button" className="rdmd-pay-btn" onClick={pay}>{t('rentDemand.payBtn')}</button>
        </div>
      )}
      <p className="rdmd-note">{t('rentDemand.note')}</p>
    </section>
  )
}
