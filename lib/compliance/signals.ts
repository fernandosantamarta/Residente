// Foundation-level compliance signals computable from the community profile
// alone (no domain tables required). Domain modules add their own producers
// (see estoppel.ts); the dashboard merges them all.

import { STATUTORY_MAX_APR, STATUTORY_LATE_FEE_MIN, STATUTORY_LATE_FEE_PCT, communityDuesConfig } from '@/lib/dues'
import { signal, calendarDaysUntil, type ComplianceSignal, type Severity } from './rules-core'

type Community = Record<string, any> | null | undefined

// Records-website posting compliance deadlines. Each is a hard "must be live by"
// date with NO statutory grace or cure window — verified against primary sources:
//   condo: FS 718.111(12)(g)1 (HB 1021 §8) — the paragraph itself takes effect, and
//          must be complied with, on 2026-01-01; applies at 25+ non-timeshare units.
//   hoa:   FS 720.303(4)(b)1 (HB 1203) — "By January 1, 2025 ... shall post";
//          applies at 100+ parcels.
// Because there is no cure window, the signal escalates from 'soon' (deadline
// approaching) to 'overdue' the moment the deadline passes with posting still off.
const WEBSITE_POSTING_DEADLINE = {
  condo: '2026-01-01',
  hoa:   '2025-01-01',
} as const

// Within this many days *before* the deadline we flag it 'Due soon'; earlier than
// that it is 'info' (applicable, but not yet urgent). On/after the deadline it is
// 'overdue'. `now` is past both real deadlines, so in practice in-scope communities
// see 'overdue' today — the tiers keep the rule correct on both sides of the date.
const WEBSITE_POSTING_SOON_DAYS = 90

/** Interest/late-fee config sanity + association identity + records-website applicability. */
export function foundationSignals(community: Community, now: Date = new Date()): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const type = community.association_type === 'hoa' ? 'hoa' : 'condo'
  const cfg = communityDuesConfig(community)
  const monthlyDues = Number(community.monthly_dues) || 0

  // Interest over statutory cap.
  if ((cfg.apr || 0) > STATUTORY_MAX_APR) {
    out.push(signal({
      id: 'assess:apr-over-cap',
      domain: 'Assessments & interest',
      severity: 'overdue',
      title: `Late-payment interest (${cfg.apr}%/yr) exceeds the ${STATUTORY_MAX_APR}% statutory cap`,
      detail: 'Florida caps delinquent-assessment interest at 18%/year unless the declaration sets a lower rate.',
      href: '/admin/community',
      citation: 'FS 718.116(3) / 720.3085(3)',
    }))
  }

  // Admin late fee over cap (greater of $25 or 5% of the installment). The fee
  // actually charged is the greater of the flat fee and the percentage fee
  // (mirrors adminLateFees() in lib/dues.ts), so a percentage-only setting above
  // 5% must trip the cap too — testing the flat fee alone would silently miss it.
  const feeCap = Math.max(STATUTORY_LATE_FEE_MIN, (monthlyDues * STATUTORY_LATE_FEE_PCT) / 100)
  const flat = Number(cfg.lateFeeFlat) || 0
  const pct = Number(cfg.lateFeePct) || 0
  const effectiveFee = Math.max(flat, (monthlyDues * pct) / 100)
  if (effectiveFee > 0 && monthlyDues > 0 && effectiveFee > feeCap + 0.005) {
    out.push(signal({
      id: 'assess:latefee-over-cap',
      domain: 'Assessments & interest',
      severity: 'overdue',
      title: `Admin late fee ($${Math.round(effectiveFee)}) exceeds the statutory cap ($${Math.round(feeCap)})`,
      detail: 'The late fee may not exceed the greater of $25 or 5% of the delinquent installment.',
      href: '/admin/community',
      citation: 'FS 718.116(3) / 720.3085(3)',
    }))
  }

  // Association identity needed before liens/estoppel.
  if (!community.association_address || !community.association_officer_name) {
    out.push(signal({
      id: 'assess:missing-identity',
      domain: 'Assessments & interest',
      severity: 'info',
      title: 'Add the association address and authorized officer',
      detail: 'Required on liens, statutory notices, and estoppel certificates.',
      href: '/admin/community',
      citation: 'FS 718.116 / 720.3085',
    }))
  }

  // Records website-posting applicability. Severity is date-aware: the requirement
  // is 'soon' while the statutory deadline approaches and 'overdue' once it passes
  // with posting still off (no grace/cure window exists — see WEBSITE_POSTING_*).
  const posting = !!community.website_posting_enabled
  const spec = type === 'condo'
    ? {
        id: 'records:website-condo',
        applies: (Number(community.unit_count) || 0) >= 25,
        deadline: WEBSITE_POSTING_DEADLINE.condo,
        title: 'Records website posting is required (condo, 25+ units)',
        who: 'condominiums with 25 or more units must post official records on a password-protected website',
        citation: 'FS 718.111(12)(g) (HB 1021)',
      }
    : {
        id: 'records:website-hoa',
        applies: (Number(community.parcel_count) || 0) >= 100,
        deadline: WEBSITE_POSTING_DEADLINE.hoa,
        title: 'Records website posting is required (HOA, 100+ parcels)',
        who: 'HOAs with 100 or more parcels must post official records online',
        citation: 'FS 720.303(4)(b) (HB 1203)',
      }
  if (spec.applies && !posting) {
    const daysLeft = calendarDaysUntil(spec.deadline, now) // < 0 once the deadline is past
    const severity: Severity = daysLeft < 0 ? 'overdue' : daysLeft <= WEBSITE_POSTING_SOON_DAYS ? 'soon' : 'info'
    const detail = daysLeft < 0
      ? `The ${spec.deadline} deadline has passed — ${spec.who}. There is no statutory grace or cure period.`
      : `Effective ${spec.deadline}, ${spec.who}.`
    out.push(signal({
      id: spec.id,
      domain: 'Official records',
      severity,
      title: spec.title,
      detail,
      // Point at the Official-records workspace so the dashboard tallies this
      // under that card's badge (wsBase match). The posting toggle still lives
      // in Community settings, which the detail text directs the board to.
      href: '/admin/documents#documents',
      citation: spec.citation,
    }))
  }

  return out
}
