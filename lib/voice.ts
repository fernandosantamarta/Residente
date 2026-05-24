// Easy Voice — shared constants and helpers

export type MeetingType = 'board' | 'annual' | 'special' | 'committee'
export type VoteType =
  | 'resolution'
  | 'budget_ratification'
  | 'bylaw_amendment'
  | 'special_assessment'
  | 'election'
  | 'other'
export type DocType = 'agenda' | 'minutes' | 'supporting' | 'notice_record'
export type MeetingStatus = 'draft' | 'notice_sent' | 'in_progress' | 'completed'
export type VoteStatus = 'draft' | 'open' | 'closed' | 'tallied' | 'published'
export type BallotType = 'open' | 'secret'
export type BallotAnswer = 'yes' | 'no' | 'abstain'

type Option<T extends string> = { value: T; label: string }

export const MEETING_TYPES: Option<MeetingType>[] = [
  { value: 'board',     label: 'Board Meeting' },
  { value: 'annual',    label: 'Annual Member Meeting' },
  { value: 'special',   label: 'Special Member Meeting' },
  { value: 'committee', label: 'Committee Meeting' },
]

export const VOTE_TYPES: Option<VoteType>[] = [
  { value: 'resolution',          label: 'Resolution (yes/no)' },
  { value: 'budget_ratification', label: 'Budget Ratification' },
  { value: 'bylaw_amendment',     label: 'Bylaw / Rule Amendment' },
  { value: 'special_assessment',  label: 'Special Assessment' },
  { value: 'election',            label: 'Board Election' },
  { value: 'other',               label: 'Other' },
]

export const DOC_TYPES: Option<DocType>[] = [
  { value: 'agenda',        label: 'Agenda' },
  { value: 'minutes',       label: 'Minutes' },
  { value: 'supporting',    label: 'Supporting Document' },
  { value: 'notice_record', label: 'Notice Record' },
]

// Florida required notice periods in hours.
// Source: FL 718.112(2)(c), 718.112(2)(d), 720.303(2), 720.306(4)
export const FL_NOTICE_HOURS: Record<MeetingType, number> = {
  board:     48,
  annual:    14 * 24,
  special:   14 * 24,
  committee: 0,   // no statutory minimum
}

// Returns null (ok) or a warning string if the meeting is cutting the notice period short.
export function noticeWarning(meetingType: MeetingType, scheduledAt: string | null): string | null {
  const required = FL_NOTICE_HOURS[meetingType]
  if (!required || !scheduledAt) return null
  const hoursUntil = (new Date(scheduledAt).getTime() - Date.now()) / 36e5
  if (hoursUntil < required) {
    const label = MEETING_TYPES.find(t => t.value === meetingType)?.label ?? meetingType
    const days = required >= 24 ? `${required / 24}-day` : `${required}-hour`
    return `Florida law requires at least a ${days} notice for a ${label} (FL ${meetingStatute(meetingType)}). You may proceed if you have sent a separate physical notice.`
  }
  return null
}

function meetingStatute(type: MeetingType): string {
  if (type === 'board')   return '718.112(2)(c) / 720.303(2)'
  if (type === 'annual')  return '718.112(2)(d) / 720.306(4)'
  if (type === 'special') return '720.306(4)'
  return ''
}

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  draft:       'Draft',
  notice_sent: 'Notice Sent',
  in_progress: 'In Progress',
  completed:   'Completed',
}

export const VOTE_STATUS_LABELS: Record<VoteStatus, string> = {
  draft:     'Draft',
  open:      'Open',
  closed:    'Closed',
  tallied:   'Tallied',
  published: 'Published',
}

// ---------- NOTICES ----------

export type NoticeKind =
  | 'meeting_published'
  | 'meeting_reminder'
  | 'document_uploaded'
  | 'vote_opened'
  | 'vote_reminder'
  | 'vote_results'
  | 'minutes_published'
  | 'proxy_submitted'
  | 'custom_broadcast'

export type NoticeChannel = 'in_app' | 'email' | 'sms'

export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = {
  meeting_published: 'Meeting published',
  meeting_reminder:  'Meeting reminder',
  document_uploaded: 'New document',
  vote_opened:       'Vote opened',
  vote_reminder:     'Vote reminder',
  vote_results:      'Vote results',
  minutes_published: 'Minutes published',
  proxy_submitted:   'Proxy submitted',
  custom_broadcast:  'Announcement',
}

export function noticeHref(n: { meeting_id?: string | null; vote_id?: string | null }): string {
  if (n.meeting_id) return `/app/voice/${n.meeting_id}`
  return '/app/voice'
}

// ---------- ELECTRONIC VOTING CONSENT ----------
// Plain-English disclosures shown on /onboard's consent step before the
// owner clicks "I consent". The four-bullet structure satisfies the
// "informed consent" requirement under FL 718.128 / 720.317.
// PLACEHOLDER COPY — Andres should review/replace before pilot launch.
export const CONSENT_DISCLOSURES: string[] = [
  'You are agreeing to receive official association notices and to cast votes electronically through Residente.',
  'Electronic ballots have the same legal effect as paper ballots. Once cast, a ballot cannot be changed.',
  'For board elections, your individual ballot is encrypted and the association cannot see how you voted. Vote totals are public.',
  'You can withdraw consent at any time by emailing your board — paper ballots will then be provided for future votes.',
]

export function defaultNoticeCopy(
  kind: NoticeKind,
  ctx: { meetingTitle?: string; docTitle?: string } = {}
): { subject: string; body: string } {
  switch (kind) {
    case 'meeting_published':
      return {
        subject: `Meeting notice: ${ctx.meetingTitle ?? ''}`.trim(),
        body: 'A new meeting has been posted. Tap to view details, agenda, and documents.',
      }
    case 'document_uploaded':
      return {
        subject: `New document: ${ctx.docTitle ?? ctx.meetingTitle ?? ''}`.trim(),
        body: 'A new document has been posted for an upcoming meeting.',
      }
    case 'minutes_published':
      return {
        subject: `Minutes available: ${ctx.meetingTitle ?? ''}`.trim(),
        body: 'Meeting minutes have been published.',
      }
    case 'custom_broadcast':
      return { subject: '', body: '' }
    default:
      return { subject: '', body: '' }
  }
}
