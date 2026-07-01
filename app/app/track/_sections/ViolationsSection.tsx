'use client'

// My Violations — the resident's own warnings & fines, moved into Easy Track
// (between Pay and Vendors). Stats up top (warnings, fines issued, outstanding,
// under review), then the list with pay / contest actions. RLS scopes it to the
// signed-in resident. No demo fallback — a clean account shows an empty state.

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { computeStats, useMyViolations } from '@/lib/violations'
import { useCheckout } from '@/components/CheckoutProvider'
import { ContestFineControl } from './ContestFineControl'
import { useT } from '@/lib/i18n'

const fmtMoney = (n: number | null | undefined) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtNum = (n: number) => n.toLocaleString('en-US')
const fmtDate = (d: string | Date | null | undefined) => (d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—')
const VIOL_PAGE = 5

export function ViolationsSection() {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { violations } = useMyViolations()
  const stats = useMemo(() => computeStats(violations), [violations])

  const [page, setPage] = useState(0)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const pages = Math.max(1, Math.ceil(violations.length / VIOL_PAGE))
  const shown = violations.slice(page * VIOL_PAGE, page * VIOL_PAGE + VIOL_PAGE)

  const payable = (v: any) =>
    v.kind === 'fine' && v.status !== 'closed' && Number(v.amount) > 0 &&
    v.dispute_status !== 'filed' && v.dispute_status !== 'under_review'
  const payAmount = (v: any) =>
    v.dispute_status === 'reduced' && v.reduced_amount != null ? Number(v.reduced_amount) : Number(v.amount)
  const isPaid = (v: any) =>
    v.status === 'closed' && (v.resolution === 'stripe-paid' || v.resolution === 'manual-paid' || v.resolution === 'Paid')
  const resolvedLabel = (v: any): string => {
    if (isPaid(v)) return t('documents.statusPaid')
    if (v.resolution === 'waived') return t('documents.statusWaived')
    if (v.resolution === 'dismissed') return t('documents.statusClosed')
    return v.resolution || t('documents.statusClosed')
  }
  const underReview = (v: any) =>
    v.status === 'appealed' || v.dispute_status === 'filed' || v.dispute_status === 'under_review'
  const statusLabel = (v: any): string =>
    v.status === 'closed' ? resolvedLabel(v)
    : underReview(v) ? t('documents.statusUnderReview')
    : t('documents.statusOpen')
  const statusTone = (v: any): string =>
    isPaid(v) ? 'paid' : v.status === 'closed' ? 'closed' : underReview(v) ? 'review' : 'open'

  const onPay = (v: any) => {
    setPayError(null)
    openCheckout({ fn: 'create-fine-checkout', body: { violation_id: v.id }, returnUrl: '/app/track?fine_paid=1#violations' })
  }

  return (
    <div id="violations">
      {/* Stats — the resident's own enforcement summary. */}
      <section className="rb-vi" style={{ marginBottom: 18 }}>
        <div className="rb-vi-head">
          <h2>{t('documents.violationsTitlePre')} <span className="rb-amp">&amp;</span> {t('documents.violationsTitlePost')}</h2>
          <span className="rb-vi-sub">{t('documents.violationsSub')}</span>
        </div>
        <div className="rb-vi-stats">
          <div className="rb-vi-stat">
            <div className="rb-vi-stat-n">{fmtNum(stats.warnings)}</div>
            <div className="rb-vi-stat-l">{t('documents.statWarningsLabel')}</div>
            <div className="rb-vi-stat-d">{t('documents.statWarningsDesc')}</div>
          </div>
          <div className="rb-vi-stat">
            <div className="rb-vi-stat-n">{fmtNum(stats.finesCount)}</div>
            <div className="rb-vi-stat-l">{t('documents.statFinesIssuedLabel')}</div>
            <div className="rb-vi-stat-d">{t('documents.statFinesCountDesc')}</div>
          </div>
          <div className="rb-vi-stat">
            <div className="rb-vi-stat-n">{fmtMoney(stats.outstanding)}</div>
            <div className="rb-vi-stat-l">{t('documents.statOutstandingLabel')}</div>
            <div className="rb-vi-stat-d">{t('documents.statOutstandingDesc')}</div>
          </div>
          <div className="rb-vi-stat">
            <div className="rb-vi-stat-n">{fmtNum(stats.appeals)}</div>
            <div className="rb-vi-stat-l">{t('documents.statAppealsLabel')}</div>
            <div className="rb-vi-stat-d">{t('documents.statAppealsDesc')}</div>
          </div>
        </div>
      </section>

      {/* List */}
      <section className="doc-card" style={{ gridColumn: '1 / -1' }}>
        <div className="doc-card-head">
          <h2 className="doc-card-title">{t('documents.yourViolations')}</h2>
        </div>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(10,36,64,0.55)', margin: '-2px 0 14px' }}>{t('documents.appealsNote')}</p>
        {payError && <div className="myv-pay-err">{payError}</div>}
        {violations.length === 0 ? (
          <div className="doc-empty">{t('documents.noViolations')}</div>
        ) : (
          <div className="myv-list">
            {shown.map(v => {
              const isFine = v.kind === 'fine'
              const canContest = isFine && v.status !== 'closed'
              const hasActions = payable(v) || canContest
              return (
                <div className="myv-card" key={v.id}>
                  <div className="myv-card-top">
                    <div className="myv-tags">
                      <span className={`myv-tag myv-tag-${v.kind}`}>{isFine ? t('documents.tagFine') : t('documents.tagWarning')}</span>
                      <span className={`myv-status myv-status-${statusTone(v)}`}>{statusLabel(v)}</span>
                    </div>
                    {isFine && v.amount != null && Number(v.amount) > 0 && (
                      <div className="myv-amt">{fmtMoney(payAmount(v))}</div>
                    )}
                  </div>
                  <div className="myv-title">{v.rule_title || t('documents.communityRule')}</div>
                  <div className="myv-meta">{t('documents.openedOn', { date: fmtDate(v.opened_at) })}</div>
                  {v.notes && <p className="myv-note">{v.notes}</p>}
                  {hasActions && (
                    <div className="myv-actions">
                      {payable(v) && (
                        <button type="button" className="myv-pay-btn" onClick={() => onPay(v)} disabled={payingId === v.id}>
                          {payingId === v.id ? t('documents.payingFine') : t('documents.payFine', { amount: fmtMoney(payAmount(v)) })}
                        </button>
                      )}
                      {canContest && <ContestFineControl violation={v} className="myv-pay-btn myv-contest-btn" />}
                    </div>
                  )}
                </div>
              )
            })}
            {pages > 1 && (
              <div className="con-pager">
                <button type="button" className="con-pager-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>&lsaquo; {t('documents.prev')}</button>
                <span className="con-pager-info">{t('documents.pageOf', { page: page + 1, pages })}</span>
                <button type="button" className="con-pager-btn" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>{t('documents.next')} &rsaquo;</button>
              </div>
            )}
          </div>
        )}
      </section>

      <Link href="/app/enforcement" className="myv-link">
        <span className="myv-link-body">
          <span className="myv-link-title">Hearings &amp; suspensions</span>
          <span className="myv-link-sub">See any hearing on a proposed fine, and any voting or use-rights suspension on your account.</span>
        </span>
        <span className="myv-link-open">Open &rarr;</span>
      </Link>
    </div>
  )
}
