'use client'

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from 'react'
import {
  ALL_KINDS,
  EventKind,
  KIND_LABEL,
  ScheduleEvent,
  addStoredEvent,
  getStoredEvents,
  removeStoredEvent,
  useScheduleEvents,
} from '@/lib/schedule'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const EVENTS_PAGE_SIZE = 8

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

// Admin → Schedule. Board can add events one-off (form) or in bulk via
// PDF / Excel upload. Everything they add shows up on the resident-facing
// /app/schedule page and the dashboard's "Up next" rail.
export default function AdminSchedule() {
  const allEvents = useScheduleEvents()
  const [form, setForm] = useState<EmptyForm>(EMPTY_FORM)
  const [status, setStatus] = useState<string>('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [xlsFile, setXlsFile] = useState<File | null>(null)
  const [filterKind, setFilterKind] = useState<'all' | EventKind>('all')
  const [filterPeriod, setFilterPeriod] = useState<
    'all' | 'upcoming' | 'week' | 'month' | 'past' | 'past-week' | 'past-month' | 'past-year'
  >('all')
  const [page, setPage] = useState(1)

  // Only board-added events can be deleted from this admin view —
  // the seeded demo/holiday set lives in code and isn't user-editable.
  const stored = useMemo(() => {
    if (typeof window === 'undefined') return [] as ScheduleEvent[]
    return getStoredEvents()
  }, [allEvents])
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

  const onChange = (k: keyof EmptyForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [k]: e.target.value }))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.date) {
      setStatus('Title and date are required.')
      return
    }
    addStoredEvent({
      kind: form.kind,
      title: form.title.trim(),
      date: form.date,
      time: form.time.trim() || undefined,
      vendor: form.vendor.trim() || undefined,
      location: form.location.trim() || undefined,
    })
    setForm(EMPTY_FORM)
    setStatus(`Added "${form.title.trim()}" to the calendar.`)
    setTimeout(() => setStatus(''), 4000)
  }

  const onDelete = (id: string) => {
    if (!window.confirm('Remove this event from the calendar?')) return
    removeStoredEvent(id)
    setStatus('Event removed.')
    setTimeout(() => setStatus(''), 3000)
  }

  const onPickPdf = (e: ChangeEvent<HTMLInputElement>) => {
    setPdfFile(e.target.files?.[0] || null)
  }
  const onPickXls = (e: ChangeEvent<HTMLInputElement>) => {
    setXlsFile(e.target.files?.[0] || null)
  }
  const importPdf = () => {
    if (!pdfFile) return
    // TODO: wire to a parser route (e.g. /api/parse-schedule-pdf) that
    // returns a list of {kind, title, date, ...} for the board to confirm
    // before they land on the calendar. For now this is the upload stub.
    setStatus(`Received ${pdfFile.name} — PDF parsing isn't wired yet, but the file is ready.`)
  }
  const importXls = () => {
    if (!xlsFile) return
    // TODO: wire to xlsx (SheetJS) parser. Expected columns: title, date,
    // kind, time, vendor, location. For now this is the upload stub.
    setStatus(`Received ${xlsFile.name} — Excel parsing isn't wired yet, but the file is ready.`)
  }

  return (
    <div className="admin-schedule">
      <div className="admin-h-wrap">
        <h1 className="admin-h1">Schedule</h1>
        <p className="admin-dek">
          Add events to the community calendar one at a time, or upload a PDF
          / Excel file to bulk-import. Anything you add here shows up on every
          resident&rsquo;s <strong>Schedule</strong> tab and the dashboard&rsquo;s
          &ldquo;Up next&rdquo; rail.
        </p>
      </div>

      {status && <div className="admin-sched-status">{status}</div>}

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
            <input type="date" value={form.date} onChange={onChange('date')} required />
          </label>

          <label className="admin-field">
            <span>Time <em>(optional)</em></span>
            <input
              type="text"
              value={form.time}
              onChange={onChange('time')}
              placeholder="7:00 PM, 8:00 AM – 12:00 PM, All day"
            />
          </label>

          <label className="admin-field">
            <span>Vendor <em>(optional)</em></span>
            <input
              type="text"
              value={form.vendor}
              onChange={onChange('vendor')}
              placeholder="e.g. SeaCare Pools"
            />
          </label>

          <label className="admin-field">
            <span>Location <em>(optional)</em></span>
            <input
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
            sub="A flyer, memo, or quarterly newsletter — we&rsquo;ll pull dates and titles out automatically."
            accept="application/pdf"
            file={pdfFile}
            onPick={onPickPdf}
            onImport={importPdf}
          />
          <BulkBox
            kind="xls"
            title="Excel / CSV"
            sub="Columns: title, date, kind, time, vendor, location. The first row should be the header."
            accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            file={xlsFile}
            onPick={onPickXls}
            onImport={importXls}
          />
        </div>
      </section>

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
  kind, title, sub, accept, file, onPick, onImport,
}: {
  kind: 'pdf' | 'xls'
  title: string
  sub: string
  accept: string
  file: File | null
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
        <div className="admin-bulk-actions">
          <input
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
