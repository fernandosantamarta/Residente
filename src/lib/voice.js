// Easy Voice — shared constants and helpers

export const MEETING_TYPES = [
  { value: 'board',     label: 'Board Meeting' },
  { value: 'annual',    label: 'Annual Member Meeting' },
  { value: 'special',   label: 'Special Member Meeting' },
  { value: 'committee', label: 'Committee Meeting' },
]

export const VOTE_TYPES = [
  { value: 'resolution',          label: 'Resolution (yes/no)' },
  { value: 'budget_ratification', label: 'Budget Ratification' },
  { value: 'bylaw_amendment',     label: 'Bylaw / Rule Amendment' },
  { value: 'special_assessment',  label: 'Special Assessment' },
  { value: 'election',            label: 'Board Election' },
  { value: 'other',               label: 'Other' },
]

export const DOC_TYPES = [
  { value: 'agenda',        label: 'Agenda' },
  { value: 'minutes',       label: 'Minutes' },
  { value: 'supporting',    label: 'Supporting Document' },
  { value: 'notice_record', label: 'Notice Record' },
]

// Florida required notice periods in hours.
// Source: FL 718.112(2)(c), 718.112(2)(d), 720.303(2), 720.306(4)
export const FL_NOTICE_HOURS = {
  board:     48,
  annual:    14 * 24,
  special:   14 * 24,
  committee: 0,   // no statutory minimum
}

// Returns null (ok) or a warning string if the meeting is cutting the notice period short.
export function noticeWarning(meetingType, scheduledAt) {
  const required = FL_NOTICE_HOURS[meetingType]
  if (!required || !scheduledAt) return null
  const hoursUntil = (new Date(scheduledAt) - Date.now()) / 36e5
  if (hoursUntil < required) {
    const label = MEETING_TYPES.find(t => t.value === meetingType)?.label ?? meetingType
    const days = required >= 24 ? `${required / 24}-day` : `${required}-hour`
    return `Florida law requires at least a ${days} notice for a ${label} (FL ${meetingStatute(meetingType)}). You may proceed if you have sent a separate physical notice.`
  }
  return null
}

function meetingStatute(type) {
  if (type === 'board')   return '718.112(2)(c) / 720.303(2)'
  if (type === 'annual')  return '718.112(2)(d) / 720.306(4)'
  if (type === 'special') return '720.306(4)'
  return ''
}

export const MEETING_STATUS_LABELS = {
  draft:       'Draft',
  notice_sent: 'Notice Sent',
  in_progress: 'In Progress',
  completed:   'Completed',
}

export const VOTE_STATUS_LABELS = {
  draft:     'Draft',
  open:      'Open',
  closed:    'Closed',
  tallied:   'Tallied',
  published: 'Published',
}
