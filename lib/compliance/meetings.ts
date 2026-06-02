// Meetings & statutory notice — FS 718.112(2)(c)-(e) (condo) and FS 720.303(2)
// & 720.306(5) (HOA). The operational meeting feature already lives in
// ev_meetings / /admin/voice; this domain adds the NOTICE-COMPLIANCE layer: the
// required lead time by meeting type (48-hour posted board meeting; 14-day
// mailed + posted for budget adoption, special assessments, rules on use, and
// the annual/members meeting), the agenda requirement, and the minutes-
// availability clock.
//
// Posture: Enable + Monitor — ADVISORY ONLY. Nothing here blocks scheduling or
// holding a meeting. Every constant carries its FS citation + validated:false
// until Florida counsel confirms it.
//
// ⚠ REQUIRES ATTORNEY REVIEW — the 48-hour vs 14-day lead times, which meeting
//   subjects trigger the 14-day mailed notice, the agenda requirement, and the
//   minutes-availability period must be confirmed by Florida counsel and against
//   the governing documents (which may impose longer notice).

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

// A regular board meeting: notice posted conspicuously on the property at least
// 48 hours in advance (continuously). Tracked as 2 calendar days for the
// deadline math; the obligation is hours-based.
export const BOARD_MEETING_NOTICE_HOURS = rule(48, 'FS 718.112(2)(c) / 720.303(2)(c)', {
  note: 'regular board meeting — notice posted conspicuously ≥48 hours in advance',
})

// A board meeting at which a SPECIAL/REGULAR ASSESSMENT or RULES regarding
// unit/parcel USE will be considered: 14 days written notice, mailed/delivered/
// electronically transmitted AND posted conspicuously.
export const ASSESSMENT_RULE_MEETING_NOTICE_DAYS = rule(14, 'FS 718.112(2)(c)1 / 720.303(2)(c)1', {
  note: 'meeting considering a special assessment or rules on use — 14 days mailed + posted',
})

// Budget-adoption meeting: 14 days notice with a copy of the proposed budget.
export const BUDGET_MEETING_NOTICE_DAYS = rule(14, 'FS 718.112(2)(e) / 720.303(2)', {
  note: 'budget adoption — 14 days notice with the proposed budget',
})

// Annual / members meeting: 14 days (unless the bylaws require longer).
export const ANNUAL_MEETING_NOTICE_DAYS = rule(14, 'FS 718.112(2)(d) / 720.306(5)', {
  note: 'annual / members meeting — 14 days mailed + posted unless bylaws require longer',
})

// Minutes must be available to owners; we flag a held meeting with no minutes
// published after this many days as an advisory nudge (minutes are also official
// records under FS 718.111(12) / 720.303(4)).
export const MINUTES_AVAILABLE_DAYS = rule(30, 'FS 718.111(12) / 720.303(4)', {
  note: 'minutes should be drafted/available to owners promptly after the meeting',
})

// ----------------------------------------------------------------------------
// Domain types
// ----------------------------------------------------------------------------

export type MeetingType = 'board' | 'annual' | 'special' | 'committee'
export type MinutesStatus = 'pending' | 'draft' | 'published' | 'approved'

export interface MeetingRow {
  id: string
  community_id?: string
  type?: MeetingType | string | null
  title?: string | null
  scheduled_at?: string | null            // timestamptz
  status?: 'draft' | 'notice_sent' | 'in_progress' | 'completed' | string | null
  minutes_status?: MinutesStatus | string | null
  // notice-compliance columns added by meetings.sql
  notice_posted_at?: string | null
  notice_mailed_at?: string | null
  agenda_posted_at?: string | null
  minutes_published_at?: string | null
  affects_assessments?: boolean | null
  affects_use_rules?: boolean | null
  is_budget_meeting?: boolean | null
  emergency?: boolean | null
}

export interface NoticeRequirement {
  days: number
  /** true when the statute requires MAILED (+ posted) notice, not just posting */
  mailed: boolean
  citation: string
  reason: string
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

const asType = (t: AssociationType | string | null | undefined): AssociationType =>
  t === 'hoa' ? 'hoa' : 'condo'

/**
 * The governing notice requirement for a meeting — the MOST STRINGENT that
 * applies. A budget, special-assessment, use-rule, or annual meeting needs 14
 * days mailed + posted; an ordinary board/committee meeting needs the 48-hour
 * posting (tracked as 2 days). Pure.
 */
export function requiredNotice(m: MeetingRow): NoticeRequirement {
  if (m.is_budget_meeting) {
    return { days: BUDGET_MEETING_NOTICE_DAYS.value, mailed: true, citation: BUDGET_MEETING_NOTICE_DAYS.citation, reason: 'budget adoption' }
  }
  if (m.affects_assessments) {
    return { days: ASSESSMENT_RULE_MEETING_NOTICE_DAYS.value, mailed: true, citation: ASSESSMENT_RULE_MEETING_NOTICE_DAYS.citation, reason: 'a special/regular assessment will be considered' }
  }
  if (m.affects_use_rules) {
    return { days: ASSESSMENT_RULE_MEETING_NOTICE_DAYS.value, mailed: true, citation: ASSESSMENT_RULE_MEETING_NOTICE_DAYS.citation, reason: 'rules regarding unit/parcel use will be considered' }
  }
  if (m.type === 'annual') {
    return { days: ANNUAL_MEETING_NOTICE_DAYS.value, mailed: true, citation: ANNUAL_MEETING_NOTICE_DAYS.citation, reason: 'annual / members meeting' }
  }
  return { days: Math.ceil(BOARD_MEETING_NOTICE_HOURS.value / 24), mailed: false, citation: BOARD_MEETING_NOTICE_HOURS.citation, reason: 'regular board meeting (48-hour posting)' }
}

/** The latest date notice may be given for the meeting to be properly noticed
 *  (= scheduled date − required lead). Null if not scheduled. */
export function noticeDeadline(m: MeetingRow): Date | null {
  const sched = toDate(m.scheduled_at)
  if (!sched) return null
  return addCalendarDays(sched, -requiredNotice(m).days)
}

/** The effective date notice was given: the mailed date when the statute
 *  requires mailing, otherwise the posted date. Null when not yet given. */
export function noticeGivenDate(m: MeetingRow): Date | null {
  const req = requiredNotice(m)
  return toDate(req.mailed ? m.notice_mailed_at : m.notice_posted_at)
}

/** Whether the recorded notice satisfies the lead-time requirement. */
export function noticeSatisfied(m: MeetingRow): boolean {
  const given = noticeGivenDate(m)
  const deadline = noticeDeadline(m)
  if (!given || !deadline) return false
  return given.getTime() <= deadline.getTime()
}

const isHeld = (m: MeetingRow): boolean =>
  String(m.status ?? 'draft') === 'completed' || String(m.status ?? '') === 'in_progress'

// ----------------------------------------------------------------------------
// Monitor signal producer
// ----------------------------------------------------------------------------

const DOMAIN = 'Meetings & notice'
const HREF = '/admin/meetings'

/**
 * Turn meeting rows into Monitor signals: notice not yet given as the deadline
 * approaches, notice given too late for the required lead, a 14-day meeting
 * missing its agenda, and held meetings without published minutes. Advisory.
 * Side-effect free; tolerates partial rows; never throws.
 */
export function meetingsSignals(
  meetings: MeetingRow[] = [],
  community: Record<string, any> | null | undefined = null,
  now: Date = new Date(),
): ComplianceSignal[] {
  const out: ComplianceSignal[] = []
  const regime = asType(community?.association_type)
  void regime
  const nowMs = toDate(now)!.getTime()

  for (const m of meetings) {
    const sched = toDate(m.scheduled_at)
    const label = m.title || (m.type ? `${m.type} meeting` : 'meeting') + (sched ? ` (${ymd(sched)})` : '')
    const req = requiredNotice(m)
    const deadline = noticeDeadline(m)
    const upcoming = !!sched && sched.getTime() >= nowMs // today or future (a held meeting is handled by the minutes block)

    // 1. Notice obligations for an upcoming meeting.
    if (upcoming && deadline && !m.emergency) {
      const given = noticeGivenDate(m)
      if (!given) {
        const daysToDeadline = calendarDaysUntil(deadline, now)
        if (deadline.getTime() < nowMs) {
          out.push(signal({
            id: `meetings:notice-late:${m.id}`,
            domain: DOMAIN,
            severity: 'overdue',
            title: `${label}: statutory notice has not been recorded and the deadline has passed`,
            detail: `${req.reason} requires ${req.mailed ? `${req.days} days mailed + posted` : '48 hours posted'} notice. The latest notice date was ${ymd(deadline)}.`,
            href: HREF,
            citation: req.citation,
          }))
        } else if (daysToDeadline <= (req.mailed ? 7 : 2)) {
          out.push(signal({
            id: `meetings:notice-due:${m.id}`,
            domain: DOMAIN,
            severity: 'soon',
            title: `${label}: send statutory notice by ${ymd(deadline)}`,
            detail: `${req.reason} requires ${req.mailed ? `${req.days} days mailed + posted` : '48 hours posted'} notice before the meeting.`,
            href: HREF,
            citation: req.citation,
          }))
        }
      } else if (!noticeSatisfied(m)) {
        out.push(signal({
          id: `meetings:notice-short:${m.id}`,
          domain: DOMAIN,
          severity: 'overdue',
          title: `${label}: notice was given too late for the required lead time`,
          detail: `Notice was ${req.mailed ? 'mailed' : 'posted'} ${ymd(given)} but ${req.reason} requires ${req.mailed ? `${req.days} days` : '48 hours'} before the meeting (by ${ymd(deadline)}). Consider re-noticing.`,
          href: HREF,
          citation: req.citation,
        }))
      }
      // Agenda: a properly noticed meeting should include/post an agenda.
      if (given && !m.agenda_posted_at) {
        out.push(signal({
          id: `meetings:agenda:${m.id}`,
          domain: DOMAIN,
          severity: 'info',
          title: `${label}: post an agenda with the notice`,
          detail: 'The board-meeting notice must include the agenda; post it conspicuously with the notice.',
          href: HREF,
          citation: 'FS 718.112(2)(c) / 720.303(2)(c)',
        }))
      }
    }

    // 2. Minutes not available after a held meeting.
    if (isHeld(m) && sched) {
      const published = !!toDate(m.minutes_published_at) || ['published', 'approved'].includes(String(m.minutes_status ?? ''))
      const ageDays = calendarDaysUntil(now, sched)
      if (!published && ageDays >= MINUTES_AVAILABLE_DAYS.value) {
        out.push(signal({
          id: `meetings:minutes:${m.id}`,
          domain: DOMAIN,
          severity: 'soon',
          title: `${label}: minutes are not yet available`,
          detail: `The meeting was held ${ageDays} days ago. Minutes are official records owners may inspect.`,
          href: HREF,
          citation: MINUTES_AVAILABLE_DAYS.citation,
        }))
      }
    }
  }

  return out
}
