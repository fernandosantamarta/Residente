// iCalendar (.ics) export for the community calendar. Builds an RFC 5545
// VCALENDAR from the schedule events the resident already sees, so the
// "Subscribe to calendar" buttons can hand off to Apple Calendar / Outlook
// (download + open) or Google Calendar (download + open its Import screen).
//
// Events are emitted as all-day VEVENTs (DTSTART;VALUE=DATE) — the schedule's
// `time` is a free-form display string ("6:00 PM") that we can't reliably parse
// into a wall-clock start, so we keep it in the description instead of guessing.
import { ScheduleEvent, KIND_LABEL } from './schedule'

function pad(n: number) { return String(n).padStart(2, '0') }

// "2026-06-24" -> "20260624"
function icsDate(iso: string) { return iso.replace(/-/g, '') }

// All-day events use a non-inclusive end date, so DTEND is the following day.
function nextDay(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

// Escape per RFC 5545 §3.3.11 (backslash, semicolon, comma, newlines).
function esc(s: string) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Fold long content lines to ~75 octets (we approximate by characters, which is
// safe for our ASCII-ish content) with a leading space on continuations.
function fold(line: string) {
  if (line.length <= 73) return line
  const out: string[] = []
  let s = line
  while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73) }
  out.push(s)
  return out.join('\r\n')
}

export function buildCalendar(events: ScheduleEvent[], calName = 'Community Calendar'): string {
  const now = new Date()
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Residente//Community Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold('X-WR-CALNAME:' + esc(calName)),
  ]

  for (const e of events) {
    const desc = [KIND_LABEL[e.kind], e.time, e.vendor].filter(Boolean).join(' · ')
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${esc(e.id)}@residente.io`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`)
    lines.push(`DTEND;VALUE=DATE:${nextDay(e.date)}`)
    lines.push(fold('SUMMARY:' + esc(e.title)))
    if (desc) lines.push(fold('DESCRIPTION:' + esc(desc)))
    if (e.location) lines.push(fold('LOCATION:' + esc(e.location)))
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// Trigger a browser download of the .ics. On iOS/macOS this opens the system
// "Add to Calendar" sheet; on desktop it saves a file that opens in Calendar /
// Outlook. Works inside the Capacitor WKWebView (no native plugin required).
export function downloadICS(
  events: ScheduleEvent[],
  filename = 'residente-calendar.ics',
  calName?: string,
) {
  const ics = buildCalendar(events, calName)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// Google Calendar can't accept a pushed file, so we download the .ics and open
// Google's "Import & export" settings in a new tab where the user picks the file.
export const GOOGLE_IMPORT_URL = 'https://calendar.google.com/calendar/u/0/r/settings/export'

export function addToGoogle(
  events: ScheduleEvent[],
  filename = 'residente-calendar.ics',
  calName?: string,
) {
  downloadICS(events, filename, calName)
  window.open(GOOGLE_IMPORT_URL, '_blank', 'noopener,noreferrer')
}
