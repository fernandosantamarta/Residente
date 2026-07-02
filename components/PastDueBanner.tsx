'use client'

import Link from 'next/link'
import { useMyResident } from '@/hooks/useMyResident'
import { fmtMoney } from '@/lib/dues'
import { useMyPaymentPlan } from '@/lib/payment-plans'
import { casePayoffForCase, type CollectionCaseRow } from '@/lib/compliance/collections'
import { useT } from '@/lib/i18n'

// Exact-cents money for a collection payoff (fmtMoney rounds to whole dollars).
const fmtCents = (n: number | string | null | undefined): string =>
  '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// A persistent "payment past due" banner for owners who are genuinely behind on
// dues (status === 'late' = carrying more than one month's dues). It's
// self-clearing — the moment the balance is paid it vanishes, so it can never
// lie the way a dismissable one-off message can. Shown in two places:
//   • Home (context="home")  — a can't-miss band right under the hero
//   • Easy Track → Pay (context="pay") — right above the balance, where they pay
// It reinforces the board's "please pay" bell notice without depending on the
// board remembering to send one. Tenants (no dues) and paid-up/current owners
// see nothing.
export function PastDueBanner({ context = 'home' }: { context?: 'home' | 'pay' }) {
  const t = useT()
  const { resident, community, payments, balance, status, isTenant, loading } = useMyResident() as any
  // In collections the banner quotes the same single number as everything else:
  // the statutory payoff (dues + daily interest + recorded costs), to the cent.
  const { openCase } = useMyPaymentPlan()
  if (loading || isTenant) return null
  const payoff = openCase && resident
    ? casePayoffForCase(openCase as CollectionCaseRow, resident, community, payments || [])
    : null
  const inCollections = !!(openCase && payoff && payoff.payoff > 0)
  const owed = inCollections ? payoff!.payoff : (Number(balance) || 0)
  if ((status !== 'late' && !inCollections) || owed <= 0) return null

  return (
    <section
      role="alert"
      className={`pastdue-band pastdue-${context}`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
        padding: '15px 20px', borderRadius: 16,
        background: 'linear-gradient(135deg, #E14909 0%, #F2922A 100%)',
        color: '#fff', boxShadow: '0 6px 22px rgba(225,73,9,0.22)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
        <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>⚠</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.2px' }}>{t('pay.pastDueTitle')}</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, opacity: 0.96, lineHeight: 1.45 }}>
            {inCollections
              ? t('pay.pastDueBodyColl', { amount: fmtCents(owed) })
              : t('pay.pastDueBody', { amount: fmtMoney(owed) })}
          </div>
        </div>
      </div>
      {context === 'home' && (
        <Link
          href="/app/track#pay"
          className="pastdue-cta"
          style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#fff', color: '#C43C06', textDecoration: 'none',
            fontSize: 13.5, fontWeight: 800, padding: '9px 17px', borderRadius: 999,
            whiteSpace: 'nowrap',
          }}
        >
          {t('pay.pastDuePayNow')}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
          </svg>
        </Link>
      )}
    </section>
  )
}
