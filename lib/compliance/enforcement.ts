// Violations, fines, hearings & suspension — FS 718.303 (condo) and
// FS 720.305 / 720.3085 (HOA). The enforcement layer the statute wraps around a
// fine or a use-rights suspension: an INDEPENDENT fining committee, the 14-day
// notice + opportunity for a hearing, the $100/day & $1,000-aggregate caps, the
// no-lien rule for fines, and the voting/use-rights suspension track (a 90-day
// monetary delinquency may be suspended WITHOUT a hearing; a covenant-violation
// use-rights suspension needs the same hearing as a fine).
//
// Posture: Enable + Monitor — ADVISORY ONLY. Nothing here auto-levies a fine,
// auto-suspends an owner, or hard-blocks a board action. Every constant carries
// its FS citation + validated:false until Florida counsel confirms it.
//
// ⚠ REQUIRES ATTORNEY REVIEW — the caps, the 14-day notice, the committee-
//   independence test, the no-lien rule, and the 90-day-delinquency suspension
//   must be confirmed by Florida community-association counsel and against the
//   governing documents (which, for an HOA, may waive the $1,000 aggregate cap).

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
// Statutory constants (validated:false).
// ----------------------------------------------------------------------------

// A fine may not exceed $100 per violation. For a CONTINUING violation a fine
// may be levied per day, but the aggregate may not exceed $1,000 — and, for an
// HOA, that aggregate cap applies "unless otherwise provided in the governing
// documents," so an HOA declaration may waive it. (We cap by default and flag
// the HOA override rather than assume it.)
export const FINE_PER_VIOLATION_MAX = rule(100, 'FS 718.303(3)(b) / 720.305(2)(b)', {
  note: '$100 per violation; per day for a continuing violation',
})
export const FINE_AGGREGATE_CAP = rule(1000, 'FS 718.303(3)(b) / 720.305(2)(b)', {
  note: 'condo: hard $1,000 aggregate cap; HOA: $1,000 unless the declaration provides otherwise',
})

// Before a fine or a covenant-violation suspension may be imposed, the owner
// gets at least 14 days' notice and an opportunity for a hearing.
export const HEARING_NOTICE_DAYS = rule(14, 'FS 718.303(3)(b) / 720.305(2)(b)', {
  note: 'at least 14 days notice + opportunity for a hearing before the fine/suspension is imposed',
})

// The hearing is before a committee of at least three members APPOINTED BY THE
// BOARD who are NOT officers, directors, or employees of the association, nor
// the spouse, parent, child, brother, or sister of one. If the committee, by
// majority vote, does not approve the fine/suspension, it may not be imposed.
export const FINING_COMMITTEE_MIN = rule(3, 'FS 718.303(3)(b) / 720.305(2)(b)', {
  note: 'committee of ≥3 board-appointed members independent of the board',
})

// A fine may NEVER become a lien against a condominium unit. For an HOA, a fine
// of less than $1,000 may not become a lien (HB 1203). (Mirrors
// collections.ts HOA_FINE_LIEN_FLOOR; restated here for the enforcement view.)
export const FINE_LIEN_FLOOR = rule(
  { condo: Infinity, hoa: 1000 } as { condo: number; hoa: number },
  'FS 718.303(3) (condo: never a lien) / 720.305(2) (HOA: <$1,000 not a lien, HB 1203)',
  { note: 'a condo fine is never a lien; an HOA fine under $1,000 may not become a lien' },
)

// >90 days delinquent in a monetary obligation: the board may suspend voting
// rights and common-area use rights at a properly noticed meeting WITHOUT a
// hearing. (Use-rights suspension for a covenant violation DOES need a hearing.)
export const SUSPENSION_DELINQUENCY_DAYS = rule(90, 'FS 718.303(4)-(5) / 720.3085(4) & 720.305(2)', {
  note: '>90 days delinquent → voting/use-rights may be suspended without a hearing; the suspension stays until the debt is paid',
})

// ----------------------------------------------------------------------------
// Domain types
// ----------------------------------------------------------------------------

export type EnforcementStage =
  | 'none'        // a plain warning / simple fine — no statutory hearing track
  | 'proposed'    // a fine/suspension is proposed, hearing track started
  | 'notice_sent' // 14-day notice + opportunity for a hearing delivered
  | 'hearing_set' // a hearing date is scheduled
  | 'upheld'      // committee upheld it — may be imposed
  | 'rejected'    // committee rejected it — may NOT be imposed
  | 'levied'      // fine made effective after the hearing

export type HearingDecision = 'pending' | 'upheld' | 'rejected' | 'waived'
export type SuspensionRights = 'voting' | 'use_common' | 'both'
export type SuspensionBasis = 'delinquency_90' | 'unpaid_fine' | 'rule_violation'
export type SuspensionStatus = 'proposed' | 'active' | 'lifted'

export const STAGE_LABELS: Record<EnforcementStage, string> = {
  none:        'Issued',
  proposed:    'Fine proposed',
  notice_sent: '14-day notice sent',
  hearing_set: 'Hearing scheduled',
  upheld:      'Upheld by committee',
  rejected:    'Rejected by committee',
  levied:      'Fine levied',
}

export const SUSPENSION_BASIS_LABELS: Record<SuspensionBasis, string> = {
  delinquency_90: 'More than 90 days delinquent (no hearing required)',
  unpaid_fine:    'Unpaid fine',
  rule_violation: 'Covenant / rule violation (hearing required)',
}

export const SUSPENSION_RIGHTS_LABELS: Record<SuspensionRights, string> = {
  voting:     'Voting rights',
  use_common: 'Common-area use rights',
  both:       'Voting + common-area use rights',
}

// An ev_violations row, with the enforcement columns added by enforcement.sql.
export interface ViolationRow {
  id: string
  community_id?: string
  profile_id?: string | null
  resident_label?: string | null
  kind?: 'warning' | 'fine' | string | null
  rule_title?: string | null
  amount?: number | null
  status?: 'open' | 'appealed' | 'closed' | string | null
  resolution?: string | null
  opened_at?: string | null
  closed_at?: string | null
  // enforcement layer
  fine_per_day?: number | null
  fine_continuing?: boolean | null
  fine_started_on?: string | null
  cure_by?: string | null
  hearing_required?: boolean | null
  levied_at?: string | null
  enforcement_stage?: EnforcementStage | string | null
}

export interface HearingRow {
  id: string
  community_id?: string
  violation_id?: string | null
  notice_sent_at?: string | null
  scheduled_at?: string | null
  held_at?: string | null
  decision?: HearingDecision | string | null
  committee_present?: number | null
  vote_for?: number | null
  vote_against?: number | null
  minutes?: string | null
}

export interface FiningCommitteeMemberRow {
  id: string
  community_id?: string
  full_name?: string | null
  is_independent?: boolean | null
  relationship_note?: string | null
  active?: boolean | null
}

export interface SuspensionRow {
  id: string
  community_id?: string
  profile_id?: string | null
  resident_id?: string | null
  unit_label?: string | null
  rights?: SuspensionRights | string | null
  basis?: SuspensionBasis | string | null
  violation_id?: string | null
  hearing_id?: string | null
  requires_hearing?: boolean | null
  amount_owed?: number | null
  delinquent_since?: string | null
  approved_at?: string | null
  started_at?: string | null
  ended_at?: string | null
  status?: SuspensionStatus | string | null
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

const asType = (t: AssociationType | string | null | undefined): AssociationType =>
  t === 'hoa' ? 'hoa' : 'condo'

/** Whether a violation row is still being worked (open and not resolved). */
export function isOpenViolation(v: ViolationRow): boolean {
  return String(v.status ?? 'open') !== 'closed' && !v.resolution
}

/**
 * The accrued fine for a (possibly continuing) violation, capped at the $1,000
 * aggregate. For a continuing violation the daily rate runs from fine_started_on
 * (default opened_at) to `now`, each day capped at $100. A single-event fine is
 * just its amount, capped per-violation. Pure; never exceeds the aggregate cap.
 */
export function fineAccrued(v: ViolationRow, now: Date = new Date()): {
  raw: number
  capped: number
  days: number
  atCap: boolean
} {
  const perDay = Math.min(Number(v.fine_per_day) || 0, FINE_PER_VIOLATION_MAX.value)
  let raw = 0
  let days = 0
  if (v.fine_continuing && perDay > 0) {
    const start = toDate(v.fine_started_on ?? v.opened_at)
    const end = toDate(v.levied_at) ?? toDate(now)
    if (start && end) {
      days = Math.max(0, calendarDaysUntil(end, start)) // whole days elapsed
      raw = perDay * days
    }
  } else {
    raw = Math.min(Number(v.amount) || 0, FINE_PER_VIOLATION_MAX.value)
  }
  const capped = Math.min(raw, FINE_AGGREGATE_CAP.value)
  return { raw, capped, days, atCap: raw >= FINE_AGGREGATE_CAP.value }
}

/** The earliest date a fine/suspension may be imposed = notice + 14 days. Null
 *  until the 14-day notice is recorded. */
export function hearingReadyDate(h: HearingRow | null | undefined): Date | null {
  if (!h?.notice_sent_at) return null
  return addCalendarDays(h.notice_sent_at, HEARING_NOTICE_DAYS.value)
}

/** Does an HOA fine reach the $1,000 floor needed to become a lien? A condo fine
 *  is never a lien. Advisory. */
export function fineCanLien(v: ViolationRow, type: AssociationType | string | null | undefined): boolean {
  const regime = asType(type)
  if (regime === 'condo') return false
  return (fineAccrued(v).capped) >= FINE_LIEN_FLOOR.value.hoa
}

/** Active, board-attested-independent committee members. */
export function independentMembers(members: FiningCommitteeMemberRow[] = []): FiningCommitteeMemberRow[] {
  return members.filter(m => m.active !== false && m.is_independent !== false)
}

/** Is the fining committee statutorily sufficient (≥3 independent members)? */
export function committeeReady(members: FiningCommitteeMemberRow[] = []): boolean {
  return independentMembers(members).length >= FINING_COMMITTEE_MIN.value
}

/**
 * Whether the committee's recorded vote SUPPORTS imposing the fine/suspension: a
 * majority of those present must approve, with at least the statutory minimum
 * present. (A tie or a majority-against means it may not be imposed.) Pure.
 */
export function hearingApproved(h: HearingRow | null | undefined): boolean {
  if (!h) return false
  if (h.decision === 'upheld') return true
  if (h.decision === 'rejected') return false
  const present = Number(h.committee_present) || 0
  const forV = Number(h.vote_for) || 0
  const against = Number(h.vote_against) || 0
  return present >= FINING_COMMITTEE_MIN.value && forV > against
}

// ----------------------------------------------------------------------------
// Monitor signal producers
// ----------------------------------------------------------------------------

const DOMAIN = 'Violations & enforcement'
const HREF = '/admin/enforcement'

/**
 * Turn fine/hearing/committee rows into Monitor signals. Advisory — flag only.
 * Side-effect free; tolerates partial rows; never throws.
 */
export function enforcementSignals(
  community: Record<string, any> | null | undefined,
  violations: ViolationRow[] = [],
  hearings: HearingRow[] = [],
  committee: FiningCommitteeMemberRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const regime = asType(community.association_type)
  const nowMs = toDate(now)!.getTime()

  const hearingByViolation = new Map<string, HearingRow>()
  for (const h of hearings) {
    const k = String(h.violation_id ?? '')
    // keep the most recently noticed hearing per violation
    const prev = hearingByViolation.get(k)
    if (!prev || (toDate(h.notice_sent_at)?.getTime() ?? 0) >= (toDate(prev.notice_sent_at)?.getTime() ?? 0)) {
      hearingByViolation.set(k, h)
    }
  }

  // A fine on the hearing track needs a sufficient, independent committee.
  const committeeOk = committeeReady(committee)
  const needsCommittee = violations.some(v =>
    isOpenViolation(v) &&
    (v.kind === 'fine' || v.hearing_required) &&
    !['none', 'rejected'].includes(String(v.enforcement_stage ?? 'none')))
  if (needsCommittee && !committeeOk) {
    const n = independentMembers(committee).length
    out.push(signal({
      id: 'enforcement:committee-short',
      domain: DOMAIN,
      severity: 'overdue',
      title: `The fining committee has ${n} of ${FINING_COMMITTEE_MIN.value} required independent members`,
      detail: `A fine or covenant-violation suspension may not be imposed without a hearing before a committee of at least ${FINING_COMMITTEE_MIN.value} members, appointed by the board, who are not officers, directors, employees, or their relatives.`,
      href: HREF,
      citation: FINING_COMMITTEE_MIN.citation,
    }))
  }

  for (const v of violations) {
    if (!isOpenViolation(v)) continue
    const stage = String(v.enforcement_stage ?? 'none') as EnforcementStage
    const onTrack = v.kind === 'fine' || v.hearing_required
    if (!onTrack || stage === 'none') continue
    const label = v.resident_label || v.rule_title || v.id.slice(0, 8)
    const h = hearingByViolation.get(String(v.id))

    // 1. Proposed but the 14-day notice hasn't been sent. (No `continue` — the
    //    levy/cap checks below must still run for this row regardless of stage.)
    if (stage === 'proposed' || (stage === 'notice_sent' && !h?.notice_sent_at)) {
      out.push(signal({
        id: `enforcement:notice-needed:${v.id}`,
        domain: DOMAIN,
        severity: 'soon',
        title: `${label}: send the 14-day hearing notice before imposing the fine`,
        detail: `A fine or covenant-violation suspension requires at least ${HEARING_NOTICE_DAYS.value} days written notice and an opportunity for a hearing before an independent committee.`,
        href: HREF,
        citation: HEARING_NOTICE_DAYS.citation,
      }))
    }

    // 2. Notice sent — the 14-day clock is running / has elapsed.
    const ready = hearingReadyDate(h)
    if ((stage === 'notice_sent' || stage === 'hearing_set') && ready) {
      const daysLeft = calendarDaysUntil(ready, now)
      const noHearingScheduled = !h?.scheduled_at
      if (ready.getTime() <= nowMs && (h?.decision ?? 'pending') === 'pending') {
        out.push(signal({
          id: `enforcement:hearing-due:${v.id}`,
          domain: DOMAIN,
          severity: 'soon',
          title: `${label}: the 14-day period has elapsed — hold the hearing`,
          detail: `Notice period ended ${ymd(ready)}.${noHearingScheduled ? ' No hearing date is on file.' : ''} The committee must vote before the fine/suspension may be imposed.`,
          href: HREF,
          citation: HEARING_NOTICE_DAYS.citation,
        }))
      } else if (daysLeft >= 0 && daysLeft <= 14) {
        out.push(signal({
          id: `enforcement:hearing-window:${v.id}`,
          domain: DOMAIN,
          severity: 'info',
          title: `${label}: the owner's 14-day hearing window runs to ${ymd(ready)}`,
          detail: `Do not impose the fine/suspension before then. ${noHearingScheduled ? 'Schedule the hearing.' : `Hearing set for ${h?.scheduled_at}.`}`,
          href: HREF,
          citation: HEARING_NOTICE_DAYS.citation,
        }))
      }
    }

    // 3. Committee upheld — the fine may now be levied.
    if (stage === 'upheld' && !v.levied_at) {
      out.push(signal({
        id: `enforcement:ready-to-levy:${v.id}`,
        domain: DOMAIN,
        severity: 'info',
        title: `${label}: the committee upheld the fine — record it as levied`,
        detail: 'The independent committee approved the fine after the hearing. Record the effective date so the balance and any cap are tracked.',
        href: HREF,
        citation: FINING_COMMITTEE_MIN.citation,
      }))
    }

    // 4. A continuing fine that has reached the $1,000 aggregate cap.
    const fine = fineAccrued(v, now)
    if (v.fine_continuing && fine.atCap) {
      out.push(signal({
        id: `enforcement:cap-reached:${v.id}`,
        domain: DOMAIN,
        severity: 'soon',
        title: `${label}: the continuing fine has reached the $${FINE_AGGREGATE_CAP.value.toLocaleString('en-US')} aggregate cap`,
        detail: regime === 'hoa'
          ? `Further daily accrual past $${FINE_AGGREGATE_CAP.value.toLocaleString('en-US')} is not collectable unless the declaration provides for a higher amount.`
          : `A condominium fine may not exceed $${FINE_AGGREGATE_CAP.value.toLocaleString('en-US')} in the aggregate.`,
        href: HREF,
        citation: FINE_AGGREGATE_CAP.citation,
      }))
    }
  }

  return out
}

/**
 * Suspension signals: (a) a covenant-violation use-rights suspension that lacks
 * its required hearing, and (b) reminders that an active suspension for a 90-day
 * delinquency must be lifted once the debt is cured. Kept separate so the fine
 * producer stays focused. Advisory.
 */
export function suspensionSignals(
  suspensions: SuspensionRow[] = [],
  hearings: HearingRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const hearingById = new Map<string, HearingRow>()
  for (const h of hearings) hearingById.set(String(h.id), h)

  for (const s of suspensions) {
    if (String(s.status ?? 'proposed') === 'lifted') continue
    const label = s.unit_label || s.id.slice(0, 8)
    const basis = String(s.basis ?? 'delinquency_90') as SuspensionBasis
    const needsHearing = basis === 'rule_violation' || s.requires_hearing === true

    // A covenant-violation suspension must run the 14-day notice + committee hearing.
    if (needsHearing) {
      const h = s.hearing_id ? hearingById.get(String(s.hearing_id)) : null
      if (!h || !hearingApproved(h)) {
        out.push(signal({
          id: `enforcement:suspension-hearing:${s.id}`,
          domain: DOMAIN,
          severity: 'overdue',
          title: `${label}: a use-rights suspension needs a committee hearing first`,
          detail: `Suspending use rights for a covenant violation requires the same ${HEARING_NOTICE_DAYS.value}-day notice and committee hearing as a fine. Record the hearing and the committee's approval before the suspension takes effect.`,
          href: HREF,
          citation: HEARING_NOTICE_DAYS.citation,
        }))
      }
    }
  }
  return out
}

// ----------------------------------------------------------------------------
// Derived voting-suspension candidates — owners >90 days delinquent in a
// monetary obligation, drawn from open collection cases, whose voting/use rights
// the board MAY suspend (no hearing required) but for whom no suspension is yet
// recorded. Detection is automated; the board decides. Reads the collections
// CollectionCaseRow shape structurally to avoid a hard import cycle.
// ----------------------------------------------------------------------------

export interface DelinquentCaseLike {
  id: string
  resident_id?: string | null
  profile_id?: string | null
  unit_label?: string | null
  stage?: string | null
  delinquent_since?: string | null
  opened_at?: string | null
  total_balance?: number | null
}

const OPEN_CASE_STAGES = new Set(['delinquent', 'notice_30', 'intent_to_lien', 'lien_recorded', 'intent_to_foreclose', 'foreclosure'])

/** Owners ≥90 days delinquent with an open case and no recorded suspension. */
export function votingSuspensionCandidates(
  cases: DelinquentCaseLike[] = [],
  suspensions: SuspensionRow[] = [],
  now: Date = new Date(),
): { case_id: string; resident_id: string | null; profile_id: string | null; unit_label: string; days: number; balance: number }[] {
  const suspendedResidents = new Set<string>()
  for (const s of suspensions) {
    if (String(s.status ?? 'proposed') !== 'lifted' && s.resident_id) suspendedResidents.add(String(s.resident_id))
  }
  const out: { case_id: string; resident_id: string | null; profile_id: string | null; unit_label: string; days: number; balance: number }[] = []
  for (const c of cases) {
    if (!OPEN_CASE_STAGES.has(String(c.stage ?? 'delinquent'))) continue
    if (c.resident_id && suspendedResidents.has(String(c.resident_id))) continue
    const since = toDate(c.delinquent_since ?? c.opened_at)
    if (!since) continue
    const days = calendarDaysUntil(now, since) // days since delinquency began
    if (days < SUSPENSION_DELINQUENCY_DAYS.value) continue
    out.push({
      case_id: c.id,
      resident_id: c.resident_id ?? null,
      profile_id: c.profile_id ?? null,
      unit_label: c.unit_label || c.id.slice(0, 8),
      days,
      balance: Number(c.total_balance) || 0,
    })
  }
  return out.sort((a, b) => b.days - a.days)
}

/** One aggregate signal nudging the board that delinquent owners may have voting
 *  rights suspended (no hearing required). Advisory. */
export function votingSuspensionSignals(
  candidates: { unit_label: string }[] = [],
): ComplianceSignal[] {
  if (!candidates.length) return []
  const n = candidates.length
  return [signal({
    id: 'enforcement:voting-suspension-eligible',
    domain: DOMAIN,
    severity: 'info',
    title: `${n} owner${n === 1 ? '' : 's'} more than 90 days delinquent may have voting rights suspended`,
    detail: `Voting and common-area use rights of an owner more than ${SUSPENSION_DELINQUENCY_DAYS.value} days delinquent may be suspended by the board at a properly noticed meeting — no hearing required. The suspension lasts until the debt is paid.`,
    href: HREF,
    citation: SUSPENSION_DELINQUENCY_DAYS.citation,
  })]
}
