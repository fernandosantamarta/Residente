// Insurance — property (replacement-cost appraisal) & fidelity bonding.
//
// FS 718.111(11)(a)  — CONDO: adequate property insurance based on replacement
//                      cost, determined by an independent appraisal that is
//                      redetermined "at least once every 36 months."
// FS 718.111(11)(h)  — CONDO: fidelity bonding / insurance of every person who
//                      controls or disburses association funds; the bond must
//                      cover the MAXIMUM funds in the association's (or its
//                      manager's) custody at any one time. NO member waiver.
// FS 720.3033(5)     — HOA: the same fidelity-bond duty + the same "maximum
//                      funds in custody" floor, but the members MAY waive the
//                      bond by an ANNUAL majority vote of those present at a
//                      properly called meeting.
//
// Posture: Enable + Monitor (advisory). Constants carry their FS citation and
// validated:false until Florida community-association counsel confirms them.
// Nothing here blocks a board action.
//
// Scope split:
//   • property insurance + the 36-month replacement-cost appraisal = CONDO ONLY.
//   • fidelity bonding = BOTH regimes (HOAs may waive it annually; condos may not).

import {
  rule,
  toDate,
  ymd,
  calendarDaysUntil,
  signal,
  type AssociationType,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Statutory constants (all validated:false until counsel confirms).
// ----------------------------------------------------------------------------

// Condo property insurance must be based on replacement cost, determined by an
// independent appraisal (or an update of a prior appraisal) "redetermined at
// least once every 36 months."
export const PROPERTY_APPRAISAL_INTERVAL_MONTHS = rule(
  36,
  'FS 718.111(11)(a)',
  { note: 'replacement-cost appraisal redetermined at least once every 36 months (condo)' },
)

// The statutory minimum fidelity-bond amount: the maximum funds that will be in
// the custody of the association OR its management agent at any one time. We can
// only ESTIMATE that figure (see estimatedMaxFunds) — counsel/the manager must
// confirm the true peak balance.
export const FIDELITY_BOND_FLOOR_NOTE = rule(
  'the maximum funds that will be in the custody of the association or its management agent at any one time',
  'FS 718.111(11)(h) / 720.3033(5)',
  { note: 'statutory minimum bond/insurance amount; the platform estimate is advisory only' },
)

// Who the bond/insurance must cover. The statute reaches every person who
// controls or disburses association funds — the officers named below plus the
// management agent and any other check-signer.
export const FIDELITY_BOND_COVERED_PERSONS = rule(
  [
    'President',
    'Secretary',
    'Treasurer',
    'Any other person who controls or disburses association funds',
    'The management company / CAM, if it handles association funds',
  ] as string[],
  'FS 718.111(11)(h) / 720.3033(5)',
  { note: 'bond/insurance must cover all persons who control or disburse association funds' },
)

// HOA only: the members may waive the fidelity bond, but only by an ANNUAL vote
// of a majority of the voting interests PRESENT at a properly called meeting.
// Condominium associations have no such waiver.
export const HOA_FIDELITY_BOND_WAIVER_BASIS = rule(
  'a majority of the voting interests present at a properly called meeting of the association',
  'FS 720.3033(5)',
  { note: 'HOA may waive the fidelity bond by an ANNUAL member vote; condominiums may not waive (718.111(11)(h))' },
)
// An HOA bond waiver is effective for one fiscal year and must be re-approved.
export const FIDELITY_BOND_WAIVER_VALID_YEARS = rule(
  1,
  'FS 720.3033(5)',
  { note: 'HOA fidelity-bond waiver lasts one fiscal year; renew the vote annually' },
)

// --- Operational (NOT statutory) horizons for "due soon" advisories. ---
// How far ahead of a stale appraisal / an expiring policy we start nudging.
const APPRAISAL_SOON_DAYS = 90
const POLICY_EXPIRY_SOON_DAYS = 45

// ----------------------------------------------------------------------------
// Row shapes (mirror supabase/insurance.sql; all optional so the producer is
// resilient to partially-migrated data).
// ----------------------------------------------------------------------------
export type InsuranceKind = 'property' | 'fidelity_bond'

export interface InsurancePolicyRow {
  id: string
  community_id?: string
  kind?: InsuranceKind | string | null
  carrier?: string | null
  policy_number?: string | null
  amount?: number | null               // coverage / bond amount
  effective_date?: string | null
  expiration_date?: string | null
  last_appraisal_date?: string | null  // property only — anchors the 36-month clock
  replacement_cost_value?: number | null // property only
  document_id?: string | null          // → documents (the 'Insurance' category)
  notes?: string | null
}

// Reuse the financials reserve row shape structurally (no import — avoids a
// module cycle). We only read current_balance to estimate funds in custody.
export interface ReserveBalanceRow {
  current_balance?: number | null
}

// ----------------------------------------------------------------------------
// Pure statutory / estimate math (unit-tested in isolation).
// ----------------------------------------------------------------------------
const regimeOf = (t: AssociationType | string | null | undefined): AssociationType => (t === 'hoa' ? 'hoa' : 'condo')

/** The date the next replacement-cost appraisal is due = last + 36 months. */
export function appraisalNextDue(lastAppraisalDate: string | Date | null | undefined): Date | null {
  const d = toDate(lastAppraisalDate)
  if (!d) return null
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + PROPERTY_APPRAISAL_INTERVAL_MONTHS.value,
    d.getUTCDate(),
  ))
}

/**
 * Estimate the maximum funds in custody the fidelity bond must cover. A
 * board-entered override (communities.estimated_max_funds) wins; otherwise we
 * fall back to the sum of reserve balances as a conservative proxy. This is an
 * ADVISORY estimate — the true statutory floor is the peak operating+reserve
 * balance, which only the association/manager can confirm.
 */
export function estimatedMaxFunds(
  community: Record<string, any> | null | undefined,
  reserves: ReserveBalanceRow[] = [],
): number {
  const override = Number(community?.estimated_max_funds) || 0
  if (override > 0) return override
  return reserves.reduce((s, r) => s + (Number(r.current_balance) || 0), 0)
}

/** The fiscal year currently in effect (matches financials.ts budget-year math). */
export function currentFiscalYear(community: Record<string, any> | null | undefined, now: Date = new Date()): number {
  const n = toDate(now)!
  const m = Math.min(12, Math.max(1, Number(community?.fiscal_year_start_month) || 1))
  const fyStartThisYear = Date.UTC(n.getUTCFullYear(), m - 1, 1)
  return n.getTime() >= fyStartThisYear ? n.getUTCFullYear() : n.getUTCFullYear() - 1
}

/** Latest policy of a kind by effective_date (falls back to created order). */
function latestPolicy(policies: InsurancePolicyRow[], kind: InsuranceKind): InsurancePolicyRow | null {
  const matches = policies.filter(p => p.kind === kind)
  if (!matches.length) return null
  return matches.sort((a, b) =>
    (toDate(b.effective_date)?.getTime() ?? 0) - (toDate(a.effective_date)?.getTime() ?? 0),
  )[0]
}

const fmt$ = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

// ----------------------------------------------------------------------------
// Monitor signal producer (condo + HOA — property half is condo-only).
// ----------------------------------------------------------------------------
const HREF = '/admin/insurance'

export function insuranceSignals(
  community: Record<string, any> | null | undefined,
  policies: InsurancePolicyRow[] = [],
  reserves: ReserveBalanceRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const regime = regimeOf(community.association_type)

  // ==========================================================================
  // PROPERTY INSURANCE + 36-MONTH REPLACEMENT-COST APPRAISAL — CONDO ONLY.
  // ==========================================================================
  if (regime === 'condo') {
    const cite = PROPERTY_APPRAISAL_INTERVAL_MONTHS.citation
    const prop = latestPolicy(policies, 'property')
    if (!prop) {
      out.push(signal({
        id: 'insurance:property-missing',
        domain: 'Insurance',
        severity: 'soon',
        title: 'Property insurance is not recorded',
        detail: `Florida condominiums must maintain adequate property insurance based on the full replacement cost of the insurable property. Record the master property policy so the dashboard can track the replacement-cost appraisal clock.`,
        href: HREF,
        citation: cite,
      }))
    } else {
      // 36-month replacement-cost appraisal clock.
      if (!prop.last_appraisal_date) {
        out.push(signal({
          id: 'insurance:appraisal-undated',
          domain: 'Insurance',
          severity: 'soon',
          title: 'Replacement-cost appraisal date is not recorded',
          detail: `The property policy is on file, but no independent replacement-cost appraisal date is recorded. The appraisal must be redetermined at least once every ${PROPERTY_APPRAISAL_INTERVAL_MONTHS.value} months — record the most recent appraisal date to track it.`,
          href: HREF,
          citation: cite,
        }))
      } else {
        const nextDue = appraisalNextDue(prop.last_appraisal_date)
        if (nextDue) {
          const daysLeft = calendarDaysUntil(nextDue, now)
          if (daysLeft < 0) {
            out.push(signal({
              id: 'insurance:appraisal-overdue',
              domain: 'Insurance',
              severity: 'overdue',
              title: 'Replacement-cost appraisal is overdue (older than 36 months)',
              detail: `The last replacement-cost appraisal was ${ymd(prop.last_appraisal_date)}; a redetermination was due ${ymd(nextDue)} (at least once every ${PROPERTY_APPRAISAL_INTERVAL_MONTHS.value} months). Order an updated independent appraisal.`,
              href: HREF,
              citation: cite,
            }))
          } else if (daysLeft <= APPRAISAL_SOON_DAYS) {
            out.push(signal({
              id: 'insurance:appraisal-soon',
              domain: 'Insurance',
              severity: 'soon',
              title: 'Replacement-cost appraisal due soon',
              detail: `The next replacement-cost appraisal is due ${ymd(nextDue)} (${daysLeft} days), 36 months after the ${ymd(prop.last_appraisal_date)} appraisal.`,
              href: HREF,
              citation: cite,
            }))
          }
        }
      }
      // Property policy expiration.
      pushExpiry(out, prop, 'property', 'Property insurance', now)
    }
  }

  // ==========================================================================
  // FIDELITY BOND / INSURANCE OF THOSE WHO CONTROL FUNDS — BOTH REGIMES.
  // ==========================================================================
  {
    const cite = regime === 'hoa' ? 'FS 720.3033(5)' : 'FS 718.111(11)(h)'
    const bond = latestPolicy(policies, 'fidelity_bond')

    // HOA-only annual waiver. Condominiums cannot waive (718.111(11)(h)).
    const waiverFy = Number(community.fidelity_bond_waiver_fy) || 0
    const fy = currentFiscalYear(community, now)
    const waivedThisYear = regime === 'hoa' && waiverFy === fy

    if (!bond) {
      if (waivedThisYear) {
        // Waiver in force for the current fiscal year — suppress the "no bond"
        // flag and nudge the annual renewal (mirrors the reserve-waiver pattern).
        out.push(signal({
          id: 'insurance:bond-waived',
          domain: 'Insurance',
          severity: 'info',
          title: `Fidelity bond waived for FY${fy} — the waiver must be renewed annually`,
          detail: `Members waived the fidelity bond for the current fiscal year. An HOA waiver is approved by ${HOA_FIDELITY_BOND_WAIVER_BASIS.value} and is effective for one fiscal year only — to keep the bond waived next year, the members must vote again.`,
          href: HREF,
          citation: cite,
        }))
      } else if (regime === 'hoa' && waiverFy > 0 && waiverFy < fy) {
        // A prior-year waiver has expired and no bond is on file — the waiver
        // is already in the past, so this is a current violation, not upcoming.
        out.push(signal({
          id: 'insurance:bond-waiver-expired',
          domain: 'Insurance',
          severity: 'overdue',
          title: `The fidelity-bond waiver (FY${waiverFy}) has expired and no bond is on file`,
          detail: `An HOA fidelity-bond waiver lasts one fiscal year. With the FY${waiverFy} waiver expired, the association must either obtain fidelity bonding covering ${FIDELITY_BOND_FLOOR_NOTE.value}, or have the members re-approve a waiver for FY${fy} by ${HOA_FIDELITY_BOND_WAIVER_BASIS.value}.`,
          href: HREF,
          citation: cite,
        }))
      } else {
        // For condos the bond is a continuous mandatory obligation with no grace
        // period and no waiver right — missing = already in violation ('overdue').
        // For HOAs the board may simply not have entered the bond yet — 'soon' is
        // the appropriate advisory posture.
        out.push(signal({
          id: 'insurance:bond-missing',
          domain: 'Insurance',
          severity: regime === 'condo' ? 'overdue' : 'soon',
          title: 'Fidelity bond / insurance for those who handle funds is not recorded',
          detail: regime === 'hoa'
            ? `Florida HOAs must maintain fidelity bonding (or insurance) of everyone who controls or disburses association funds, in an amount covering ${FIDELITY_BOND_FLOOR_NOTE.value}, unless the members annually waive it. Record the bond, or the waiver in the fidelity-bond settings.`
            : `Florida condominiums must maintain fidelity bonding (or insurance) of everyone who controls or disburses association funds, in an amount covering ${FIDELITY_BOND_FLOOR_NOTE.value}. Condominiums may NOT waive this. Record the bond once obtained.`,
          href: HREF,
          citation: cite,
        }))
      }
    } else {
      // Bond on file — check the amount against the estimated funds in custody.
      const maxFunds = estimatedMaxFunds(community, reserves)
      const amount = Number(bond.amount) || 0
      if (maxFunds > 0 && amount <= 0) {
        // A bond row was recorded but with a zero/blank amount — the shortfall
        // is still unguarded even though latestPolicy() suppressed bond-missing.
        out.push(signal({
          id: 'insurance:bond-zero-amount',
          domain: 'Insurance',
          severity: 'soon',
          title: 'Fidelity bond amount is not recorded',
          detail: `A fidelity bond entry is on file but the bond amount is $0 or blank. The bond must cover ${FIDELITY_BOND_FLOOR_NOTE.value} (estimated ${fmt$(maxFunds)}); update the entry with the actual coverage amount.`,
          href: HREF,
          citation: cite,
        }))
      } else if (maxFunds > 0 && amount < maxFunds) {
        out.push(signal({
          id: 'insurance:bond-underinsured',
          domain: 'Insurance',
          severity: 'soon',
          title: 'Fidelity bond may be below the funds in custody',
          detail: `The recorded fidelity bond (${fmt$(amount)}) is less than the estimated maximum funds in custody (${fmt$(maxFunds)}). The bond must cover ${FIDELITY_BOND_FLOOR_NOTE.value}; confirm the peak balance and increase the bond if needed.`,
          href: HREF,
          citation: cite,
        }))
      } else if (maxFunds === 0 && amount > 0) {
        out.push(signal({
          id: 'insurance:bond-maxfunds-unknown',
          domain: 'Insurance',
          severity: 'info',
          title: 'Record the maximum funds in custody to check the bond amount',
          detail: `A fidelity bond of ${fmt$(amount)} is on file, but the maximum funds in custody is not estimated yet, so the dashboard can't confirm the bond meets the statutory floor. Enter an estimate (or reserve balances) in the fidelity-bond settings.`,
          href: HREF,
          citation: cite,
        }))
      }
      // Bond expiration.
      pushExpiry(out, bond, 'fidelity_bond', 'Fidelity bond', now)
    }
  }

  // Note: a zero-policy community is already covered by the property-missing
  // (condo) + bond-missing signals above, so there is no separate empty-state
  // signal here (it would just triple-flag the same gap).

  return out
}

/** Shared policy-expiration clock (expired = overdue, ≤45 days = soon). */
function pushExpiry(
  out: ComplianceSignal[],
  p: InsurancePolicyRow,
  kind: InsuranceKind,
  label: string,
  now: Date,
): void {
  if (!p.expiration_date) return
  const daysLeft = calendarDaysUntil(p.expiration_date, now)
  if (daysLeft < 0) {
    out.push(signal({
      id: `insurance:${kind}-expired`,
      domain: 'Insurance',
      severity: 'overdue',
      title: `${label} policy has expired`,
      detail: `The recorded ${label.toLowerCase()} policy${p.carrier ? ` (${p.carrier})` : ''} expired ${ymd(p.expiration_date)}. Record the renewal so coverage is continuous.`,
      href: HREF,
      citation: kind === 'property' ? 'FS 718.111(11)(a)' : 'FS 718.111(11)(h) / 720.3033(5)',
    }))
  } else if (daysLeft <= POLICY_EXPIRY_SOON_DAYS) {
    out.push(signal({
      id: `insurance:${kind}-expiring`,
      domain: 'Insurance',
      severity: 'soon',
      title: `${label} policy expires soon`,
      detail: `The ${label.toLowerCase()} policy${p.carrier ? ` (${p.carrier})` : ''} expires ${ymd(p.expiration_date)} (${daysLeft} days). Confirm the renewal.`,
      href: HREF,
      citation: kind === 'property' ? 'FS 718.111(11)(a)' : 'FS 718.111(11)(h) / 720.3033(5)',
    }))
  }
}
