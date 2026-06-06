'use client'

// Payment plan card — shared by the desktop + mobile Pay sections. Lets a
// delinquent resident request an installment plan (board reviews, ARC-style)
// and, once approved, pay each installment. Renders nothing for residents in
// good standing (no open collection case and no plan).

import { useState } from 'react'
import { fmtMoney } from '@/lib/dues'
import { useMyPaymentPlan, payInstallment } from '@/lib/payment-plans'
import { useT } from '@/lib/i18n'
import { DetailDialog } from './DetailDialog'

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '—' }
}

export function PaymentPlanCard({ resident }: { resident: any }) {
  const t = useT()
  const { openCase, plan, loading, requestPlan, withdrawPlan } = useMyPaymentPlan()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState('100')
  const [count, setCount] = useState('6')
  const [freq, setFreq] = useState('30')
  const [autopayOpt, setAutopayOpt] = useState(false)

  if (loading) return null
  // Show only when there's an open collection case or an existing/recent plan.
  if (!openCase && !plan) return null

  const rs = plan?.request_status ?? null
  const isPending = rs === 'requested'
  const isActive = (rs === 'approved' || rs === 'modified') && String(plan?.status ?? '') === 'active'
  const isDenied = rs === 'denied'
  const canRequest = !!openCase && (!plan || isDenied)

  const submitRequest = async () => {
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
    if (err) { setError(err) } else { setDialogOpen(false) }
  }

  const onWithdraw = async () => {
    if (!plan) return
    setBusy(true); setError(null)
    const err = await withdrawPlan(plan.id)
    setBusy(false)
    if (err) setError(err)
  }

  const onPayInstallment = async () => {
    if (!plan || !resident) return
    setBusy(true); setError(null)
    const installmentNo = (plan.paid_count ?? 0) + 1
    const err = await payInstallment(resident.id, plan.id, installmentNo, Number(plan.installment_amount) || 0)
    if (err) { setError(err); setBusy(false) }   // redirects to Stripe on success
  }

  return (
    <section className="pay-card pay-plan-card" id="payment-plan">
      <div className="pay-plan-head">
        <span className="pay-plan-eyebrow">{t('pay.planTitle')}</span>
      </div>
      {error && <div className="pay-err">{error}</div>}

      {canRequest && (
        <div className="pay-plan-body">
          {isDenied && (
            <div className="pay-plan-denied">
              <strong>{t('pay.planDeniedTitle')}</strong>
              {plan?.decision_reason && <div>{t('pay.planDeniedReason', { reason: plan.decision_reason })}</div>}
            </div>
          )}
          <p className="pay-plan-intro">{t('pay.planRequestIntro')}</p>
          <button type="button" className="pay-cta-primary" onClick={() => setDialogOpen(true)}>
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

      {isActive && (
        <div className="pay-plan-body">
          <div className="pay-plan-state">{t('pay.planApprovedTitle')}</div>
          <div className="pay-plan-terms">
            {t('pay.planInstallmentOf', { paid: plan?.paid_count ?? 0, count: plan?.installment_count ?? 0 })}
            {' · '}{fmtMoney(Number(plan?.installment_amount) || 0)}
            {plan?.next_due_at && <> · {t('pay.planNextDue', { date: fmtDate(plan.next_due_at) })}</>}
          </div>
          {plan?.autopay_opt_in
            ? <div className="pay-plan-autopay">{t('pay.planAutopayOn')}</div>
            : (
              <button type="button" className="pay-cta-primary" disabled={busy || !resident} onClick={onPayInstallment}>
                {busy ? t('pay.startingCheckout') : t('pay.planPayInstallment')}
              </button>
            )}
        </div>
      )}

      {dialogOpen && (
        <DetailDialog
          eyebrow={t('pay.planTitle')}
          title={t('pay.planRequest')}
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <button type="button" className="pay-cta-secondary" onClick={() => setDialogOpen(false)}>{t('pay.cancel')}</button>
              <button type="button" className="pay-cta-primary" disabled={busy} onClick={submitRequest}>
                {busy ? t('pay.planSubmitting') : t('pay.planSubmit')}
              </button>
            </>
          }
        >
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
        </DetailDialog>
      )}
    </section>
  )
}
