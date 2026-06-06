// Procurement — competitive bidding, written contracts & management-agreement
// required terms.
//
// FS 718.3026  — CONDO: a contract whose aggregate payment EXCEEDS 5% of the
//                association's total annual budget (INCLUDING reserves) requires
//                competitive bids; service contracts and any contract not fully
//                performed within one year must be in writing.
// FS 720.3055  — HOA: the same, at the >10% threshold (also reserves-inclusive).
// FS 718.3025  — CONDO: a written operation/maintenance/management agreement is
//                not valid or enforceable unless it contains the enumerated
//                required terms (services, reimbursable costs, frequency,
//                minimum personnel, developer & board/manager interest).
//                (HOAs have NO 718.3025 analog — 720.3055 is bidding-only and the
//                HOA fairness/cancellation duty lives in 720.309 / Ch. 468.)
//
// NOT covered here (cross-reference only, to avoid duplicating governance):
//   • Director/officer conflicts of interest & related-party contracts —
//     FS 718.3027 / 720.3033 — already handled in lib/compliance/governance.ts.
//
// Posture: Enable + Monitor (advisory). Constants carry their FS citation and
// validated:false until Florida community-association counsel confirms them.
// Nothing here blocks a board action.

import {
  rule,
  signal,
  type AssociationType,
  type ByRegime,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Statutory constants (all validated:false until counsel confirms).
// ----------------------------------------------------------------------------

// The competitive-bid threshold, as a PERCENT of the total annual budget
// INCLUDING reserves. Condo >5% (718.3026), HOA >10% (720.3055). The trigger is
// strictly greater-than, and the basis is the reserves-INCLUSIVE budget.
export const BID_THRESHOLD_PCT = rule<ByRegime<number>>(
  { condo: 5, hoa: 10 },
  'FS 718.3026(1) / 720.3055(1)',
  { note: 'contract aggregate EXCEEDING this % of the total annual budget (including reserves) requires competitive bids' },
)
// Spelled out so signal copy + the worksheet can name the basis exactly.
export const BID_THRESHOLD_BASIS = rule(
  'the total annual budget of the association, including reserves',
  'FS 718.3026(1) / 720.3055(1)',
  { note: 'reserves-INCLUSIVE budget basis — distinct from the operating-only revenue used for audit tiers' },
)

// Writing requirement: every service contract, and every contract not fully
// performed within one year, must be in writing — independent of the $ threshold.
export const WRITING_REQUIRED_TERM_MONTHS = rule(
  12,
  'FS 718.3026(1) / 720.3055(1)',
  { note: 'a contract not fully performed within 1 year must be in writing; all service contracts must be in writing regardless of term' },
)

// The professional services / persons a contract with whom is NOT subject to the
// bidding (and writing) section. Condo (718.3026(2)(a)) additionally lists a
// timeshare management firm; HOA (720.3055(2)(a)1) does not.
export const BID_PROFESSIONAL_EXCEPTIONS = rule<ByRegime<string[]>>(
  {
    condo: ['employees', 'attorney', 'accountant', 'architect', 'community association manager', 'timeshare management firm', 'engineering', 'landscape architect'],
    hoa: ['employees', 'attorney', 'accountant', 'architect', 'community association manager', 'engineering', 'landscape architect'],
  },
  'FS 718.3026(2)(a) / 720.3055(2)(a)1',
  { note: 'contracts with these are not subject to the bidding/writing section' },
)

// The recognised statutory exception bases (used to SUPPRESS the bid signal).
export const BID_EXCEPTION_BASES = rule(
  ['emergency', 'sole_source', 'professional_service', 'employee', 'franchise', 'renewal_cancelable', 'pre_2004', 'opt_out', 'governing_docs'] as string[],
  'FS 718.3026(2) / 720.3055(2)',
  { note: 'emergency; only county source; professional/employee; local-government franchise (HOA); renewal of a bid-awarded contract cancelable on 30 days notice (HOA); pre-2004 (HOA); ≤10-unit two-thirds opt-out (condo); stricter governing-document procedure (HOA)' },
)

// CONDO management/maintenance agreement required terms (718.3025(1)). A written
// agreement is not valid or enforceable unless it contains all of these.
export const CONDO_MGMT_REQUIRED_TERMS = rule(
  [
    'Specifies the services, obligations, and responsibilities of the manager',
    'Specifies the costs to be reimbursed by the association',
    'Indicates how often each service/obligation is to be performed',
    'Specifies a minimum number of personnel to be employed',
    'Discloses any developer financial/ownership interest (if the developer controls the association)',
    'Discloses any board-member or manager financial/ownership interest with the contracting party',
  ] as string[],
  'FS 718.3025(1)',
  { note: 'a written condo management/maintenance contract is not valid or enforceable unless it contains all of these; services not on the face are unenforceable' },
)

// HOA-only: a competitively-bid manager contract may run up to three years
// (720.3055(2)(a)2). Surfaced as context, not a hard cap on all manager contracts.
export const HOA_MANAGER_BID_TERM_MAX_YEARS = rule(3, 'FS 720.3055(2)(a)2', { note: 'an HOA manager contract made by competitive bid may be for up to 3 years' })

// ----------------------------------------------------------------------------
// Row shapes (mirror supabase/contracts.sql; all optional so the producer is
// resilient to partially-migrated data). budget rows reuse the financials shape
// structurally (no import — avoids a module cycle).
// ----------------------------------------------------------------------------
export type ContractKind = 'products' | 'services' | 'management'

export interface ContractRow {
  id: string
  community_id?: string
  vendor?: string | null
  description?: string | null
  amount?: number | null            // aggregate payment under the contract
  contract_kind?: ContractKind | string | null
  term_months?: number | null
  executed_on?: string | null
  bids_obtained?: boolean | null
  written_contract?: boolean | null
  exception_basis?: string | null   // one of BID_EXCEPTION_BASES, or null/none
  required_terms_attested?: boolean | null // condo management agreements (718.3025)
  notes?: string | null
}

export interface BudgetRow {
  budget?: number | null
  fiscal_year?: number | null
  is_reserve?: boolean | null
}

// ----------------------------------------------------------------------------
// Pure math (unit-tested in isolation).
// ----------------------------------------------------------------------------
const regimeOf = (t: AssociationType | string | null | undefined): AssociationType => (t === 'hoa' ? 'hoa' : 'condo')

/**
 * The total annual budget INCLUDING reserves — the competitive-bid threshold
 * basis. This deliberately SUMS reserve and non-reserve budget lines (unlike
 * financials.estimateAnnualRevenue, which strips reserves for audit tiers).
 * Uses the most recent fiscal year present in the budget rows; if no rows carry
 * a fiscal year, sums them all; falls back to communities.annual_revenue only as
 * a rough proxy. Returns { total, basis } so callers can flag an estimate.
 */
export function totalAnnualBudgetInclReserves(
  community: Record<string, any> | null | undefined,
  budgets: BudgetRow[] = [],
): { total: number; basis: 'budget' | 'annual_revenue' | 'none' } {
  const years = budgets.map(b => Number(b.fiscal_year) || 0).filter(y => y > 0)
  if (budgets.length) {
    const fy = years.length ? Math.max(...years) : 0
    const rows = fy ? budgets.filter(b => Number(b.fiscal_year) === fy) : budgets
    const total = rows.reduce((s, b) => s + (Number(b.budget) || 0), 0)
    if (total > 0) return { total, basis: 'budget' }
  }
  const rev = Number(community?.annual_revenue) || 0
  if (rev > 0) return { total: rev, basis: 'annual_revenue' }
  return { total: 0, basis: 'none' }
}

/** The dollar competitive-bid threshold for a regime against a budget total. */
export function bidThreshold(regime: AssociationType, totalAnnualBudget: number): number {
  return (BID_THRESHOLD_PCT.value[regime] / 100) * (Number(totalAnnualBudget) || 0)
}

/** A service contract (or management agreement) — these must be in writing. */
function isServiceKind(kind: ContractKind | string | null | undefined): boolean {
  return kind === 'services' || kind === 'management'
}

/** Does the contract claim a recognised exception to the bidding requirement? */
function hasExceptionBasis(c: ContractRow): boolean {
  const b = String(c.exception_basis ?? '').trim()
  return b !== '' && b !== 'none'
}

const fmt$ = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

// ----------------------------------------------------------------------------
// Monitor signal producer (condo + HOA).
// ----------------------------------------------------------------------------
const HREF = '/admin/contracts'

export function contractsSignals(
  community: Record<string, any> | null | undefined,
  contracts: ContractRow[] = [],
  budgets: BudgetRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const regime = regimeOf(community.association_type)
  const pct = BID_THRESHOLD_PCT.value[regime]
  const bidCite = regime === 'hoa' ? 'FS 720.3055' : 'FS 718.3026'
  const { total: budgetTotal, basis } = totalAnnualBudgetInclReserves(community, budgets)
  const threshold = bidThreshold(regime, budgetTotal)
  void now // reserved for future date-aware clauses; signals here are state-based

  // Empty-state nudge — this workspace is opt-in data entry.
  if (contracts.length === 0) {
    out.push(signal({
      id: 'contract:none-recorded',
      domain: 'Procurement',
      severity: 'info',
      title: 'Record significant vendor contracts to track the competitive-bid rule',
      detail: `Florida requires competitive bids for a contract exceeding ${pct}% of ${BID_THRESHOLD_BASIS.value}${threshold > 0 ? ` (about ${fmt$(threshold)} for your association)` : ''}, and every service contract or contract over a year must be in writing. Add your material vendor and management contracts so the dashboard can check them.`,
      href: HREF,
      citation: bidCite,
    }))
    return out
  }

  // If we can't compute the budget, we can't evaluate the threshold — say so once.
  if (basis === 'none') {
    out.push(signal({
      id: 'contract:threshold-unknown',
      domain: 'Procurement',
      severity: 'info',
      title: 'Add a budget to enable the competitive-bid threshold check',
      detail: `The ${pct}% competitive-bid threshold is measured against ${BID_THRESHOLD_BASIS.value}. Record this year's budget (including reserve lines) so the dashboard can tell which contracts cross it.`,
      href: HREF,
      citation: bidCite,
    }))
  }

  for (const c of contracts) {
    const label = c.vendor || c.description || c.id.slice(0, 8)
    const amount = Number(c.amount) || 0

    // 1) Over the competitive-bid threshold, no exception, no bids recorded.
    if (threshold > 0 && amount > threshold && !hasExceptionBasis(c) && !c.bids_obtained) {
      out.push(signal({
        id: `contract:bid-needed:${c.id}`,
        domain: 'Procurement',
        severity: 'soon',
        title: `Competitive bids not recorded for ${label}`,
        detail: `This ${fmt$(amount)} contract exceeds the ${pct}% competitive-bid threshold (~${fmt$(threshold)} of ${BID_THRESHOLD_BASIS.value}${basis === 'annual_revenue' ? ', estimated from annual revenue' : ''}). Record the competitive bids obtained, or the statutory exception that applies (emergency, sole county source, professional/employee services${regime === 'hoa' ? ', franchise, cancelable renewal' : ', or a ≤10-unit two-thirds opt-out'}).`,
        href: HREF,
        citation: regime === 'hoa' ? 'FS 720.3055(1)' : 'FS 718.3026(1)',
      }))
    }

    // 2) Writing requirement — services (any amount) or a term over one year.
    const needsWriting = isServiceKind(c.contract_kind) || (Number(c.term_months) || 0) > WRITING_REQUIRED_TERM_MONTHS.value
    if (needsWriting && !c.written_contract) {
      out.push(signal({
        id: `contract:writing-needed:${c.id}`,
        domain: 'Procurement',
        severity: 'soon',
        title: `Written contract not recorded for ${label}`,
        detail: `${isServiceKind(c.contract_kind) ? 'A contract for services' : 'A contract not fully performed within one year'} must be in writing. Mark the signed written contract on file once recorded.`,
        href: HREF,
        citation: regime === 'hoa' ? 'FS 720.3055(1)' : 'FS 718.3026(1)',
      }))
    }

    // 3) CONDO management agreement required-terms attestation (718.3025).
    // Condo only — HOAs have no 718.3025 required-terms list.
    if (regime === 'condo' && c.contract_kind === 'management' && !c.required_terms_attested) {
      out.push(signal({
        id: `contract:mgmt-terms:${c.id}`,
        domain: 'Procurement',
        severity: 'soon',
        title: `Confirm the management agreement's required terms for ${label}`,
        detail: `A condominium management/maintenance agreement is not valid or enforceable unless it specifies the manager's services, the reimbursable costs, how often each duty is performed, a minimum number of personnel, and the developer/board interest disclosures. Attest that the agreement contains these once confirmed.`,
        href: HREF,
        citation: CONDO_MGMT_REQUIRED_TERMS.citation,
      }))
    }
  }

  return out
}
