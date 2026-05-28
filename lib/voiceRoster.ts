// Easy Voice — owner-roster CSV parser.
//
// Columns (header row required, case-insensitive, any order):
//   unit_number | unit  (required)
//   first_name  | first (required)
//   last_name   | last  (required)
//   email                (required)
//   phone                (optional)
//
// Returns one normalised row per data line plus a flat list of errors keyed
// by line number. The caller decides whether to surface errors per-row or
// block the whole import.

export interface RosterRow {
  line: number
  unit_number: string
  first_name: string
  last_name: string
  email: string
  phone: string
  errors: string[]   // populated by validate(), one message per problem
}

export interface RosterParseResult {
  rows: RosterRow[]
  // Errors that aren't tied to a specific row: missing header, missing
  // required columns, empty file.
  fatal: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Strict column-name lookup → canonical key. Extra columns are ignored.
const HEADER_ALIASES: Record<string, keyof Omit<RosterRow, 'line' | 'errors'>> = {
  unit_number: 'unit_number',
  unit:        'unit_number',
  first_name:  'first_name',
  first:       'first_name',
  last_name:   'last_name',
  last:        'last_name',
  email:       'email',
  phone:       'phone',
}

// Naive CSV split: comma-separated, quotes optional. Good enough for the
// hand-built rosters HOAs upload; no embedded newlines, no escaped quotes.
function splitCsvLine(line: string): string[] {
  return line.split(',').map(c => c.replace(/^"|"$/g, '').trim())
}

export function parseRosterCsv(text: string): RosterParseResult {
  const fatal: string[] = []
  const lines = String(text || '').split(/\r?\n/)
    .map((l, i) => ({ raw: l, line: i + 1 }))
    .filter(x => x.raw.trim().length > 0)

  if (!lines.length) {
    return { rows: [], fatal: ['File is empty.'] }
  }

  const headerCells = splitCsvLine(lines[0].raw).map(c => c.toLowerCase())
  const colMap: Record<string, number> = {}
  headerCells.forEach((cell, idx) => {
    const canon = HEADER_ALIASES[cell]
    if (canon) colMap[canon] = idx
  })

  const required: Array<keyof typeof colMap> = ['unit_number', 'first_name', 'last_name', 'email']
  const missing = required.filter(k => !(k in colMap))
  if (missing.length) {
    fatal.push(
      `Header row is missing required column${missing.length > 1 ? 's' : ''}: ` +
      missing.join(', ') + '. Expected: unit_number, first_name, last_name, email, phone (optional).'
    )
    return { rows: [], fatal }
  }

  const rows: RosterRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i].raw)
    const get = (k: keyof typeof colMap): string =>
      (cells[colMap[k]] ?? '').trim()

    rows.push({
      line: lines[i].line,
      unit_number: get('unit_number'),
      first_name:  get('first_name'),
      last_name:   get('last_name'),
      email:       get('email').toLowerCase(),
      phone:       colMap.phone != null ? get('phone') : '',
      errors:      [],
    })
  }

  return { rows, fatal }
}

// Validate parsed rows against required-field rules + within-CSV duplicates +
// caller-supplied DB sets (units already in the community, emails already
// claimed). Mutates row.errors in place.
export function validateRoster(
  rows: RosterRow[],
  existing: { units: Set<string>; emails: Set<string> },
): { okCount: number; errorCount: number } {
  const seenUnit: Map<string, number> = new Map()
  const seenEmail: Map<string, number> = new Map()

  for (const r of rows) {
    r.errors = []

    if (!r.unit_number) r.errors.push('unit_number is required')
    if (!r.first_name)  r.errors.push('first_name is required')
    if (!r.last_name)   r.errors.push('last_name is required')
    if (!r.email)       r.errors.push('email is required')
    else if (!EMAIL_RE.test(r.email)) r.errors.push('email is malformed')

    if (r.unit_number) {
      const prior = seenUnit.get(r.unit_number)
      if (prior) r.errors.push(`unit_number duplicated (also on line ${prior})`)
      else seenUnit.set(r.unit_number, r.line)
      if (existing.units.has(r.unit_number)) {
        // Not a hard error — admin may be re-importing to update names. Flag it.
        r.errors.push('unit already exists (will be re-used)')
      }
    }

    if (r.email) {
      const prior = seenEmail.get(r.email)
      if (prior) r.errors.push(`email duplicated (also on line ${prior})`)
      else seenEmail.set(r.email, r.line)
      if (existing.emails.has(r.email)) {
        r.errors.push('email already in roster (will be updated)')
      }
    }
  }

  const okCount = rows.filter(r => isImportable(r)).length
  return { okCount, errorCount: rows.length - okCount }
}

// Soft warnings ("unit already exists", "email already in roster") DON'T block
// import — they trigger an upsert path. Only structural errors block.
export function isImportable(r: RosterRow): boolean {
  const blocking = r.errors.filter(e =>
    !e.startsWith('unit already exists') && !e.startsWith('email already in roster')
  )
  return blocking.length === 0
}
