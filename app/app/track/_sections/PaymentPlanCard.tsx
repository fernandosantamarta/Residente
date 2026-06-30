'use client'

// Payment plan card — shared by the desktop + mobile Pay sections. Lets a
// delinquent resident request an installment plan (board reviews, ARC-style)
// and, once approved, pay each installment. Renders nothing for residents in
// good standing (no open collection case and no plan).
//
// Three render modes:
//   default   — its own full pay-card (legacy / standalone)
//   embedded  — bare body, no card chrome (folded inside another card)
//   variant="row" — a single Quick Actions row (icon + status) that opens the
//                   full flow in a popup. This is how it lives now: inside the
//                   right-column Quick Actions tile, not as a stacked card.

import { useState } from 'react'
import { fmtMoney, casePayoff } from '@/lib/dues'
import { addCalendarDays } from '@/lib/compliance/rules-core'
import { useMyPaymentPlan } from '@/lib/payment-plans'
import { useCheckout } from '@/components/CheckoutProvider'
import { useT } from '@/lib/i18n'
import { DetailDialog } from './DetailDialog'

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '—' }
}

export function PaymentPlanCard({ resident, community, payments, embedded, variant }: { resident: any; community?: any; payments?: any[]; embedded?: boolean; variant?: 'row' }) {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { openCase, plan, loading, requestPlan, withdrawPlan } = useMyPaymentPlan()
  const [dialogOpen, setDialogOpen] = useState(false)   // request form (default/embedded mode)
  const [rowOpen, setRowOpen] = useState(false)         // detail popup (row mode)
  const [rowForm, setRowForm] = useState(false)         // form view inside the row popup
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState('100')
  const [count, setCount] = useState('6')
  const [freq, setFreq] = useState('30')
  const [autopayOpt, setAutopayOpt] = useState(false)
  const [planDetailOpen, setPlanDetailOpen] = useState(false)  // expand the installment schedule

  if (loading) return null
  // Show only when there's an open collection case or an existing/recent plan.
  if (!openCase && !plan) return null

  const rs = plan?.request_status ?? null
  const isPending = rs === 'requested'
  // A plan is active when its status is 'active' and it isn't still a pending or
  // denied request. This INCLUDES admin-created plans, which carry no
  // request_status (null) — they must still show as active to the resident.
  const isActive = String(plan?.status ?? '') === 'active' && rs !== 'requested' && rs !== 'denied'
  const isDenied = rs === 'denied'
  const canRequest = !!openCase && (!plan || isDenied)

  const submitRequest = async (onDone?: () => void) => {
    if (!openCase) return
    setBusy(true); setError(null)
    const err = await requestPlan({
      caseId: openCase.id,
      amount: Math.max(1, Number(amount) || 0),
      count: Math.max(1, Math.round(Number(count) || 0)),
      frequencyDays: Math.max(1, Math.round(Number(freq) || 30)),
      autopayOptIn: autopayOpt,
    })
    setBusy(false)
    if (err) { setError(err) } else { (onDone ?? (() => setDialogOpen(false)))() }
  }

  const onWithdraw = async () => {
    if (!plan) return
    setBusy(true); setError(null)
    const err = await withdrawPlan(plan.id)
    setBusy(false)
    if (err) setError(err)
  }

  const onPayInstallment = () => {
    if (!plan || !resident) return
    setError(null)
    const installmentNo = (plan.paid_count ?? 0) + 1
    openCheckout({
      fn: 'create-checkout',
      body: { resident_id: resident.id, amount: Number(plan.installment_amount) || 0, plan_id: plan.id, installment_no: installmentNo },
      returnUrl: '/app/track?submitted=1#pay',
    })
  }

  // The request form — reused by the default-mode dialog and the row popup.
  const formFields = (
    <>
      <p className="pay-plan-intro">{t('pay.planRequestIntro')}</p>
      <label className="pay-plan-field">
        <span>{t('pay.planInstallmentAmount')}</span>
        <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} />
      </label>
      <label className="pay-plan-field">
        <span>{t('pay.planCountLabel')}</span>
        <input type="number" min={1} value={count} onChange={e => setCount(e.target.value)} />
      </label>
      <label className="pay-plan-field">
        <span>{t('pay.planFrequencyLabel')}</span>
        <input type="number" min={1} value={freq} onChange={e => setFreq(e.target.value)} />
      </label>
      <label className="pay-plan-check">
        <input type="checkbox" checked={autopayOpt} onChange={e => setAutopayOpt(e.target.checked)} />
        <span>{t('pay.planAutopayOpt')}</span>
      </label>
      {error && <div className="pay-err">{error}</div>}
    </>
  )

  // The current-state blocks (pending / active / can-request) — reused by the
  // default-mode body and the row popup's info view.
  const stateBlocks = (onRequest: () => void) => (
    <>
      {canRequest && (
        <div className="pay-plan-body">
          {isDenied && (
            <div className="pay-plan-denied">
              <strong>{t('pay.planDeniedTitle')}</strong>
              {plan?.decision_reason && <div>{t('pay.planDeniedReason', { reason: plan.decision_reason })}</div>}
            </div>
          )}
          <p className="pay-plan-intro">{t('pay.planRequestIntro')}</p>
          <button type="button" className="pay-cta-primary" onClick={onRequest}>
            {t('pay.planRequest')}
          </button>
        </div>
      )}

      {isPending && (
        <div className="pay-plan-body">
          <span className="pay-pill pay-pill-pending">{t('pay.statusPending')}</span>
          <div className="pay-plan-state">{t('pay.planPendingTitle')}</div>
          <div className="pay-plan-terms">
            {t('pay.planProposed', {
              amount: fmtMoney(Number(plan?.requested_amount ?? plan?.installment_amount) || 0),
              count: plan?.requested_count ?? plan?.installment_count ?? 0,
            })}
          </div>
          <button type="button" className="pay-cta-secondary" disabled={busy} onClick={onWithdraw}>
            {t('pay.planWithdraw')}
          </button>
        </div>
      )}

      {isActive && (() => {
        // Mini version of the admin active-plan card: summary + progress bar +
        // an expandable per-installment schedule, then the pay action.
        const amt = Number(plan?.installment_amount) || 0
        const count = Number(plan?.installment_count) || 0
        const paidN = Number(plan?.paid_count) || 0
        const planFreq = Number(plan?.frequency_days) || 30
        const pct = count ? Math.min(100, (paidN / count) * 100) : 0
        const paidAmt = amt * paidN
        const totalAmt = amt * count
        // Live amount still owed on the case (interest, late fees, and recorded
        // collection/mailing costs keep accruing AFTER the plan was set). If the
        // plan's remaining installments fall short of it, the plan won't clear
        // the balance — warn the owner here, the same way the admin case does.
        let payoffNow = 0
        try {
          if (resident && openCase) {
            const extraCosts = (Number((openCase as any).cost_balance) || 0) + (Number((openCase as any).mailing_cost_balance) || 0)
            payoffNow = casePayoff(resident, community, payments || [], { extraCosts })?.payoff || 0
          }
        } catch { payoffNow = 0 }
        const remainingInstallments = amt * Math.max(0, count - paidN)
        const shortfall = count > 0 ? payoffNow - remainingInstallments : 0
        return (
          <div className="pay-plan-body" style={{ width: '100%' }}>
            {/* No border/box — the popup is already the container, and there's
                only ever one plan, so a card-in-a-card is redundant. */}
            <div style={{ width: '100%', boxSizing: 'border-box' }}>
              {/* Installment amount — the headline number */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: '#0A2440', lineHeight: 1 }}>{fmtMoney(amt)}</span>
                <span style={{ fontSize: 13, color: '#475467' }}>{t('pay.planEveryDays', { days: planFreq })}</span>
              </div>

              {/* Progress: labels + bar */}
              {count > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18, fontSize: 12.5 }}>
                    <span style={{ fontWeight: 700, color: '#0A2440' }}>{t('pay.planProgressPaid', { paid: paidN, count })}</span>
                    <span style={{ color: '#475467' }}>{t('pay.planAmtOf', { paid: fmtMoney(paidAmt), total: fmtMoney(totalAmt) })}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: 'rgba(10,36,64,0.08)', overflow: 'hidden', marginTop: 8 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #E14909, #22A06B)', borderRadius: 999, transition: 'width .45s ease' }} />
                  </div>
                </>
              )}

              {/* Next due */}
              {plan?.next_due_at && (
                <div style={{ marginTop: 14, fontSize: 12.5, color: '#475467' }}>
                  {t('pay.planNextDue', { date: fmtDate(plan.next_due_at) })}
                </div>
              )}

              {/* Shortfall — the plan won't fully clear what's owed (costs accrued
                  after it was set). */}
              {shortfall > 0.5 && (
                <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.45, color: '#B54708', background: 'rgba(225,73,9,0.07)', border: '1px solid rgba(225,73,9,0.18)', borderRadius: 10, padding: '9px 12px' }}>
                  {t('pay.planShortfallNote', { short: fmtMoney(shortfall) })}
                </div>
              )}

              {/* Pay action — full width, the primary thing to do here */}
              <div style={{ marginTop: 16 }}>
                {plan?.autopay_opt_in
                  ? <div className="pay-plan-autopay">{t('pay.planAutopayOn')}</div>
                  : (
                    <button type="button" className="pay-cta-primary" style={{ width: '100%' }} disabled={busy || !resident} onClick={onPayInstallment}>
                      {busy ? t('pay.startingCheckout') : t('pay.planPayInstallment')}
                    </button>
                  )}
              </div>

              {/* Expandable full schedule */}
              {count > 0 && (
                <button type="button" onClick={() => setPlanDetailOpen(o => !o)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 16, fontSize: 12.5, fontWeight: 700, color: '#B54708' }}>
                  {planDetailOpen ? t('pay.planHideSchedule') : t('pay.planViewSchedule')}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                    style={{ transform: planDetailOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
              {planDetailOpen && count > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid #EEF0F2', paddingTop: 4 }}>
                  {Array.from({ length: count }).map((_, i) => {
                    const due = plan?.start_date ? addCalendarDays(plan.start_date, i * planFreq) : null
                    const st = i < paidN ? 'paid' : i === paidN ? 'next' : 'upcoming'
                    const dot = st === 'paid' ? '#22A06B' : st === 'next' ? '#E14909' : '#D0D5DD'
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '8px 0', borderTop: i ? '1px solid #F7F8FA' : 'none' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: dot }} />
                        <span style={{ flex: 1, color: st === 'upcoming' ? '#98A2B3' : '#0A2440', fontWeight: st === 'next' ? 700 : 400 }}>#{i + 1} · {fmtMoney(amt)}</span>
                        <span style={{ color: st === 'paid' ? '#067647' : st === 'next' ? '#B54708' : '#98A2B3', fontWeight: st === 'next' ? 700 : 400 }}>
                          {due ? fmtDate(due) : '—'}{st === 'paid' ? ` · ${t('pay.planSchedPaid')}` : st === 'next' ? ` · ${t('pay.planSchedNext')}` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </>
  )

  // -- ROW MODE: a Quick Actions row that opens the flow in a popup -------------
  if (variant === 'row') {
    const rowStatus = isPending ? t('pay.planRowPending')
      : isActive ? t('pay.planRowActive', { paid: plan?.paid_count ?? 0, count: plan?.installment_count ?? 0 })
      : isDenied ? t('pay.planRowDenied')
      : t('pay.planRowPropose')
    return (
      <>
        <button type="button" className="pay-quick-row"
          onClick={() => { setError(null); setRowForm(canRequest); setRowOpen(true) }}>
          <span className="pay-quick-icon"><PlanIcon /></span>
          <span className="pay-quick-body">
            <span className="pay-quick-title">{t('pay.planTitle')}</span>
            <span className="pay-quick-desc">{rowStatus}</span>
          </span>
          <svg className="pay-quick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        {rowOpen && (
          <DetailDialog
            eyebrow={t('pay.planTitle')}
            title={rowForm ? t('pay.planRequest') : t('pay.planTitle')}
            onClose={() => setRowOpen(false)}
            footer={rowForm ? (
              <>
                <button type="button" className="pay-cta-secondary"
                  onClick={() => (canRequest ? setRowOpen(false) : setRowForm(false))}>{t('pay.cancel')}</button>
                <button type="button" className="pay-cta-primary" disabled={busy}
                  onClick={() => submitRequest(() => setRowOpen(false))}>
                  {busy ? t('pay.planSubmitting') : t('pay.planSubmit')}
                </button>
              </>
            ) : undefined}
          >
            {rowForm ? formFields : stateBlocks(() => setRowForm(true))}
          </DetailDialog>
        )}
      </>
    )
  }

  // -- DEFAULT / EMBEDDED MODE: full card body ---------------------------------
  return (
    <div className={embedded ? 'pay-embed' : 'pay-card pay-plan-card'} id={embedded ? undefined : 'payment-plan'}>
      <div className="pay-plan-head">
        <span className="pay-plan-eyebrow">{t('pay.planTitle')}</span>
      </div>
      {error && <div className="pay-err">{error}</div>}

      {stateBlocks(() => setDialogOpen(true))}

      {dialogOpen && (
        <DetailDialog
          eyebrow={t('pay.planTitle')}
          title={t('pay.planRequest')}
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <button type="button" className="pay-cta-secondary" onClick={() => setDialogOpen(false)}>{t('pay.cancel')}</button>
              <button type="button" className="pay-cta-primary" disabled={busy} onClick={() => submitRequest()}>
                {busy ? t('pay.planSubmitting') : t('pay.planSubmit')}
              </button>
            </>
          }
        >
          {formFields}
        </DetailDialog>
      )}
    </div>
  )
}

function PlanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14h.01M12 14h.01M16 14h.01" />
    </svg>
  )
}
