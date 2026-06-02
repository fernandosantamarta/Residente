// Director eligibility, education/certification, conflicts & CAM.
// Applies to BOTH condo (FS 718.112(2)(d), 718.1265, 718.3027) and HOA
// (FS 720.3033) + community-association management (Ch. 468 Part VIII).
//
// Posture: Enable + Monitor — ADVISORY ONLY. This NEVER auto-removes a director,
// auto-voids a contract, or hard-blocks a board action. Every constant carries
// its FS citation + validated:false until Florida counsel confirms it.
//
// Director identity = residents.id (the board roster is residents.is_board).

import {
  rule,
  toDate,
  ymd,
  calendarDaysUntil,
  signal,
  forType,
  type AssociationType,
  type ByRegime,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Statutory constants (validated:false).
// ----------------------------------------------------------------------------

// Condo director term limit: 8 consecutive years (FS 718.112(2)(d)2). Service is
// counted from 2018-07-01 forward; the limit reaches hard impact 2026-07-01.
// (HOAs have no equivalent statutory term limit — governing docs may impose one.)
export const CONDO_TERM_LIMIT_YEARS = rule(8, 'FS 718.112(2)(d)2', { note: 'consecutive years; condo only' })
export const TERM_LIMIT_COUNT_SINCE = rule('2018-07-01', 'FS 718.112(2)(d)2', { note: 'service counted from this date' })
export const TERM_LIMIT_HARD_IMPACT = rule('2026-07-01', 'FS 718.112(2)(d)2', { note: 'limit reaches hard impact' })

// Initial certification: within 90 days of being elected/appointed, a director
// must either complete the approved educational course OR sign a written
// certification of having read the governing documents.
export const INITIAL_CERT_DAYS = rule(90, 'FS 718.112(2)(d)4 / 720.3033(1)', { note: 'from election to certify' })
// Certification validity before recertification is required.
export const CERT_VALIDITY_YEARS = rule(
  { condo: 7, hoa: 4 } as ByRegime<number>,
  'FS 718.112(2)(d)4 / 720.3033(1)',
  { note: 'condo cert valid 7 yr; HOA 4 yr' },
)
// Continuing education. Condo: ~1 hour/year. HOA: 4 hours (≤2,500 parcels) or 8
// hours (>2,500 parcels) over the term.
export const CONDO_CE_HOURS_PER_YEAR = rule(1, 'FS 718.112(2)(d)4', { note: 'continuing education hours/year' })
export const HOA_CE_HOURS = rule(
  { small: 4, large: 8 } as { small: number; large: number },
  'FS 720.3033(1)',
  { note: '4 hr if ≤2,500 parcels; 8 hr if >2,500' },
)
export const HOA_CE_LARGE_PARCELS = rule(2500, 'FS 720.3033(1)', { note: 'parcel threshold for the 8-hour tier' })

// A director who is more than 90 days delinquent in a monetary obligation is
// ineligible / deemed to have abandoned the seat (advisory — board acts).
export const DIRECTOR_DELINQUENCY_DAYS = rule(90, 'FS 718.112(2)(d)2 / 720.3033(1)', { note: '>90 days delinquent → ineligible' })

// Conflict of interest: a director must disclose a conflict at least 14 days
// before the vote, and a contract with a director-affiliated party requires
// disclosure + approval (condo: ⅔ of directors present).
export const CONFLICT_DISCLOSURE_LEAD_DAYS = rule(14, 'FS 718.3027 / 720.3033(2)', { note: 'disclose before the vote' })
export const CONFLICT_CONTRACT_APPROVAL = rule('two-thirds of directors present', 'FS 718.3027', { note: 'approval for a conflict contract' })

// Community-association management (CAM) is required once the association is
// larger than 10 units OR has an annual budget over $100,000.
export const CAM_TRIGGER_UNITS = rule(10, 'FS 468.431(2)', { note: '>10 units requires a licensed CAM' })
export const CAM_TRIGGER_BUDGET = rule(100_000, 'FS 468.431(2)', { note: '>$100k annual budget requires a licensed CAM' })

// ----------------------------------------------------------------------------
// Row shapes.
// ----------------------------------------------------------------------------
export interface DirectorRow {            // a residents row with is_board = true
  id: string
  community_id?: string
  full_name?: string | null
  board_position?: string | null
  is_board?: boolean | null
}
export interface BoardTermRow {
  id: string
  community_id?: string
  resident_id?: string | null
  term_start?: string | null
  term_end?: string | null
  elected_at?: string | null
}
export interface DirectorEligibilityRow {
  id: string
  community_id?: string
  resident_id?: string | null
  delinquent?: boolean | null
  delinquent_since?: string | null
  felony_conviction?: boolean | null
  charged_pending?: boolean | null
  co_owner_conflict?: boolean | null
  signed_certification?: boolean | null
}
export interface DirectorCertRow {
  id: string
  community_id?: string
  resident_id?: string | null
  kind?: 'initial' | 'continuing' | 'recert' | string | null
  completed_at?: string | null
  hours?: number | null
  expires_at?: string | null
}
export interface ManagerRow {
  id: string
  community_id?: string
  name?: string | null
  license_number?: string | null
  license_type?: 'cam' | 'cab' | 'other' | string | null
  license_expiry?: string | null
  dbpr_verified?: boolean | null
  status?: 'active' | 'inactive' | string | null
}
export interface ConflictVendorRow {     // vendors with director_owned = true
  id: string
  name?: string | null
  director_owned?: boolean | null
  director_equity_pct?: number | null
}
export interface ConflictDisclosureRow {
  id: string
  resident_id?: string | null
  related_vendor_id?: string | null
  approved?: boolean | null
}

// ----------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ----------------------------------------------------------------------------
const regimeOf = (t: AssociationType | string | null | undefined): AssociationType => (t === 'hoa' ? 'hoa' : 'condo')

/**
 * Consecutive years a director has served, counting only service on/after
 * TERM_LIMIT_COUNT_SINCE. Terms within ~2.5 years of each other count as one
 * unbroken run (covers annual + 2-year terms); a larger gap resets the run.
 */
export function consecutiveServiceYears(
  termStarts: (string | null | undefined)[],
  now: Date = new Date(),
  sinceISO: string = TERM_LIMIT_COUNT_SINCE.value,
): number {
  const since = toDate(sinceISO)!.getTime()
  const nowMs = toDate(now)!.getTime()
  const starts = termStarts
    .map(s => toDate(s)?.getTime())
    .filter((t): t is number => t != null && t <= nowMs)
    .sort((a, b) => a - b)
  if (!starts.length) return 0
  const GAP = 2.5 * 365.25 * 86400000
  // Walk backward from the most recent term; extend the run while gaps are small.
  let runStart = starts[starts.length - 1]
  for (let i = starts.length - 1; i > 0; i--) {
    if (starts[i] - starts[i - 1] <= GAP) runStart = starts[i - 1]
    else break
  }
  const effectiveStart = Math.max(runStart, since)
  if (effectiveStart > nowMs) return 0
  return (nowMs - effectiveStart) / (365.25 * 86400000)
}

/** Certification validity end = completed + (7 condo / 4 hoa) years. */
export function certExpiry(completedAt: string | Date | null | undefined, regime: AssociationType): Date | null {
  const d = toDate(completedAt)
  if (!d) return null
  return new Date(Date.UTC(d.getUTCFullYear() + forType(CERT_VALIDITY_YEARS.value, regime), d.getUTCMonth(), d.getUTCDate()))
}

/** Does the association need a licensed CAM (>10 units OR >$100k budget)? */
export function camRequired(community: Record<string, any> | null | undefined): boolean {
  if (!community) return false
  const regime = regimeOf(community.association_type)
  const units = regime === 'hoa' ? Number(community.parcel_count) || 0 : Number(community.unit_count) || 0
  const budget = Number(community.annual_revenue) || (Number(community.monthly_dues) || 0) * units * 12
  return units > CAM_TRIGGER_UNITS.value || budget > CAM_TRIGGER_BUDGET.value
}

const dateDaysAgo = (iso: string | null | undefined, now: Date): number | null => {
  const d = toDate(iso)
  if (!d) return null
  return Math.round((toDate(now)!.getTime() - d.getTime()) / 86400000)
}

// ----------------------------------------------------------------------------
// Monitor signal producer (condo + HOA). ADVISORY — flag only.
// ----------------------------------------------------------------------------
const HREF = '/admin/governance'

export function governanceSignals(
  community: Record<string, any> | null | undefined,
  directors: DirectorRow[] = [],
  terms: BoardTermRow[] = [],
  certs: DirectorCertRow[] = [],
  eligibility: DirectorEligibilityRow[] = [],
  managers: ManagerRow[] = [],
  conflictVendors: ConflictVendorRow[] = [],
  disclosures: ConflictDisclosureRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const regime = regimeOf(community.association_type)
  const board = directors.filter(d => d.is_board)

  const termsByDirector = new Map<string, BoardTermRow[]>()
  for (const t of terms) { const k = String(t.resident_id ?? ''); (termsByDirector.get(k) || termsByDirector.set(k, []).get(k)!).push(t) }
  const certsByDirector = new Map<string, DirectorCertRow[]>()
  for (const c of certs) { const k = String(c.resident_id ?? ''); (certsByDirector.get(k) || certsByDirector.set(k, []).get(k)!).push(c) }
  const eligByDirector = new Map<string, DirectorEligibilityRow>()
  for (const e of eligibility) eligByDirector.set(String(e.resident_id ?? ''), e)

  for (const d of board) {
    const label = d.full_name || d.board_position || d.id.slice(0, 8)
    const dTerms = termsByDirector.get(d.id) || []
    const dCerts = certsByDirector.get(d.id) || []
    const elig = eligByDirector.get(d.id)

    // --- Condo 8-year consecutive term limit ---
    if (regime === 'condo' && dTerms.length) {
      const years = consecutiveServiceYears(dTerms.map(t => t.term_start), now)
      if (years >= CONDO_TERM_LIMIT_YEARS.value) {
        out.push(signal({
          id: `governance:term-limit:${d.id}`,
          domain: 'Directors & management',
          severity: 'overdue',
          title: `${label} has served ~${years.toFixed(1)} consecutive years (8-year limit)`,
          detail: `Condominium directors may not serve more than ${CONDO_TERM_LIMIT_YEARS.value} consecutive years (service counted since ${TERM_LIMIT_COUNT_SINCE.value}) absent the statutory exception. This is advisory — the board decides.`,
          href: HREF,
          citation: CONDO_TERM_LIMIT_YEARS.citation,
        }))
      } else if (years >= CONDO_TERM_LIMIT_YEARS.value - 1) {
        out.push(signal({
          id: `governance:term-limit-soon:${d.id}`,
          domain: 'Directors & management',
          severity: 'soon',
          title: `${label} is approaching the 8-year consecutive-service limit`,
          detail: `~${years.toFixed(1)} consecutive years served.`,
          href: HREF,
          citation: CONDO_TERM_LIMIT_YEARS.citation,
        }))
      }
    }

    // --- Initial certification within 90 days of the most recent term start ---
    const latestTermStart = dTerms.map(t => toDate(t.elected_at ?? t.term_start)?.getTime() ?? 0).sort((a, b) => b - a)[0]
    const hasInitial = dCerts.some(c => c.kind === 'initial' && c.completed_at) || !!elig?.signed_certification
    if (latestTermStart && !hasInitial) {
      const ageDays = Math.round((toDate(now)!.getTime() - latestTermStart) / 86400000)
      if (ageDays > INITIAL_CERT_DAYS.value) {
        out.push(signal({
          id: `governance:cert-missing:${d.id}`,
          domain: 'Directors & management',
          severity: 'overdue',
          title: `${label} has no director certification on file`,
          detail: `Elected ~${ageDays} days ago. Within ${INITIAL_CERT_DAYS.value} days a director must complete the educational course or sign a written certification of having read the governing documents.`,
          href: HREF,
          citation: INITIAL_CERT_DAYS.citation,
        }))
      } else if (ageDays >= INITIAL_CERT_DAYS.value - 30) {
        out.push(signal({
          id: `governance:cert-due:${d.id}`,
          domain: 'Directors & management',
          severity: 'soon',
          title: `${label} must certify within the 90-day window`,
          detail: `Elected ~${ageDays} days ago; the certification deadline is approaching.`,
          href: HREF,
          citation: INITIAL_CERT_DAYS.citation,
        }))
      }
    }

    // --- Certification expiring / expired (recert) ---
    const newestCert = dCerts
      .filter(c => c.completed_at && (c.kind === 'initial' || c.kind === 'recert'))
      .sort((a, b) => (toDate(b.completed_at)!.getTime()) - (toDate(a.completed_at)!.getTime()))[0]
    if (newestCert) {
      const exp = toDate(newestCert.expires_at) ?? certExpiry(newestCert.completed_at, regime)
      if (exp) {
        const daysLeft = calendarDaysUntil(exp, now)
        if (daysLeft <= 90) {
          out.push(signal({
            id: `governance:cert-expiring:${d.id}`,
            domain: 'Directors & management',
            severity: daysLeft < 0 ? 'overdue' : 'soon',
            title: `${label}'s director certification ${daysLeft < 0 ? 'has expired' : 'expires soon'}`,
            detail: `Valid through ${ymd(exp)} (${forType(CERT_VALIDITY_YEARS.value, regime)}-year ${regime === 'hoa' ? 'HOA' : 'condo'} validity).`,
            href: HREF,
            citation: CERT_VALIDITY_YEARS.citation,
          }))
        }
      }
    }

    // --- Director ≥90 days delinquent (board-recorded eligibility flag) ---
    const delinqDays = elig?.delinquent ? (dateDaysAgo(elig.delinquent_since, now) ?? DIRECTOR_DELINQUENCY_DAYS.value) : null
    if (elig?.delinquent && (delinqDays == null || delinqDays >= DIRECTOR_DELINQUENCY_DAYS.value)) {
      out.push(signal({
        id: `governance:delinquent:${d.id}`,
        domain: 'Directors & management',
        severity: 'overdue',
        title: `${label} is flagged more than ${DIRECTOR_DELINQUENCY_DAYS.value} days delinquent`,
        detail: `A director more than ${DIRECTOR_DELINQUENCY_DAYS.value} days delinquent in a monetary obligation is ineligible to serve. Advisory — confirm and act.`,
        href: HREF,
        citation: DIRECTOR_DELINQUENCY_DAYS.citation,
      }))
    }

    // --- Other recorded eligibility concerns (advisory info) ---
    if (elig && (elig.felony_conviction || elig.charged_pending)) {
      out.push(signal({
        id: `governance:eligibility:${d.id}`,
        domain: 'Directors & management',
        severity: 'soon',
        title: `${label} has a recorded eligibility concern to review`,
        detail: `${[elig.felony_conviction ? 'felony conviction (eligibility may require restoration of civil rights)' : '', elig.charged_pending ? 'pending charge' : ''].filter(Boolean).join('; ')}. Advisory — confirm with counsel.`,
        href: HREF,
        citation: 'FS 718.112(2)(d)2 / 720.3033(1)',
      }))
    }
  }

  // --- CAM requirement + license status ---
  if (camRequired(community)) {
    const activeMgr = managers.find(m => String(m.status ?? 'active') === 'active')
    if (!activeMgr) {
      out.push(signal({
        id: 'governance:cam-missing',
        domain: 'Directors & management',
        severity: 'soon',
        title: 'A licensed community-association manager may be required',
        detail: `Associations over ${CAM_TRIGGER_UNITS.value} units or with a budget over $${CAM_TRIGGER_BUDGET.value.toLocaleString('en-US')} must retain a licensed CAM. None is recorded.`,
        href: HREF,
        citation: CAM_TRIGGER_UNITS.citation,
      }))
    } else {
      const expDays = calendarDaysUntil(activeMgr.license_expiry, now)
      if (activeMgr.license_expiry && expDays <= 60) {
        out.push(signal({
          id: 'governance:cam-license-expiring',
          domain: 'Directors & management',
          severity: expDays < 0 ? 'overdue' : 'soon',
          title: `The CAM license ${expDays < 0 ? 'has expired' : 'expires soon'}`,
          detail: `${activeMgr.name || 'Manager'} — license valid through ${ymd(activeMgr.license_expiry)}.`,
          href: HREF,
          citation: 'FS 468.432',
        }))
      }
      if (!activeMgr.dbpr_verified) {
        out.push(signal({
          id: 'governance:cam-unverified',
          domain: 'Directors & management',
          severity: 'info',
          title: 'Verify the CAM license against DBPR',
          detail: `${activeMgr.name || 'The recorded manager'}'s license has not been marked DBPR-verified.`,
          href: HREF,
          citation: 'FS 468.432',
        }))
      }
    }
  }

  // --- Director-owned vendor without a recorded conflict disclosure ---
  const disclosedVendorIds = new Set(disclosures.map(x => String(x.related_vendor_id ?? '')))
  const undisclosed = conflictVendors.filter(v => v.director_owned && !disclosedVendorIds.has(String(v.id)))
  if (undisclosed.length) {
    out.push(signal({
      id: 'governance:conflict-undisclosed',
      domain: 'Directors & management',
      severity: 'soon',
      title: `${undisclosed.length} director-affiliated vendor(s) without a conflict disclosure`,
      detail: `A contract with a director-affiliated party requires written disclosure and ${CONFLICT_CONTRACT_APPROVAL.value} approval: ${undisclosed.map(v => v.name).filter(Boolean).join(', ')}.`,
      href: HREF,
      citation: CONFLICT_CONTRACT_APPROVAL.citation,
    }))
  }

  return out
}
