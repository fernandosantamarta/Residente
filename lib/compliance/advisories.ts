// Niche / event-driven advisories — the long tail of Ch. 718/720 duties that
// don't fit the established domains. Mostly event-logged clocks plus a few
// standing-right reminders. All advisory; constants validated:false.
//
// Event-driven clocks (board logs the triggering date in ev_compliance_events):
//   • CONDO developer-turnover ELECTION — FS 718.301(2): within 75 days of the
//     turnover trigger the association must CALL the election, with ≥60 days'
//     notice.
//   • HOA developer-turnover DOCUMENT DELIVERY — FS 720.307(4): the developer
//     must deliver the enumerated records (a)-(t) within 90 days of turnover.
//   • RECEIVERSHIP cure window — FS 718.1124 / 720.3053: if the board can't fill
//     vacancies for a quorum, an owner/member may give notice and, after a
//     30-day cure window, petition a circuit court for a receiver. (NOTE: there
//     is NO notice-to-the-Division in either statute — a common misconception.)
//   • CONDO invoice DELIVERY-METHOD change — FS 718.121(4)(b): a 30-day written
//     notice precedes a change, AND the owner must affirmatively acknowledge it.
//   • HOA tiered financial-report PETITION — FS 720.303(7)(c): on a petition by
//     20% of parcel owners the board must notice + hold a members' meeting within
//     30 days.
//
// Data-driven:
//   • PROXY 90-day expiry — FS 720.306(8) (HOA "automatically expires 90 days
//     after the date of the meeting"); condo proxies (718.112(2)(b)) are valid
//     only for the specific meeting. Stale proxies are housekeeping advisories.
//
// Standing rights surfaced as workspace reference + document artifacts (NOT
// recurring dashboard signals, to avoid permanent noise): the receivership
// right; the CONDO-ONLY electric-vehicle / natural-gas charging right
// (FS 718.113(8) — HOAs have NO statutory counterpart); and the presuit
// mediation/arbitration process (FS 718.1255 / 720.311).

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
// Statutory constants (all validated:false until counsel confirms).
// ----------------------------------------------------------------------------

// CONDO turnover: 75 days to CALL the election + ≥60 days' notice of it.
export const TURNOVER_CALL_DAYS = rule(75, 'FS 718.301(2)', { note: 'condo: association must call the turnover election within 75 days of the trigger' })
export const TURNOVER_ELECTION_NOTICE_DAYS = rule(60, 'FS 718.301(2)', { note: 'condo: at least 60 days notice of the turnover election' })
// HOA turnover: developer delivers the enumerated records within 90 days.
export const TURNOVER_DOC_DELIVERY_DAYS = rule(90, 'FS 720.307(4)', { note: 'HOA: developer delivers the turnover documents within 90 days' })

// Receivership cure window before an owner/member may petition the court.
export const RECEIVERSHIP_CURE_DAYS = rule(30, 'FS 718.1124 / 720.3053', { note: 'owner/member 30-day notice + cure window before petitioning for a receiver; NO notice to the Division' })

// CONDO invoice delivery-method change: 30-day written notice + owner ack.
export const INVOICE_DELIVERY_NOTICE_DAYS = rule(30, 'FS 718.121(4)(b)', { note: 'condo: 30-day written notice before changing invoice/statement delivery method; owner must also affirmatively acknowledge' })

// HOA tiered financial-report petition: 20% of parcel owners → 30-day meeting.
export const TIERED_REPORT_PETITION_PCT = rule(20, 'FS 720.303(7)(c)', { note: 'HOA: 20% of parcel owners may petition for a higher report tier' })
export const TIERED_REPORT_MEETING_DAYS = rule(30, 'FS 720.303(7)(c)', { note: 'HOA: board must notice + hold the members meeting within 30 days of the petition' })

// Proxy expiry (housekeeping advisory).
export const PROXY_EXPIRY_DAYS = rule(90, 'FS 720.306(8) / 718.112(2)(b)', { note: 'HOA proxy expires 90 days after the meeting; condo proxies are valid only for the specific meeting. The staleness check here is APPROXIMATE — measured from the proxy submission date, not the meeting date.' })

// HOA developer-turnover enumerated records (FS 720.307(4)(a)-(t)) — for the
// turnover-checklist artifact.
export const TURNOVER_DOC_CHECKLIST = rule(
  [
    'All deeds to common property owned by the association',
    'The original (or a copy) of the declaration of covenants and restrictions and all amendments',
    'A certified copy of the articles of incorporation',
    'A copy of the bylaws',
    'The minute books, including all minutes',
    'The books and records of the association',
    'Any policies, rules, and regulations adopted',
    'Resignations of directors who are required to resign on loss of developer control',
    'The financial records, including financial statements, from incorporation',
    'All association funds and control of them',
    'All tangible personal property of the association',
    'A copy of all contracts in force with the association',
    'Names, addresses, and contact info of all contractors, subcontractors, and suppliers',
    'Any and all insurance policies in effect',
    'Any permits issued to the association by governmental entities',
    'Any and all warranties in effect',
    'A roster of current owners with addresses and telephone numbers',
    'Employment and service contracts in effect',
    'All other contracts to which the association is a party',
  ] as string[],
  'FS 720.307(4)',
  { note: 'HOA developer-turnover document delivery list; "if applicable" — confirm the controlling enumeration with counsel' },
)

// Standing-right reference notes (surfaced in the workspace + documents).
export const EV_CHARGING_RIGHT_NOTE = rule(
  'A condominium declaration or covenant may not prohibit a unit owner from installing an electric-vehicle charging station or natural-gas fuel station within the owner’s limited common element or designated parking; the association may impose reasonable safety, metering, insurance, and licensed-installation conditions at the owner’s expense.',
  'FS 718.113(8)',
  { note: 'CONDO ONLY — there is NO HOA (Ch. 720) statutory counterpart (720.3075 is Florida-friendly landscaping)' },
)
export const PRESUIT_ADR_NOTE = rule(
  'Many covenant-enforcement, use, meeting-notice, and records disputes must go through presuit mediation (or, for condos, nonbinding Division arbitration) before a lawsuit; assessment-collection, fining, and election/recall disputes are handled differently.',
  'FS 718.1255 / 720.311',
  { note: 'advisory only — NOT a deadline clock; condo may choose Division arbitration or mediation, HOA uses presuit mediation' },
)

// ----------------------------------------------------------------------------
// Row shapes (mirror supabase/advisories.sql + the existing ev_proxies table).
// ----------------------------------------------------------------------------
export type ComplianceEventKind =
  | 'turnover_trigger'
  | 'receivership_notice'
  | 'invoice_delivery_change'
  | 'tiered_report_petition'

export interface ComplianceEventRow {
  id: string
  community_id?: string
  kind?: ComplianceEventKind | string | null
  event_date?: string | null   // the triggering date the clock runs from
  resolved_at?: string | null   // when the duty was satisfied (clears the clock)
  notes?: string | null
}

export interface ProxyRow {
  id: string
  community_id?: string
  status?: string | null        // submitted | verified | used | revoked
  type?: string | null          // limited | general
  submitted_at?: string | null
}

// ----------------------------------------------------------------------------
// Pure math (unit-tested in isolation).
// ----------------------------------------------------------------------------
const regimeOf = (t: AssociationType | string | null | undefined): AssociationType => (t === 'hoa' ? 'hoa' : 'condo')
const isResolved = (e: ComplianceEventRow): boolean => !!toDate(e.resolved_at)

/** Count proxies that are still open (not used/revoked) and older than 90 days. */
export function staleProxies(proxies: ProxyRow[] = [], now: Date = new Date()): ProxyRow[] {
  return proxies.filter(p => {
    const st = String(p.status ?? '')
    if (st === 'used' || st === 'revoked') return false
    const sub = toDate(p.submitted_at)
    if (!sub) return false
    return calendarDaysUntil(addCalendarDays(sub, PROXY_EXPIRY_DAYS.value)!, now) < 0
  })
}

// ----------------------------------------------------------------------------
// Monitor signal producer (condo + HOA).
// ----------------------------------------------------------------------------
const HREF = '/admin/advisories'

export function advisoriesSignals(
  community: Record<string, any> | null | undefined,
  events: ComplianceEventRow[] = [],
  proxies: ProxyRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const regime = regimeOf(community.association_type)

  for (const e of events) {
    if (!e.event_date || isResolved(e)) continue
    const kind = String(e.kind ?? '')

    // --- Developer turnover (regime-specific duty) ---
    if (kind === 'turnover_trigger') {
      if (regime === 'condo') {
        const due = addCalendarDays(e.event_date, TURNOVER_CALL_DAYS.value)!
        const d = calendarDaysUntil(due, now)
        if (d < 0 || d <= 30) {
          out.push(signal({
            id: `advisory:turnover-call:${e.id}`,
            domain: 'Turnover & receivership',
            severity: d < 0 ? 'overdue' : 'soon',
            title: d < 0 ? 'Turnover election was not called within 75 days' : 'Call the developer-turnover election',
            detail: `The turnover trigger was recorded ${ymd(e.event_date)}. The association must call the turnover election by ${ymd(due)} (within ${TURNOVER_CALL_DAYS.value} days) and give at least ${TURNOVER_ELECTION_NOTICE_DAYS.value} days' notice of it.`,
            href: HREF,
            citation: TURNOVER_CALL_DAYS.citation,
          }))
        }
      } else {
        const due = addCalendarDays(e.event_date, TURNOVER_DOC_DELIVERY_DAYS.value)!
        const d = calendarDaysUntil(due, now)
        if (d < 0 || d <= 30) {
          out.push(signal({
            id: `advisory:turnover-deliver:${e.id}`,
            domain: 'Turnover & receivership',
            severity: d < 0 ? 'overdue' : 'soon',
            title: d < 0 ? 'Developer-turnover documents past the 90-day delivery deadline' : 'Developer must deliver the turnover documents',
            detail: `Turnover was recorded ${ymd(e.event_date)}. The developer must deliver the turnover records (FS 720.307(4), the (a)-(t) list) by ${ymd(due)} (within ${TURNOVER_DOC_DELIVERY_DAYS.value} days). Use the turnover-checklist document to confirm receipt.`,
            href: HREF,
            citation: TURNOVER_DOC_DELIVERY_DAYS.citation,
          }))
        }
      }
    }

    // --- Receivership cure window ---
    if (kind === 'receivership_notice') {
      const due = addCalendarDays(e.event_date, RECEIVERSHIP_CURE_DAYS.value)!
      const d = calendarDaysUntil(due, now)
      if (!(d < 0 || d <= RECEIVERSHIP_CURE_DAYS.value)) continue
      out.push(signal({
        id: `advisory:receivership-cure:${e.id}`,
        domain: 'Turnover & receivership',
        severity: d < 0 ? 'overdue' : 'soon',
        title: d < 0 ? 'Board-vacancy cure window has passed — receiver may be petitioned' : 'Fill board vacancies before the receivership cure window closes',
        detail: d < 0
          ? `A notice of intent to seek a receiver was recorded ${ymd(e.event_date)}; the ${RECEIVERSHIP_CURE_DAYS.value}-day cure window closed ${ymd(due)}. An owner/member may now petition a circuit court to appoint a receiver. Fill the vacancies and record the resolution.`
          : `A notice of intent to seek a receiver was recorded ${ymd(e.event_date)}. Fill enough board vacancies to constitute a quorum by ${ymd(due)} (${RECEIVERSHIP_CURE_DAYS.value}-day cure window) to avoid a receiver petition.`,
        href: HREF,
        citation: RECEIVERSHIP_CURE_DAYS.citation,
      }))
    }

    // --- CONDO invoice delivery-method change ---
    if (kind === 'invoice_delivery_change' && regime === 'condo') {
      const due = addCalendarDays(e.event_date, INVOICE_DELIVERY_NOTICE_DAYS.value)!
      const d = calendarDaysUntil(due, now)
      out.push(signal({
        id: `advisory:invoice-delivery:${e.id}`,
        domain: 'Owner notices',
        severity: d < 0 ? 'overdue' : 'soon',
        title: d < 0 ? 'Invoice delivery-method change — notice period elapsed' : 'Invoice delivery-method change is in its 30-day notice period',
        detail: `A 30-day notice of a change to how assessment invoices/statements are delivered was recorded ${ymd(e.event_date)}. The new method may not be used before ${ymd(due)}, and only after each owner affirmatively acknowledges the change (FS 718.121(4)(b)-(c)).`,
        href: HREF,
        citation: INVOICE_DELIVERY_NOTICE_DAYS.citation,
      }))
    }

    // --- HOA tiered financial-report petition ---
    if (kind === 'tiered_report_petition' && regime === 'hoa') {
      const due = addCalendarDays(e.event_date, TIERED_REPORT_MEETING_DAYS.value)!
      const d = calendarDaysUntil(due, now)
      if (d < 0 || d <= 14) {
        out.push(signal({
          id: `advisory:tiered-report:${e.id}`,
          domain: 'Owner notices',
          severity: d < 0 ? 'overdue' : 'soon',
          title: d < 0 ? 'Tiered-report petition meeting is overdue' : 'Hold the tiered financial-report petition meeting',
          detail: `A petition for a higher financial-report tier was recorded ${ymd(e.event_date)}. On a petition by ${TIERED_REPORT_PETITION_PCT.value}% of parcel owners, the board must notice and hold a members' meeting by ${ymd(due)} (within ${TIERED_REPORT_MEETING_DAYS.value} days) to vote on raising the report level.`,
          href: HREF,
          citation: TIERED_REPORT_MEETING_DAYS.citation,
        }))
      }
    }
  }

  // --- Stale proxies (housekeeping; aggregate) ---
  const stale = staleProxies(proxies, now)
  if (stale.length) {
    out.push(signal({
      id: 'advisory:proxies-expired',
      domain: 'Owner notices',
      severity: 'info',
      title: `${stale.length} proxy${stale.length === 1 ? '' : 's'} appear to have expired (90-day rule)`,
      detail: regime === 'hoa'
        ? `A proxy automatically expires 90 days after the meeting it was given for (FS 720.306(8)). ${stale.length} open prox${stale.length === 1 ? 'y was' : 'ies were'} submitted more than ${PROXY_EXPIRY_DAYS.value} days ago — clear or archive them so the roster stays accurate.`
        : `A proxy is valid only for the specific meeting it was given for (FS 718.112(2)(b)). ${stale.length} open prox${stale.length === 1 ? 'y was' : 'ies were'} submitted more than ${PROXY_EXPIRY_DAYS.value} days ago — clear or archive them.`,
      href: HREF,
      citation: PROXY_EXPIRY_DAYS.citation,
    }))
  }

  return out
}
