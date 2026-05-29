'use client'

import Link from 'next/link'
import { ReactNode, useState } from 'react'
import { useMyResident } from '@/hooks/useMyResident'
import { useAuth } from '@/app/providers'
import { hasSupabase, stripeEnabled, supabase } from '@/lib/supabase'
import { usePreferences } from '@/lib/preferences'
import { fmtMoney } from '@/lib/dues'

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '—' }
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

// Resident-facing Pay surface. Sunset hero, current balance card with
// the breakdown ledger, a right-rail Quick Actions tile, Autopay tile,
// Payment History table, Statements list, and the saved payment
// methods (read from /app/settings preferences).
export default function Pay() {
  const { resident, balance, monthlyDues, loading } = useMyResident() as any
  const { session } = useAuth() || {}
  const [prefs] = usePreferences()
  const [checkout, setCheckout] = useState({ loading: false, error: '' })

  // Skeleton only while a SIGNED-IN resident's real number is still resolving.
  // Logged-out preview has no session, so it shows the demo number immediately
  // instead of an endless skeleton.
  const isLoading = !!session && (loading || (resident == null && balance == null && !!hasSupabase))
  const currentBalance = balance == null ? 100.00 : balance
  const dueDate = '2026-12-05'

  const breakdown = [
    { label: 'Monthly Dues',     amount: monthlyDues || 1000 },
    { label: 'Capital Reserve',  amount: 200 },
    { label: 'Pet Fees',         amount: 75 },
    { label: 'Late Fee Credit',  amount: -25 },
  ]
  const breakdownTotal = breakdown.reduce((s, r) => s + r.amount, 0)

  const defaultMethod = prefs.payment_methods[0]
  const autopayActive = !!defaultMethod

  const startCheckout = async () => {
    if (!stripeEnabled || !resident) return
    setCheckout({ loading: true, error: '' })
    try {
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: { resident_id: resident.id, amount: currentBalance },
      })
      if (error) throw error
      if (data?.url) window.location.href = data.url
    } catch (err: any) {
      setCheckout({ loading: false, error: err?.message || 'Checkout failed' })
    }
  }

  return (
    <div className="pay-wrap">
      <section className="pay-hero">
        <div className="pay-hero-content">
          <h1 className="pay-hero-title">Pay</h1>
          <div className="pay-hero-sub">
            View your balance, make payments, and manage your payment methods.
          </div>
        </div>
      </section>

      <div className="pay-grid">
        {/* MAIN COLUMN */}
        <div className="pay-col">
          {/* Current Balance card with breakdown */}
          <section className="pay-card pay-balance-card">
            <div className="pay-balance-head">
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
                <button type="button" className="pay-cta-secondary">
                  View Account Details
                </button>
              </div>
              {checkout.error && <div className="pay-err">{checkout.error}</div>}
            </div>
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

          {/* Payment History */}
          <section className="pay-card">
            <div className="pay-card-head">
              <h2 className="pay-card-title">Payment History</h2>
              <Link href="#" className="pay-card-link">View all</Link>
            </div>
            <div className="pay-history-table">
              <div className="pay-history-row pay-history-header">
                <span>Date</span>
                <span>Description</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Payment Method</span>
              </div>
              {DEMO_HISTORY.map(h => (
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
              <Link href="/app/settings" className="pay-card-link">+ Add New</Link>
            </div>
            {prefs.payment_methods.length === 0 ? (
              <div className="pay-empty">
                No payment methods saved &mdash;
                <Link href="/app/settings" className="pay-empty-link"> add one in Settings</Link>.
              </div>
            ) : (
              <div className="pay-methods-grid">
                {prefs.payment_methods.map((pm, i) => (
                  <div key={pm.id} className={`pay-method-card${i === 0 ? ' is-default' : ''}`}>
                    <div className="pay-method-icon">
                      {pm.kind === 'card' ? <CardIcon /> : <BankIcon />}
                    </div>
                    <div className="pay-method-info">
                      <div className="pay-method-title">{pm.brand} ending in {pm.last4}</div>
                      <div className="pay-method-meta">
                        {pm.kind === 'card' ? 'Credit / debit card' : 'Bank account'}
                      </div>
                    </div>
                    {i === 0 ? (
                      <span className="pay-method-badge">Default</span>
                    ) : (
                      <button type="button" className="pay-method-action">Set as default</button>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                title="Set Up Autopay"
                desc="Pay your dues automatically each month."
                onClick={() => alert('Autopay setup will open the Stripe customer portal.')} />
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

          <section className="pay-card pay-autopay">
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
                  <div className="pay-autopay-row">
                    <span>Payment method</span>
                    <span>{defaultMethod!.brand} ···· {defaultMethod!.last4}</span>
                  </div>
                </div>
                <button type="button" className="pay-cta-secondary pay-cta-block">
                  Pause Autopay
                </button>
              </>
            ) : (
              <>
                <div className="pay-autopay-note">
                  Save yourself a click each month. Pick a payment method
                  in Settings, then turn Autopay on here.
                </div>
                <Link href="/app/settings" className="pay-cta-primary pay-cta-block">
                  Set up autopay
                </Link>
              </>
            )}
          </section>

          <section className="pay-card" id="statements">
            <div className="pay-card-head">
              <h3 className="pay-tile-title">Statements</h3>
              <Link href="#" className="pay-card-link">View all</Link>
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
    </div>
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
