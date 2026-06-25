// Structured minutes templates — the default section schema per meeting type and
// the helpers that turn captured sections_data into a printable minutes document.
// (FS 718.111(12) / 720.303(4) — minutes are official records owners may inspect.)
//
// The schema is data-driven: a template is an ordered list of SECTIONS, each
// either a fixed group of FIELDS or a REPEATING group (agenda items, motions,
// action items) the secretary adds rows to. Some sections are CONDITIONAL on the
// meeting flags (budget / assessment / use-rule) so they appear only when
// relevant. The capture page at /admin/meetings/[id]/minutes renders this; the
// SQL stores the chosen template (or null → these defaults) and the values.
//
// Posture: aid only. The default sections + the secretary-certification language
// are starting points; confirm against the governing documents and Florida
// counsel before adopting minutes.

import { ymd } from './rules-core'

export type MeetingType = 'board' | 'annual' | 'special' | 'committee'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'time'
  | 'date'
  | 'enum'

export interface FieldSchema {
  /** stable id; values are stored under sections_data[section.id][field.id] (or
   *  inside each row for repeating sections). */
  id: string
  /** i18n key suffix under admin.minutes.field.* AND a plain fallback label. */
  label: string
  type: FieldType
  /** enum options (each is an i18n key suffix under admin.minutes.opt.* + value). */
  options?: { value: string; label: string }[]
  placeholder?: string
  /** prefill key: pull an initial value from the meeting (see prefillFromMeeting). */
  prefill?: 'title' | 'type' | 'scheduled_date' | 'scheduled_time' | 'location' | 'attendance_count' | 'quorum_required_pct'
  help?: string
}

export interface SectionSchema {
  id: string
  /** i18n key suffix under admin.minutes.section.* + a plain fallback title. */
  title: string
  /** a repeating section lets the secretary add/remove rows of `fields`. */
  repeating?: boolean
  fields: FieldSchema[]
  /** when set, the section only renders if the meeting flag is true. */
  conditionalOn?: 'is_budget_meeting' | 'affects_assessments' | 'affects_use_rules'
  help?: string
}

export type MinutesTemplate = SectionSchema[]

// ----------------------------------------------------------------------------
// Default section schema
// ----------------------------------------------------------------------------

const metadataSection: SectionSchema = {
  id: 'metadata',
  title: 'Meeting details',
  fields: [
    { id: 'title', label: 'Meeting title', type: 'text', prefill: 'title' },
    {
      id: 'type', label: 'Meeting type', type: 'enum', prefill: 'type',
      options: [
        { value: 'board', label: 'Board meeting' },
        { value: 'annual', label: 'Annual / members meeting' },
        { value: 'special', label: 'Special meeting' },
        { value: 'committee', label: 'Committee meeting' },
      ],
    },
    { id: 'date', label: 'Date', type: 'date', prefill: 'scheduled_date' },
    { id: 'called_to_order', label: 'Called to order at', type: 'time', prefill: 'scheduled_time' },
    { id: 'location', label: 'Location / video link', type: 'text', prefill: 'location' },
    { id: 'presiding', label: 'Presiding officer', type: 'text' },
    { id: 'recorded_by', label: 'Minutes recorded by', type: 'text' },
  ],
}

const quorumSection: SectionSchema = {
  id: 'quorum',
  title: 'Quorum',
  fields: [
    { id: 'attendance_count', label: 'Members / directors present', type: 'number', prefill: 'attendance_count' },
    { id: 'quorum_required_pct', label: 'Quorum required (%)', type: 'number', prefill: 'quorum_required_pct' },
    { id: 'quorum_met', label: 'Quorum established', type: 'boolean' },
    { id: 'quorum_note', label: 'Quorum note', type: 'textarea', placeholder: 'How quorum was verified (in person, proxy, electronic).' },
  ],
}

const agendaItemsSection: SectionSchema = {
  id: 'agenda_items',
  title: 'Agenda items & discussion',
  repeating: true,
  help: 'One row per agenda item. Business not on the noticed agenda generally may not be acted upon.',
  fields: [
    { id: 'topic', label: 'Topic', type: 'text' },
    { id: 'discussion', label: 'Discussion', type: 'textarea' },
  ],
}

const motionsSection: SectionSchema = {
  id: 'motions',
  title: 'Motions & votes',
  repeating: true,
  help: 'Record each motion, who moved/seconded, and the vote tally.',
  fields: [
    { id: 'motion', label: 'Motion', type: 'textarea' },
    { id: 'moved_by', label: 'Moved by', type: 'text' },
    { id: 'seconded_by', label: 'Seconded by', type: 'text' },
    { id: 'votes_for', label: 'For', type: 'number' },
    { id: 'votes_against', label: 'Against', type: 'number' },
    { id: 'votes_abstain', label: 'Abstain', type: 'number' },
    {
      id: 'outcome', label: 'Outcome', type: 'enum',
      options: [
        { value: 'passed', label: 'Passed' },
        { value: 'failed', label: 'Failed' },
        { value: 'tabled', label: 'Tabled' },
        { value: 'withdrawn', label: 'Withdrawn' },
      ],
    },
  ],
}

const budgetSection: SectionSchema = {
  id: 'budget',
  title: 'Budget adoption',
  conditionalOn: 'is_budget_meeting',
  help: 'Budget-adoption details (a copy of the proposed budget must accompany the notice).',
  fields: [
    { id: 'budget_adopted', label: 'Budget adopted', type: 'boolean' },
    { id: 'total_amount', label: 'Total annual budget', type: 'number' },
    { id: 'reserves_funded', label: 'Reserves fully funded', type: 'boolean' },
    { id: 'budget_note', label: 'Note', type: 'textarea' },
  ],
}

const assessmentSection: SectionSchema = {
  id: 'assessment',
  title: 'Special / regular assessment',
  conditionalOn: 'affects_assessments',
  fields: [
    { id: 'assessment_approved', label: 'Assessment approved', type: 'boolean' },
    { id: 'assessment_amount', label: 'Amount', type: 'number' },
    { id: 'assessment_purpose', label: 'Purpose', type: 'textarea' },
    { id: 'assessment_due', label: 'Due / payable', type: 'text' },
  ],
}

const rulesSection: SectionSchema = {
  id: 'use_rules',
  title: 'Rules regarding unit / parcel use',
  conditionalOn: 'affects_use_rules',
  fields: [
    { id: 'rules_adopted', label: 'Rule(s) adopted', type: 'boolean' },
    { id: 'rules_summary', label: 'Summary of the rule change', type: 'textarea' },
    { id: 'rules_effective', label: 'Effective date', type: 'date' },
  ],
}

const actionItemsSection: SectionSchema = {
  id: 'action_items',
  title: 'Action items',
  repeating: true,
  fields: [
    { id: 'action', label: 'Action', type: 'textarea' },
    { id: 'owner', label: 'Responsible', type: 'text' },
    { id: 'due', label: 'Due', type: 'date' },
  ],
}

const ownerCommentsSection: SectionSchema = {
  id: 'owner_comments',
  title: 'Owner / member comments',
  fields: [
    { id: 'comments', label: 'Owner / member comments (open forum)', type: 'textarea' },
  ],
}

const adjournmentSection: SectionSchema = {
  id: 'adjournment',
  title: 'Adjournment',
  fields: [
    { id: 'adjourned_at', label: 'Adjourned at', type: 'time' },
    { id: 'next_meeting', label: 'Next meeting (if scheduled)', type: 'text' },
  ],
}

const certificationSection: SectionSchema = {
  id: 'certification',
  title: 'Secretary certification',
  help: 'The secretary certifies these minutes are a true and accurate record. Confirm against the governing documents.',
  fields: [
    { id: 'secretary_name', label: 'Secretary', type: 'text' },
    { id: 'certified', label: 'Certified as a true and accurate record', type: 'boolean' },
    { id: 'approved_on', label: 'Approved on', type: 'date' },
  ],
}

/** The ordered default sections shared by every meeting type. The conditional
 *  budget/assessment/rules sections are present but only render when the meeting
 *  flag is set. */
const BASE_SECTIONS: MinutesTemplate = [
  metadataSection,
  quorumSection,
  agendaItemsSection,
  motionsSection,
  budgetSection,
  assessmentSection,
  rulesSection,
  actionItemsSection,
  ownerCommentsSection,
  adjournmentSection,
  certificationSection,
]

/**
 * The default minutes template for a meeting type. Today every type shares the
 * base sections (the conditional sections handle budget/assessment/rule cases);
 * a committee meeting drops the owner-comment open-forum section. Returns a fresh
 * array so callers may safely mutate.
 */
export function defaultTemplate(meetingType: MeetingType | string | null | undefined): MinutesTemplate {
  const type = (meetingType ?? 'board') as MeetingType
  if (type === 'committee') {
    return BASE_SECTIONS.filter(s => s.id !== 'owner_comments').map(s => ({ ...s }))
  }
  return BASE_SECTIONS.map(s => ({ ...s }))
}

// ----------------------------------------------------------------------------
// Prefill + rendering helpers
// ----------------------------------------------------------------------------

export interface MeetingForPrefill {
  title?: string | null
  type?: string | null
  scheduled_at?: string | null
  location?: string | null
  quorum_required_pct?: number | null
}

/** Compute the initial value for a prefill field from the meeting + attendance
 *  count. Returns undefined when there is nothing to prefill. */
export function prefillValue(
  prefill: FieldSchema['prefill'],
  meeting: MeetingForPrefill,
  attendanceCount: number,
): string | number | undefined {
  if (!prefill) return undefined
  const sched = meeting.scheduled_at ? new Date(meeting.scheduled_at) : null
  switch (prefill) {
    case 'title': return meeting.title ?? undefined
    case 'type': return meeting.type ?? 'board'
    case 'location': return meeting.location ?? undefined
    case 'attendance_count': return attendanceCount || 0
    case 'quorum_required_pct': return meeting.quorum_required_pct ?? undefined
    case 'scheduled_date': return sched ? ymd(sched) : undefined
    case 'scheduled_time':
      // Use UTC getters to match ymd() which normalises to UTC midnight — avoids
      // a date/time contradiction for evening meetings stored in UTC.
      return sched
        ? `${String(sched.getUTCHours()).padStart(2, '0')}:${String(sched.getUTCMinutes()).padStart(2, '0')}`
        : undefined
    default: return undefined
  }
}

/** Build a sections_data object seeded with prefilled values for a fresh capture
 *  (fixed sections only; repeating sections start with a single empty row). */
export function seedSectionsData(
  template: MinutesTemplate,
  meeting: MeetingForPrefill,
  attendanceCount: number,
): Record<string, any> {
  const data: Record<string, any> = {}
  for (const section of template) {
    if (section.repeating) {
      data[section.id] = [emptyRow(section)]
      continue
    }
    const group: Record<string, any> = {}
    for (const f of section.fields) {
      const pre = prefillValue(f.prefill, meeting, attendanceCount)
      if (pre !== undefined) group[f.id] = pre
    }
    data[section.id] = group
  }
  return data
}

/** A blank row for a repeating section. */
export function emptyRow(section: SectionSchema): Record<string, any> {
  const row: Record<string, any> = {}
  for (const f of section.fields) row[f.id] = f.type === 'boolean' ? false : ''
  return row
}

/** Sections that should render for a meeting, dropping conditional sections whose
 *  flag is not set. */
export function visibleSections(
  template: MinutesTemplate,
  flags: { is_budget_meeting?: boolean | null; affects_assessments?: boolean | null; affects_use_rules?: boolean | null },
): MinutesTemplate {
  return template.filter(s => {
    if (!s.conditionalOn) return true
    return !!flags[s.conditionalOn]
  })
}

// ---- value formatting ------------------------------------------------------

function fieldLabel(f: FieldSchema): string {
  return f.label
}

function formatValue(f: FieldSchema, raw: any): string {
  if (raw === undefined || raw === null || raw === '') return '—'
  if (f.type === 'boolean') return raw ? 'Yes' : 'No'
  if (f.type === 'enum') {
    const opt = f.options?.find(o => o.value === raw)
    return opt ? opt.label : String(raw)
  }
  return String(raw)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Render captured sections_data into a plain-text minutes document. Side-effect
 * free; tolerates partial data; never throws. Conditional sections whose flag is
 * unset are omitted.
 */
export function renderMinutesText(
  template: MinutesTemplate,
  sectionsData: Record<string, any>,
  flags: { is_budget_meeting?: boolean | null; affects_assessments?: boolean | null; affects_use_rules?: boolean | null } = {},
): string {
  const lines: string[] = []
  for (const section of visibleSections(template, flags)) {
    lines.push(section.title.toUpperCase())
    const value = sectionsData?.[section.id]
    if (section.repeating) {
      const rows: any[] = Array.isArray(value) ? value : []
      if (rows.length === 0) { lines.push('  —'); lines.push(''); continue }
      rows.forEach((row, i) => {
        lines.push(`  ${i + 1}.`)
        for (const f of section.fields) {
          lines.push(`     ${fieldLabel(f)}: ${formatValue(f, row?.[f.id])}`)
        }
      })
    } else {
      const group = value || {}
      for (const f of section.fields) {
        lines.push(`  ${fieldLabel(f)}: ${formatValue(f, group?.[f.id])}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/**
 * Render captured sections_data into an HTML minutes document fragment (no outer
 * <html>; safe to embed in a print page). Values are HTML-escaped.
 */
export function renderMinutesHtml(
  template: MinutesTemplate,
  sectionsData: Record<string, any>,
  flags: { is_budget_meeting?: boolean | null; affects_assessments?: boolean | null; affects_use_rules?: boolean | null } = {},
): string {
  const parts: string[] = []
  for (const section of visibleSections(template, flags)) {
    parts.push(`<section><h2>${escapeHtml(section.title)}</h2>`)
    const value = sectionsData?.[section.id]
    if (section.repeating) {
      const rows: any[] = Array.isArray(value) ? value : []
      if (rows.length === 0) {
        parts.push('<p>—</p>')
      } else {
        parts.push('<ol>')
        for (const row of rows) {
          parts.push('<li><dl>')
          for (const f of section.fields) {
            parts.push(`<dt>${escapeHtml(fieldLabel(f))}</dt><dd>${escapeHtml(formatValue(f, row?.[f.id]))}</dd>`)
          }
          parts.push('</dl></li>')
        }
        parts.push('</ol>')
      }
    } else {
      const group = value || {}
      parts.push('<dl>')
      for (const f of section.fields) {
        parts.push(`<dt>${escapeHtml(fieldLabel(f))}</dt><dd>${escapeHtml(formatValue(f, group?.[f.id]))}</dd>`)
      }
      parts.push('</dl>')
    }
    parts.push('</section>')
  }
  return parts.join('\n')
}
