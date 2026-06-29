'use client'

// Collections payoff card — the one notification an owner in collections sees up
// top: the live statutory payoff with a "Pay to clear" CTA, plus a quiet link
// down to Quick actions (where the payment-plan + legal-protection flows live).
// Shown only when the owner has an OPEN collection case.

import { fmtMoney, casePayoff } from '@/lib/dues'
import { useMyPaymentPlan } from '@/lib/payment-plans'
import { useCheckout } from '@/components/CheckoutProvider'
import { stripeEnabled } from '@/lib/supabase'
import { useT } from '@/lib/i18n'
import { PaymentPlanCard } from './PaymentPlanCard'
import { LegalHoldCard } from './LegalHoldCard'

// Smooth-scroll the page to the Quick Actions tile (id="quick-actions"), set by
// both the desktop and mobile Pay sections.
function scrollToQuickActions(e: React.MouseEvent) {
  e.preventDefault()
  if (typeof document === 'undefined') return
  document.getElementById('quick-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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
  // Show the running balance even while on a plan — it drops as installments
  // post (each recorded installment is a real payment against the case), so the
  // owner watches the total go down. The plan context moves into the intro line.
  const showPayoff = !!payoff && payoff.payoff > 0
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
      {/* Zesty header — a full-bleed orange band flush with the card top (rounded
          top corners match the card, no background leaks at the edges): the
          (larger) label on the left, the live payoff on the right, same line. */}
      <div style={{ background: 'linear-gradient(135deg, #E14909 0%, #F2922A 100%)', color: '#fff', padding: '18px 22px', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.95 }}>{t('pay.collTitle')}</div>
        {showPayoff
          ? <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05, whiteSpace: 'nowrap' }}>{t('pay.collTotal', { amount: fmtMoney(payoff!.payoff) })}</div>
          : <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.95, whiteSpace: 'nowrap' }}>{t('pay.collOnPlan')}</div>}
      </div>

      <div style={{ padding: '12px 20px 16px' }}>
        {showPayoff && (
          <>
            <p className="pay-plan-intro" style={{ marginTop: 0, marginBottom: 0 }}>{onActivePlan ? t('pay.collOnPlan') : t('pay.collIntro')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '16px 0 14px' }}>
              {chips.map(([label, val]) => (
                <span key={label} style={{ fontSize: 12, background: 'rgba(225,73,9,0.09)', color: '#B54708', borderRadius: 999, padding: '4px 11px', fontWeight: 600 }}>
                  {label} {fmtMoney(Number(val) || 0)}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Action row — Pay on the left, the quiet link to Quick actions pushed
            all the way to the right (where the plan + legal flows live). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {showPayoff && stripeEnabled && (
            <button type="button" className="pay-cta-primary" onClick={pay}>
              {t('pay.collPay')}
            </button>
          )}
          <a href="#quick-actions" onClick={scrollToQuickActions} className="pay-coll-help"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: '#B54708', textDecoration: 'none', cursor: 'pointer' }}>
            {t('pay.collMoreHelp')}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  )
}

// CollectionQuickActions — the payment-plan + legal-protection rows, shown only
// when the owner has an open collection case. Rendered two ways:
//   default    — a bare group meant to sit INSIDE the existing right-column
//                Quick Actions tile (desktop), with a divider above it.
//   standalone — its own tile with a heading + id="quick-actions" (mobile, which
//                has no right-column tile of its own).
export function CollectionQuickActions({ resident, standalone }: { resident: any; standalone?: boolean }) {
  const t = useT()
  const { openCase, loading } = useMyPaymentPlan()
  if (loading || !openCase) return null

  const rows = (
    <>
      <PaymentPlanCard resident={resident} variant="row" />
      <LegalHoldCard variant="row" />
    </>
  )

  if (standalone) {
    return (
      <section className="pay-card pay-tile-tight" id="quick-actions">
        <h3 className="pay-tile-title">{t('pay.collQuickActions')}</h3>
        <div className="pay-quick">{rows}</div>
      </section>
    )
  }

  return (
    <div className="pay-quick" style={{ borderTop: '1px solid var(--ev-border, #e5e2da)', marginTop: 10, paddingTop: 10 }}>
      {rows}
    </div>
  )
}
