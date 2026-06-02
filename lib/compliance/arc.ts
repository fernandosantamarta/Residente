// Architectural review (ARC) — FS 720.3035 (HOA architectural authority) and FS
// 718.113(2) (condo material alterations). Tracks owner ARC applications against
// the association's response deadline (a missed deadline can mean DEEMED
// APPROVAL where the governing documents so provide), requires a written
// decision with specific reasons for a denial, and flags a condominium material
// alteration that needs the 75% membership vote.
//
// Posture: Enable + Monitor — ADVISORY ONLY. Nothing here approves or denies a
// request. The response window is governing-document-driven (the platform reads
// communities.arc_response_days / arc_deemed_approval / material_alteration_
// threshold_pct); the constants carry their FS citation + validated:false.
//
// ⚠ REQUIRES ATTORNEY REVIEW — the response-day window, whether the governing
//   documents create a deemed-approval, the specific-reasons requirement, and
//   the condo 75% material-alteration threshold must be confirmed by Florida
//   counsel and against the declaration/bylaws.

import {
  rule,
  toDate,
  ymd,
  addCalendarDays,
  calendarDaysUntil,
  signal,
  type AssociationType,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Statutory / governing-document constants (validated:false).
// ----------------------------------------------------------------------------

// Default response window when the community has not set one. The actual period
// is governing-document-driven (communities.arc_response_days).
export const ARC_DEFAULT_RESPONSE_DAYS = rule(30, 'FS 720.3035 / governing documents', {
  note: 'default ARC response window when the community has not configured one; the declaration controls',
})

// A denial must be in writing and state the specific reason(s); an HOA may not
// enforce architectural standards inconsistently.
export const ARC_DENIAL_REASONS_REQUIRED = rule(true, 'FS 720.3035(3)', {
  note: 'a denial must be in writing with the specific reason(s); standards applied consistently',
})

// Condo material alterations require approval of 75% of the total voting
// interests unless the declaration provides otherwise.
export const MATERIAL_ALTERATION_APPROVAL_PCT = rule(75, 'FS 718.113(2)', {
  note: 'condo: material alteration needs 75% of total voting interests unless the declaration provides otherwise',
})

// ----------------------------------------------------------------------------
// Domain types
// ----------------------------------------------------------------------------

export type ArcRequestType = 'exterior_alteration' | 'new_construction' | 'landscaping' | 'other'
export type ArcStatus = 'submitted' | 'under_review' | 'approved' | 'approved_with_conditions' | 'denied' | 'withdrawn'

export const ARC_TYPE_LABELS: Record<ArcRequestType, string> = {
  exterior_alteration: 'Exterior alteration',
  new_construction:    'New construction',
  landscaping:         'Landscaping',
  other:               'Other',
}

export const ARC_STATUS_LABELS: Record<ArcStatus, string> = {
  submitted:               'Submitted',
  under_review:            'Under review',
  approved:                'Approved',
  approved_with_conditions:'Approved with conditions',
  denied:                  'Denied',
  withdrawn:               'Withdrawn',
}

export interface ArcRequestRow {
  id: string
  community_id?: string
  resident_id?: string | null
  profile_id?: string | null
  unit_label?: string | null
  request_type?: ArcRequestType | string | null
  description?: string | null
  submitted_at?: string | null
  response_due_at?: string | null
  status?: ArcStatus | string | null
  decided_at?: string | null
  decision_reason?: string | null
  is_material_alteration?: boolean | null
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

const asType = (t: AssociationType | string | null | undefined): AssociationType =>
  t === 'hoa' ? 'hoa' : 'condo'

/** The configured ARC response window for a community (governing-doc-driven). */
export function arcResponseDays(community: Record<string, any> | null | undefined): number {
  const n = Number(community?.arc_response_days)
  return n > 0 ? n : ARC_DEFAULT_RESPONSE_DAYS.value
}

/** The date the association must decide by = submitted + response window. */
export function arcResponseDeadline(r: ArcRequestRow, community: Record<string, any> | null | undefined): Date | null {
  const due = toDate(r.response_due_at)
  if (due) return due
  return addCalendarDays(r.submitted_at, arcResponseDays(community))
}

const isOpenArc = (r: ArcRequestRow): boolean =>
  ['submitted', 'under_review'].includes(String(r.status ?? 'submitted'))

// ----------------------------------------------------------------------------
// Monitor signal producer
// ----------------------------------------------------------------------------

const DOMAIN = 'Architectural review'
const HREF = '/admin/arc'

/**
 * Turn ARC requests into Monitor signals: an open request whose response window
 * is closing/closed (with a DEEMED-APPROVAL warning where the governing
 * documents so provide), a denial lacking written reasons, and a condo material
 * alteration that needs the 75% vote. Advisory. Side-effect free; never throws.
 */
export function arcSignals(
  requests: ArcRequestRow[] = [],
  community: Record<string, any> | null | undefined = null,
  now: Date = new Date(),
): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const regime = asType(community?.association_type)
  const deemed = !!community?.arc_deemed_approval
  const nowMs = toDate(now)!.getTime()

  for (const r of requests) {
    const label = `${r.unit_label || r.id.slice(0, 8)} — ${ARC_TYPE_LABELS[(r.request_type ?? 'other') as ArcRequestType] || 'request'}`

    // 1. Open request against the response deadline.
    if (isOpenArc(r)) {
      const deadline = arcResponseDeadline(r, community)
      if (deadline) {
        const daysLeft = calendarDaysUntil(deadline, now)
        if (deadline.getTime() < nowMs) {
          out.push(signal({
            id: `arc:overdue:${r.id}`,
            domain: DOMAIN,
            severity: 'overdue',
            title: `${label}: the response window has passed`,
            detail: deemed
              ? `A written decision was due by ${ymd(deadline)}. Your governing documents provide for DEEMED APPROVAL when the association does not respond in time — act or confirm the approval.`
              : `A written decision was due by ${ymd(deadline)}. Decide and notify the owner in writing.`,
            href: HREF,
            citation: ARC_DEFAULT_RESPONSE_DAYS.citation,
          }))
        } else if (daysLeft <= 7) {
          out.push(signal({
            id: `arc:soon:${r.id}`,
            domain: DOMAIN,
            severity: 'soon',
            title: `${label}: respond by ${ymd(deadline)}`,
            detail: deemed
              ? `Decide within the response window — a missed deadline may be a deemed approval under your governing documents.`
              : `Give the owner a written decision within the response window.`,
            href: HREF,
            citation: ARC_DEFAULT_RESPONSE_DAYS.citation,
          }))
        }
      }
    }

    // 2. A denial must state specific written reasons.
    if (String(r.status ?? '') === 'denied' && !String(r.decision_reason ?? '').trim()) {
      out.push(signal({
        id: `arc:denial-reasons:${r.id}`,
        domain: DOMAIN,
        severity: 'soon',
        title: `${label}: a denial must state the specific reason(s)`,
        detail: 'Record the written reason(s) for the denial; architectural standards must be applied consistently.',
        href: HREF,
        citation: ARC_DENIAL_REASONS_REQUIRED.citation,
      }))
    }

    // 3. Condo material alteration needs the 75% vote.
    if (regime === 'condo' && r.is_material_alteration && ['submitted', 'under_review', 'approved', 'approved_with_conditions'].includes(String(r.status ?? ''))) {
      const pct = Number(community?.material_alteration_threshold_pct) || MATERIAL_ALTERATION_APPROVAL_PCT.value
      out.push(signal({
        id: `arc:material:${r.id}`,
        domain: DOMAIN,
        severity: 'info',
        title: `${label}: a material alteration may need a ${pct}% membership vote`,
        detail: `A material alteration of the condominium common elements requires approval of ${pct}% of the total voting interests unless the declaration provides otherwise — board approval alone may not suffice.`,
        href: HREF,
        citation: MATERIAL_ALTERATION_APPROVAL_PCT.citation,
      }))
    }
  }

  return out
}
