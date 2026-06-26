'use client'

import Link from 'next/link'
import { ReactNode, useEffect, useState } from 'react'
import { useMyResident } from '@/hooks/useMyResident'
import { stripeEnabled, supabase } from '@/lib/supabase'
import { usePreferences, newId, PaymentMethod } from '@/lib/preferences'
import { fmtMoney, monthsCovered, monthsOwed } from '@/lib/dues'
import { deriveStatements } from '@/lib/statements'
import { useMyViolations, payFine } from '@/lib/violations'
import { useCheckout } from '@/components/CheckoutProvider'
import { useT } from '@/lib/i18n'
import { DetailDialog } from './DetailDialog'
import { PaymentPlanCard } from './PaymentPlanCard'
import { ContestFineControl } from './ContestFineControl'

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '—' }
}
const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const DAY_MS = 86_400_000

// HOA convention: dues for month N are due on the 1st of month N. Once we're
// past the 1st, the next bill is for next month. Mirrors the rail's
// nextDueDate in app/app/layout.tsx so the figures agree.
function nextDueDate(now: Date): Date {
  if (now.getDate() === 1) return new Date(now.getFullYear(), now.getMonth(), 1)
  return new Date(now.getFullYear(), now.getMonth() + 1, 1)
}

// Demo payment history — mirrors the mockup so the table reads as
// lived-in until we wire real Stripe-imported history.
const DEMO_HISTORY = [
  { id: 'h1', date: '2024-11-29', desc: 'Regular Dues Dec 2024', amount: 1250.00, status: 'paid',    method: 'Visa ···· 4242' },
  { id: 'h2', date: '2024-10-29', desc: 'Regular Dues Nov 2024', amount: 1250.00, status: 'paid',    method: 'Mastercard ···· 8888' },
  { id: 'h3', date: '2024-10-15', desc: 'Capital Reserve',       amount:  450.00, status: 'paid',    method: 'Visa ···· 4242' },
  { id: 'h4', date: '2024-09-29', desc: 'Regular Dues Oct 2024', amount: 1250.00, status: 'pending', method: 'Bank ···· 8821' },
  { id: 'h5', date: '2024-09-12', desc: 'Late Fee Credit',       amount:  -25.00, status: 'paid',    method: 'Adjustment'      },
]

// Preview / no-roster-match showcase only. Real residents get statements derived
// from their actual ledger (deriveStatements); see stmtItems in the component.
const DEMO_STATEMENTS = [
  { id: 's1', label: 'December 2024 Statement', date: '2024-12-01', size: '1.2 MB' },
  { id: 's2', label: 'November 2024 Statement', date: '2024-11-01', size: '1.1 MB' },
  { id: 's3', label: 'October 2024 Statement',  date: '2024-10-01', size: '1.0 MB' },
  { id: 's4', label: 'September 2024 Statement', date: '2024-09-01', size: '0.9 MB' },
]

// A statement normalized for rendering — one shape for both real (ledger-derived)
// and demo (preview) rows.
type StmtItem = {
  id: string
  title: string
  meta: string
  periodLabel: string
  rows: [string, string][]
  /** 'YYYY-MM' for real statements — drives the print/PDF route. Absent for demo rows. */
  period?: string
}

// Pay — the resident's balance-and-payments surface, now a section of the
// Easy Track hub. Current balance card with the breakdown ledger, a
// right-rail Quick Actions tile, Autopay tile, Payment History table,
// Statements list, and the saved payment methods (read from /app/settings
// preferences).
export function PaySection() {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { resident, community, duesCfg, balance, monthlyDues, payments, loading, status } = useMyResident() as any
  const [prefs, patchPrefs] = usePreferences()
  const [checkout, setCheckout] = useState({ loading: false, error: '' })
  // Demo-mode payment confirmation (no real Stripe): holds the amount "paid".
  const [demoPaid, setDemoPaid] = useState<number | null>(null)
  // In-place popups (no page navigation): account details (view) and
  // add-payment-method (action — also offers the Settings route).
  const [accountOpen, setAccountOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  // Autopay + Payment Methods open as popups straight from the balance card.
  const [autopayOpen, setAutopayOpen] = useState(false)
  const [methodsOpen, setMethodsOpen] = useState(false)
  // "View all" list popups + a single statement opened in place.
  const [listOpen, setListOpen] = useState<null | 'history' | 'statements'>(null)
  const [stmtOpen, setStmtOpen] = useState<StmtItem | null>(null)
  // Demo autopay toggle — lets preview mode flip autopay on/off in place
  // (real autopay goes through Stripe via toggleAutopay).
  const [autopayDemo, setAutopayDemo] = useState<boolean | null>(null)
  // Set when we land back from Stripe Checkout (?submitted=1) so we can show an
  // honest confirmation — a card posts now, an ACH bank transfer takes days.
  const [submitted, setSubmitted] = useState(false)

  // Real Stripe state (test mode in the demo). `cards` are the customer's saved
  // payment methods from list-payment-methods; `autopayOn` mirrors the roster
  // row's autopay_enabled. Both stay null/unused until we have an authed
  // resident + Stripe turned on, so preview mode keeps its localStorage demo.
  const [cards, setCards] = useState<any[] | null>(null)
  const [autopayOn, setAutopayOn] = useState<boolean | null>(null)
  const [autopayBusy, setAutopayBusy] = useState(false)
  const [autopayErr, setAutopayErr] = useState('')
  const stripeLive = stripeEnabled && !!supabase && !!resident

  useEffect(() => {
    if (resident) setAutopayOn(!!resident.autopay_enabled)
  }, [resident?.id, resident?.autopay_enabled])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!stripeLive) return
      try {
        const { data } = await supabase.functions.invoke('list-payment-methods', {
          body: { resident_id: resident.id },
        })
        if (!cancelled && data?.methods) setCards(data.methods)
      } catch { /* keep the localStorage/demo fallback */ }
    })()
    return () => { cancelled = true }
  }, [resident?.id, stripeLive])

  // Returning from Stripe Checkout (?submitted=1): show an honest confirmation,
  // then strip the param so a refresh doesn't re-show it (keep the #pay hash).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('submitted') !== '1') return
    setSubmitted(true)
    params.delete('submitted')
    const qs = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}#pay`)
  }, [])

  // Show the skeleton only while the resident query is genuinely in flight.
  // Once it settles we render either the real balance or — in preview / no-
  // roster-match — the demo fallback, instead of a skeleton that never fills.
  const isLoading = loading
  const currentBalance = balance == null ? 1250.00 : balance

  // Breakdown that ALWAYS reconciles to the Current Balance above: the board-set
  // opening balance, everything accrued since (dues + any late interest/fees),
  // and payments received. The accrued charges are lumped into one line so the
  // breakdown total equals the balance exactly — the rings already detail the
  // monthly dues cadence, so we don't re-derive every charge here.
  const openingBal = Number(resident?.opening_balance) || 0
  const paidToDate = (payments || []).reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0)
  const duesAndCharges = currentBalance - openingBal + paidToDate
  const breakdown = [
    ...(openingBal ? [{ label: t('pay.chargeOpeningBalance'), amount: openingBal }] : []),
    { label: t('pay.chargeDuesAndCharges'), amount: duesAndCharges },
    ...(paidToDate ? [{ label: t('pay.chargePaymentsReceived'), amount: -paidToDate }] : []),
  ]
  const breakdownTotal = breakdown.reduce((s, r) => s + r.amount, 0)

  // Year-to-date dues math that feeds the three Current Balance rings.
  // Demo-friendly: derived from the monthly dues and today's date. The
  // outstanding balance is treated as the upcoming bill (Due {nextDue}), so
  // the months that have already elapsed this year count as paid.
  const now = new Date()
  const nextDue = nextDueDate(now)
  const dueDate = nextDue
  const monthlyDue = monthlyDues || 1000
  // Real ring inputs from the resident's actual payments (lib/dues). With no
  // roster match (preview / marketing view) there's no `resident`, so fall
  // back to the date-derived demo so the showcase view still looks alive.
  const paidAmount = (payments || []).reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0)
  const coveredMonths = resident ? monthsCovered(resident, monthlyDue, payments || []) : Math.min(12, now.getMonth() + 1)
  const owedMonths = resident ? monthsOwed(resident) : Math.max(1, now.getMonth() + 1)
  const monthsPaid = Math.min(12, coveredMonths)
  const annualDue = monthlyDue * 12
  const paidYTD = resident ? paidAmount : monthlyDue * monthsPaid

  // On Track = months actually covered ÷ months owed. Late status (a real
  // overdue balance) flips the ring to "behind"; otherwise it reads on track.
  const monthsDue = Math.max(1, Math.min(12, owedMonths))
  const onTimeRate = Math.min(1, monthsPaid / monthsDue)
  const onTimePct = Math.round(onTimeRate * 100)
  const trackState: 'ok' | 'warn' = resident ? (status === 'late' ? 'warn' : 'ok') : (onTimeRate >= 0.75 ? 'ok' : 'warn')

  // Next-payment cycle — exact days remaining until the 1st-of-next-month due.
  const cycleStart = new Date(nextDue.getFullYear(), nextDue.getMonth() - 1, 1)
  const cycleDays = Math.max(1, Math.round((nextDue.getTime() - cycleStart.getTime()) / DAY_MS))
  const daysLeft = Math.max(0, Math.ceil((nextDue.getTime() - now.getTime()) / DAY_MS))
  const duePct = (cycleDays - daysLeft) / cycleDays

  // The same three signals the dial rings used to show, now as plain
  // label/value rows sitting under the Make Payment actions.
  const statRows: { label: string; value: string; meta?: string; tone?: 'ok' | 'warn' }[] = [
    {
      label: t('pay.ringCatBalance'),
      value: `${fmtMoney(paidYTD)} ${t('pay.ringOfAmount', { amount: fmtMoney(annualDue) })}`,
      meta: `${monthsPaid}/12 ${t('pay.ringMonthsPaidSub')}`,
    },
    {
      label: t('pay.ringCatPaymentStatus'),
      value: trackState === 'warn' ? t('pay.ringBehind') : `${onTimePct}%`,
      meta: trackState === 'warn' ? undefined : t('pay.ringOnTimeSub'),
      tone: trackState === 'warn' ? 'warn' : 'ok',
    },
    {
      label: t('pay.ringCatDueDate'),
      value: daysLeft === 0 ? t('pay.ringToday') : `${daysLeft} ${t('pay.ringDaysLeftSub')}`,
      meta: fmtShort(nextDue),
    },
  ]

  // Unified payment-method list: real Stripe cards + saved bank accounts (ACH)
  // when we have them, else the localStorage/demo methods so preview mode renders.
  const liveCards = cards && cards.length > 0
    ? cards.map((c: any) => {
        const kind = c.kind === 'bank' ? 'bank' as const : 'card' as const
        return {
          id: c.id,
          brand: c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : (kind === 'bank' ? 'Bank' : 'Card'),
          last4: c.last4,
          kind,
          is_default: !!c.is_default,
        }
      })
    : null
  // Demo default: the stored id, falling back to the first saved method.
  const demoDefaultId = prefs.default_payment_method_id || prefs.payment_methods[0]?.id
  const methods: any[] = liveCards
    ?? prefs.payment_methods.map((pm) => ({ ...pm, is_default: pm.id === demoDefaultId }))
  const defaultMethod = methods.find(m => m.is_default) || methods[0]
  const autopayActive = stripeLive
    ? (autopayOn != null ? autopayOn : !!defaultMethod)
    : (autopayDemo != null ? autopayDemo : !!defaultMethod)

  // Save a card on file via Stripe hosted Checkout (setup mode) — redirects to
  // Stripe and back to #pay. Used by "+ Add New" and the autopay setup CTA.
  const addCard = async () => {
    if (!stripeLive) return
    setAutopayErr('')
    openCheckout({
      fn: 'create-setup-checkout',
      body: { resident_id: resident.id },
      returnUrl: '/app/track?card=saved#pay',
    })
  }

  // Turn autopay on/off against the resident's default saved card.
  const toggleAutopay = async (enabled: boolean) => {
    if (!stripeLive) return
    if (enabled && !defaultMethod) { void addCard(); return }
    setAutopayBusy(true); setAutopayErr('')
    try {
      const { data, error } = await supabase.functions.invoke('set-autopay', {
        body: { resident_id: resident.id, enabled, payment_method_id: defaultMethod?.id },
      })
      if (error) throw error
      setAutopayOn(!!data?.autopay_enabled)
    } catch (err: any) {
      setAutopayErr(err?.message || t('pay.errUpdateAutopay'))
    } finally {
      setAutopayBusy(false)
    }
  }

  // Make a saved card the default (used by autopay + one-click pay).
  const makeDefault = async (pmId: string) => {
    // Demo / no-Stripe: persist the choice locally so the list updates.
    if (!stripeLive) { patchPrefs({ default_payment_method_id: pmId }); return }
    setAutopayErr('')
    try {
      const { error } = await supabase.functions.invoke('set-autopay', {
        body: { resident_id: resident.id, enabled: autopayActive, payment_method_id: pmId },
      })
      if (error) throw error
      setCards(cs => cs ? cs.map((c: any) => ({ ...c, is_default: c.id === pmId })) : cs)
    } catch (err: any) {
      setAutopayErr(err?.message || t('pay.errSetDefaultCard'))
    }
  }

  // Payment history — real rows from the `payments` table (already fetched and
  // sorted newest-first by useMyResident) when we have a resident, falling back
  // to the demo ledger only in preview mode where there's no roster match.
  const methodLabel = defaultMethod
    ? `${defaultMethod.brand} ···· ${defaultMethod.last4}`
    : t('pay.cardFallback')
  const history = resident == null
    ? DEMO_HISTORY
    : (payments || []).map((p: any) => {
        const when = p.paid_on || p.created_at
        const period = when
          ? new Date(when).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
          : ''
        return {
          id: p.id,
          date: when,
          desc: period ? t('pay.histRegularDuesPeriod', { period }) : t('pay.histRegularDues'),
          amount: Number(p.amount) || 0,
          status: 'paid',
          method: methodLabel,
        }
      })

  // Paid in full — a real roster resident whose balance is cleared. Show it
  // (with the date of their latest payment) so they know dues are settled.
  const paidInFull = resident != null && currentBalance <= 0.005
  const lastPaidIso = history[0]?.date

  // Statements — derived from the resident's REAL ledger (owner-verifiable), or the
  // demo set in preview / no-roster-match mode so the showcase stays alive.
  const realStmts = resident ? deriveStatements(resident, monthlyDues || 0, payments || [], { cfg: duesCfg }) : null
  const stmtItems: StmtItem[] = realStmts
    ? realStmts.map((s): StmtItem => {
        const monthLabel = new Date(`${s.periodStart}T00:00:00`)
          .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        return {
          id: s.id,
          period: s.id,
          title: t('pay.statementMonthLabel', { month: monthLabel }),
          meta: t('pay.statementMetaBalance', { balance: fmtMoney(s.closingBalance) }),
          periodLabel: monthLabel,
          rows: [
            [t('pay.statementPeriod'), monthLabel],
            [t('pay.statementOpeningBalance'), fmtMoney(s.openingBalance)],
            [t('pay.statementDuesAssessed'), fmtMoney(s.dues)],
            ...(s.interestFees ? [[t('pay.statementInterestFees'), fmtMoney(s.interestFees)] as [string, string]] : []),
            [t('pay.statementPaymentsReceived'), s.paid ? `-${fmtMoney(s.paid)}` : fmtMoney(0)],
            [t('pay.statementClosingBalance'), fmtMoney(s.closingBalance)],
          ],
        }
      })
    : DEMO_STATEMENTS.map((s): StmtItem => ({
        id: s.id,
        title: s.label,
        meta: `${fmtDate(s.date)} · ${s.size}`,
        periodLabel: `${fmtDate(s.date)} · PDF · ${s.size}`,
        rows: [
          [t('pay.statementPeriod'), fmtDate(s.date)],
          [t('pay.format'), 'PDF'],
          [t('pay.size'), s.size],
        ],
      }))

  const startCheckout = () => {
    if (currentBalance <= 0) return   // nothing due — never open a $0 checkout
    // Demo / no-Stripe: simulate a successful payment instead of dead-clicking,
    // mirroring the Home Quick-Pay popup.
    if (!stripeEnabled || !resident) { setDemoPaid(currentBalance); return }
    openCheckout({
      fn: 'create-checkout',
      body: { resident_id: resident.id, amount: currentBalance },
      returnUrl: '/app/track?submitted=1#pay',
    })
  }

  return (
    <section id="pay" className="pay-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">{t('pay.heading')}</h2>
        <p className="voice-page-sub">
          {t('pay.subheading')}
        </p>
      </div>

      {/* Off-session charge failed (autopay / installment declined). Cleared once
          any payment lands. */}
      {resident?.last_charge_failed_at && (
        <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 11, margin: '0 0 16px', padding: '14px 16px', border: '1px solid #f0b4a4', borderRadius: 12, background: '#fdecec', color: '#8a1c1c' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: 2 }}>{t('pay.chargeFailedTitle')}</strong>
            {t('pay.chargeFailedBody')}
            {resident.last_charge_fail_reason && (
              <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, opacity: 0.85 }}>{resident.last_charge_fail_reason}</span>
            )}
          </div>
        </div>
      )}

      {submitted && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            margin: '0 0 16px', padding: '12px 16px',
            border: '1px solid var(--ev-border, #d6d3cc)', borderRadius: 12,
            background: 'var(--ev-surface-2, #f6f5f1)', color: 'var(--ev-text, #2b2a27)',
            fontSize: 14, lineHeight: 1.45,
          }}
        >
          <span>{t('pay.submittedNote')}</span>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            aria-label={t('pay.dismiss')}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 18, lineHeight: 1, color: 'inherit', padding: 4,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Outstanding fines — an orange "action needed" band above the balance
          (matches the open-votes band). Each fine is its own Stripe charge that
          closes itself on payment, so the band vanishes once everything's paid. */}
      <FinesDueCard />

      {/* Payment plan — request/track an installment plan on a collection case. */}
      <PaymentPlanCard resident={resident} />

      {/* Current Balance hero — full width: balance on the left, a divider,
          then the three progress rings on the right. */}
      <section className="pay-card pay-balance-card">
        <div className="pay-balance-head">
          <div className="pay-balance-main">
            <div className="pay-balance-label">{t('pay.currentBalance')}</div>
            {isLoading ? (
              <div className="pay-balance-amt pay-skel pay-skel-amt" aria-label={t('pay.loadingBalance')}>&nbsp;</div>
            ) : (
              <div className="pay-balance-amt">{fmtMoney(currentBalance)}</div>
            )}
            {isLoading ? (
              <div className="pay-balance-due pay-skel pay-skel-due">&nbsp;</div>
            ) : paidInFull ? (
              <div className="pay-balance-paid">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>
                </svg>
                {t('pay.paidInFull')}{lastPaidIso ? ` · ${fmtDate(lastPaidIso)}` : ''}
              </div>
            ) : (
              <div className="pay-balance-due">{t('pay.dueOn', { date: fmtDate(dueDate) })}</div>
            )}
            <div className="pay-balance-actions">
              <button type="button" className="pay-cta-primary"
                disabled={checkout.loading || isLoading || currentBalance <= 0}
                onClick={startCheckout}>
                {checkout.loading ? t('pay.startingCheckout') : currentBalance <= 0 ? t('pay.allPaidUp') : t('pay.makePayment')}
              </button>
              <button type="button" className="pay-cta-secondary"
                onClick={() => setAccountOpen(true)}>
                {t('pay.viewAccountDetails')}
              </button>
              <button type="button" className="pay-cta-secondary"
                onClick={() => setAutopayOpen(true)}>
                {autopayActive ? t('pay.manageAutopay') : t('pay.setUpAutopay')}
              </button>
              <button type="button" className="pay-cta-secondary"
                onClick={() => setMethodsOpen(true)}>
                {t('pay.paymentMethods')}
              </button>
            </div>
            {checkout.error && <div className="pay-err">{checkout.error}</div>}

            <div className="pay-balance-rows" role="group" aria-label={t('pay.duesProgressAria')}>
              {statRows.map(row => (
                <div key={row.label} className="pay-stat-row">
                  <span className="pay-stat-label">{row.label}</span>
                  <span className={`pay-stat-value${row.tone ? ' ' + row.tone : ''}`}>
                    {row.value}
                    {row.meta && <span className="pay-stat-meta">{row.meta}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Breakdown — its own card */}
      <section className="pay-card pay-breakdown-card">
        <div className="pay-breakdown">
          <div className="pay-breakdown-head">{t('pay.breakdown')}</div>
          {breakdown.map(b => (
            <div key={b.label} className="pay-breakdown-row">
              <span>{b.label}</span>
              <span className={b.amount < 0 ? 'pay-amt-credit' : ''}>
                {b.amount < 0 ? `-${fmtMoney(Math.abs(b.amount))}` : fmtMoney(b.amount)}
              </span>
            </div>
          ))}
          <div className="pay-breakdown-row pay-breakdown-total">
            <span>{t('pay.total')}</span>
            <span>{fmtMoney(breakdownTotal)}</span>
          </div>
        </div>
      </section>

      {/* Payment History */}
      <section className="pay-card" id="history">
        <div className="pay-card-head">
          <h2 className="pay-card-title">{t('pay.paymentHistory')}</h2>
          <button type="button" className="pay-card-link" onClick={() => setListOpen('history')}>{t('pay.viewAll')}</button>
        </div>
        <div className="pay-history-table">
          <div className="pay-history-row pay-history-header">
            <span>{t('pay.colDate')}</span>
            <span>{t('pay.colDescription')}</span>
            <span>{t('pay.colAmount')}</span>
            <span>{t('pay.colStatus')}</span>
            <span>{t('pay.colPaymentMethod')}</span>
          </div>
          {history.length === 0 ? (
            <div className="pay-empty">{t('pay.historyEmpty')}</div>
          ) : history.map((h: any) => (
            <div key={h.id} className="pay-history-row">
              <span className="pay-hist-date">{fmtDate(h.date)}</span>
              <span className="pay-hist-desc">{h.desc}</span>
              <span className={`pay-hist-amt${h.amount < 0 ? ' pay-amt-credit' : ''}`}>
                {h.amount < 0 ? `-${fmtMoney(Math.abs(h.amount))}` : fmtMoney(h.amount)}
              </span>
              <span className="pay-hist-status"><StatusPill kind={h.status} /></span>
              <span className="pay-hist-method">{h.method}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Statements — above Payment Methods */}
      <section className="pay-card" id="statements">
        <div className="pay-card-head">
          <h3 className="pay-tile-title">{t('pay.statements')}</h3>
          <button type="button" className="pay-card-link" onClick={() => setListOpen('statements')}>{t('pay.viewAll')}</button>
        </div>
        <div className="pay-statements">
          {stmtItems.length === 0 ? (
            <div className="pay-empty">{t('pay.statementsEmpty')}</div>
          ) : stmtItems.map(s => (
            <button key={s.id} type="button" className="pay-statement" onClick={() => setStmtOpen(s)}>
              <span className="pay-statement-icon"><PdfIcon /></span>
              <span className="pay-statement-body">
                <span className="pay-statement-title">{s.title}</span>
                <span className="pay-statement-meta">{s.meta}</span>
              </span>
              <span className="pay-statement-dl" aria-label={t('pay.open')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M5 20h14"/>
                </svg>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Account Details — view popup, opened in place from the balance card. */}
      {accountOpen && (
        <DetailDialog
          eyebrow={t('pay.eyebrowAccount')}
          title={t('pay.accountDetails')}
          period={t('pay.dueOn', { date: fmtDate(dueDate) })}
          onClose={() => setAccountOpen(false)}
        >
          <div className="rd-detail-top">
            <div className="rd-detail-headline">
              <span className="rd-detail-h-label">{t('pay.currentBalanceLower')}</span>
              <span className="rd-detail-h-amt">{fmtMoney(currentBalance)}</span>
              <span className="rd-detail-h-sub">{t('pay.accountStatusSub', { paid: monthsPaid, pct: onTimePct })}</span>
            </div>
          </div>

          <div className="rd-bd-table rd-bd-cols2">
            <div className="rd-bd-row rd-bd-head"><span>{t('pay.charge')}</span><span>{t('pay.colAmount')}</span><span /></div>
            {breakdown.map(b => (
              <div className="rd-bd-row" key={b.label}>
                <span className="rd-bd-cat">{b.label}</span>
                <span className={`rd-bd-amt${b.amount < 0 ? ' pay-amt-credit' : ''}`}>
                  {b.amount < 0 ? `-${fmtMoney(Math.abs(b.amount))}` : fmtMoney(b.amount)}
                </span>
                <span />
              </div>
            ))}
            <div className="rd-bd-row rd-bd-total">
              <span>{t('pay.totalDue')}</span><span className="rd-bd-amt">{fmtMoney(breakdownTotal)}</span><span />
            </div>
          </div>

          <div className="rd-bd-table rd-bd-cols2">
            <div className="rd-bd-row"><span className="rd-bd-cat">{t('pay.nextPayment')}</span><span className="rd-bd-amt">{fmtDate(dueDate)}</span><span /></div>
            <div className="rd-bd-row"><span className="rd-bd-cat">{t('pay.autopay')}</span><span className="rd-bd-amt">{autopayActive ? t('pay.on') : t('pay.off')}</span><span /></div>
            {defaultMethod && (
              <div className="rd-bd-row"><span className="rd-bd-cat">{t('pay.defaultMethod')}</span><span className="rd-bd-amt">{defaultMethod.brand} ···· {defaultMethod.last4}</span><span /></div>
            )}
          </div>
        </DetailDialog>
      )}

      {/* Payment Methods — manage saved cards in a popup, opened from the balance card. */}
      {methodsOpen && (
        <DetailDialog
          eyebrow={t('pay.heading')}
          title={t('pay.paymentMethods')}
          onClose={() => setMethodsOpen(false)}
          footer={
            <button type="button" className="ven-cta-primary"
              onClick={() => { setMethodsOpen(false); setAddOpen(true) }}>
              {t('pay.addNew')}
            </button>
          }
        >
          {methods.length === 0 ? (
            <p className="rd-report-blurb">{t('pay.noMethodsSaved')}</p>
          ) : (
            <div className="pay-methods-grid">
              {methods.map(pm => (
                <div key={pm.id} className={`pay-method-card${pm.is_default ? ' is-default' : ''}`}>
                  <div className="pay-method-icon">
                    {pm.kind === 'card' ? <CardIcon /> : <BankIcon />}
                  </div>
                  <div className="pay-method-info">
                    <div className="pay-method-title">{t('pay.methodEndingIn', { brand: pm.brand, last4: pm.last4 })}</div>
                    <div className="pay-method-meta">
                      {pm.kind === 'card' ? t('pay.creditDebitCard') : t('pay.bankAccount')}
                    </div>
                  </div>
                  {pm.is_default ? (
                    <span className="pay-method-badge">{t('pay.default')}</span>
                  ) : (
                    <button type="button" className="pay-method-action"
                      onClick={() => makeDefault(pm.id)}>{t('pay.setAsDefault')}</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {autopayErr && <div className="pay-err">{autopayErr}</div>}
          <p className="pay-card-note">{t('pay.secureNote')}</p>
        </DetailDialog>
      )}

      {/* Add a payment method — action popup. Add it here, OR jump to Settings. */}
      {addOpen && (
        <AddPaymentDialog
          stripeLive={stripeLive}
          onStripe={() => { setAddOpen(false); void addCard() }}
          onAddDemo={(m) => {
            const method: PaymentMethod = { id: newId('pm'), brand: m.brand, last4: m.last4, kind: m.kind }
            patchPrefs({ payment_methods: [...prefs.payment_methods, method] })
            setAddOpen(false)
          }}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Manage Autopay — popup version of the #autopay tile, opened from Quick Actions. */}
      {autopayOpen && (
        <DetailDialog
          eyebrow={t('pay.autopay')}
          title={autopayActive ? t('pay.manageAutopay') : t('pay.setUpAutopay')}
          period={autopayActive ? t('pay.active') : t('pay.off')}
          onClose={() => setAutopayOpen(false)}
          footer={autopayActive ? (
            <button type="button" className="ven-cta-secondary"
              disabled={autopayBusy}
              onClick={() => (stripeLive ? toggleAutopay(false) : setAutopayDemo(false))}>
              {autopayBusy ? t('pay.updating') : t('pay.pauseAutopay')}
            </button>
          ) : (
            <button type="button" className="ven-cta-primary"
              disabled={autopayBusy}
              onClick={() => (stripeLive ? toggleAutopay(true) : setAutopayDemo(true))}>
              {autopayBusy ? t('pay.updating') : defaultMethod ? t('pay.turnOnAutopay') : t('pay.addCardToEnable')}
            </button>
          )}
        >
          {autopayActive ? (
            <>
              <p className="rd-report-blurb">
                {t('pay.autopayChargedNote')}
              </p>
              <div className="rd-bd-table">
                <div className="rd-bd-row"><span className="rd-bd-cat">{t('pay.nextPayment')}</span><span className="rd-bd-amt">{fmtDate(dueDate)}</span><span /></div>
                <div className="rd-bd-row"><span className="rd-bd-cat">{t('pay.amount')}</span><span className="rd-bd-amt">{fmtMoney(currentBalance)}</span><span /></div>
                {defaultMethod && (
                  <div className="rd-bd-row"><span className="rd-bd-cat">{t('pay.paymentMethod')}</span><span className="rd-bd-amt">{defaultMethod.brand} ···· {defaultMethod.last4}</span><span /></div>
                )}
              </div>
            </>
          ) : (
            <p className="rd-report-blurb">
              {t('pay.autopayOffNote')}
            </p>
          )}
          {autopayErr && <div className="pay-err">{autopayErr}</div>}
        </DetailDialog>
      )}

      {/* Demo payment confirmation — shown when Stripe isn't wired up. */}
      {demoPaid != null && (
        <DetailDialog
          eyebrow={t('pay.heading')}
          title={t('pay.paymentSubmitted')}
          onClose={() => setDemoPaid(null)}
        >
          <p className="rd-report-blurb">
            {t('pay.demoPaidNote', { amount: fmtMoney(demoPaid) })}
          </p>
        </DetailDialog>
      )}

      {/* View all — Payment History */}
      {listOpen === 'history' && (
        <DetailDialog
          eyebrow={t('pay.eyebrowPayments')}
          title={t('pay.paymentHistory')}
          period={history.length === 1 ? t('pay.paymentCountOne', { count: history.length }) : t('pay.paymentCountOther', { count: history.length })}
          size="wide"
          onClose={() => setListOpen(null)}
        >
          <div className="pay-history-table">
            <div className="pay-history-row pay-history-header">
              <span>{t('pay.colDate')}</span><span>{t('pay.colDescription')}</span><span>{t('pay.colAmount')}</span><span>{t('pay.colStatus')}</span><span>{t('pay.colPaymentMethod')}</span>
            </div>
            {history.length === 0 ? (
              <div className="pay-empty">{t('pay.noPaymentsYet')}</div>
            ) : history.map((h: any) => (
              <div key={h.id} className="pay-history-row">
                <span className="pay-hist-date">{fmtDate(h.date)}</span>
                <span className="pay-hist-desc">{h.desc}</span>
                <span className={`pay-hist-amt${h.amount < 0 ? ' pay-amt-credit' : ''}`}>
                  {h.amount < 0 ? `-${fmtMoney(Math.abs(h.amount))}` : fmtMoney(h.amount)}
                </span>
                <span className="pay-hist-status"><StatusPill kind={h.status} /></span>
                <span className="pay-hist-method">{h.method}</span>
              </div>
            ))}
          </div>
        </DetailDialog>
      )}

      {/* View all — Statements */}
      {listOpen === 'statements' && (
        <DetailDialog
          eyebrow={t('pay.statements')}
          title={t('pay.allStatements')}
          period={t('pay.statementCount', { count: stmtItems.length })}
          onClose={() => setListOpen(null)}
        >
          <div className="pay-statements">
            {stmtItems.length === 0 ? (
              <div className="pay-empty">{t('pay.statementsEmpty')}</div>
            ) : stmtItems.map(s => (
              <button key={s.id} type="button" className="pay-statement"
                onClick={() => { setListOpen(null); setStmtOpen(s) }}>
                <span className="pay-statement-icon"><PdfIcon /></span>
                <span className="pay-statement-body">
                  <span className="pay-statement-title">{s.title}</span>
                  <span className="pay-statement-meta">{s.meta}</span>
                </span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        </DetailDialog>
      )}

      {/* A single statement, opened in place */}
      {stmtOpen && (
        <DetailDialog
          eyebrow={t('pay.eyebrowStatement')}
          title={stmtOpen.title}
          period={stmtOpen.periodLabel}
          onClose={() => setStmtOpen(null)}
          footer={stmtOpen.period ? (
            <a
              className="ven-cta-primary"
              href={`/app/track/statement/${stmtOpen.period}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('pay.statementDownloadPdf')}
            </a>
          ) : undefined}
        >
          <div className="rd-bd-table">
            {stmtOpen.rows.map(([label, value], i) => {
              const isClosing = stmtOpen.period && i === stmtOpen.rows.length - 1
              const credit = value.startsWith('-')
              return (
                <div className={`rd-bd-row${isClosing ? ' rd-bd-total' : ''}`} key={label}>
                  <span className="rd-bd-cat">{label}</span>
                  <span className={`rd-bd-amt${credit ? ' pay-amt-credit' : ''}`}>{value}</span>
                  <span />
                </div>
              )
            })}
          </div>
          <p className="rd-detail-foot-note">
            {t('pay.statementFootNote')}
          </p>
        </DetailDialog>
      )}
    </section>
  )
}

// Add-payment-method popup. In live Stripe mode it hands off to Stripe's secure
// hosted form; in demo mode it captures brand / last 4 / type inline and saves
// to local preferences. Either way the footer keeps a "Manage in Settings" link
// so the resident is never forced down a single path.
function AddPaymentDialog({
  stripeLive, onStripe, onAddDemo, onClose,
}: {
  stripeLive: boolean
  onStripe: () => void
  onAddDemo: (m: { brand: string; last4: string; kind: 'card' | 'bank' }) => void
  onClose: () => void
}) {
  const t = useT()
  const [kind, setKind] = useState<'card' | 'bank'>('card')
  const [brand, setBrand] = useState('')
  const [last4, setLast4] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    if (!brand.trim()) { setError(kind === 'card' ? t('pay.errAddCardBrand') : t('pay.errAddBankName')); return }
    if (!/^\d{4}$/.test(last4)) { setError(t('pay.errEnterLast4')); return }
    onAddDemo({ brand: brand.trim(), last4, kind })
  }

  const footer = stripeLive ? (
    <>
      <button type="button" className="ven-cta-secondary" onClick={onClose}>{t('pay.cancel')}</button>
      <button type="button" className="ven-cta-primary" onClick={onStripe}>{t('pay.continueToSecureForm')}</button>
    </>
  ) : (
    <>
      <button type="button" className="ven-cta-secondary" onClick={onClose}>{t('pay.cancel')}</button>
      <button type="button" className="ven-cta-primary" onClick={submit}>{kind === 'card' ? t('pay.addCard') : t('pay.addAccount')}</button>
    </>
  )

  return (
    <DetailDialog
      eyebrow={t('pay.eyebrowPaymentMethod')}
      title={t('pay.addFormOfPayment')}
      onClose={onClose}
      footer={footer}
      settingsHref="/app/settings"
    >
      {stripeLive ? (
        <p className="rd-detail-foot-note" style={{ marginTop: 0 }}>
          {t('pay.stripeSecureNote')}
        </p>
      ) : (
        <div className="rd-form">
          <div className="rd-form-seg">
            <button type="button" className={`rd-seg-btn${kind === 'card' ? ' on' : ''}`} onClick={() => setKind('card')}>{t('pay.segCard')}</button>
            <button type="button" className={`rd-seg-btn${kind === 'bank' ? ' on' : ''}`} onClick={() => setKind('bank')}>{t('pay.segBankAccount')}</button>
          </div>
          <label className="rd-form-field">
            <span className="rd-form-label">{kind === 'card' ? t('pay.cardBrandLabel') : t('pay.bankNameLabel')}</span>
            <input className="rd-form-input" value={brand} onChange={e => setBrand(e.target.value)}
              placeholder={kind === 'card' ? t('pay.cardBrandPlaceholder') : t('pay.bankNamePlaceholder')} />
          </label>
          <label className="rd-form-field">
            <span className="rd-form-label">{t('pay.last4Label')}</span>
            <input className="rd-form-input" value={last4} inputMode="numeric" maxLength={4}
              onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4242" />
          </label>
          {error && <p className="rd-form-err">{error}</p>}
        </div>
      )}
    </DetailDialog>
  )
}

// -- small components ----------------------------------------------

// Fines have no stored due date — only opened_at (issued). HOA fines carry a
// payment window; we surface it as issued + FINE_DUE_DAYS. Adjust to match the
// association's bylaws / the statutory window if it differs.
const FINE_DUE_DAYS = 30
function fineDueDate(issued: string): Date {
  const d = new Date(issued)
  d.setDate(d.getDate() + FINE_DUE_DAYS)
  return d
}

// Outstanding fines the resident still owes. Each fine is its own Stripe
// charge (create-fine-checkout) that the webhook closes on payment — this card
// just surfaces them on the Pay screen so dues + fines live in one place.
// Hidden entirely when there's nothing open to pay.
function FinesDueCard() {
  const t = useT()
  const { violations } = useMyViolations()
  const fines = violations.filter(
    v => v.kind === 'fine' && v.status === 'open' && Number(v.amount) > 0,
  )
  const [payingId, setPayingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { openCheckout } = useCheckout()

  if (fines.length === 0) return null

  const onPay = (id: string) => {
    setError(null)
    openCheckout({ fn: 'create-fine-checkout', body: { violation_id: id }, returnUrl: '/app/documents?fine_paid=1#violations' })
  }

  return (
    <section className="pay-fines-band" id="fines">
      <div className="pay-fines-band-head">
        <span className="pay-fines-eyebrow">⚠ {t('pay.finesDue')}</span>
      </div>
      {error && <div className="pay-err">{error}</div>}
      <div className="pay-fines-list">
        {fines.map(v => (
          <div key={v.id} className="pay-fine-row">
            <div className="pay-fine-head">
              <div className="pay-fine-info">
                <div className="pay-fine-title">{v.rule_title || t('pay.fineGeneric')}</div>
                <div className="pay-fine-meta">{t('pay.dueOn', { date: fmtDate(v.due_at || fineDueDate(v.opened_at)) })}</div>
              </div>
              <div className="pay-fine-amt">{fmtMoney(v.amount)}</div>
            </div>
            <div className="pay-fine-foot">
              {v.notes && <p className="pay-fine-note">{v.notes}</p>}
              <div className="pay-fine-actions">
                <button
                  type="button"
                  className="pay-cta-primary pay-fine-pay"
                  disabled={payingId === v.id}
                  onClick={() => onPay(v.id)}
                >
                  {payingId === v.id ? t('pay.startingCheckout') : t('pay.payNow')}
                </button>
                <ContestFineControl violation={v} className="pay-cta-secondary pay-fine-contest" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function StatusPill({ kind }: { kind: string }) {
  const t = useT()
  const cls = kind === 'paid' ? 'pay-pill-on'
            : kind === 'pending' ? 'pay-pill-pending'
            : 'pay-pill-off'
  const label = kind === 'paid' ? t('pay.statusPaid') : kind === 'pending' ? t('pay.statusPending') : t('pay.statusFailed')
  return <span className={`pay-pill ${cls}`}>{label}</span>
}

// -- icons ---------------------------------------------------------

function CardIcon()      { return <Svg><><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></></Svg> }
function BankIcon()      { return <Svg><><path d="M3 10 12 4l9 6"/><path d="M5 10v8h14v-8"/><path d="M3 20h18"/></></Svg> }
function PdfIcon()       { return <Svg><><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><text x="7" y="17" fontSize="5.5" fontWeight="700" fill="currentColor" stroke="none">PDF</text></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
