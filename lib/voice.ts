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

// User-facing voting categories — how proposals are grouped on the resident
// Proposals & Rules tab. Distinct from the FL-statutory `type` above (which
// drives ballot rules); this is just the bucket the board files it under.
export type VoteCategory = 'rules' | 'expenses' | 'events' | 'other'
export const VOTE_CATEGORIES: Option<VoteCategory>[] = [
  { value: 'rules',    label: 'New rules & proposals' },
  { value: 'expenses', label: 'New expenses' },
  { value: 'events',   label: 'New events' },
  { value: 'other',    label: 'Miscellaneous' },
]
export const voteCategoryLabel = (c?: string | null) =>
  VOTE_CATEGORIES.find(x => x.value === (c || 'other'))?.label ?? 'Miscellaneous'

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
  | 'violation'           // owner-directed: a fine/warning was issued against them
  // ---- FL compliance layer ----
  | 'compliance_alert'    // board-directed: a statutory deadline/obligation needs attention
  | 'estoppel_update'     // owner-directed: their estoppel request was received / delivered
  | 'collections_deadline' // board-directed: a collection-case statutory deadline needs attention
  | 'collections_update'   // owner-directed: a statutory collection notice was logged on their account
  // ---- resident requests & payments ----
  | 'request_new'          // board-directed: a resident submitted a new request
  | 'request_update'       // owner-directed: the board changed status / replied on their request
  | 'payment_received'     // owner-directed: a payment landed on their account (receipt)
  | 'rule_published'       // community-directed: the board added a new rule to the rule book

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
  violation:         'Violation',
  compliance_alert:  'Compliance alert',
  estoppel_update:   'Estoppel request',
  collections_deadline: 'Collections deadline',
  collections_update:   'Account in collections',
  request_new:          'New request',
  request_update:       'Request update',
  payment_received:     'Payment received',
  rule_published:       'New rule',
}

// Semantic colour group for a notice, used to colour-code the notification
// rows (left accent + kind chip) so a resident can scan the bell by tone:
//   alert   — needs action / money owed / a deadline (orange-red)
//   success — something good landed (payment, booking, board reply) (green)
//   info    — informational publish (docs, minutes, meetings, votes) (blue)
//   neutral — everything else (slate)
export type NoticeTone = 'alert' | 'success' | 'info' | 'neutral'
export function noticeTone(kind?: string | null): NoticeTone {
  switch (kind) {
    case 'violation':
    case 'dues_due':
    case 'collections_deadline':
    case 'collections_update':
    case 'compliance_alert':
    case 'meeting_reminder':
    case 'vote_reminder':
      return 'alert'
    case 'payment_received':
    case 'amenity_booked':
    case 'estoppel_update':
    case 'vote_results':
    case 'statement_ready':
      return 'success'
    case 'meeting_published':
    case 'document_uploaded':
    case 'minutes_published':
    case 'vote_opened':
    case 'rule_published':
    case 'request_update':   // an informational board reply → navy, not green
      return 'info'
    default:
      return 'neutral'
  }
}

// Translated kind label for the resident UI (bell + notifications inbox).
// Falls back to the English NOTICE_KIND_LABELS (then the raw kind) when a
// translation is missing — t() returns the key unchanged on a miss.
export function noticeKindLabel(kind: string | null | undefined, t: (k: string) => string): string {
  if (!kind) return ''
  const key = `notice.kind.${kind}`
  const label = t(key)
  return label === key ? (NOTICE_KIND_LABELS[kind as NoticeKind] ?? kind) : label
}

// Notice subjects/bodies are written once (in English) by DB triggers, then
// delivered to every resident — so they can't be stored per-language. For the
// system-generated REQUEST templates (the common resident notices) we localise
// at render time by matching the known English text. Board-written free text
// and other templates fall through unchanged (correctly — we can't know them).
export function localizeNoticeText(
  text: string | null | undefined,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (!text) return ''
  const exact: Record<string, string> = {
    'Your request is now in progress.': 'notice.tpl.reqInProgress',
    'Your request has been marked resolved.': 'notice.tpl.reqResolved',
    'The board replied to your request. Tap to read it.': 'notice.tpl.reqReplied',
  }
  if (exact[text]) return t(exact[text])
  let m: RegExpExecArray | null
  if ((m = /^Request update: (.*)$/.exec(text)))        return t('notice.tpl.requestUpdate', { subject: m[1] })
  if ((m = /^Reply on your request: (.*)$/.exec(text))) return t('notice.tpl.replyOnRequest', { subject: m[1] })
  if ((m = /^Your request status changed to (.*)\.$/.exec(text))) return t('notice.tpl.reqStatusChanged', { status: m[1] })
  return text
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
  // A new resident request is board-facing — open the requests triage worklist.
  if (n.kind === 'request_new') return '/admin/requests'
  // A status change / board reply sends the resident to the Contact tab where
  // their requests, statuses, and board replies render (#contact selects it).
  if (n.kind === 'request_update') return '/app/voice#contact'
  // A payment receipt sends the resident to their Pay/Track balance.
  if (n.kind === 'payment_received') return '/app/track#pay'
  // A monthly statement notice opens the resident's Statements list.
  if (n.kind === 'statement_ready') return '/app/track#statements'
  // A new rule opens the resident rule book (Rules tab in Easy Documents).
  if (n.kind === 'rule_published') return '/app/documents#rules'
  // A fine/warning notice opens the resident's violations tab in Easy Documents
  // (the #violations hash selects that tab on load, not the default Rules tab).
  if (n.kind === 'violation') return '/app/documents#violations'
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

// ---------- VOICE DASHBOARD HELPERS (resident + admin share these) ----------

// Minimal vote shape the dashboards read. Pulled from ev_votes; all optional
// so it tolerates the lighter list-query select and the full single-meeting one.
export type VoteLike = {
  id: string
  title?: string | null
  description?: string | null
  type?: string | null
  status?: VoteStatus | string | null
  yes_count?: number | null
  no_count?: number | null
  abstain_count?: number | null
  result?: string | null
  opens_at?: string | null
  closes_at?: string | null
}

// Ballots cast = yes + no + abstain. Used for the support bar and turnout copy.
export function ballotsCast(v: VoteLike): number {
  return (v.yes_count ?? 0) + (v.no_count ?? 0) + (v.abstain_count ?? 0)
}

// Share of decided ballots (yes / (yes+no)) as a 0-100 int. We have no
// eligible-voter denominator in the schema, so the bar shows support among
// those who voted, not community-wide turnout. Returns null when nobody has
// voted yes or no yet (abstains don't move the bar).
export function supportPct(v: VoteLike): number | null {
  const decided = (v.yes_count ?? 0) + (v.no_count ?? 0)
  if (decided === 0) return null
  return Math.round(((v.yes_count ?? 0) / decided) * 100)
}

// "Ends Jun 10" style label from closes_at; null when there's no close date.
export function voteEndsLabel(v: VoteLike): string | null {
  if (!v.closes_at) return null
  const d = new Date(v.closes_at)
  if (isNaN(d.getTime())) return null
  return `Ends ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

// Vote types that read as "Proposals & Rule Changes" on the resident page
// (vs straight resolutions/elections). No proposals table exists, so the
// dashboard derives this view from the meeting votes themselves.
const PROPOSAL_VOTE_TYPES = new Set(['bylaw_amendment', 'special_assessment', 'budget_ratification'])
export function isProposalVote(v: VoteLike): boolean {
  return PROPOSAL_VOTE_TYPES.has(String(v.type ?? ''))
}

export type ProposalStatus = { label: string; tone: 'review' | 'pending' | 'approved' | 'rejected' }

// Map a vote's lifecycle to the proposal pill in 4.png:
//   draft        → Under Review   (board hasn't opened it)
//   open         → Pending Vote   (community is voting now)
//   closed       → Pending Vote   (awaiting tally)
//   tallied/pub  → Approved / Rejected by result
export function proposalStatus(v: VoteLike): ProposalStatus {
  const s = String(v.status ?? '')
  if (s === 'draft') return { label: 'Under Review', tone: 'review' }
  if (s === 'open' || s === 'closed') return { label: 'Pending Vote', tone: 'pending' }
  const passed = String(v.result ?? '').toLowerCase()
  if (passed.includes('pass') || passed.includes('approve') || passed === 'yes')
    return { label: 'Approved', tone: 'approved' }
  if (passed.includes('fail') || passed.includes('reject') || passed === 'no')
    return { label: 'Rejected', tone: 'rejected' }
  return { label: 'Decided', tone: 'approved' }
}
