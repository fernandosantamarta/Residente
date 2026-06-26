// Residente — FL statutory compliance: rules-engine core.
//
// One place for the primitives every compliance domain shares:
//   • the association-type regime switch (condo = FS 718, hoa = FS 720)
//   • statutory constants carried WITH their citation + a `validated` flag
//   • the Florida business-/working-day calendar (holiday-aware date math)
//   • advisory warning + attorney-review helpers (Enable+Monitor posture —
//     these surface guidance, they NEVER block a board action).
//
// Mirrors the existing lib/voice.ts FL_NOTICE_HOURS / noticeWarning() pattern,
// generalised so condo/hoa differ by lookup and a future state is additive.

export type AssociationType = 'condo' | 'hoa'

// ----------------------------------------------------------------------------
// Statutory constants carry their own provenance.
//
// `validated` stays false until a Florida community-association attorney signs
// off the value/citation. UI that drives a real filing or member-facing alert
// should check `validated` and show the attorney-review banner when it is false.
// ----------------------------------------------------------------------------
export interface Rule<T> {
  value: T
  /** Florida Statutes citation, e.g. "FS 718.116(8)". */
  citation: string
  /** True only once confirmed by FL counsel. */
  validated: boolean
  /** Optional human note (effective dates, "unless governing docs provide…"). */
  note?: string
}

export function rule<T>(
  value: T,
  citation: string,
  opts: { validated?: boolean; note?: string } = {},
): Rule<T> {
  return { value, citation, validated: opts.validated ?? false, note: opts.note }
}

/** A value that differs by regime (condo vs hoa). `null` = not applicable. */
export type ByRegime<T> = Record<AssociationType, T>

/** Pick the rule for an association, defaulting unknown/missing types to condo. */
export function forType<T>(byRegime: ByRegime<T>, type: AssociationType | string | null | undefined): T {
  return byRegime[(type as AssociationType) in byRegime ? (type as AssociationType) : 'condo']
}

// ----------------------------------------------------------------------------
// Advisory helpers (NEVER blocking).
// ----------------------------------------------------------------------------
export const ATTORNEY_REVIEW_BANNER =
  '⚠ REQUIRES ATTORNEY REVIEW — the statutory logic and any generated document ' +
  'below is aligned to Florida law to the best of our ability, but the exact ' +
  'parameters, deadlines, and wording must be confirmed by a Florida-licensed ' +
  'community-association attorney before your association relies on it.'

/**
 * Returns an advisory string when `triggered`, else null — the building block
 * for every "you may be out of compliance" hint. Like noticeWarning(), callers
 * render the string but are free to proceed.
 */
export function complianceWarning(triggered: boolean, message: string): string | null {
  return triggered ? message : null
}

/** Append the FS citation to an advisory message in the house style. */
export function withCitation(message: string, citation: string): string {
  return citation ? `${message} (${citation})` : message
}

// ----------------------------------------------------------------------------
// Date utilities — UTC calendar-date math (no DST drift, no external deps).
// Statutory deadlines are calendar/business dates, so we operate on the
// Y-M-D triple in UTC and never on wall-clock time.
// ----------------------------------------------------------------------------

/** A date input we accept anywhere: Date, ISO string, or null/undefined. */
export type DateInput = Date | string | number | null | undefined

/** Parse to a UTC-midnight Date, or null if unparseable. */
export function toDate(input: DateInput): Date | null {
  if (input == null) return null
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return null
  // Normalise to UTC midnight so day arithmetic is exact.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** 'YYYY-MM-DD' in UTC. */
export function ymd(input: DateInput): string {
  const d = toDate(input)
  return d ? d.toISOString().slice(0, 10) : ''
}

export function isWeekend(input: DateInput): boolean {
  const d = toDate(input)
  if (!d) return false
  const wd = d.getUTCDay()
  return wd === 0 || wd === 6
}

// --- Florida holiday calendar ------------------------------------------------
// FL legal holidays (FS 110.117) + the federal holidays courts/recording
// offices observe. Used for "business day" / "working day" tolling.
// ⚠ validated:false — the precise set that tolls each statutory deadline must
// be confirmed by counsel (e.g. whether Juneteenth or the day-after-Thanksgiving
// counts for a given clock). Keep this list as the single source of truth.

function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): Date {
  // month0: 0-11, weekday: 0=Sun..6=Sat, n: 1-based occurrence.
  const first = new Date(Date.UTC(year, month0, 1))
  const shift = (weekday - first.getUTCDay() + 7) % 7
  return new Date(Date.UTC(year, month0, 1 + shift + (n - 1) * 7))
}

function lastWeekdayOfMonth(year: number, month0: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month0 + 1, 0)) // last day of month
  const shift = (last.getUTCDay() - weekday + 7) % 7
  return new Date(Date.UTC(year, month0, last.getUTCDate() - shift))
}

/** Fixed-date holiday with weekend-observed shift (Sat→Fri, Sun→Mon). */
function observed(year: number, month0: number, day: number): Date {
  const d = new Date(Date.UTC(year, month0, day))
  const wd = d.getUTCDay()
  if (wd === 6) return new Date(Date.UTC(year, month0, day - 1)) // Sat → Fri
  if (wd === 0) return new Date(Date.UTC(year, month0, day + 1)) // Sun → Mon
  return d
}

const _holidayCache = new Map<number, Set<string>>()

export function flHolidaysFor(year: number): Set<string> {
  const cached = _holidayCache.get(year)
  if (cached) return cached
  const days: Date[] = [
    observed(year, 0, 1), // New Year's Day
    nthWeekdayOfMonth(year, 0, 1, 3), // MLK Jr. Day (3rd Mon Jan)
    lastWeekdayOfMonth(year, 4, 1), // Memorial Day (last Mon May)
    observed(year, 5, 19), // Juneteenth
    observed(year, 6, 4), // Independence Day
    nthWeekdayOfMonth(year, 8, 1, 1), // Labor Day (1st Mon Sep)
    observed(year, 10, 11), // Veterans Day
    nthWeekdayOfMonth(year, 10, 4, 4), // Thanksgiving (4th Thu Nov)
    // Day after Thanksgiving (FL observes) — 4th Thu + 1
    new Date(nthWeekdayOfMonth(year, 10, 4, 4).getTime() + 86400000),
    observed(year, 11, 25), // Christmas Day
  ]
  const set = new Set(days.map(d => d.toISOString().slice(0, 10)))
  _holidayCache.set(year, set)
  return set
}

export function isHoliday(input: DateInput): boolean {
  const d = toDate(input)
  if (!d) return false
  return flHolidaysFor(d.getUTCFullYear()).has(ymd(d))
}

/** A business / working day = not a weekend and not a FL/federal holiday. */
export function isBusinessDay(input: DateInput): boolean {
  const d = toDate(input)
  if (!d) return false
  return !isWeekend(d) && !isHoliday(d)
}

/** Add `n` calendar days (n may be negative). */
export function addCalendarDays(input: DateInput, n: number): Date | null {
  const d = toDate(input)
  if (!d) return null
  return new Date(d.getTime() + n * 86400000)
}

/**
 * Add `n` business days (skips weekends + holidays). n may be negative to count
 * backward (e.g. election milestones). Day 0 = the start date itself.
 */
export function addBusinessDays(input: DateInput, n: number): Date | null {
  const d = toDate(input)
  if (!d) return null
  const step = n >= 0 ? 1 : -1
  let remaining = Math.abs(n)
  let cur = d
  while (remaining > 0) {
    cur = new Date(cur.getTime() + step * 86400000)
    if (isBusinessDay(cur)) remaining--
  }
  return cur
}

// "working days" is treated identically to "business days" for tolling.
export const addWorkingDays = addBusinessDays

/** Count business days strictly between two dates (exclusive of start). */
export function businessDaysBetween(from: DateInput, to: DateInput): number {
  const a = toDate(from)
  const b = toDate(to)
  if (!a || !b) return 0
  const sign = b.getTime() >= a.getTime() ? 1 : -1
  let cur = a
  let count = 0
  while (ymd(cur) !== ymd(b)) {
    cur = new Date(cur.getTime() + sign * 86400000)
    if (isBusinessDay(cur)) count += sign
  }
  return count
}

/** Whole calendar days from `now` until `target` (negative = overdue). */
export function calendarDaysUntil(target: DateInput, now: DateInput = new Date()): number {
  const t = toDate(target)
  const n = toDate(now)
  if (!t || !n) return 0
  return Math.round((t.getTime() - n.getTime()) / 86400000)
}

/** A statutory due date is the start + N business days. */
export function businessDayDeadline(start: DateInput, businessDays: number): Date | null {
  return addBusinessDays(start, businessDays)
}

// ----------------------------------------------------------------------------
// Compliance signals — the unit the Monitor dashboard + cron consume. Each
// domain module exports a producer that turns loaded rows into signals; the
// dashboard merges and groups them. Severity drives sort + colour.
// ----------------------------------------------------------------------------
export type Severity = 'overdue' | 'soon' | 'info'

export interface ComplianceSignal {
  /** Stable-ish id for keys/dedupe, e.g. `estoppel:overdue:<uuid>`. */
  id: string
  /** Human domain label, e.g. "Estoppel", "Assessments & interest". */
  domain: string
  severity: Severity
  title: string
  detail: string
  /** Deep link to the admin surface that resolves it. Also used to tally a
   *  signal under its workspace card, so it stays the workspace BASE path. */
  href?: string
  /** Optional more-specific target for the row's "Review" action (e.g. a case's
   *  printable 30-day notice). Falls back to `href` when unset. */
  reviewHref?: string
  /** FS citation backing the obligation. */
  citation?: string
}

export const SEVERITY_ORDER: Record<Severity, number> = { overdue: 0, soon: 1, info: 2 }

export function signal(s: ComplianceSignal): ComplianceSignal {
  return s
}

/** Sort overdue → soon → info, stable within a severity. */
export function sortSignals(signals: ComplianceSignal[]): ComplianceSignal[] {
  return [...signals].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
