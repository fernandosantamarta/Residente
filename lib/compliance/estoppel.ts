// Estoppel certificates — FS 718.116(8) (condo) / FS 720.30851 (HOA).
// Statutory constants + the fee / business-day / validity engine + the
// Monitor signal producer. Posture: Enable + Monitor (advisory).
//
// ⚠ REQUIRES ATTORNEY REVIEW — the CPI fee amounts, the 10/3-business-day
// clocks, the validity windows, and the required certificate contents must be
// confirmed against the current DBPR-published figures before relied upon.

import {
  rule,
  toDate,
  ymd,
  businessDayDeadline,
  addCalendarDays,
  calendarDaysUntil,
  businessDaysBetween,
  signal,
  type ComplianceSignal,
} from './rules-core'

// Fees are identical condo vs HOA (2022 CPI; next DBPR adjustment 2027-07-01).
export const ESTOPPEL_FEE_BASE = rule(299, 'FS 718.116(8)(d) / 720.30851', { note: 'non-delinquent base; 2022 CPI' })
export const ESTOPPEL_FEE_EXPEDITED = rule(119, 'FS 718.116(8)(d) / 720.30851', { note: 'expedited add-on; 2022 CPI' })
export const ESTOPPEL_FEE_DELINQUENCY = rule(179, 'FS 718.116(8)(d) / 720.30851', { note: 'delinquent-owner add-on; 2022 CPI' })

export const ESTOPPEL_DELIVERY_BUSINESS_DAYS = rule(10, 'FS 718.116(8)(a) / 720.30851')
export const ESTOPPEL_EXPEDITED_BUSINESS_DAYS = rule(3, 'FS 718.116(8)(a) / 720.30851')

// Validity from delivery: 30 days if hand/electronic, 35 if mailed.
export const ESTOPPEL_VALIDITY_DAYS = rule(
  { electronic: 30, hand: 30, mail: 35 } as Record<EstoppelDeliveryMethod, number>,
  'FS 718.116(8)(c) / 720.30851',
)

// Aggregate fee caps for simultaneous, same-owner, non-delinquent requests.
export const ESTOPPEL_AGGREGATE_CAPS = rule(
  [
    { maxUnits: 25, cap: 750 },
    { maxUnits: 50, cap: 1000 },
    { maxUnits: 100, cap: 1500 },
    { maxUnits: Infinity, cap: 2500 },
  ],
  'FS 718.116(8)(e) / 720.30851',
)

export const ESTOPPEL_CPI_NEXT_ADJUST = '2027-07-01'

// No fee may be charged for a certificate NOT delivered within the statutory
// window (condo 718.116(8)(d) / HOA 720.30851(4)). A fee collected on a late
// certificate must be waived / refunded.
export const ESTOPPEL_NO_FEE_IF_LATE = rule(true, 'FS 718.116(8)(d) / 720.30851(4)', {
  note: 'no fee may be charged for an estoppel certificate not delivered within 10 (or 3 expedited) business days',
})
// If the sale/mortgage closing does not occur and a payor (not the owner) makes
// a timely written refund request with reasonable documentation, the fee is
// refunded within 30 days of that request (condo 718.116(8)(h) / HOA
// 720.30851(8)).
export const ESTOPPEL_REFUND_DAYS = rule(30, 'FS 718.116(8)(h) / 720.30851(8)', {
  note: 'estoppel fee refunded within 30 days of a timely written refund request when the closing does not occur',
})

export type EstoppelDeliveryMethod = 'electronic' | 'hand' | 'mail'
export type EstoppelStatus = 'new' | 'in_progress' | 'delivered' | 'fee_waived' | 'cancelled'

export interface EstoppelRequestRow {
  id: string
  community_id?: string
  unit_label?: string | null
  requestor_name?: string | null
  expedited?: boolean | null
  delinquent?: boolean | null
  received_at?: string | null
  due_at?: string | null
  status?: EstoppelStatus | string | null
  delivered_at?: string | null
  delivery_method?: EstoppelDeliveryMethod | string | null
  effective_until?: string | null
  fee_total?: number | null
  fee_waived?: boolean | null
  // Slice-1 detective fields (no-fee-if-late / refund-if-closing-cancelled).
  fee_paid?: boolean | null
  closing_cancelled_at?: string | null
  refund_due?: boolean | null
  refund_issued_at?: string | null
}

/** Statutory delivery deadline = received + 10 (or 3 expedited) business days. */
export function estoppelDueAt(receivedAt: Date | string | null | undefined, expedited = false): Date | null {
  const days = expedited ? ESTOPPEL_EXPEDITED_BUSINESS_DAYS.value : ESTOPPEL_DELIVERY_BUSINESS_DAYS.value
  return businessDayDeadline(receivedAt, days)
}

/** Itemised statutory fee. */
export function estoppelFee(opts: { expedited?: boolean; delinquent?: boolean }): {
  base: number
  expedited: number
  delinquency: number
  total: number
} {
  const base = ESTOPPEL_FEE_BASE.value
  const expedited = opts.expedited ? ESTOPPEL_FEE_EXPEDITED.value : 0
  const delinquency = opts.delinquent ? ESTOPPEL_FEE_DELINQUENCY.value : 0
  return { base, expedited, delinquency, total: base + expedited + delinquency }
}

/** Max fee the law allows for a single request (base + expedite + delinquency). */
export function estoppelMaxFee(opts: { expedited?: boolean; delinquent?: boolean }): number {
  return estoppelFee({ expedited: !!opts.expedited, delinquent: !!opts.delinquent }).total
}

/** Certificate validity end = delivered + 30/35 calendar days by method. */
export function estoppelValidUntil(
  deliveredAt: Date | string | null | undefined,
  method: EstoppelDeliveryMethod | string | null | undefined,
): Date | null {
  const m = (method as EstoppelDeliveryMethod) in ESTOPPEL_VALIDITY_DAYS.value ? (method as EstoppelDeliveryMethod) : 'electronic'
  return addCalendarDays(deliveredAt, ESTOPPEL_VALIDITY_DAYS.value[m])
}

const OPEN_STATUSES = new Set(['new', 'in_progress'])

/** Turn estoppel request rows into Monitor signals. */
export function estoppelSignals(rows: EstoppelRequestRow[] = [], now: Date = new Date()): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const cite = ESTOPPEL_DELIVERY_BUSINESS_DAYS.citation
  for (const r of rows) {
    const open = OPEN_STATUSES.has(String(r.status ?? 'new'))
    const due = toDate(r.due_at) ?? estoppelDueAt(r.received_at, !!r.expedited)
    const label = r.unit_label || r.requestor_name || r.id.slice(0, 8)

    if (open && due) {
      if (toDate(now)!.getTime() > due.getTime()) {
        out.push(signal({
          id: `estoppel:overdue:${r.id}`,
          domain: 'Estoppel',
          severity: 'overdue',
          title: `Estoppel for ${label} is past its statutory deadline`,
          detail: `Due ${ymd(due)} (${r.expedited ? 3 : 10} business days). When delivered late, ALL estoppel fees must be waived.`,
          href: '/admin/estoppel',
          citation: cite,
        }))
      } else if (businessDaysBetween(now, due) <= 2) {
        out.push(signal({
          id: `estoppel:soon:${r.id}`,
          domain: 'Estoppel',
          severity: 'soon',
          title: `Estoppel for ${label} is due within 2 business days`,
          detail: `Statutory delivery deadline ${ymd(due)}.`,
          href: '/admin/estoppel',
          citation: cite,
        }))
      }
    }

    // Over-cap fee guard (advisory).
    const maxFee = estoppelMaxFee({ expedited: !!r.expedited, delinquent: !!r.delinquent })
    if (r.fee_total != null && Number(r.fee_total) > maxFee) {
      out.push(signal({
        id: `estoppel:overfee:${r.id}`,
        domain: 'Estoppel',
        severity: 'overdue',
        title: `Estoppel fee for ${label} exceeds the statutory cap`,
        detail: `Charged $${r.fee_total}; cap for this request is $${maxFee}.`,
        href: '/admin/estoppel',
        citation: ESTOPPEL_FEE_BASE.citation,
      }))
    }

    // Delivered certificate nearing/at expiry.
    const validUntil = toDate(r.effective_until)
    if (String(r.status) === 'delivered' && validUntil) {
      const daysLeft = calendarDaysUntil(validUntil, now)
      if (daysLeft <= 5) {
        out.push(signal({
          id: `estoppel:expiring:${r.id}`,
          domain: 'Estoppel',
          severity: 'info',
          title: `Estoppel certificate for ${label} ${daysLeft < 0 ? 'has expired' : 'expires soon'}`,
          detail: `Effective through ${ymd(validUntil)}.`,
          href: '/admin/estoppel',
          citation: ESTOPPEL_VALIDITY_DAYS.citation,
        }))
      }
    }

    // Detective: a certificate delivered AFTER its deadline may carry NO fee —
    // flag any late delivery that still shows a fee charged or paid (and isn't
    // already waived) so the board waives or refunds it.
    const deliveredAt = toDate(r.delivered_at)
    if (String(r.status) === 'delivered' && deliveredAt && due && deliveredAt.getTime() > due.getTime()
        && !r.fee_waived && ((Number(r.fee_total) || 0) > 0 || r.fee_paid)) {
      out.push(signal({
        id: `estoppel:no-fee-late:${r.id}`,
        domain: 'Estoppel',
        severity: 'overdue',
        title: `Estoppel for ${label} was delivered late — no fee may be charged`,
        detail: `Delivered ${ymd(deliveredAt)} after the ${ymd(due)} deadline. When a certificate is not delivered within ${r.expedited ? ESTOPPEL_EXPEDITED_BUSINESS_DAYS.value : ESTOPPEL_DELIVERY_BUSINESS_DAYS.value} business days, no fee may be charged — ${r.fee_paid ? 'refund the amount collected' : 'waive the fee'}.`,
        href: '/admin/estoppel',
        citation: ESTOPPEL_NO_FEE_IF_LATE.citation,
      }))
    }

    // Detective: the closing did not occur and a paid fee has not been refunded.
    const cancelledAt = toDate(r.closing_cancelled_at)
    if (cancelledAt && r.fee_paid && !toDate(r.refund_issued_at)) {
      const by = addCalendarDays(cancelledAt, ESTOPPEL_REFUND_DAYS.value)
      const left = by ? calendarDaysUntil(by, now) : 0
      out.push(signal({
        id: `estoppel:refund-due:${r.id}`,
        domain: 'Estoppel',
        severity: left < 0 ? 'overdue' : 'soon',
        title: `Estoppel fee for ${label} may be refundable — the closing did not occur`,
        detail: `The closing was marked cancelled ${ymd(cancelledAt)}. If a payor other than the owner timely requested a refund with documentation, refund the fee within ${ESTOPPEL_REFUND_DAYS.value} days${by ? ` (by ${ymd(by)})` : ''}.`,
        href: '/admin/estoppel',
        citation: ESTOPPEL_REFUND_DAYS.citation,
      }))
    }
  }
  return out
}
