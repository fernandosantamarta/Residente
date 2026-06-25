// Structural integrity — milestone inspections, SIRS & turnover.
// CONDO ONLY (FS 718). HOAs (FS 720) have no statutory milestone/SIRS regime,
// so every producer here returns [] for an HOA.
//
// FS 553.899        — mandatory milestone structural inspections (Phase 1 / 2)
// FS 718.112(2)(g)  — Structural Integrity Reserve Study (SIRS) + reserve funding
// FS 718.301(4)     — developer turnover structural inspection / report
//
// Posture: Enable + Monitor (advisory). Constants carry their FS citation and
// validated:false — the trigger years, the coastal definition, the SIRS
// component list, the deadlines, the $ threshold, and the accepted credential
// types must all be confirmed by Florida community-association counsel before an
// association relies on them. (See ATTORNEY_REVIEW_BANNER.)

import {
  rule,
  toDate,
  ymd,
  addCalendarDays,
  calendarDaysUntil,
  signal,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Statutory constants (all validated:false until counsel confirms).
// ----------------------------------------------------------------------------

// Milestone inspection is triggered when a building reaches this age (years
// since the certificate of occupancy). Coastal buildings (within 3 miles of the
// coastline, per FS 553.899(3)) trigger 5 years sooner. ⚠ SB 154 (2023) amended
// the trigger and the coastal definition — confirm the current values + the
// precise coastal-distance rule with counsel.
export const MILESTONE_TRIGGER_YEARS = rule(
  { inland: 30, coastal: 25 } as { inland: number; coastal: number },
  'FS 553.899(3)',
  { note: 'years since certificate of occupancy; coastal = within 3 mi of coastline (verify post-SB 154)' },
)

// After the initial milestone, re-inspect every 10 years.
export const MILESTONE_RECUR_YEARS = rule(10, 'FS 553.899(3)', { note: 're-inspection interval' })

// Phase 1 inspection report is due 180 days after the local enforcement agency's
// written notice that a milestone inspection is required.
export const MILESTONE_PHASE1_DAYS = rule(180, 'FS 553.899(7)', { note: 'from local-enforcement notice to Phase 1 report' })

// If Phase 2 (substantial structural deterioration) requires repairs, the
// association must commence repairs within 365 days, with one 185-day extension
// available for permitting/contracting delays.
export const MILESTONE_REPAIR_COMMENCE_DAYS = rule(365, 'FS 553.899(9)', { note: 'to commence required repairs' })
export const MILESTONE_REPAIR_EXTENSION_DAYS = rule(185, 'FS 553.899(9)', { note: 'one available extension' })

// Within 45 days of receiving a Phase 1 or Phase 2 report, the association must
// distribute a summary to owners and (per the milestone scheme) report to the
// local enforcement agency. We use this as the owner-notice / reporting clock.
export const MILESTONE_REPORT_NOTICE_DAYS = rule(45, 'FS 553.899(8)', { note: 'owner summary + local-enforcement report after inspection report' })

// SIRS applies to buildings 3 stories or higher.
export const SIRS_MIN_STORIES = rule(3, 'FS 718.112(2)(g)1', { note: 'three or more habitable stories' })

// SIRS must be completed by 2025-12-31 (initial deadline). Many associations
// missed it; the absolute statutory backstop is 2026-12-31.
export const SIRS_INITIAL_DEADLINE = rule('2025-12-31', 'FS 718.112(2)(g)1', { note: 'initial SIRS deadline' })
export const SIRS_ABSOLUTE_CAP = rule('2026-12-31', 'FS 718.112(2)(g)1', { note: 'absolute backstop' })

// Reserve funding for SIRS components must be fully funded — and reserves for
// SIRS items may no longer be waived/reduced — for budgets adopted on/after this
// date.
export const SIRS_FULL_FUNDING_EFFECTIVE = rule('2026-01-01', 'FS 718.112(2)(g)2', { note: 'SIRS reserves must be fully funded; no waiver' })

// An item belongs in the SIRS when its deferred-maintenance / replacement cost
// meets this threshold. ⚠ The plan carries $25,000 (indexed from 2026-02-01);
// some readings of the statute use $10,000. Confirm with counsel.
export const SIRS_COMPONENT_THRESHOLD = rule(25000, 'FS 718.112(2)(g)1', { note: 'per-item deferred-maintenance/replacement threshold; indexed from 2026-02-01 — confirm amount' })

// Condominium associations must maintain a DBPR online account; the obligation
// took effect 2025-10-01 (already past). Reuses communities.dbpr_account_created_at.
export const DBPR_ACCOUNT_REQUIRED_SINCE = rule('2025-10-01', 'FS 718.501(1)', { note: 'condo DBPR online account registration' })

// --- Condominium DBPR annual fee (FS 718.501(2)(a), distinct from the (1) account) ---
// Each condominium association operating MORE THAN two units owes the Division a
// $4-per-residential-unit annual fee, due by January 1. If it is not paid by
// March 1 a 10% penalty is added, and the association has NO standing to maintain
// or defend a court action until all fees + penalties are paid. (HB 1021 expanded
// 718.501(1) jurisdiction but did NOT change this (2) fee structure.)
export const DBPR_FEE_PER_UNIT = rule(4, 'FS 718.501(2)(a)', { note: '$4 per residential unit, per year' })
export const DBPR_FEE_MIN_UNITS = rule(2, 'FS 718.501(2)(a)', { note: 'applies to an association operating MORE THAN two units' })
export const DBPR_FEE_PENALTY_PCT = rule(10, 'FS 718.501(2)(a)', { note: '10% penalty if the fee is unpaid by March 1' })
// Month/day anchors (year is supplied at evaluation time).
export const DBPR_FEE_DUE_MMDD = rule('01-01', 'FS 718.501(2)(a)', { note: 'annual fee due January 1' })
export const DBPR_FEE_PENALTY_MMDD = rule('03-01', 'FS 718.501(2)(a)', { note: '10% penalty + loss of court standing once unpaid past March 1' })

// --- Condominium DBPR three-or-more-story building report (FS 718.501(3), SB 4-D) ---
// A condominium association with one or more buildings three or more stories high
// must report to the Division the number of such buildings, the total units in
// them, their addresses, and the counties. The one-time SB 4-D report was due
// 2023-01-01 (already past); a written UPDATE is due within 6 months of any change
// to that information. ⚠ The statute is SILENT on a penalty for a missed filing —
// we flag non-compliance but assert no fine. (HB 913's 2025-10-01 online account
// is a SEPARATE duty and does not satisfy this report.)
export const DBPR_BUILDING_REPORT_MIN_STORIES = rule(3, 'FS 718.501(3)', { note: 'buildings three or more stories' })
export const DBPR_BUILDING_REPORT_DEADLINE = rule('2023-01-01', 'FS 718.501(3)', { note: 'SB 4-D one-time building report; associations existing on/before 2022-07-01' })
export const DBPR_BUILDING_REPORT_UPDATE_MONTHS = rule(6, 'FS 718.501(3)', { note: 'written update within 6 months of a change to the reported information' })

/** The condominium DBPR annual fee for `units` residential units ($4/unit). */
export function dbprAnnualFee(units: number | null | undefined): number {
  return (Number(units) || 0) * DBPR_FEE_PER_UNIT.value
}
/** The fee plus the 10% late penalty (charged when unpaid past March 1). */
export function dbprFeeWithPenalty(units: number | null | undefined): number {
  return Math.round(dbprAnnualFee(units) * (1 + DBPR_FEE_PENALTY_PCT.value / 100) * 100) / 100
}

// Accepted credentials. Milestone Phase 1/2 must be by a licensed professional
// engineer (PE) or registered architect (RA). A SIRS may additionally be
// performed by a reserve specialist (CAI-RS / APRA-PRA) for the financial
// portion. ⚠ Confirm the exact accepted-credential set per inspection type.
export const MILESTONE_PERFORMER_TYPES = rule(['PE', 'RA'], 'FS 553.899(2)', { note: 'professional engineer or registered architect' })
export const SIRS_PERFORMER_TYPES = rule(['PE', 'RA', 'CAI-RS', 'APRA-PRA'], 'FS 718.112(2)(g)1', { note: 'PE/RA, or reserve specialist (CAI-RS / APRA-PRA)' })

// The mandatory SIRS visual-inspection components. ⚠ The exact enumerated list
// has shifted across SB 4-D (2022) → SB 154 (2023); some versions add windows /
// exterior doors. Confirm the controlling list with counsel.
export const SIRS_COMPONENTS = rule(
  [
    'Roof',
    'Load-bearing walls or other primary structural members',
    'Floor',
    'Foundation',
    'Fireproofing and fire protection systems',
    'Plumbing',
    'Electrical systems',
    'Waterproofing and exterior painting',
  ] as string[],
  'FS 718.112(2)(g)1',
  { note: 'mandatory SIRS components; verify against the controlling amendment' },
)

// ----------------------------------------------------------------------------
// Row shapes (mirror supabase/structural.sql; all optional/nullable so the
// signal producer is resilient to partially-migrated data).
// ----------------------------------------------------------------------------
export type AssessmentKind = 'milestone' | 'sirs' | 'turnover'
export type AssessmentStatus =
  | 'not_started' | 'scheduled' | 'in_progress'
  | 'report_received' | 'completed' | 'cancelled'

export interface BuildingRow {
  id: string
  community_id?: string
  name?: string | null
  address?: string | null
  stories?: number | null
  units?: number | null
  certificate_of_occupancy_date?: string | null
  coastal?: boolean | null
  notes?: string | null
}

export interface StructuralAssessmentRow {
  id: string
  community_id?: string
  building_id?: string | null
  kind?: AssessmentKind | string | null
  status?: AssessmentStatus | string | null
  due_date?: string | null
  inspection_date?: string | null
  performer_name?: string | null
  performer_type?: string | null
  performer_license?: string | null
  report_document_id?: string | null
  report_received_at?: string | null
  phase_1_completed_at?: string | null
  requires_phase_2?: boolean | null
  phase_2_due?: string | null
  repair_commence_due?: string | null
  next_due_date?: string | null
  owner_notice_sent_at?: string | null
  dbpr_submitted_at?: string | null
  notes?: string | null
}

export interface SirsComponentRow {
  id: string
  community_id?: string
  assessment_id?: string | null
  component?: string | null
  estimated_cost?: number | null
  remaining_useful_life_years?: number | null
  current_reserve_balance?: number | null
  funding_status?: 'not_funded' | 'underfunded' | 'fully_funded' | string | null
}

// ----------------------------------------------------------------------------
// Pure statutory math (unit-tested in isolation).
// ----------------------------------------------------------------------------

/** Milestone trigger age in years for a building (coastal triggers sooner). */
export function milestoneTriggerYears(coastal: boolean | null | undefined): number {
  return coastal ? MILESTONE_TRIGGER_YEARS.value.coastal : MILESTONE_TRIGGER_YEARS.value.inland
}

/** First milestone due date = certificate-of-occupancy date + trigger years. */
export function milestoneInitialDueDate(
  coDate: string | Date | null | undefined,
  coastal: boolean | null | undefined,
): Date | null {
  const co = toDate(coDate)
  if (!co) return null
  return new Date(Date.UTC(co.getUTCFullYear() + milestoneTriggerYears(coastal), co.getUTCMonth(), co.getUTCDate()))
}

/** Recurring milestone due date = last completed inspection + 10 years. */
export function milestoneRecurDueDate(lastCompleted: string | Date | null | undefined): Date | null {
  const d = toDate(lastCompleted)
  if (!d) return null
  return new Date(Date.UTC(d.getUTCFullYear() + MILESTONE_RECUR_YEARS.value, d.getUTCMonth(), d.getUTCDate()))
}

/** True if a building is tall enough to fall under the milestone/SIRS scheme. */
export function isSirsEligible(stories: number | null | undefined): boolean {
  return (Number(stories) || 0) >= SIRS_MIN_STORIES.value
}

const TERMINAL = new Set<string>(['completed', 'cancelled'])
const DONE = new Set<string>(['report_received', 'completed'])

// A community-wide assessment (building_id == null) intentionally counts toward
// EVERY building — the common single-building condo records one association-wide
// SIRS/milestone rather than tagging it to a building row. So coverage = "this
// building's own assessment OR a community-wide one".
/** Latest completed assessment of a kind covering a building (incl. community-wide). */
function latestCompleted(
  assessments: StructuralAssessmentRow[],
  kind: AssessmentKind,
  buildingId?: string | null,
): StructuralAssessmentRow | null {
  const matches = assessments.filter(a =>
    a.kind === kind &&
    DONE.has(String(a.status)) &&
    (buildingId == null || a.building_id == null || a.building_id === buildingId),
  )
  if (!matches.length) return null
  return matches.sort((a, b) =>
    (toDate(b.inspection_date ?? b.report_received_at)?.getTime() ?? 0) -
    (toDate(a.inspection_date ?? a.report_received_at)?.getTime() ?? 0),
  )[0]
}

/** Any open (non-terminal) assessment of a kind for a building. */
function hasOpen(
  assessments: StructuralAssessmentRow[],
  kind: AssessmentKind,
  buildingId?: string | null,
): boolean {
  return assessments.some(a =>
    a.kind === kind &&
    !TERMINAL.has(String(a.status)) &&
    (buildingId == null || a.building_id == null || a.building_id === buildingId),
  )
}

// ----------------------------------------------------------------------------
// Monitor signal producer. CONDO ONLY.
// ----------------------------------------------------------------------------
const HREF = '/admin/structural'

export function structuralSignals(
  buildings: BuildingRow[] = [],
  assessments: StructuralAssessmentRow[] = [],
  components: SirsComponentRow[] = [],
  community: Record<string, any> | null | undefined = null,
  now: Date = new Date(),
): ComplianceSignal[] {
  // FS 718 only — HOAs have no statutory milestone/SIRS regime.
  const type = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  if (type !== 'condo') return []

  const out: ComplianceSignal[] = []

  // --- Condo DBPR online account (eff 2025-10-01, already past) ---
  if (community && !community.dbpr_account_created_at) {
    const past = calendarDaysUntil(DBPR_ACCOUNT_REQUIRED_SINCE.value, now) < 0
    out.push(signal({
      id: 'structural:dbpr-account',
      domain: 'Structural',
      severity: past ? 'overdue' : 'soon',
      title: 'Condominium DBPR online account is not recorded',
      detail: `Florida condominiums must register a DBPR online account (effective ${DBPR_ACCOUNT_REQUIRED_SINCE.value}). Record the account date in the community profile once registered.`,
      href: '/admin/community',
      citation: DBPR_ACCOUNT_REQUIRED_SINCE.citation,
    }))
  }

  // --- Condominium DBPR annual fee ($4/unit, due Jan 1; 10% penalty Mar 1) ---
  // Only associations operating MORE THAN two units owe the fee.
  const units = Number(community?.unit_count) || 0
  if (community && units > DBPR_FEE_MIN_UNITS.value) {
    const year = toDate(now)!.getUTCFullYear()
    const paidYear = Number(community.dbpr_fee_paid_year) || 0
    if (paidYear < year) {
      const penaltyDate = `${year}-${DBPR_FEE_PENALTY_MMDD.value}` // March 1 of the obligation year
      const pastPenalty = calendarDaysUntil(penaltyDate, now) < 0
      const fee = dbprAnnualFee(units)
      const withPenalty = dbprFeeWithPenalty(units)
      out.push(signal({
        id: `structural:dbpr-fee:${year}`,
        domain: 'Structural',
        severity: pastPenalty ? 'overdue' : 'soon',
        title: pastPenalty
          ? `Condominium DBPR annual fee for ${year} is past due (10% penalty)`
          : `Condominium DBPR annual fee for ${year} is due`,
        detail: pastPenalty
          ? `The $${DBPR_FEE_PER_UNIT.value}/unit Division fee (~$${fee.toLocaleString('en-US')} for ${units} units) was due January 1 and was not recorded paid by March 1, so a ${DBPR_FEE_PENALTY_PCT.value}% penalty applies (~$${withPenalty.toLocaleString('en-US')} total). Until the fee and penalty are paid, the association has no standing to maintain or defend a court action.`
          : `Florida condominiums operating more than two units owe the Division a $${DBPR_FEE_PER_UNIT.value}/unit annual fee (~$${fee.toLocaleString('en-US')} for ${units} units), due January 1. Pay by March 1 to avoid a ${DBPR_FEE_PENALTY_PCT.value}% penalty; record the year paid in the DBPR settings.`,
        href: HREF,
        citation: DBPR_FEE_PER_UNIT.citation,
      }))
    }
  }

  // --- Condominium DBPR 3+-story building report (one-time + 6-month updates) ---
  // Fires when any building is ≥3 stories (or the community profile records ≥3
  // stories) and no filing date is on record. The SB 4-D deadline is already
  // past, so an unrecorded filing is overdue; we assert no penalty (statute silent).
  if (community) {
    const has3Story =
      buildings.some(b => (Number(b.stories) || 0) >= DBPR_BUILDING_REPORT_MIN_STORIES.value) ||
      (Number(community.building_stories) || 0) >= DBPR_BUILDING_REPORT_MIN_STORIES.value
    if (has3Story && !community.dbpr_building_report_filed_at) {
      out.push(signal({
        id: 'structural:dbpr-building-report',
        domain: 'Structural',
        severity: 'overdue',
        title: 'DBPR three-or-more-story building report is not recorded',
        detail: `A condominium with buildings ${DBPR_BUILDING_REPORT_MIN_STORIES.value} or more stories must report the building count, units, addresses, and counties to the Division (the SB 4-D report was due ${DBPR_BUILDING_REPORT_DEADLINE.value}). Record the filing date once submitted, and file a written update within ${DBPR_BUILDING_REPORT_UPDATE_MONTHS.value} months of any change to that information. (This is separate from the DBPR online account.)`,
        href: HREF,
        citation: DBPR_BUILDING_REPORT_DEADLINE.citation,
      }))
    }
  }

  // --- Per-building milestone + SIRS coverage ---
  const sirsInitialPast = calendarDaysUntil(SIRS_INITIAL_DEADLINE.value, now) < 0
  const sirsCapDays = calendarDaysUntil(SIRS_ABSOLUTE_CAP.value, now)

  for (const b of buildings) {
    if (!isSirsEligible(b.stories)) continue
    const label = b.name || b.address || b.id.slice(0, 8)

    // Milestone: initial trigger by building age.
    const lastMilestone = latestCompleted(assessments, 'milestone', b.id)
    const milestoneOpen = hasOpen(assessments, 'milestone', b.id)
    const initialDue = milestoneInitialDueDate(b.certificate_of_occupancy_date, b.coastal)
    const recurDue = lastMilestone
      ? milestoneRecurDueDate(lastMilestone.inspection_date ?? lastMilestone.report_received_at)
      : null
    const dueDate = recurDue ?? initialDue

    if (dueDate && !milestoneOpen) {
      const daysLeft = calendarDaysUntil(dueDate, now)
      // On the recurrence path dueDate = lastInspection + 10y, so the prior
      // inspection always predates it; the guard is meaningful only on the
      // initial path (a milestone completed on/after its first trigger clears it).
      const coveredByCompleted = lastMilestone && (toDate(lastMilestone.inspection_date ?? lastMilestone.report_received_at)?.getTime() ?? 0) >= dueDate.getTime()
      const lastInspected = lastMilestone ? ymd(lastMilestone.inspection_date ?? lastMilestone.report_received_at) : null
      if (!coveredByCompleted) {
        if (daysLeft < 0) {
          out.push(signal({
            id: `structural:milestone-overdue:${b.id}`,
            domain: 'Structural',
            severity: 'overdue',
            title: `Milestone ${recurDue ? 're-inspection' : 'inspection'} overdue for ${label}`,
            detail: recurDue
              ? `The last milestone inspection of this ${b.stories}-story ${b.coastal ? 'coastal' : 'inland'} building was ${lastInspected}; the 10-year re-inspection was due ${ymd(dueDate)}.`
              : `${b.stories}-story ${b.coastal ? 'coastal' : 'inland'} building reached its ${milestoneTriggerYears(b.coastal)}-year milestone trigger on ${ymd(dueDate)}. No milestone inspection is on file.`,
            href: HREF,
            citation: MILESTONE_TRIGGER_YEARS.citation,
          }))
        } else if (daysLeft <= 365) {
          out.push(signal({
            id: `structural:milestone-soon:${b.id}`,
            domain: 'Structural',
            severity: 'soon',
            title: `Milestone inspection due within a year for ${label}`,
            detail: `${b.coastal ? 'Coastal' : 'Inland'} ${milestoneTriggerYears(b.coastal)}-year trigger on ${ymd(dueDate)}.`,
            href: HREF,
            citation: MILESTONE_TRIGGER_YEARS.citation,
          }))
        }
      }
    } else if (!dueDate && !lastMilestone && !milestoneOpen && !b.certificate_of_occupancy_date) {
      // Eligible building with no CO date recorded — can't compute the trigger.
      out.push(signal({
        id: `structural:milestone-nodata:${b.id}`,
        domain: 'Structural',
        severity: 'info',
        title: `Record the certificate-of-occupancy date for ${label}`,
        detail: 'The milestone-inspection trigger (25/30 years) is computed from the certificate-of-occupancy date.',
        href: HREF,
        citation: MILESTONE_TRIGGER_YEARS.citation,
      }))
    }

    // SIRS coverage for this building.
    const lastSirs = latestCompleted(assessments, 'sirs', b.id)
    const sirsOpen = hasOpen(assessments, 'sirs', b.id)
    if (!lastSirs && !sirsOpen) {
      out.push(signal({
        id: `structural:sirs-missing:${b.id}`,
        domain: 'Structural',
        severity: sirsInitialPast ? 'overdue' : 'soon',
        title: `Structural Integrity Reserve Study missing for ${label}`,
        detail: sirsInitialPast
          ? `The SIRS deadline (${SIRS_INITIAL_DEADLINE.value}) has passed for this ${b.stories}-story building; the absolute backstop is ${SIRS_ABSOLUTE_CAP.value}${sirsCapDays >= 0 ? ` (${sirsCapDays} days away)` : ' (also passed)'}.`
          : `A SIRS is required for buildings ${SIRS_MIN_STORIES.value}+ stories by ${SIRS_INITIAL_DEADLINE.value}.`,
        href: HREF,
        citation: SIRS_INITIAL_DEADLINE.citation,
      }))
    }
  }

  // If there are no buildings on file yet, nudge to add them (condo only).
  if (buildings.length === 0) {
    out.push(signal({
      id: 'structural:no-buildings',
      domain: 'Structural',
      severity: 'info',
      title: 'Add your building(s) to track structural deadlines',
      detail: 'Milestone inspections and SIRS deadlines are computed per building from its height and certificate-of-occupancy date.',
      href: HREF,
      citation: 'FS 553.899 / 718.112(2)(g)',
    }))
  }

  // --- Per-assessment lifecycle clocks ---
  const componentsByAssessment = new Map<string, SirsComponentRow[]>()
  for (const c of components) {
    const k = String(c.assessment_id ?? '')
    if (!componentsByAssessment.has(k)) componentsByAssessment.set(k, [])
    componentsByAssessment.get(k)!.push(c)
  }

  // Note: completed assessments are kept in scope here — they still drive the
  // 45-day owner-summary / local-enforcement reporting clock below.
  for (const a of assessments) {
    const aLabel = `${a.kind === 'sirs' ? 'SIRS' : a.kind === 'turnover' ? 'Turnover inspection' : 'Milestone inspection'}`

    // Phase 1 180-day clock (milestone, open).
    if (a.kind === 'milestone' && !TERMINAL.has(String(a.status)) && a.due_date) {
      const daysLeft = calendarDaysUntil(a.due_date, now)
      if (!a.phase_1_completed_at && daysLeft < 0) {
        out.push(signal({
          id: `structural:phase1-overdue:${a.id}`,
          domain: 'Structural',
          severity: 'overdue',
          title: `Phase 1 milestone report overdue`,
          detail: `The Phase 1 report was due ${ymd(a.due_date)} (180 days from the local-enforcement notice).`,
          href: HREF,
          citation: MILESTONE_PHASE1_DAYS.citation,
        }))
      } else if (!a.phase_1_completed_at && daysLeft <= 30) {
        out.push(signal({
          id: `structural:phase1-soon:${a.id}`,
          domain: 'Structural',
          severity: 'soon',
          title: `Phase 1 milestone report due soon`,
          detail: `Due ${ymd(a.due_date)}.`,
          href: HREF,
          citation: MILESTONE_PHASE1_DAYS.citation,
        }))
      }
    }

    // Phase 2 progress / repair-commencement clocks (milestone).
    if (a.kind === 'milestone' && a.requires_phase_2) {
      if (a.phase_2_due) {
        const d = calendarDaysUntil(a.phase_2_due, now)
        if (d < 0 && !TERMINAL.has(String(a.status))) {
          out.push(signal({
            id: `structural:phase2-overdue:${a.id}`,
            domain: 'Structural',
            severity: 'overdue',
            title: `Phase 2 milestone inspection overdue`,
            detail: `Phase 2 (substantial structural deterioration) was due ${ymd(a.phase_2_due)}.`,
            href: HREF,
            citation: 'FS 553.899(7)',
          }))
        }
      }
      if (a.repair_commence_due) {
        const d = calendarDaysUntil(a.repair_commence_due, now)
        if (d < 0) {
          out.push(signal({
            id: `structural:repair-overdue:${a.id}`,
            domain: 'Structural',
            severity: 'overdue',
            title: `Required structural repairs not commenced in time`,
            detail: `Repairs were to commence by ${ymd(a.repair_commence_due)} (within ${MILESTONE_REPAIR_COMMENCE_DAYS.value} days; a ${MILESTONE_REPAIR_EXTENSION_DAYS.value}-day extension may apply).`,
            href: HREF,
            citation: MILESTONE_REPAIR_COMMENCE_DAYS.citation,
          }))
        } else if (d <= 60) {
          out.push(signal({
            id: `structural:repair-soon:${a.id}`,
            domain: 'Structural',
            severity: 'soon',
            title: `Deadline to commence required structural repairs approaching`,
            detail: `Repairs must commence by ${ymd(a.repair_commence_due)}.`,
            href: HREF,
            citation: MILESTONE_REPAIR_COMMENCE_DAYS.citation,
          }))
        }
      }
    }

    // 45-day owner-summary / local-enforcement reporting clock after a report
    // is received (milestone).
    if (a.kind === 'milestone' && a.report_received_at && !a.owner_notice_sent_at && !TERMINAL.has(String(a.status))) {
      const deadline = addCalendarDays(a.report_received_at, MILESTONE_REPORT_NOTICE_DAYS.value)
      if (deadline) {
        const d = calendarDaysUntil(deadline, now)
        out.push(signal({
          id: `structural:owner-notice:${a.id}`,
          domain: 'Structural',
          severity: d < 0 ? 'overdue' : d <= 10 ? 'soon' : 'info',
          title: d < 0 ? 'Milestone owner summary / report past its 45-day deadline' : 'Milestone owner summary / report due',
          detail: `A summary of the inspection report (received ${ymd(a.report_received_at)}) must reach owners and the local enforcement agency by ${ymd(deadline)}.`,
          href: HREF,
          citation: MILESTONE_REPORT_NOTICE_DAYS.citation,
        }))
      }
    }

    // Performer credential gap — only milestone + SIRS have a statutory PE/RA
    // credential requirement. A 'turnover' assessment (financial/records review
    // at developer turnover) is NOT a structural engineering report, so it must
    // not be measured against the milestone/SIRS performer set.
    if (a.performer_type && (a.kind === 'milestone' || a.kind === 'sirs')) {
      const accepted = a.kind === 'sirs' ? SIRS_PERFORMER_TYPES.value : MILESTONE_PERFORMER_TYPES.value
      if (!accepted.includes(String(a.performer_type))) {
        out.push(signal({
          id: `structural:credential:${a.id}`,
          domain: 'Structural',
          severity: 'soon',
          title: `${aLabel} performer credential may not qualify`,
          detail: `Recorded performer type "${a.performer_type}" is not in the accepted set (${accepted.join(', ')}).`,
          href: HREF,
          citation: a.kind === 'sirs' ? SIRS_PERFORMER_TYPES.citation : MILESTONE_PERFORMER_TYPES.citation,
        }))
      }
    }

    // SIRS component completeness + funding (completed/in-progress SIRS).
    if (a.kind === 'sirs') {
      const comps = componentsByAssessment.get(String(a.id)) || []
      if (DONE.has(String(a.status)) || a.status === 'in_progress') {
        if (comps.length > 0 && comps.length < SIRS_COMPONENTS.value.length) {
          out.push(signal({
            id: `structural:sirs-components:${a.id}`,
            domain: 'Structural',
            severity: 'soon',
            title: 'SIRS is missing mandatory components',
            detail: `Only ${comps.length} of the ${SIRS_COMPONENTS.value.length} mandatory components are recorded for this study.`,
            href: HREF,
            citation: SIRS_COMPONENTS.citation,
          }))
        }
        const underfunded = comps.filter(c => c.funding_status === 'underfunded' || c.funding_status === 'not_funded')
        if (underfunded.length && calendarDaysUntil(SIRS_FULL_FUNDING_EFFECTIVE.value, now) < 0) {
          out.push(signal({
            id: `structural:sirs-funding:${a.id}`,
            domain: 'Structural',
            severity: 'overdue',
            title: `${underfunded.length} SIRS component(s) are not fully funded`,
            detail: `Since ${SIRS_FULL_FUNDING_EFFECTIVE.value}, reserves for SIRS components must be fully funded and may not be waived or reduced.`,
            href: HREF,
            citation: SIRS_FULL_FUNDING_EFFECTIVE.citation,
          }))
        }
      }
    }
  }

  return out
}
