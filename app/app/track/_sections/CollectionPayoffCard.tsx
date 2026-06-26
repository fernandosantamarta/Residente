'use client'

// Collection balance card — shows an owner the full statutory payoff on their
// open collection case (principal + interest + late fees + collection/mailing
// costs) computed live with casePayoff, and lets them pay it in one shot to clear
// the case. Hidden for owners in good standing or already on an active plan (the
// PaymentPlanCard owns installment payments). Mirrors PaymentPlanCard.

import { fmtMoney, casePayoff } from '@/lib/dues'
import { useMyPaymentPlan } from '@/lib/payment-plans'
import { useCheckout } from '@/components/CheckoutProvider'
import { stripeEnabled } from '@/lib/supabase'
import { useT } from '@/lib/i18n'

export function CollectionPayoffCard({ resident, community, payments }: { resident: any; community: any; payments: any[] }) {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { openCase, plan, loading } = useMyPaymentPlan()

  if (loading || !openCase || !resident) return null
  // On an active plan the PaymentPlanCard handles payments — don't double up.
  const onActivePlan = (plan?.request_status === 'approved' || plan?.request_status === 'modified') && String(plan?.status ?? '') === 'active'
  if (onActivePlan) return null

  let payoff: ReturnType<typeof casePayoff> | null = null
  try {
    const extraCosts = (Number((openCase as any).cost_balance) || 0) + (Number((openCase as any).mailing_cost_balance) || 0)
    payoff = casePayoff(resident, community, payments || [], { extraCosts })
  } catch { payoff = null }
  if (!payoff || payoff.payoff <= 0) return null
  const r = payoff.remaining

  const pay = () => {
    if (!payoff) return
    openCheckout({
      fn: 'create-checkout',
      body: { resident_id: resident.id, amount: payoff.payoff, applied_to_case: openCase.id },
      returnUrl: '/app/track?submitted=1#pay',
    })
  }

  return (
    <section className="pay-card pay-plan-card" id="collection-balance">
      <div className="pay-plan-head">
        <span className="pay-plan-eyebrow">{t('pay.collTitle')}</span>
      </div>
      <div className="pay-plan-body">
        <p className="pay-plan-intro">{t('pay.collIntro')}</p>
        <div className="pay-plan-terms">
          {t('pay.collPrincipal')} {fmtMoney(r.principal)} · {t('pay.collInterest')} {fmtMoney(r.interest)} · {t('pay.collFees')} {fmtMoney(r.lateFee)} · {t('pay.collCosts')} {fmtMoney(r.cost)}
        </div>
        <div className="pay-plan-state" style={{ fontSize: 17, marginTop: 4 }}>{t('pay.collTotal', { amount: fmtMoney(payoff.payoff) })}</div>
        {stripeEnabled && (
          <button type="button" className="pay-cta-primary" onClick={pay}>
            {t('pay.collPay', { amount: fmtMoney(payoff.payoff) })}
          </button>
        )}
      </div>
    </section>
  )
}
