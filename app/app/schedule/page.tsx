'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ALL_KINDS,
  EventKind,
  KIND_LABEL,
  ScheduleEvent,
  useScheduleEvents,
} from '@/lib/schedule'
import { usePreferences } from '@/lib/preferences'

const WEEKDAYS_SUN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const WEEKDAYS_MON = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function toISO(y: number, m: number, d: number) {
  const mm = String(m + 1).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}
function fmtMonth(y: number, m: number) {
  return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
function fmtFullDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric',
  })
}
function fmtWeekday(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
}
// "Today", "Yesterday", "Tomorrow", or the weekday name for anything else.
function relativeDayLabel(selectedISO: string, todayISO: string) {
  const sel = new Date(selectedISO + 'T00:00:00').getTime()
  const today = new Date(todayISO + 'T00:00:00').getTime()
  const diff = Math.round((sel - today) / (24 * 60 * 60 * 1000))
  if (diff === 0)  return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1)  return 'Tomorrow'
  return fmtWeekday(selectedISO)
}

export default function Schedule() {
  // Demo "today" pinned to May 28, 2026 so the mockup matches. Swap to
  // `new Date()` once real data is wired.
  const today = new Date(2026, 4, 28)
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [selected, setSelected] = useState<string>(toISO(today.getFullYear(), today.getMonth(), today.getDate()))
  const [enabledKinds, setEnabledKinds] = useState<Set<EventKind>>(new Set(ALL_KINDS))

  const allEvents = useScheduleEvents()
  const [prefs] = usePreferences()
  const startDay = prefs.calendar_week_start === 'mon' ? 1 : 0
  const WEEKDAYS = startDay === 1 ? WEEKDAYS_MON : WEEKDAYS_SUN
  const events = useMemo(
    () => allEvents.filter(e => enabledKinds.has(e.kind)),
    [allEvents, enabledKinds]
  )

  const byDate = useMemo(() => {
    const map: Record<string, ScheduleEvent[]> = {}
    for (const e of events) (map[e.date] ||= []).push(e)
    return map
  }, [events])

  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate())

  // Visible month grid — start day governed by Settings → Calendar
  // (Sunday by default, Monday if the resident opted in).
  const monthStart = new Date(cursor.y, cursor.m, 1)
  const leadingBlanks = (monthStart.getDay() - startDay + 7) % 7
  const totalDays = daysInMonth(cursor.y, cursor.m)
  const cells: ({ day: number; iso: string } | null)[] = []
  for (let i = 0; i < leadingBlanks; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push({ day: d, iso: toISO(cursor.y, cursor.m, d) })
  while (cells.length % 7 !== 0) cells.push(null)

  const go = (delta: number) => {
    let m = cursor.m + delta
    let y = cursor.y
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setCursor({ y, m })
  }

  const goToday = () => {
    setCursor({ y: today.getFullYear(), m: today.getMonth() })
    setSelected(todayISO)
  }

  const toggleKind = (k: EventKind) => {
    setEnabledKinds(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

  const selectedEvents = byDate[selected] || []
  const todayCount = (byDate[todayISO] || []).length

  return (
    <div className="sched-wrap">
      {/* Page title — bare on the page background, no banner */}
      <section className="sched-hero">
        <div className="sched-hero-content">
          <h1 className="sched-hero-title">Schedule</h1>
          <div className="sched-hero-sub">Everything happening in your community.</div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="sched-toolbar">
        <button className="sched-today-btn" onClick={goToday}>
          {relativeDayLabel(selected, todayISO)} · {fmtFullDate(selected)}
        </button>
        <div className="sched-monthnav">
          <button className="sched-nav-btn" onClick={() => go(-1)} aria-label="Previous month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button className="sched-monthnav-title" aria-label="Pick a month">
            {fmtMonth(cursor.y, cursor.m)}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button className="sched-nav-btn" onClick={() => go(1)} aria-label="Next month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="sched-views">
          {['Month', 'Week', 'Day'].map(v => (
            <button
              key={v}
              className={`sched-view-btn${v === 'Month' ? ' active' : ''}`}
              disabled={v !== 'Month'}
              title={v !== 'Month' ? 'Coming soon' : undefined}
            >
              {v}
            </button>
          ))}
        </div>

        <button className="sched-filter-btn" aria-label="Filter events">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18l-7 9v6l-4-2v-4z" />
          </svg>
          Filter
        </button>

        <div className="sched-toolbar-today">
          <div className="sched-toolbar-today-label">Today · {fmtFullDate(todayISO)}</div>
          <div className="sched-toolbar-today-count">{todayCount} events</div>
        </div>
      </div>

      <div className="sched-layout">
        {/* Calendar */}
        <div className="sched-cal">
          <div className="sched-weekdays">
            {WEEKDAYS.map(w => <div key={w} className="sched-weekday">{w}</div>)}
          </div>
          <div className="sched-grid">
            {cells.map((cell, i) => {
              if (!cell) return <div key={i} className="sched-cell empty" />
              const dayEvents = byDate[cell.iso] || []
              const isToday = cell.iso === todayISO
              const isSelected = cell.iso === selected
              const visible = dayEvents.slice(0, 3)
              const overflow = dayEvents.length - visible.length
              return (
                <button
                  key={i}
                  className={`sched-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${dayEvents.length ? ' has-events' : ''}`}
                  onClick={() => setSelected(cell.iso)}
                >
                  <div className="sched-cell-day">{cell.day}</div>
                  <div className="sched-cell-events">
                    {visible.map(e => (
                      <div key={e.id} className={`sched-pill kind-${e.kind}`}>
                        <span className={`sched-dot kind-${e.kind}`} />
                        <span className="sched-pill-title">{e.title}</span>
                      </div>
                    ))}
                    {overflow > 0 && (
                      <div className="sched-pill-more">+{overflow} more</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="sched-legend">
            {ALL_KINDS.map(k => (
              <span key={k} className="sched-legend-item">
                <span className={`sched-dot kind-${k}`} />
                {KIND_LABEL[k]}
              </span>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <aside className="sched-side">
          <div className="sched-side-card">
            <div className="sched-side-head">
              <div>
                <div className="sched-side-eyebrow">
                  {relativeDayLabel(selected, todayISO)} · {fmtFullDate(selected)}
                </div>
                <div className="sched-side-count">
                  <span className="sched-side-check" aria-hidden="true">✓</span>
                  {selectedEvents.length} event{selectedEvents.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="sched-side-list">
              {selectedEvents.length === 0 && (
                <div className="sched-side-empty">Nothing scheduled.</div>
              )}
              {selectedEvents.map(e => (
                <EventRow key={e.id} e={e} />
              ))}
            </div>
          </div>

          <div className="sched-side-card">
            <div className="sched-filters-head">
              <span>Filters</span>
              <button
                className="sched-filters-clear"
                onClick={() => setEnabledKinds(new Set(ALL_KINDS))}
              >
                Reset
              </button>
            </div>
            <div className="sched-filters-list">
              {ALL_KINDS.map(k => {
                const on = enabledKinds.has(k)
                return (
                  <label key={k} className={`sched-filter${on ? ' on' : ''}`}>
                    <input
                      name={`kind-${k}`}
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleKind(k)}
                    />
                    <span className={`sched-dot kind-${k}`} />
                    <span>{KIND_LABEL[k]}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="sched-subscribe">
            <div className="sched-subscribe-title">Subscribe to calendar</div>
            <div className="sched-subscribe-sub">
              Sync this calendar to your phone or computer.
            </div>
            <div className="sched-subscribe-row">
              <button className="sched-subscribe-btn">Apple / .ics</button>
              <button className="sched-subscribe-btn">Google</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function EventRow({ e }: { e: ScheduleEvent }) {
  const body = (
    <>
      <span className={`sched-row-stripe kind-${e.kind}`} aria-hidden="true" />
      <div className="sched-row-body">
        <div className="sched-row-kind">{KIND_LABEL[e.kind]}</div>
        <div className="sched-row-title">{e.title}</div>
        <div className="sched-row-meta">
          {e.time && <span>{e.time}</span>}
          {e.vendor && <><span className="sched-row-dot">·</span><span>{e.vendor}</span></>}
          {e.location && <><span className="sched-row-dot">·</span><span>{e.location}</span></>}
        </div>
      </div>
      {e.href && (
        <svg className="sched-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </>
  )

  return e.href ? (
    <Link href={e.href} className="sched-row">{body}</Link>
  ) : (
    <div className="sched-row">{body}</div>
  )
}
