import { useState } from 'react'
import { useMyResident } from '../hooks/useMyResident'
import { supabase, stripeEnabled } from '../lib/supabase'
import { monthsOwed, fmtMoney, DUES_LABEL } from '../lib/dues'

const fmtDate = (d) => (d
  ? new Date(d + 'T00:00:00').toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' })
  : '')

// Pay page — the resident's own dues balance, how it's built, and history.
// Card payments plug in here once Stripe is connected.
export default function Pay() {
  const { resident, balance, status, payments, monthlyDues, loading } = useMyResident()
  const [checkout, setCheckout] = useState({ loading: false, error: null })
  // Stripe sends the resident back to /pay?paid=1 after a successful payment.
  const justPaid = new URLSearchParams(window.location.search).get('paid') === '1'

  // Hands off to Stripe's hosted checkout via the create-checkout edge
  // function. The payment lands in `payments` when stripe-webhook fires.
  async function startCheckout() {
    setCheckout({ loading: true, error: null })
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { resident_id: resident.id, amount: balance },
      })
      if (error) throw error
      if (!data?.url) throw new Error('No checkout URL returned')
      window.location.href = data.url
    } catch (err) {
      setCheckout({ loading: false, error: 'Could not start checkout. Please try again.' })
    }
  }

  if (loading) {
    return (
      <div className="pay-wrap">
        <div className="pay-kicker">Dues &amp; Assessments</div>
        <h1 className="pay-h1">Your balance</h1>
        <div className="pay-note">Loading your balance…</div>
      </div>
    )
  }

  if (!resident) {
    return (
      <div className="pay-wrap">
        <div className="pay-kicker">Dues &amp; Assessments</div>
        <h1 className="pay-h1">Your balance</h1>
        <div className="pay-note">
          We couldn't match your login to a household on the roster. Ask your
          board to add you on the Residents page using this email address.
        </div>
      </div>
    )
  }

  const monthsAccrued = monthsOwed(resident)
  const opening = Number(resident.opening_balance) || 0
  const accrued = monthsAccrued * monthlyDues
  const paid = (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)

  return (
    <div className="pay-wrap">
      <div className="pay-kicker">Dues &amp; Assessments</div>
      <h1 className="pay-h1">Your balance</h1>

      {justPaid && (
        <div className="pay-paid-banner">
          Payment received — thank you. Your balance updates within a moment;
          reload if it hasn't caught up yet.
        </div>
      )}

      <div className={`pay-card pay-${status}`}>
        <div className="pay-card-top">
          <span className={`pay-status pay-${status}`}>{DUES_LABEL[status]}</span>
          <span className="pay-as-of">{resident.address || resident.full_name}</span>
        </div>
        <div className="pay-balance-label">Current balance</div>
        <div className="pay-balance">{fmtMoney(balance)}</div>
        <div className="pay-balance-sub">
          {balance <= 0
            ? "You're all paid up — nothing due."
            : `Outstanding balance · dues are ${fmtMoney(monthlyDues)}/mo`}
        </div>
        <button
          className="pay-btn"
          disabled={!stripeEnabled || checkout.loading || balance <= 0}
          onClick={startCheckout}
        >
          {balance <= 0
            ? 'Paid up ✓'
            : checkout.loading ? 'Starting checkout…' : `Pay ${fmtMoney(balance)}`}
        </button>
        {checkout.error && (
          <div className="pay-soon pay-error">{checkout.error}</div>
        )}
        {balance > 0 && !stripeEnabled && (
          <div className="pay-soon">Card payments turn on once your board connects Stripe.</div>
        )}
      </div>

      <div className="pay-section-title">How this balance is built</div>
      <div className="pay-ledger">
        <div className="pay-line">
          <span>Opening balance</span><span>{fmtMoney(opening)}</span>
        </div>
        <div className="pay-line">
          <span>Dues accrued · {monthsAccrued} {monthsAccrued === 1 ? 'month' : 'months'} × {fmtMoney(monthlyDues)}</span>
          <span>{fmtMoney(accrued)}</span>
        </div>
        <div className="pay-line">
          <span>Payments received</span><span>−{fmtMoney(paid)}</span>
        </div>
        <div className="pay-line pay-line-total">
          <span>Balance</span><span>{fmtMoney(balance)}</span>
        </div>
      </div>

      <div className="pay-section-title">Payment history</div>
      {payments.length === 0 ? (
        <div className="pay-note">No payments recorded yet.</div>
      ) : (
        <div className="pay-history">
          {payments.map(p => (
            <div className="pay-hist-row" key={p.id}>
              <span className="pay-hist-date">{fmtDate(p.paid_on)}</span>
              <span className="pay-hist-amt">{fmtMoney(p.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
