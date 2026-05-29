'use client'

import Link from 'next/link'
import { ReactNode, useEffect, useState } from 'react'
import { useMyResident } from '@/hooks/useMyResident'
import { stripeEnabled, supabase } from '@/lib/supabase'
import { usePreferences } from '@/lib/preferences'
import { fmtMoney } from '@/lib/dues'

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

const DEMO_STATEMENTS = [
  { id: 's1', label: 'December 2024 Statement', date: '2024-12-01', size: '1.2 MB' },
  { id: 's2', label: 'November 2024 Statement', date: '2024-11-01', size: '1.1 MB' },
  { id: 's3', label: 'October 2024 Statement',  date: '2024-10-01', size: '1.0 MB' },
  { id: 's4', label: 'September 2024 Statement', date: '2024-09-01', size: '0.9 MB' },
]

// Pay — the resident's balance-and-payments surface, now a section of the
// Easy Track hub. Current balance card with the breakdown ledger, a
// right-rail Quick Actions tile, Autopay tile, Payment History table,
// Statements list, and the saved payment methods (read from /app/settings
// preferences).
export function PaySection() {
  const { resident, balance, monthlyDues, payments, loading } = useMyResident() as any
  const [prefs] = usePreferences()
  const [checkout, setCheckout] = useState({ loading: false, error: '' })

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

  // Show the skeleton only while the resident query is genuinely in flight.
  // Once it settles we render either the real balance or — in preview / no-
  // roster-match — the demo fallback, instead of a skeleton that never fills.
  const isLoading = loading
  const currentBalance = balance == null ? 1250.00 : balance

  const breakdown = [
    { label: 'Monthly Dues',     amount: monthlyDues || 1000 },
    { label: 'Capital Reserve',  amount: 200 },
    { label: 'Pet Fees',         amount: 75 },
    { label: 'Late Fee Credit',  amount: -25 },
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
  const monthsElapsed = now.getMonth() + 1                       // Jan = 1
  const monthsPaid = Math.min(12, monthsElapsed)                 // paid through this month
  const annualDue = monthlyDue * 12
  const paidYTD = monthlyDue * monthsPaid

  // On Track = share of due payments made on time. Demo treats each elapsed
  // month as on time; real data can refine this from payment dates. Green
  // check at 75%+ on time, yellow clock below that.
  const monthsDue = Math.max(1, monthsElapsed)
  const onTimeRate = Math.min(1, monthsPaid / monthsDue)
  const onTimePct = Math.round(onTimeRate * 100)
  const trackState: 'ok' | 'warn' = onTimeRate >= 0.75 ? 'ok' : 'warn'

  // Next-payment cycle — exact days remaining until the 1st-of-next-month due.
  const cycleStart = new Date(nextDue.getFullYear(), nextDue.getMonth() - 1, 1)
  const cycleDays = Math.max(1, Math.round((nextDue.getTime() - cycleStart.getTime()) / DAY_MS))
  const daysLeft = Math.max(0, Math.ceil((nextDue.getTime() - now.getTime()) / DAY_MS))
  const duePct = (cycleDays - daysLeft) / cycleDays

  const trackFaces: Record<'ok' | 'warn', [RingFace, RingFace]> = {
    ok: [
      { value: <RingCheck />, sub: '',         aria: `on track, ${onTimePct}% of payments on time` },
      { value: `${onTimePct}%`, sub: 'on time',  aria: `${onTimePct}% of payments on time` },
    ],
    warn: [
      { value: 'Behind',        sub: '',         aria: `behind, ${onTimePct}% of payments on time` },
      { value: `${onTimePct}%`, sub: 'on time',  aria: `${onTimePct}% of payments on time` },
    ],
  }

  const rings: { tone: RingTone; pct: number; cat: string; faces: [RingFace, RingFace] }[] = [
    {
      tone: 'dues', cat: 'Balance', pct: annualDue ? paidYTD / annualDue : 0,
      faces: [
        { value: `${monthsPaid}/12`, sub: 'months paid',              aria: `${monthsPaid} of 12 months paid` },
        { value: fmtMoney(paidYTD),  sub: `of ${fmtMoney(annualDue)}`, aria: `${fmtMoney(paidYTD)} of ${fmtMoney(annualDue)} paid this year` },
      ],
    },
    {
      tone: trackState, cat: 'Payment status', pct: onTimeRate,
      faces: trackFaces[trackState],
    },
    {
      tone: 'due', cat: 'Due date', pct: duePct,
      faces: [
        { value: daysLeft === 0 ? 'Today' : `${daysLeft}`, sub: daysLeft === 0 ? 'due today' : 'days left', aria: daysLeft === 0 ? 'due today' : `${daysLeft} days until due` },
        { value: fmtShort(nextDue), sub: 'next due', aria: `next payment due ${fmtShort(nextDue)}` },
      ],
    },
  ]

  // Unified payment-method list: real Stripe cards when we have them, else the
  // localStorage/demo methods so preview mode still renders cards.
  const liveCards = cards && cards.length > 0
    ? cards.map((c: any) => ({
        id: c.id,
        brand: c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : 'Card',
        last4: c.last4,
        kind: 'card' as const,
        is_default: !!c.is_default,
      }))
    : null
  const methods: any[] = liveCards
    ?? prefs.payment_methods.map((pm, i) => ({ ...pm, is_default: i === 0 }))
  const defaultMethod = methods.find(m => m.is_default) || methods[0]
  const autopayActive = autopayOn != null ? autopayOn : !!defaultMethod

  // Save a card on file via Stripe hosted Checkout (setup mode) — redirects to
  // Stripe and back to #pay. Used by "+ Add New" and the autopay setup CTA.
  const addCard = async () => {
    if (!stripeLive) return
    setAutopayErr('')
    try {
      const { data, error } = await supabase.functions.invoke('create-setup-checkout', {
        body: { resident_id: resident.id },
      })
      if (error) throw error
      if (data?.url) window.location.href = data.url
    } catch (err: any) {
      setAutopayErr(err?.message || 'Could not start card setup.')
    }
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
      setAutopayErr(err?.message || 'Could not update autopay.')
    } finally {
      setAutopayBusy(false)
    }
  }

  // Make a saved card the default (used by autopay + one-click pay).
  const makeDefault = async (pmId: string) => {
    if (!stripeLive) return
    setAutopayErr('')
    try {
      const { error } = await supabase.functions.invoke('set-autopay', {
        body: { resident_id: resident.id, enabled: autopayActive, payment_method_id: pmId },
      })
      if (error) throw error
      setCards(cs => cs ? cs.map((c: any) => ({ ...c, is_default: c.id === pmId })) : cs)
    } catch (err: any) {
      setAutopayErr(err?.message || 'Could not set default card.')
    }
  }

  // Payment history — real rows from the `payments` table (already fetched and
  // sorted newest-first by useMyResident) when we have a resident, falling back
  // to the demo ledger only in preview mode where there's no roster match.
  const methodLabel = defaultMethod
    ? `${defaultMethod.brand} ···· ${defaultMethod.last4}`
    : 'Card'
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
          desc: `Regular Dues${period ? ` — ${period}` : ''}`,
          amount: Number(p.amount) || 0,
          status: 'paid',
          method: methodLabel,
        }
      })

  const startCheckout = async () => {
    if (!stripeEnabled || !resident) return
    setCheckout({ loading: true, error: '' })
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { resident_id: resident.id, amount: currentBalance },
      })
      if (error) throw error
      if (data?.url) window.location.href = data.url
    } catch (err: any) {
      setCheckout({ loading: false, error: err?.message || 'Checkout failed' })
    }
  }

  return (
    <section id="pay" className="pay-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">Pay</h2>
        <p className="voice-page-sub">
          View your balance, make payments, and manage your payment methods.
        </p>
      </div>

      {/* Current Balance hero — full width: balance on the left, a divider,
          then the three progress rings on the right. */}
      <section className="pay-card pay-balance-card">
        <div className="pay-balance-head">
          <div className="pay-balance-main">
            <div className="pay-balance-label">Current Balance</div>
            {isLoading ? (
              <div className="pay-balance-amt pay-skel pay-skel-amt" aria-label="Loading balance">&nbsp;</div>
            ) : (
              <div className="pay-balance-amt">{fmtMoney(currentBalance)}</div>
            )}
            {isLoading ? (
              <div className="pay-balance-due pay-skel pay-skel-due">&nbsp;</div>
            ) : (
              <div className="pay-balance-due">Due {fmtDate(dueDate)}</div>
            )}
            <div className="pay-balance-actions">
              <button type="button" className="pay-cta-primary"
                disabled={checkout.loading || !stripeEnabled || isLoading}
                onClick={startCheckout}>
                {checkout.loading ? 'Starting checkout…' : 'Make Payment'}
              </button>
              <a href="#history" className="pay-cta-secondary">
                View Account Details
              </a>
            </div>
            {checkout.error && <div className="pay-err">{checkout.error}</div>}
          </div>

          <div className="pay-balance-sep" aria-hidden="true" />

          <div className="pay-rings" role="group" aria-label="Dues progress">
            {rings.map((r, i) => (
              <BalanceRing key={i} index={i} tone={r.tone} pct={r.pct} cat={r.cat} faces={r.faces} />
            ))}
          </div>
        </div>
      </section>

      {/* Breakdown — its own card */}
      <section className="pay-card pay-breakdown-card">
        <div className="pay-breakdown">
          <div className="pay-breakdown-head">Breakdown</div>
          {breakdown.map(b => (
            <div key={b.label} className="pay-breakdown-row">
              <span>{b.label}</span>
              <span className={b.amount < 0 ? 'pay-amt-credit' : ''}>
                {b.amount < 0 ? `-${fmtMoney(Math.abs(b.amount))}` : fmtMoney(b.amount)}
              </span>
            </div>
          ))}
          <div className="pay-breakdown-row pay-breakdown-total">
            <span>Total</span>
            <span>{fmtMoney(breakdownTotal)}</span>
          </div>
        </div>
      </section>

      <div className="pay-grid">
        {/* MAIN COLUMN */}
        <div className="pay-col">
          {/* Payment History */}
          <section className="pay-card" id="history">
            <div className="pay-card-head">
              <h2 className="pay-card-title">Payment History</h2>
              <Link href="#history" className="pay-card-link">View all</Link>
            </div>
            <div className="pay-history-table">
              <div className="pay-history-row pay-history-header">
                <span>Date</span>
                <span>Description</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Payment Method</span>
              </div>
              {history.length === 0 ? (
                <div className="pay-empty">No payments yet — your first dues payment will show up here.</div>
              ) : history.map((h: any) => (
                <div key={h.id} className="pay-history-row">
                  <span className="pay-hist-date">{fmtDate(h.date)}</span>
                  <span className="pay-hist-desc">{h.desc}</span>
                  <span className={`pay-hist-amt${h.amount < 0 ? ' pay-amt-credit' : ''}`}>
                    {h.amount < 0 ? `-${fmtMoney(Math.abs(h.amount))}` : fmtMoney(h.amount)}
                  </span>
                  <span><StatusPill kind={h.status} /></span>
                  <span className="pay-hist-method">{h.method}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Payment Methods */}
          <section className="pay-card">
            <div className="pay-card-head">
              <h2 className="pay-card-title">Payment Methods</h2>
              {stripeLive ? (
                <button type="button" className="pay-card-link" onClick={addCard}>+ Add New</button>
              ) : (
                <Link href="/app/settings" className="pay-card-link">+ Add New</Link>
              )}
            </div>
            {methods.length === 0 ? (
              <div className="pay-empty">
                No payment methods saved &mdash;
                {stripeLive ? (
                  <button type="button" className="pay-empty-link" onClick={addCard}> add a card</button>
                ) : (
                  <Link href="/app/settings" className="pay-empty-link"> add one in Settings</Link>
                )}.
              </div>
            ) : (
              <div className="pay-methods-grid">
                {methods.map(pm => (
                  <div key={pm.id} className={`pay-method-card${pm.is_default ? ' is-default' : ''}`}>
                    <div className="pay-method-icon">
                      {pm.kind === 'card' ? <CardIcon /> : <BankIcon />}
                    </div>
                    <div className="pay-method-info">
                      <div className="pay-method-title">{pm.brand} ending in {pm.last4}</div>
                      <div className="pay-method-meta">
                        {pm.kind === 'card' ? 'Credit / debit card' : 'Bank account'}
                      </div>
                    </div>
                    {pm.is_default ? (
                      <span className="pay-method-badge">Default</span>
                    ) : (
                      <button type="button" className="pay-method-action"
                        disabled={!stripeLive}
                        onClick={() => makeDefault(pm.id)}>Set as default</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {autopayErr && <div className="pay-err">{autopayErr}</div>}
            <p className="pay-card-note">
              Your payment information is secure and encrypted. Stripe handles
              the card details &mdash; we only see the brand and last 4.
            </p>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <aside className="pay-aside">
          <section className="pay-card pay-tile-tight">
            <h3 className="pay-tile-title">Quick Actions</h3>
            <div className="pay-quick">
              <QuickRow icon={<IconLightning />}
                title="Pay a One-Time Amount"
                desc="Make a custom payment outside of recurring dues."
                onClick={startCheckout} />
              <QuickRow icon={<IconRepeat />}
                title={autopayActive ? 'Manage Autopay' : 'Set Up Autopay'}
                desc="Pay your dues automatically each month."
                {...(stripeLive
                  ? { onClick: () => toggleAutopay(!autopayActive) }
                  : { href: '#autopay' })} />
              <QuickRow icon={<IconReceipt />}
                title="View Statements"
                desc="Download monthly statements as PDFs."
                href="#statements" />
              <QuickRow icon={<IconClock />}
                title="Payment History"
                desc="See every transaction on your account."
                href="#history" />
            </div>
          </section>

          <section className="pay-card pay-autopay" id="autopay">
            <div className="pay-autopay-head">
              <div className="pay-autopay-title">Autopay</div>
              {autopayActive ? (
                <span className="pay-pill pay-pill-on">Active</span>
              ) : (
                <span className="pay-pill pay-pill-off">Off</span>
              )}
            </div>
            {autopayActive ? (
              <>
                <div className="pay-autopay-note">
                  Your payments will be deducted automatically on the
                  1st of each month.
                </div>
                <div className="pay-autopay-meta">
                  <div className="pay-autopay-row">
                    <span>Next payment</span>
                    <span>{fmtDate(dueDate)}</span>
                  </div>
                  <div className="pay-autopay-row">
                    <span>Amount</span>
                    <span>{fmtMoney(currentBalance)}</span>
                  </div>
                  {defaultMethod && (
                    <div className="pay-autopay-row">
                      <span>Payment method</span>
                      <span>{defaultMethod.brand} ···· {defaultMethod.last4}</span>
                    </div>
                  )}
                </div>
                {stripeLive ? (
                  <button type="button" className="pay-cta-secondary pay-cta-block"
                    disabled={autopayBusy} onClick={() => toggleAutopay(false)}>
                    {autopayBusy ? 'Updating…' : 'Pause Autopay'}
                  </button>
                ) : (
                  <button type="button" className="pay-cta-secondary pay-cta-block">
                    Pause Autopay
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="pay-autopay-note">
                  Save yourself a click each month. Turn on Autopay and we&rsquo;ll
                  charge your default card on the 1st.
                </div>
                {stripeLive ? (
                  <button type="button" className="pay-cta-primary pay-cta-block"
                    disabled={autopayBusy} onClick={() => toggleAutopay(true)}>
                    {autopayBusy ? 'Updating…' : defaultMethod ? 'Turn on autopay' : 'Add a card to enable'}
                  </button>
                ) : (
                  <Link href="/app/settings" className="pay-cta-primary pay-cta-block">
                    Set up autopay
                  </Link>
                )}
              </>
            )}
            {autopayErr && <div className="pay-err">{autopayErr}</div>}
          </section>

          <section className="pay-card" id="statements">
            <div className="pay-card-head">
              <h3 className="pay-tile-title">Statements</h3>
              <Link href="#statements" className="pay-card-link">View all</Link>
            </div>
            <div className="pay-statements">
              {DEMO_STATEMENTS.map(s => (
                <a key={s.id} href="#" className="pay-statement">
                  <span className="pay-statement-icon"><PdfIcon /></span>
                  <span className="pay-statement-body">
                    <span className="pay-statement-title">{s.label}</span>
                    <span className="pay-statement-meta">{fmtDate(s.date)} &middot; {s.size}</span>
                  </span>
                  <span className="pay-statement-dl" aria-label="Download">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M5 20h14"/>
                    </svg>
                  </span>
                </a>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {/* Support footer */}
      <section className="pay-support">
        <div className="pay-support-icon" aria-hidden="true">
          <IconHelp />
        </div>
        <div className="pay-support-body">
          <div className="pay-support-title">Need help with a payment?</div>
          <div className="pay-support-sub">
            If you have any questions or need assistance, our support team is here to help.
          </div>
        </div>
        <Link href="/app/voice#contact" className="pay-cta-secondary">Contact Support</Link>
      </section>
    </section>
  )
}

// -- small components ----------------------------------------------

function StatusPill({ kind }: { kind: string }) {
  const cls = kind === 'paid' ? 'pay-pill-on'
            : kind === 'pending' ? 'pay-pill-pending'
            : 'pay-pill-off'
  const label = kind === 'paid' ? 'Paid' : kind === 'pending' ? 'Pending' : 'Failed'
  return <span className={`pay-pill ${cls}`}>{label}</span>
}

// -- Current Balance rings -----------------------------------------

type RingTone = 'dues' | 'due' | 'ok' | 'warn' | 'bad'
type RingFace = { value: ReactNode; sub: string; aria: string }

const RING_R = 51
const RING_C = 2 * Math.PI * RING_R   // circumference of the progress arc

// Green checkmark shown inside the Payment Status ring when on track. Sized
// (via CSS) to sit comfortably inside the ring with room to spare.
function RingCheck() {
  return (
    <svg className="pay-ring-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6.5 9.5 17.5 4 12" />
    </svg>
  )
}

// A single progress ring. The arc draws itself in on mount (staggered by
// `index` for a cascade) and fills to `pct`. The centre + caption show the
// primary face by default and hold on the detail face the whole time the ring
// is hovered or focused — the two faces cross-fade as they swap. Hovering
// lifts + glows the ring; tapping toggles the faces for touch.
function BalanceRing({ pct, faces, tone, cat, index = 0 }: {
  pct: number
  faces: [RingFace, RingFace]
  tone: RingTone
  cat: string
  index?: number
}) {
  const [idx, setIdx] = useState(0)
  const [armed, setArmed] = useState(false)   // false until the entrance draw fires
  const show = (i: number) => setIdx(i)

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 90 + index * 140)
    return () => clearTimeout(t)
  }, [index])

  const target = Math.max(0, Math.min(1, pct || 0)) * RING_C
  const dash = armed ? target : 0   // animate 0 → target via the CSS transition
  const face = faces[idx] ?? faces[0]

  return (
    <button
      type="button"
      className={`pay-ring pay-ring-${tone}${idx > 0 ? ' is-hot' : ''}`}
      onMouseEnter={() => show(1)} onMouseLeave={() => show(0)}
      onFocus={() => show(1)} onBlur={() => show(0)}
      onClick={() => show(idx === 0 ? 1 : 0)}
      aria-label={`${cat}: ${face.aria}`}
    >
      <span className="pay-ring-viz">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="pay-ring-track" cx="60" cy="60" r={RING_R} />
          <circle
            className="pay-ring-fill" cx="60" cy="60" r={RING_R}
            strokeDasharray={`${dash} ${RING_C}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <span className="pay-ring-center" key={idx}>
          <span className="pay-ring-value">{face.value}</span>
          {face.sub && <span className="pay-ring-sub">{face.sub}</span>}
        </span>
      </span>
      <span className="pay-ring-cat">{cat}</span>
    </button>
  )
}

function QuickRow({
  icon, title, desc, href, onClick,
}: {
  icon: ReactNode; title: string; desc: string; href?: string; onClick?: () => void
}) {
  const inner = (
    <>
      <span className="pay-quick-icon">{icon}</span>
      <span className="pay-quick-body">
        <span className="pay-quick-title">{title}</span>
        <span className="pay-quick-desc">{desc}</span>
      </span>
      <svg className="pay-quick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </>
  )
  return href
    ? <a href={href} className="pay-quick-row">{inner}</a>
    : <button type="button" className="pay-quick-row" onClick={onClick}>{inner}</button>
}

// -- icons ---------------------------------------------------------

function IconLightning() { return <Svg><><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></></Svg> }
function IconRepeat()    { return <Svg><><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></></Svg> }
function IconReceipt()   { return <Svg><><path d="M5 3h14v18l-2-2-2 2-2-2-2 2-2-2-2 2-2-2z"/><path d="M9 8h6M9 12h6M9 16h4"/></></Svg> }
function IconClock()     { return <Svg><><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></></Svg> }
function IconHelp()      { return <Svg><><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5"/><circle cx="12" cy="17.5" r="0.5" fill="currentColor"/></></Svg> }
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
