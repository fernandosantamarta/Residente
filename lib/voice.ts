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
  | 'amenity_booked'
  | 'dues_due'
  // ---- FL compliance layer ----
  | 'compliance_alert'    // board-directed: a statutory deadline/obligation needs attention
  | 'estoppel_update'     // owner-directed: their estoppel request was received / delivered
  | 'collections_deadline' // board-directed: a collection-case statutory deadline needs attention
  | 'collections_update'   // owner-directed: a statutory collection notice was logged on their account

export type NoticeChannel = 'in_app' | 'email' | 'sms'

// Default channels when an admin sends a new notice. SMS is not wired in
// Phase 4 — it ships in Milestone 2 once Twilio is provisioned.
export const DEFAULT_CHANNELS: NoticeChannel[] = ['in_app', 'email']

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
  amenity_booked:    'Amenity reserved',
  dues_due:          'Dues due',
  compliance_alert:  'Compliance alert',
  estoppel_update:   'Estoppel request',
  collections_deadline: 'Collections deadline',
  collections_update:   'Account in collections',
}

export function noticeHref(n: { kind?: string | null; meeting_id?: string | null; vote_id?: string | null }): string {
  // Amenity bookings notify the board — send them to the admin reservations view.
  if (n.kind === 'amenity_booked') return '/admin/schedule#amenities'
  // Dues reminders send the resident to the Pay hub.
  if (n.kind === 'dues_due') return '/app/track#pay'
  // Compliance alerts are board-facing — open the compliance dashboard.
  if (n.kind === 'compliance_alert') return '/admin/compliance'
  // Estoppel updates send the owner to their Pay/Track hub.
  if (n.kind === 'estoppel_update') return '/app/track#pay'
  // Collection deadlines are board-facing — open the collections worklist.
  if (n.kind === 'collections_deadline') return '/admin/collections'
  // A collection notice on the owner's account sends them to their balance.
  if (n.kind === 'collections_update') return '/app/track#pay'
  if (n.meeting_id) return `/app/voice/${n.meeting_id}`
  // A document notice with no meeting is a library upload — open Easy Documents,
  // not the Voice meetings list. (Meeting-attached docs hit the meeting_id branch
  // above and still deep-link to their meeting.)
  if (n.kind === 'document_uploaded') return '/app/documents'
  return '/app/voice'
}

// ---------- ELECTRONIC VOTING CONSENT ----------
// Disclosures shown on /onboard's consent step before the owner clicks
// "I consent". Structured to satisfy the informed-consent requirement under
// FL 718.128(1) (condominiums) and FL 720.317(1) (HOAs).
// ⚠ REQUIRES ATTORNEY REVIEW before any real owner sees /onboard.
//   The substance is FL-statute-aligned but final language must be approved
//   by a Florida-licensed attorney before pilot launch.
export const CONSENT_DISCLOSURES: string[] = [
  'By consenting, you authorize your association to deliver all official notices and to collect your votes through the Residente platform. This satisfies the written or electronic consent required by Florida Statutes §718.128 (condominiums) and §720.317 (homeowners associations) before a unit owner or member may participate in online voting.',
  'Electronic notices and ballots carry the same legal force and effect as paper notices and mailed or hand-delivered ballots.',
  'Board elections and any vote designated as a secret ballot use end-to-end encryption: your individual vote is encrypted on your device before it is transmitted. The association, management company, and Residente cannot determine how you personally voted. Only aggregate totals are disclosed after the vote closes.',
  'This consent remains in effect for all future votes and notices at this community. You may withdraw it at any time by submitting a written request to your board. Upon withdrawal, the association will provide paper ballots and postal notices for future votes and elections.',
]

// Disclosure shown immediately above the ballot buttons when an owner is
// about to cast an open (non-secret) ballot electronically.
// Required by FL 718.128(7)(c)(3) / 720.317 when an electronic ballot is
// not a secret ballot — the owner must be informed that voting electronically
// on an open ballot associates their identity with their vote choice.
export const OPEN_BALLOT_WAIVER_NOTICE =
  'OPEN BALLOT: By voting here, your vote choice (Yes / No / Abstain) will be ' +
  'visible to your board and association administrator — this is not a secret ballot. ' +
  'IF YOU PREFER TO VOTE ANONYMOUSLY, YOU MAY ATTEND THE MEETING IN PERSON INSTEAD. ' +
  '(FL §718.128 / §720.317)'

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
