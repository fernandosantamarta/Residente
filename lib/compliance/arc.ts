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

// Mandatory hurricane-protection specifications (HB 1021 condo / HB 1203 HOA, both
// eff. 2024-07-01). The board (or HOA architectural committee) MUST adopt
// hurricane-protection specifications for each building/structure — they may set
// color/style/materials and must comply with the applicable building code — for every
// community regardless of when it was created. Installation that conforms is, for a
// condo, NOT a material alteration (FS 718.113(5)); for an HOA, the committee may not
// deny a conforming owner application (FS 720.3035(6)). Advisory — the board records the
// adoption date once specifications are in place.
export const HURRICANE_SPECS_REQUIRED = rule(true, 'FS 718.113(5) / 720.3035(6)', {
  note: 'board must adopt hurricane-protection specifications for each building/structure; both regimes; eff. 2024-07-01',
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

// Plain-language meaning of each status — shown as a hover tooltip on the status
// pills (resident and admin), so everyone understands what a decision means.
export const ARC_STATUS_DESC: Record<ArcStatus, string> = {
  submitted:                'Received — waiting for the board to start its review.',
  under_review:             'The board is actively reviewing this request.',
  approved:                 'Approved — you may proceed with the work as described.',
  approved_with_conditions: 'Approved, but you must follow the specific conditions the board set.',
  denied:                   'Not approved — the board declined the request and must state a reason.',
  withdrawn:                'Cancelled without a decision — no longer under review (e.g. retracted or a duplicate).',
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
  attachment_path?: string | null
  attachment_name?: string | null
  // Official decision letter the board renders to a PDF and delivers to the
  // owner (arc-decision-letter.sql / the arc-decision-letter edge function).
  decision_letter_path?: string | null
  decision_letter_name?: string | null
  decision_letter_sent_at?: string | null
  created_by?: string | null
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

  // 4. Mandatory hurricane-protection specifications (community-level, both regimes).
  // The board must adopt specs for each building/structure (eff. 2024-07-01); a conforming
  // installation is then not a material alteration (condo) and may not be denied (HOA).
  if (community && !toDate(community.hurricane_specs_adopted_at)) {
    const condo = regime === 'condo'
    out.push(signal({
      id: 'arc:hurricane-specs',
      domain: DOMAIN,
      severity: 'soon',
      title: `Adopt hurricane-protection specifications for each ${condo ? 'building' : 'structure'}`,
      detail: condo
        ? 'Florida law requires the board to adopt hurricane-protection specifications (which may set color, style, and materials, and must comply with the building code) for each building. A conforming installation is not a material alteration, and the board may not refuse a conforming owner installation. Record the adoption date once specifications are in place.'
        : 'Florida law requires the board or architectural committee to adopt hurricane-protection specifications (which may set color and style, and must comply with the building code) for each structure, regardless of when the community was created. The committee may not deny a conforming owner application. Record the adoption date once specifications are in place.',
      href: HREF,
      citation: condo ? 'FS 718.113(5)' : 'FS 720.3035(6)',
    }))
  }

  return out
}
