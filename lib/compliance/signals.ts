// Foundation-level compliance signals computable from the community profile
// alone (no domain tables required). Domain modules add their own producers
// (see estoppel.ts); the dashboard merges them all.

import { STATUTORY_MAX_APR, STATUTORY_LATE_FEE_MIN, STATUTORY_LATE_FEE_PCT, communityDuesConfig } from '@/lib/dues'
import { signal, type ComplianceSignal } from './rules-core'

type Community = Record<string, any> | null | undefined

/** Interest/late-fee config sanity + association identity + records-website applicability. */
export function foundationSignals(community: Community): ComplianceSignal[] {
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

  // Admin late fee over cap (greater of $25 or 5% of the installment).
  const feeCap = Math.max(STATUTORY_LATE_FEE_MIN, (monthlyDues * STATUTORY_LATE_FEE_PCT) / 100)
  const flat = Number(cfg.lateFeeFlat) || 0
  if (flat > 0 && monthlyDues > 0 && flat > feeCap + 0.005) {
    out.push(signal({
      id: 'assess:latefee-over-cap',
      domain: 'Assessments & interest',
      severity: 'overdue',
      title: `Admin late fee ($${flat}) exceeds the statutory cap ($${Math.round(feeCap)})`,
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

  // Records website-posting applicability (thresholds already in force).
  const posting = !!community.website_posting_enabled
  if (type === 'condo') {
    const units = Number(community.unit_count) || 0
    if (units >= 25 && !posting) {
      out.push(signal({
        id: 'records:website-condo',
        domain: 'Official records',
        severity: 'soon',
        title: 'Records website posting is required (condo, 25+ units)',
        detail: 'Effective 2026-01-01, condominiums with 25 or more units must post official records on a password-protected website.',
        href: '/admin/community',
        citation: 'FS 718.111(12)(g) (HB 1021)',
      }))
    }
  } else {
    const parcels = Number(community.parcel_count) || 0
    if (parcels >= 100 && !posting) {
      out.push(signal({
        id: 'records:website-hoa',
        domain: 'Official records',
        severity: 'soon',
        title: 'Records website posting is required (HOA, 100+ parcels)',
        detail: 'Effective 2025-01-01, HOAs with 100 or more parcels must post official records online.',
        href: '/admin/community',
        citation: 'FS 720.303(4)(b) (HB 1203)',
      }))
    }
  }

  return out
}
