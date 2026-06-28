'use client'

// Unified Collections card — one card that only appears when the owner has an
// OPEN collection case. Shows the live statutory payoff with a "Pay to clear"
// CTA, then folds the payment-plan + legal-protection flows in as quick actions.
// Replaces the three separate stacked cards.

import { fmtMoney, casePayoff } from '@/lib/dues'
import { useMyPaymentPlan } from '@/lib/payment-plans'
import { useCheckout } from '@/components/CheckoutProvider'
import { stripeEnabled } from '@/lib/supabase'
import { useT } from '@/lib/i18n'
import { PaymentPlanCard } from './PaymentPlanCard'
import { LegalHoldCard } from './LegalHoldCard'

export function CollectionPayoffCard({ resident, community, payments }: { resident: any; community: any; payments: any[] }) {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { openCase, plan, loading } = useMyPaymentPlan()

  // Only render during an active collection — nothing for owners in good standing.
  if (loading || !openCase) return null

  const onActivePlan = (plan?.request_status === 'approved' || plan?.request_status === 'modified') && String(plan?.status ?? '') === 'active'
  let payoff: ReturnType<typeof casePayoff> | null = null
  try {
    if (resident) {
      const extraCosts = (Number((openCase as any).cost_balance) || 0) + (Number((openCase as any).mailing_cost_balance) || 0)
      payoff = casePayoff(resident, community, payments || [], { extraCosts })
    }
  } catch { payoff = null }
  const showPayoff = !!payoff && payoff.payoff > 0 && !onActivePlan
  const r = payoff?.remaining

  const pay = () => {
    if (!payoff) return
    openCheckout({
      fn: 'create-checkout',
      body: { resident_id: resident.id, amount: payoff.payoff, applied_to_case: openCase.id },
      returnUrl: '/app/track?submitted=1#pay',
    })
  }

  const chips: [string, number][] = r
    ? [[t('pay.collPrincipal'), r.principal], [t('pay.collInterest'), r.interest], [t('pay.collFees'), r.lateFee], [t('pay.collCosts'), r.cost]]
    : []

  return (
    <section className="pay-card" id="collections" style={{ overflow: 'hidden', padding: 0 }}>
      {/* Compact header — a thin orange accent bar keeps it serious but restrained. */}
      <div style={{ background: 'linear-gradient(135deg, #E14909 0%, #F2922A 100%)', color: '#fff', padding: '11px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.7px', textTransform: 'uppercase', opacity: 0.92 }}>{t('pay.collTitle')}</div>
        {showPayoff
          ? <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{t('pay.collTotal', { amount: fmtMoney(payoff!.payoff) })}</div>
          : <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.95 }}>{t('pay.collOnPlan')}</div>}
      </div>

      <div style={{ padding: '13px 16px' }}>
        {showPayoff && (
          <>
            <p className="pay-plan-intro" style={{ marginTop: 0, fontSize: 12.5 }}>{t('pay.collIntro')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '7px 0 12px' }}>
              {chips.map(([label, val]) => (
                <span key={label} style={{ fontSize: 11, background: 'rgba(225,73,9,0.08)', color: '#B54708', borderRadius: 999, padding: '3px 9px', fontWeight: 600 }}>
                  {label} {fmtMoney(Number(val) || 0)}
                </span>
              ))}
            </div>
            {stripeEnabled && (
              <button type="button" className="pay-cta-primary" onClick={pay}>
                {t('pay.collPay', { amount: fmtMoney(payoff!.payoff) })}
              </button>
            )}
          </>
        )}

        {/* Quick actions — only here because the owner is in collections. */}
        <div style={{ borderTop: showPayoff ? '1px solid rgba(0,0,0,0.08)' : 'none', marginTop: showPayoff ? 13 : 0, paddingTop: showPayoff ? 11 : 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 2 }}>{t('pay.collQuickActions')}</div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 10, paddingTop: 10 }}>
            <PaymentPlanCard resident={resident} embedded />
          </div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 10, paddingTop: 10 }}>
            <LegalHoldCard embedded />
          </div>
        </div>
      </div>
    </section>
  )
}
