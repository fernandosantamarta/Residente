// Elections & recall — FS 718.112(2)(d) (condo) and FS 720.306(9)-(10) (HOA).
// The operational secret-ballot election runs on ev_votes (type='election') +
// ev_candidates; this domain adds the NOTICE-TIMELINE compliance layer for the
// annual-meeting election (the 60-day first notice, the 40-day candidate
// deadline, and the 14–34-day second notice + ballot), the election-quorum
// check, and the board-recall clock (the board must act within 5 business days
// of a recall served on it).
//
// Posture: Enable + Monitor — ADVISORY ONLY. Nothing here runs or invalidates an
// election. Every constant carries its FS citation + validated:false until
// Florida counsel confirms it.
//
// ⚠ REQUIRES ATTORNEY REVIEW — the 60/40/14–34-day election timeline (condo;
//   HOA elections are largely governing-document-driven), the 20% election
//   quorum, and the 5-business-day recall-certification window must be confirmed
//   by Florida counsel and against the governing documents.

import {
  rule,
  toDate,
  ymd,
  addCalendarDays,
  addBusinessDays,
  calendarDaysUntil,
  signal,
  type AssociationType,
  type ComplianceSignal,
} from './rules-core'

// ----------------------------------------------------------------------------
// Statutory constants (validated:false).
// ----------------------------------------------------------------------------

// Condo: first notice of the election (with the opportunity to be a candidate)
// at least 60 days before the election.
export const ELECTION_FIRST_NOTICE_DAYS = rule(60, 'FS 718.112(2)(d)4', {
  note: 'condo: first notice of election ≥60 days before the election',
})

// A person desiring to be a candidate must give written notice at least 40 days
// before the election (condo + HOA).
export const CANDIDATE_NOTICE_DAYS = rule(40, 'FS 718.112(2)(d)4 / 720.306(9)(b)', {
  note: 'candidate written notice of intent ≥40 days before the election',
})

// Second notice + ballot + candidate information sheets: mailed not less than 14
// and not more than 34 days before the election.
export const SECOND_NOTICE_MIN_DAYS = rule(14, 'FS 718.112(2)(d)4', {
  note: 'second notice + ballot mailed ≥14 days before the election',
})
export const SECOND_NOTICE_MAX_DAYS = rule(34, 'FS 718.112(2)(d)4', {
  note: 'second notice + ballot mailed ≤34 days before the election',
})

// Condo: at least 20% of eligible voters must cast a ballot for a valid election.
export const ELECTION_QUORUM_PCT = rule(20, 'FS 718.112(2)(d)', {
  note: 'condo: ≥20% of eligible voters must cast a ballot for a valid election',
})

// Recall: a majority of the voting interests may recall the board. When a recall
// is served on the board, the board must hold a meeting and certify (or not)
// within 5 full business days; if it fails to act, the recall is effective and
// the dispute proceeds to Division/DBPR arbitration.
export const RECALL_BOARD_ACTION_BUSINESS_DAYS = rule(5, 'FS 718.112(2)(j) / 720.303(10)', {
  note: 'board must notice + hold a meeting to certify the recall within 5 full business days',
})
export const RECALL_MAJORITY = rule('a majority of the voting interests', 'FS 718.112(2)(j) / 720.303(10)', {
  note: 'recall requires a majority of all voting interests',
})

// ----------------------------------------------------------------------------
// Domain types
// ----------------------------------------------------------------------------

export type ElectionStatus = 'proposed' | 'first_notice_sent' | 'candidates_closed' | 'ballots_sent' | 'completed' | 'cancelled'
export type RecallOutcome = 'pending' | 'certified' | 'rejected' | 'arbitration'

export const ELECTION_STATUS_LABELS: Record<ElectionStatus, string> = {
  proposed:         'Proposed',
  first_notice_sent:'First notice sent',
  candidates_closed:'Candidate window closed',
  ballots_sent:     'Ballots mailed',
  completed:        'Completed',
  cancelled:        'Cancelled',
}

export interface ElectionRow {
  id: string
  community_id?: string
  meeting_id?: string | null
  vote_id?: string | null
  election_date?: string | null
  first_notice_at?: string | null
  candidate_deadline_at?: string | null
  second_notice_at?: string | null
  ballots_sent_at?: string | null
  seats?: number | null
  candidate_count?: number | null
  ballots_cast?: number | null
  eligible_count?: number | null
  status?: ElectionStatus | string | null
  notes?: string | null
}

export interface RecallRow {
  id: string
  community_id?: string
  served_at?: string | null
  method?: 'written_agreement' | 'meeting' | string | null
  voting_interests_total?: number | null
  signatures?: number | null
  board_certified?: boolean | null
  certified_at?: string | null
  outcome?: RecallOutcome | string | null
  arbitration_filed_at?: string | null
  notes?: string | null
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

const asType = (t: AssociationType | string | null | undefined): AssociationType =>
  t === 'hoa' ? 'hoa' : 'condo'

/** The four election milestone deadlines derived from the election date. */
export function electionMilestones(e: ElectionRow): {
  firstNoticeBy: Date | null
  candidateBy: Date | null
  secondNoticeEarliest: Date | null
  secondNoticeLatest: Date | null
} {
  const d = toDate(e.election_date)
  if (!d) return { firstNoticeBy: null, candidateBy: null, secondNoticeEarliest: null, secondNoticeLatest: null }
  return {
    firstNoticeBy: addCalendarDays(d, -ELECTION_FIRST_NOTICE_DAYS.value),
    candidateBy: addCalendarDays(d, -CANDIDATE_NOTICE_DAYS.value),
    secondNoticeEarliest: addCalendarDays(d, -SECOND_NOTICE_MAX_DAYS.value),
    secondNoticeLatest: addCalendarDays(d, -SECOND_NOTICE_MIN_DAYS.value),
  }
}

/** Whether a completed election met the condo 20% ballot-cast quorum. */
export function electionQuorumMet(e: ElectionRow): boolean | null {
  const eligible = Number(e.eligible_count) || 0
  const cast = Number(e.ballots_cast) || 0
  if (!eligible) return null
  return (cast / eligible) * 100 >= ELECTION_QUORUM_PCT.value
}

/** The date the board must act by after a recall is served (5 full business days). */
export function recallActionDeadline(r: RecallRow): Date | null {
  if (!r.served_at) return null
  return addBusinessDays(r.served_at, RECALL_BOARD_ACTION_BUSINESS_DAYS.value)
}

/** Whether the recall petition meets the majority-of-voting-interests threshold. */
export function recallMajorityMet(r: RecallRow): boolean | null {
  const total = Number(r.voting_interests_total) || 0
  const sigs = Number(r.signatures) || 0
  if (!total) return null
  return sigs > total / 2
}

// ----------------------------------------------------------------------------
// Monitor signal producers
// ----------------------------------------------------------------------------

const DOMAIN = 'Elections & recall'
const HREF = '/admin/elections'

/**
 * Election-timeline signals for an upcoming/active election: the 60-day first
 * notice, the 40-day candidate deadline, the 14–34-day second notice + ballot
 * window, and the election-quorum check once completed. Condo timeline is
 * statutory; HOA is largely governing-document-driven (advisory either way).
 * Side-effect free; tolerates partial rows; never throws.
 */
export function electionsSignals(
  elections: ElectionRow[] = [],
  community: Record<string, any> | null | undefined = null,
  now: Date = new Date(),
): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const regime = asType(community?.association_type)
  const nowMs = toDate(now)!.getTime()

  for (const e of elections) {
    const status = String(e.status ?? 'proposed') as ElectionStatus
    if (status === 'cancelled') continue
    const d = toDate(e.election_date)
    const label = d ? `Election ${ymd(d)}` : 'Election'
    const ms = electionMilestones(e)
    const upcoming = d && d.getTime() >= nowMs - 86400000

    if (upcoming && d) {
      // 1. First notice (condo 60-day).
      if (regime === 'condo' && ms.firstNoticeBy && !e.first_notice_at) {
        const days = calendarDaysUntil(ms.firstNoticeBy, now)
        if (ms.firstNoticeBy.getTime() < nowMs) {
          out.push(signal({
            id: `elections:first-notice-late:${e.id}`, domain: DOMAIN, severity: 'overdue',
            title: `${label}: the 60-day first notice of election is overdue`,
            detail: `The first notice was due by ${ymd(ms.firstNoticeBy)}. It tells owners of the election and the opportunity to be a candidate.`,
            href: HREF, citation: ELECTION_FIRST_NOTICE_DAYS.citation,
          }))
        } else if (days <= 14) {
          out.push(signal({
            id: `elections:first-notice-due:${e.id}`, domain: DOMAIN, severity: 'soon',
            title: `${label}: send the 60-day first notice of election by ${ymd(ms.firstNoticeBy)}`,
            detail: 'The first notice must reach owners at least 60 days before the election.',
            href: HREF, citation: ELECTION_FIRST_NOTICE_DAYS.citation,
          }))
        }
      }

      // 2. Candidate window (40-day).
      if (ms.candidateBy && !e.candidate_deadline_at) {
        const days = calendarDaysUntil(ms.candidateBy, now)
        if (days >= 0 && days <= 10) {
          out.push(signal({
            id: `elections:candidate-window:${e.id}`, domain: DOMAIN, severity: 'info',
            title: `${label}: the candidate-notice deadline is ${ymd(ms.candidateBy)}`,
            detail: 'Candidates must give written notice of intent at least 40 days before the election.',
            href: HREF, citation: CANDIDATE_NOTICE_DAYS.citation,
          }))
        }
      }

      // 3. Second notice + ballot (14–34 day window).
      if (ms.secondNoticeLatest && !e.ballots_sent_at) {
        const days = calendarDaysUntil(ms.secondNoticeLatest, now)
        if (ms.secondNoticeLatest.getTime() < nowMs) {
          out.push(signal({
            id: `elections:ballot-late:${e.id}`, domain: DOMAIN, severity: 'overdue',
            title: `${label}: the ballot / second notice is overdue`,
            detail: `The ballot must be mailed not less than 14 (and not more than 34) days before the election — the latest date was ${ymd(ms.secondNoticeLatest)}.`,
            href: HREF, citation: SECOND_NOTICE_MIN_DAYS.citation,
          }))
        } else if (days <= 10) {
          out.push(signal({
            id: `elections:ballot-due:${e.id}`, domain: DOMAIN, severity: 'soon',
            title: `${label}: mail the ballot + second notice by ${ymd(ms.secondNoticeLatest)}`,
            detail: `Mail the ballot, second notice, and candidate information sheets between ${ymd(ms.secondNoticeEarliest)} and ${ymd(ms.secondNoticeLatest)}.`,
            href: HREF, citation: SECOND_NOTICE_MIN_DAYS.citation,
          }))
        }
      }
    }

    // 4. Quorum check once completed (condo).
    if (status === 'completed' && regime === 'condo') {
      const met = electionQuorumMet(e)
      if (met === false) {
        out.push(signal({
          id: `elections:quorum:${e.id}`, domain: DOMAIN, severity: 'soon',
          title: `${label}: fewer than ${ELECTION_QUORUM_PCT.value}% of eligible voters cast a ballot`,
          detail: `${e.ballots_cast ?? 0} of ${e.eligible_count ?? 0} eligible voters. At least ${ELECTION_QUORUM_PCT.value}% must cast a ballot for a valid condo election; the prior board may continue.`,
          href: HREF, citation: ELECTION_QUORUM_PCT.citation,
        }))
      }
    }
  }

  return out
}

/**
 * Recall signals: once a recall is served on the board, the board must act
 * within 5 full business days; flag the approaching/passed deadline and the
 * arbitration path if the board does not certify. Advisory.
 */
export function recallSignals(
  recalls: RecallRow[] = [],
  now: Date = new Date(),
): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const nowMs = toDate(now)!.getTime()

  for (const r of recalls) {
    const outcome = String(r.outcome ?? 'pending') as RecallOutcome
    if (outcome === 'certified' || outcome === 'rejected') continue
    if (!r.served_at) continue
    const deadline = recallActionDeadline(r)
    if (!deadline) continue
    const label = `Recall served ${r.served_at}`

    if (!r.board_certified) {
      if (deadline.getTime() < nowMs && outcome !== 'arbitration') {
        out.push(signal({
          id: `recall:overdue:${r.id}`, domain: DOMAIN, severity: 'overdue',
          title: `${label}: the board has not acted within 5 business days`,
          detail: `The board had to notice and hold a meeting to certify the recall by ${ymd(deadline)}. If the board fails to act, the recall is effective and the dispute proceeds to Division/DBPR arbitration.`,
          href: HREF, citation: RECALL_BOARD_ACTION_BUSINESS_DAYS.citation,
        }))
      } else if (deadline.getTime() >= nowMs) {
        out.push(signal({
          id: `recall:due:${r.id}`, domain: DOMAIN, severity: 'soon',
          title: `${label}: the board must hold a recall meeting by ${ymd(deadline)}`,
          detail: 'Within 5 full business days of service the board must hold a meeting and either certify the recall or refuse to certify.',
          href: HREF, citation: RECALL_BOARD_ACTION_BUSINESS_DAYS.citation,
        }))
      }
    }
  }

  return out
}
