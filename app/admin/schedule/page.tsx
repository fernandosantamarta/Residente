'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALL_KINDS,
  EventKind,
  KIND_LABEL,
  ScheduleEvent,
  useScheduleEvents,
  useCommunitySchedule,
} from '@/lib/schedule'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { AmenitiesAdmin } from './_sections/AmenitiesAdmin'

const EVENTS_PAGE_SIZE = 8

const ADMIN_TABS: SegTab[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'amenities', label: 'Amenities' },
]

// Admin → Schedule mirrors the resident Easy Schedule: a Calendar tab (board
// adds events) and an Amenities tab (board defines bookable amenities).
export default function AdminSchedule() {
  const [tab, setTab] = useState('calendar')
  return (
    <div className="admin-schedule-tabs">
      <SegTabs tabs={ADMIN_TABS} active={tab} onChange={setTab} ariaLabel="Schedule admin sections" />
      {tab === 'amenities' ? <AmenitiesAdmin /> : <CalendarAdmin />}
    </div>
  )
}

type EmptyForm = {
  kind: EventKind
  title: string
  date: string
  time: string
  vendor: string
  location: string
}
const EMPTY_FORM: EmptyForm = {
  kind: 'event',
  title: '',
  date: '',
  time: '',
  vendor: '',
  location: '',
}

// A row parsed out of an uploaded CSV, before the board confirms it.
type ParsedRow = {
  kind: EventKind
  title: string
  date: string
  time?: string
  vendor?: string
  location?: string
  raw: string // the original date text, so we can flag rows we couldn't read
  ok: boolean // false when title or date is missing / unparseable
}

// Map free-text kind labels back to an EventKind. Accepts the enum value
// ("board_meeting") or the human label ("Board Meeting"), case-insensitive.
function coerceKind(s: string | undefined): EventKind {
  const v = (s || '').trim().toLowerCase()
  if (!v) return 'event'
  const byValue = ALL_KINDS.find(k => k.toLowerCase() === v)
  if (byValue) return byValue
  const byLabel = ALL_KINDS.find(k => KIND_LABEL[k].toLowerCase() === v)
  return byLabel || 'event'
}

// Normalize a date cell to ISO YYYY-MM-DD. Handles "2026-06-01" and common
// US forms like "6/1/2026" or "June 1, 2026". Returns '' if unparseable.
function coerceDate(s: string): string {
  const v = (s || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  // Use local parts to avoid the UTC off-by-one that toISOString can cause.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Minimal CSV parse for the schedule import. Columns (header optional, order
// fixed): title, date, kind, time, vendor, location. Header auto-detected when
// the first row's second cell isn't a date.
function parseScheduleCsv(text: string): ParsedRow[] {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line: string) => line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  const first = cells(lines[0])
  const headerLike = first[1] !== undefined && !coerceDate(first[1]) && isNaN(Number(first[1]))
  const start = headerLike ? 1 : 0
  const out: ParsedRow[] = []
  for (let i = start; i < lines.length; i++) {
    const c = cells(lines[i])
    const title = (c[0] || '').trim()
    const date = coerceDate(c[1] || '')
    out.push({
      title,
      date,
      kind: coerceKind(c[2]),
      time: (c[3] || '').trim() || undefined,
      vendor: (c[4] || '').trim() || undefined,
      location: (c[5] || '').trim() || undefined,
      raw: (c[1] || '').trim(),
      ok: Boolean(title && date),
    })
  }
  return out
}

// Calendar tab. Board can add events one-off (form) or in bulk via a CSV
// upload. Everything they add shows up on the resident-facing /app/schedule
// page and the dashboard's "Up next" rail.
function CalendarAdmin() {
  const allEvents = useScheduleEvents()
  // Board-managed events (from the DB) + async add/remove. Realtime-synced,
  // so anything added here shows on every resident's calendar immediately.
  const { events: stored, addEvent, removeEvent } = useCommunitySchedule()
  const [form, setForm] = useState<EmptyForm>(EMPTY_FORM)
  const [successMsg, setSuccessMsg] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfStatus, setPdfStatus] = useState<string>('')
  const [xlsFile, setXlsFile] = useState<File | null>(null)
  // CSV import: parsed rows awaiting the board's confirmation, plus any
  // file-level read error (binary .xlsx dropped in, empty file, etc.).
  const [preview, setPreview] = useState<ParsedRow[] | null>(null)
  const [importError, setImportError] = useState<string>('')
  const [filterKind, setFilterKind] = useState<'all' | EventKind>('all')
  const [filterPeriod, setFilterPeriod] = useState<
    'all' | 'upcoming' | 'week' | 'month' | 'past' | 'past-week' | 'past-month' | 'past-year'
  >('all')
  const [page, setPage] = useState(1)

  // Only board-added events can be deleted from this admin view —
  // the in-code holiday set isn't user-editable. `stored` now comes from
  // the DB hook above.
  const sortedStored = useMemo(
    () => [...stored].sort((a, b) => a.date.localeCompare(b.date)),
    [stored]
  )
  const visibleStored = useMemo(() => {
    const today = new Date()
    const todayISO = today.toISOString().slice(0, 10)
    // Start of this week (Sun) and end (Sat).
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay())
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
    const weekStartISO = weekStart.toISOString().slice(0, 10)
    const weekEndISO = weekEnd.toISOString().slice(0, 10)
    // First/last day of this month.
    const monthStartISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const monthEndISO = monthEnd.toISOString().slice(0, 10)
    // Rolling past windows — last 7 / 30 / 365 days, not calendar-aligned.
    const dayMs = 24 * 60 * 60 * 1000
    const pastWeekStartISO  = new Date(today.getTime() -   7 * dayMs).toISOString().slice(0, 10)
    const pastMonthStartISO = new Date(today.getTime() -  30 * dayMs).toISOString().slice(0, 10)
    const pastYearStartISO  = new Date(today.getTime() - 365 * dayMs).toISOString().slice(0, 10)

    return sortedStored.filter(e => {
      if (filterKind !== 'all' && e.kind !== filterKind) return false
      switch (filterPeriod) {
        case 'upcoming':   return e.date >= todayISO
        case 'week':       return e.date >= weekStartISO  && e.date <= weekEndISO
        case 'month':      return e.date >= monthStartISO && e.date <= monthEndISO
        case 'past':       return e.date <  todayISO
        case 'past-week':  return e.date <  todayISO && e.date >= pastWeekStartISO
        case 'past-month': return e.date <  todayISO && e.date >= pastMonthStartISO
        case 'past-year':  return e.date <  todayISO && e.date >= pastYearStartISO
        default:           return true
      }
    })
  }, [sortedStored, filterKind, filterPeriod])
  // Count per kind so the dropdown can show "Board Meeting (2)".
  const kindCounts = useMemo(() => {
    const map: Partial<Record<EventKind, number>> = {}
    for (const e of stored) map[e.kind] = (map[e.kind] || 0) + 1
    return map
  }, [stored])

  // Auto-dismiss the green confirmation banner after 4s so it never lingers.
  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const onChange = (k: keyof EmptyForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [k]: e.target.value }))
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.date) {
      setError('Title and date are required.')
      return
    }
    const title = form.title.trim()
    try {
      // notify:true (default) fires a bell notice to every resident.
      await addEvent({
        kind: form.kind,
        title,
        date: form.date,
        time: form.time.trim() || undefined,
        vendor: form.vendor.trim() || undefined,
        location: form.location.trim() || undefined,
      })
      setForm(EMPTY_FORM)
      setError('')
      setSuccessMsg(`Added "${title}" to the calendar. Residents have been notified.`)
    } catch (err: any) {
      setError(err?.message || 'Could not add the event.')
    }
  }

  const onDelete = async (id: string) => {
    if (!window.confirm('Remove this event from the calendar?')) return
    try {
      await removeEvent(id)
      setSuccessMsg('Event removed.')
    } catch (err: any) {
      setError(err?.message || 'Could not remove the event.')
    }
  }

  const onPickPdf = (e: ChangeEvent<HTMLInputElement>) => {
    setPdfFile(e.target.files?.[0] || null)
    setPdfStatus('')
  }
  const onPickXls = (e: ChangeEvent<HTMLInputElement>) => {
    setXlsFile(e.target.files?.[0] || null)
    setPreview(null)
    setImportError('')
  }
  const importPdf = () => {
    if (!pdfFile) return
    // PDF date/title extraction needs document parsing we don't have yet —
    // it belongs with Genie's AI document-ingestion work, not a one-off here.
    // Same deferral as the Rules page. Use the CSV path for now.
    setPdfStatus(`Received ${pdfFile.name} — PDF parsing isn't wired yet. For now, export your schedule as CSV and use the box to the right.`)
  }
  // Read the picked CSV and stage the parsed rows for confirmation. We never
  // land events straight from a file — the board reviews the preview first.
  const importXls = () => {
    if (!xlsFile) return
    setImportError('')
    setPreview(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      // A real .xlsx is a binary zip (starts with the "PK" signature) — reading
      // it as text yields control characters. Detect that and steer the board to
      // CSV instead of dumping junk into the preview. (Tab/newline are allowed.)
      const head = text.slice(0, 2000)
      if (text.startsWith('PK') || /[\u0000-\u0008\u000E-\u001F]/.test(head)) {
        setImportError('That looks like a binary Excel file. Open it in Excel/Sheets, choose "Save as CSV", then upload that.')
        return
      }
      const rows = parseScheduleCsv(text)
      if (!rows.length) {
        setImportError('No rows found. Expected columns: title, date, kind, time, vendor, location.')
        return
      }
      setPreview(rows)
    }
    reader.onerror = () => setImportError('Could not read that file.')
    reader.readAsText(xlsFile)
  }
  // Land every valid parsed row on the calendar, then clear the staging area.
  const confirmImport = async () => {
    if (!preview) return
    const good = preview.filter(r => r.ok)
    try {
      // notify:false on bulk import — one notice per CSV row would flood the
      // bell. The events still land live on everyone's calendar.
      for (const r of good) {
        await addEvent({
          kind: r.kind,
          title: r.title,
          date: r.date,
          time: r.time,
          vendor: r.vendor,
          location: r.location,
        }, { notify: false })
      }
      setPreview(null)
      setXlsFile(null)
      setImportError('')
      setSuccessMsg(`Added ${good.length} event${good.length === 1 ? '' : 's'} from the file.`)
    } catch (err: any) {
      setImportError(err?.message || 'Could not import all rows.')
    }
  }
  const cancelImport = () => {
    setPreview(null)
    setImportError('')
  }

  const okCount = preview ? preview.filter(r => r.ok).length : 0

  return (
    <div className="admin-schedule">
      <div className="admin-h-wrap">
        <div className="admin-kicker">Schedule</div>
        <h1 className="admin-h1">Community calendar</h1>
        <p className="admin-dek">
          Add events to the community calendar one at a time, or upload a CSV
          to bulk-import. Anything you add here shows up on every
          resident&rsquo;s <strong>Schedule</strong> tab and the dashboard&rsquo;s
          &ldquo;Up next&rdquo; rail.
        </p>
      </div>

      {error && <div className="admin-note admin-note-err">{error}</div>}
      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {/* ---------- ADD ONE ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>Add an event</h2>
          <span className="admin-sched-card-sub">Manual entry, one at a time.</span>
        </div>
        <form className="admin-sched-form" onSubmit={onSubmit}>
          <label className="admin-field">
            <span>Title</span>
            <input
              name="title"
              type="text"
              value={form.title}
              onChange={onChange('title')}
              placeholder="e.g. Pool reopening, Annual board meeting"
              required
            />
          </label>

          <div className="admin-field">
            <span>Kind</span>
            <Dropdown<EventKind>
              value={form.kind}
              onChange={v => setForm(prev => ({ ...prev, kind: v }))}
              options={ALL_KINDS.map(k => ({ value: k, label: KIND_LABEL[k] }))}
              ariaLabel="Event kind"
            />
          </div>

          <label className="admin-field">
            <span>Date</span>
            <input name="date" type="date" value={form.date} onChange={onChange('date')} required />
          </label>

          <label className="admin-field">
            <span>Time <em>(optional)</em></span>
            <input
              name="time"
              type="text"
              value={form.time}
              onChange={onChange('time')}
              placeholder="7:00 PM, 8:00 AM – 12:00 PM, All day"
            />
          </label>

          <label className="admin-field">
            <span>Vendor <em>(optional)</em></span>
            <input
              name="vendor"
              type="text"
              value={form.vendor}
              onChange={onChange('vendor')}
              placeholder="e.g. SeaCare Pools"
            />
          </label>

          <label className="admin-field">
            <span>Location <em>(optional)</em></span>
            <input
              name="location"
              type="text"
              value={form.location}
              onChange={onChange('location')}
              placeholder="e.g. Clubhouse, Pavilion"
            />
          </label>

          <div className="admin-sched-form-foot">
            <button type="submit" className="admin-primary-btn">Add to calendar</button>
          </div>
        </form>
      </section>

      {/* ---------- BULK UPLOAD ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>Bulk upload</h2>
          <span className="admin-sched-card-sub">
            Got a schedule on paper or in a spreadsheet? Drop it here.
          </span>
        </div>

        <div className="admin-sched-bulk">
          <BulkBox
            kind="pdf"
            title="PDF schedule"
            sub="A flyer, memo, or quarterly newsletter — automatic date extraction is coming soon."
            accept="application/pdf"
            file={pdfFile}
            note={pdfStatus}
            onPick={onPickPdf}
            onImport={importPdf}
          />
          <BulkBox
            kind="xls"
            title="Spreadsheet (CSV)"
            sub="Columns: title, date, kind, time, vendor, location. Header row optional. Export Excel sheets as CSV first."
            accept=".csv,text/csv"
            file={xlsFile}
            note={importError}
            noteTone="err"
            onPick={onPickXls}
            onImport={importXls}
          />
        </div>
      </section>

      {/* ---------- REVIEW IMPORT ---------- */}
      {preview && (
        <section className="admin-sched-card">
          <div className="admin-sched-card-head">
            <h2>Review import</h2>
            <span className="admin-sched-card-sub">
              {okCount} of {preview.length} row{preview.length === 1 ? '' : 's'} ready —
              check them before they land on the calendar.
            </span>
          </div>
          <div className="admin-sched-list">
            {preview.map((r, i) => (
              <div key={i} className="admin-sched-row">
                <span className={`sched-dot kind-${r.kind}`} aria-hidden="true" />
                <div className="admin-sched-row-body">
                  <div className="admin-sched-row-title">
                    {r.title || <em>(missing title)</em>}
                  </div>
                  <div className="admin-sched-row-meta">
                    {r.ok ? (
                      <>
                        {KIND_LABEL[r.kind]} · {r.date}
                        {r.time && <> · {r.time}</>}
                        {r.vendor && <> · {r.vendor}</>}
                        {r.location && <> · {r.location}</>}
                      </>
                    ) : (
                      <span className="admin-err-inline">
                        {r.title ? `Couldn’t read the date${r.raw ? ` “${r.raw}”` : ''}` : 'Missing title'} — will be skipped
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="admin-sched-form-foot" style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="admin-primary-btn"
              onClick={confirmImport}
              disabled={okCount === 0}
            >
              Add {okCount} event{okCount === 1 ? '' : 's'}
            </button>
            <button type="button" className="admin-btn-ghost" onClick={cancelImport}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* ---------- WHAT YOU'VE ADDED ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>Events you&rsquo;ve added</h2>
          <div className="admin-sched-filters">
            <div className="admin-sched-filter">
              <label>Category</label>
              <Dropdown<'all' | EventKind>
                value={filterKind}
                onChange={setFilterKind}
                ariaLabel="Filter by category"
                options={[
                  { value: 'all', label: `All (${stored.length})` },
                  ...ALL_KINDS.map(k => ({
                    value: k as 'all' | EventKind,
                    label: `${KIND_LABEL[k]} (${kindCounts[k] || 0})`,
                  })),
                ]}
              />
            </div>
            <div className="admin-sched-filter">
              <label>Time period</label>
              <Dropdown<typeof filterPeriod>
                value={filterPeriod}
                onChange={setFilterPeriod}
                ariaLabel="Filter by time period"
                options={[
                  { value: 'all',        label: 'All time' },
                  { value: 'upcoming',   label: 'Upcoming' },
                  { value: 'week',       label: 'This week' },
                  { value: 'month',      label: 'This month' },
                  { value: 'past',       label: 'Past (all)' },
                  { value: 'past-week',  label: 'Past week' },
                  { value: 'past-month', label: 'Past month' },
                  { value: 'past-year',  label: 'Past year' },
                ]}
              />
            </div>
          </div>
        </div>
        {stored.length === 0 ? (
          <div className="admin-sched-empty">Nothing added yet. Add one above.</div>
        ) : visibleStored.length === 0 ? (
          <div className="admin-sched-empty">
            No events match these filters.{' '}
            <button
              type="button"
              className="admin-sched-empty-link"
              onClick={() => { setFilterKind('all'); setFilterPeriod('all') }}
            >
              Show all
            </button>
          </div>
        ) : (
          <>
            <div className="admin-sched-list">
              {paginate(visibleStored, page, EVENTS_PAGE_SIZE).map(e => (
                <div key={e.id} className="admin-sched-row">
                  <span className={`sched-dot kind-${e.kind}`} aria-hidden="true" />
                  <div className="admin-sched-row-body">
                    <div className="admin-sched-row-title">{e.title}</div>
                    <div className="admin-sched-row-meta">
                      {KIND_LABEL[e.kind]} · {e.date}
                      {e.time && <> · {e.time}</>}
                      {e.vendor && <> · {e.vendor}</>}
                      {e.location && <> · {e.location}</>}
                    </div>
                  </div>
                  <button
                    className="admin-sched-row-del"
                    onClick={() => onDelete(e.id)}
                    aria-label={`Delete ${e.title}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <Pagination
              page={page}
              pageSize={EVENTS_PAGE_SIZE}
              total={visibleStored.length}
              onPageChange={setPage}
            />
          </>
        )}
      </section>
    </div>
  )
}

function BulkBox({
  kind, title, sub, accept, file, note, noteTone = 'ok', onPick, onImport,
}: {
  kind: 'pdf' | 'xls'
  title: string
  sub: string
  accept: string
  file: File | null
  note?: string
  noteTone?: 'ok' | 'err'
  onPick: (e: ChangeEvent<HTMLInputElement>) => void
  onImport: () => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <div className={`admin-bulk-box admin-bulk-${kind}`}>
      <div className="admin-bulk-icon" aria-hidden="true">
        {kind === 'pdf' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
            <text x="7" y="17" fontSize="6" fontWeight="700" fill="currentColor" stroke="none">PDF</text>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
            <path d="M8 13h8M8 16h8M8 19h5" />
          </svg>
        )}
      </div>
      <div className="admin-bulk-body">
        <div className="admin-bulk-title">{title}</div>
        <div className="admin-bulk-sub">{sub}</div>
        {file && <div className="admin-bulk-file">{file.name}</div>}
        {note && (
          <div
            className="admin-bulk-file"
            style={noteTone === 'err'
              ? { background: 'rgba(176, 58, 46, 0.12)', color: '#9B2C22' }
              : { background: 'rgba(125,140,92,0.14)' }}
          >
            {note}
          </div>
        )}
        <div className="admin-bulk-actions">
          <input
            name="bulk-upload"
            ref={ref}
            type="file"
            accept={accept}
            onChange={onPick}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="admin-secondary-btn"
            onClick={() => ref.current?.click()}
          >
            {file ? 'Pick another file' : 'Choose file'}
          </button>
          <button
            type="button"
            className="admin-primary-btn"
            onClick={onImport}
            disabled={!file}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )
}
