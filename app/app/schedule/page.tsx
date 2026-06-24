'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ALL_KINDS,
  EventKind,
  KIND_LABEL,
  ScheduleEvent,
  useScheduleEvents,
} from '@/lib/schedule'
import { usePreferences } from '@/lib/preferences'
import { downloadICS, addToGoogle } from '@/lib/ics'
import { useT } from '@/lib/i18n'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { AmenitiesSection } from './_sections/AmenitiesSection'

const WEEKDAYS_SUN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const WEEKDAYS_MON = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function toISO(y: number, m: number, d: number) {
  const mm = String(m + 1).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}
// Shift an ISO date by N days (handles month/year rollover).
function shiftISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toISO(d.getFullYear(), d.getMonth(), d.getDate())
}
function fmtWeekdayShort(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })
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
function relativeDayLabel(selectedISO: string, todayISO: string, t: (k: string) => string) {
  const sel = new Date(selectedISO + 'T00:00:00').getTime()
  const today = new Date(todayISO + 'T00:00:00').getTime()
  const diff = Math.round((sel - today) / (24 * 60 * 60 * 1000))
  if (diff === 0)  return t('schedule.today')
  if (diff === -1) return t('schedule.yesterday')
  if (diff === 1)  return t('schedule.tomorrow')
  return fmtWeekday(selectedISO)
}

// Easy Schedule is two tabs: the community Calendar and the bookable
// Amenities catalog. The hero + segmented control live in the wrapper so they
// persist across both; each tab renders its own body below.
export default function Schedule() {
  const t = useT()
  const [tab, setTab] = useState('calendar')
  const TABS: SegTab[] = [
    { id: 'calendar', label: t('schedule.tabCalendar') },
    { id: 'amenities', label: t('schedule.tabAmenities') },
  ]
  return (
    <div className="sched-wrap">
      <section className="sched-hero">
        <div className="sched-hero-content">
          <h1 className="sched-hero-title">Easy Schedule</h1>
          <div className="sched-hero-sub">
            {tab === 'amenities'
              ? t('schedule.heroSubAmenities')
              : t('schedule.heroSubCalendar')}
          </div>
        </div>
      </section>

      <div className="sched-tabs">
        <SegTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel={t('schedule.sectionsAria')} />
      </div>

      {tab === 'amenities' ? <AmenitiesSection /> : <CalendarView />}
    </div>
  )
}

function CalendarView() {
  const t = useT()
  // Real wall-clock "today" — drives the highlighted cell, the Today button,
  // and the relative-day labels.
  const today = new Date()
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [selected, setSelected] = useState<string>(toISO(today.getFullYear(), today.getMonth(), today.getDate()))
  const [enabledKinds, setEnabledKinds] = useState<Set<EventKind>>(new Set(ALL_KINDS))
  // Month (full grid) / Week (7 day-sections) / Day (single-day list).
  const [view, setView] = useState<'Month' | 'Week' | 'Day'>('Month')
  // Filter popup (the toolbar Filter button opens it — works on phones where the
  // side filter card isn't visible).
  const [filterOpen, setFilterOpen] = useState(false)

  // Hover tooltip — shows everything happening on a day (the cell only fits 3
  // pills). Follows the cursor; flips to the other side of the pointer when it
  // would run off the right/bottom edge so it always stays on-screen.
  const [tip, setTip] = useState<
    { x: number; y: number; date: string; events: ScheduleEvent[] } | null
  >(null)
  // Single grid-level tracker: find the day cell under the cursor and keep the
  // tooltip pinned next to the pointer as it moves (standard cursor-tooltip
  // behavior), continuous across cells. Hides over empty days/gaps.
  const gridMove = (e: React.MouseEvent) => {
    const cellEl = (e.target as HTMLElement).closest('.sched-cell') as HTMLElement | null
    const date = cellEl?.dataset.iso
    const events = date ? byDate[date] : undefined
    if (!date || !events || events.length === 0) { setTip(null); return }
    const vw = window.innerWidth, vh = window.innerHeight
    const tw = 280, th = 44 + events.length * 22   // approx tooltip size
    const gap = 14
    let x = e.clientX + gap
    let y = e.clientY + gap
    if (x + tw + 8 > vw) x = e.clientX - tw - gap   // flip to the left of the cursor
    if (y + th + 8 > vh) y = e.clientY - th - gap    // flip above the cursor
    setTip({ x: Math.max(8, x), y: Math.max(8, y), date, events })
  }
  const hideTip = () => setTip(null)

  // Clicking a day opens its events as a modal — the hover tooltip's content,
  // expanded. Dismiss by clicking the backdrop or pressing Esc.
  const [modal, setModal] = useState<{ date: string; events: ScheduleEvent[] } | null>(null)
  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

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

  // Prev/next steps by the active view: a month, a week, or a day.
  const go = (delta: number) => {
    if (view === 'Month') {
      let m = cursor.m + delta
      let y = cursor.y
      if (m < 0) { m = 11; y-- }
      if (m > 11) { m = 0; y++ }
      setCursor({ y, m })
      return
    }
    const next = shiftISO(selected, delta * (view === 'Week' ? 7 : 1))
    const d = new Date(next + 'T00:00:00')
    setSelected(next)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }

  const goToday = () => {
    setCursor({ y: today.getFullYear(), m: today.getMonth() })
    setSelected(todayISO)
  }

  // The 7 dates of the week containing the selected day (respects week-start pref).
  const weekDays = useMemo(() => {
    const d = new Date(selected + 'T00:00:00')
    const dow = (d.getDay() - startDay + 7) % 7
    const start = new Date(d); start.setDate(d.getDate() - dow)
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(start); x.setDate(start.getDate() + i)
      return toISO(x.getFullYear(), x.getMonth(), x.getDate())
    })
  }, [selected, startDay])

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
    <>
      {/* Toolbar — desktop keeps the horizontal strip; phones get today's
          three stacked rows (see the .rsv-mob block below). */}
      <div className="rsv-web">
      <div className="sched-toolbar">
        <button className="sched-today-btn" onClick={goToday}>
          {relativeDayLabel(selected, todayISO, t)} · {fmtFullDate(selected)}
        </button>
        <div className="sched-monthnav">
          <button className="sched-nav-btn" onClick={() => go(-1)} aria-label={t('schedule.prevMonth')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button className="sched-monthnav-title" aria-label={t('schedule.pickMonth')}>
            {fmtMonth(cursor.y, cursor.m)}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button className="sched-nav-btn" onClick={() => go(1)} aria-label={t('schedule.nextMonth')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="sched-views">
          {[
            { id: 'Month', label: t('schedule.viewMonth') },
            { id: 'Week', label: t('schedule.viewWeek') },
            { id: 'Day', label: t('schedule.viewDay') },
          ].map(v => (
            <button
              key={v.id}
              className={`sched-view-btn${v.id === view ? ' active' : ''}`}
              onClick={() => setView(v.id as 'Month' | 'Week' | 'Day')}
            >
              {v.label}
            </button>
          ))}
        </div>

        <button className="sched-filter-btn" aria-label={t('schedule.filterEvents')} onClick={() => setFilterOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18l-7 9v6l-4-2v-4z" />
          </svg>
          {t('schedule.filter')}
        </button>

        <div className="sched-toolbar-today">
          <div className="sched-toolbar-today-label">{t('schedule.today')} · {fmtFullDate(todayISO)}</div>
          <div className="sched-toolbar-today-count">{t('schedule.eventsCount', { count: todayCount })}</div>
        </div>
      </div>
      </div>

      {/* Phone toolbar — today's three stacked rows: month nav + Today,
          view toggle + Filter, then the selected-day summary. */}
      <div className="rsv-mob">
      <div className="sched-toolbar">
        <div className="sched-toolbar-row">
          <div className="sched-monthnav">
            <button className="sched-nav-btn" onClick={() => go(-1)} aria-label={t('schedule.prevMonth')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button className="sched-monthnav-title" aria-label={t('schedule.pickMonth')}>
              {fmtMonth(cursor.y, cursor.m)}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button className="sched-nav-btn" onClick={() => go(1)} aria-label={t('schedule.nextMonth')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          <button className="sched-today-btn" onClick={goToday}>{t('schedule.today')}</button>
        </div>

        <div className="sched-toolbar-row">
          <div className="sched-views">
            {[
              { id: 'Month', label: t('schedule.viewMonth') },
              { id: 'Week', label: t('schedule.viewWeek') },
              { id: 'Day', label: t('schedule.viewDay') },
            ].map(v => (
              <button
                key={v.id}
                className={`sched-view-btn${v.id === view ? ' active' : ''}`}
                onClick={() => setView(v.id as 'Month' | 'Week' | 'Day')}
              >
                {v.label}
              </button>
            ))}
          </div>

          <button className="sched-filter-btn" aria-label={t('schedule.filterEvents')} onClick={() => setFilterOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5h18l-7 9v6l-4-2v-4z" />
            </svg>
            {t('schedule.filter')}
          </button>
        </div>

        <div className="sched-toolbar-today">
          <div className="sched-toolbar-today-label">{relativeDayLabel(selected, todayISO, t)} · {fmtFullDate(selected)}</div>
          <div className="sched-toolbar-today-count">{t('schedule.eventsCount', { count: selectedEvents.length })}</div>
        </div>
      </div>
      </div>

      <div className="sched-layout">
        {/* Calendar */}
        <div className="sched-cal">
          {view === 'Month' && (<>
          <div className="sched-weekdays">
            {WEEKDAYS.map(w => <div key={w} className="sched-weekday">{w}</div>)}
          </div>
          <div className="sched-grid" onMouseMove={gridMove} onMouseLeave={hideTip}>
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
                  data-iso={cell.iso}
                  className={`sched-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${dayEvents.length ? ' has-events' : ''}`}
                  onClick={() => {
                    setSelected(cell.iso)
                    setTip(null)
                    if (dayEvents.length) setModal({ date: cell.iso, events: dayEvents })
                  }}
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
          </>)}

          {/* WEEK — the seven days of the selected week, each with its events. */}
          {view === 'Week' && (
            <div className="sched-week">
              {weekDays.map(iso => {
                const dayEvents = byDate[iso] || []
                const d = new Date(iso + 'T00:00:00')
                return (
                  <div key={iso} className={`sched-week-day${iso === todayISO ? ' today' : ''}${iso === selected ? ' selected' : ''}`}>
                    <button className="sched-week-dayhead" onClick={() => setSelected(iso)}>
                      <span className="sched-week-dow">{fmtWeekdayShort(iso)}</span>
                      <span className="sched-week-date">{d.getDate()}</span>
                      <span className="sched-week-count">{dayEvents.length ? t('schedule.eventsCount', { count: dayEvents.length }) : ''}</span>
                    </button>
                    <div className="sched-week-events">
                      {dayEvents.length === 0
                        ? <div className="sched-week-empty">{t('schedule.nothingScheduled')}</div>
                        : dayEvents.map(e => <EventRow key={e.id} e={e} />)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* DAY — the selected day's full event list. */}
          {view === 'Day' && (
            <div className="sched-day">
              <div className="sched-day-head">
                <span className="sched-day-title">{relativeDayLabel(selected, todayISO, t)} · {fmtFullDate(selected)}</span>
                <span className="sched-day-count">{t('schedule.eventsCount', { count: selectedEvents.length })}</span>
              </div>
              <div className="sched-day-events">
                {selectedEvents.length === 0
                  ? <div className="sched-week-empty">{t('schedule.nothingScheduled')}</div>
                  : selectedEvents.map(e => <EventRow key={e.id} e={e} />)}
              </div>
            </div>
          )}

          {/* Legend mirrors the active filters — unchecking a kind removes it
              here too, so what's under the calendar matches what's shown. */}
          <div className="sched-legend">
            {ALL_KINDS.filter(k => enabledKinds.has(k)).map(k => (
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
                  {relativeDayLabel(selected, todayISO, t)} · {fmtFullDate(selected)}
                </div>
                <div className="sched-side-count">
                  <span className="sched-side-check" aria-hidden="true">✓</span>
                  {t('schedule.eventsCount', { count: selectedEvents.length })}
                </div>
              </div>
            </div>

            <div className="sched-side-list">
              {selectedEvents.length === 0 && (
                <div className="sched-side-empty">{t('schedule.nothingScheduled')}</div>
              )}
              {selectedEvents.map(e => (
                <EventRow key={e.id} e={e} />
              ))}
            </div>
          </div>

          <div className="sched-subscribe">
            <div className="sched-subscribe-title">{t('schedule.subscribeTitle')}</div>
            <div className="sched-subscribe-sub">
              {t('schedule.subscribeSub')}
            </div>
            <div className="sched-subscribe-row">
              <button
                className="sched-subscribe-btn"
                onClick={() => downloadICS(allEvents, 'residente-calendar.ics', t('schedule.calName'))}
              >
                Apple / .ics
              </button>
              <button
                className="sched-subscribe-btn"
                onClick={() => addToGoogle(allEvents, 'residente-calendar.ics', t('schedule.calName'))}
              >
                Google
              </button>
            </div>
          </div>
        </aside>
      </div>

      {tip && (
        <div
          className="sched-cell-tip"
          role="tooltip"
          style={{ left: tip.x, top: tip.y }}
        >
          <div className="sched-cell-tip-head">{fmtFullDate(tip.date)}</div>
          {tip.events.map(e => (
            <div key={e.id} className="sched-cell-tip-row">
              <span className={`sched-dot kind-${e.kind}`} />
              <span className="sched-cell-tip-title">{e.title}</span>
              {e.time && <span className="sched-cell-tip-time">{e.time}</span>}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="sched-modal-backdrop" onClick={() => setModal(null)}>
          <div
            className="sched-modal"
            role="dialog"
            aria-modal="true"
            onClick={e => e.stopPropagation()}
          >
            <div className="sched-modal-head">
              <div className="sched-modal-title">
                {fmtWeekday(modal.date)} · {fmtFullDate(modal.date)}
              </div>
              <button className="sched-modal-close" aria-label={t('schedule.close')} onClick={() => setModal(null)}>×</button>
            </div>
            <div className="sched-modal-list">
              {modal.events.length === 0 ? (
                <div className="sched-modal-empty">{t('schedule.nothingScheduled')}</div>
              ) : (
                modal.events.map(e => (
                  <div key={e.id} className="sched-modal-row">
                    <span className={`sched-dot kind-${e.kind}`} />
                    <span className="sched-modal-kind">{KIND_LABEL[e.kind]}</span>
                    <span className="sched-modal-row-title">{e.title}</span>
                    {e.time && <span className="sched-modal-row-time">{e.time}</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter popup — opened by the toolbar Filter button (the side filter
          card isn't visible on phones). Toggles the same event-kind set. */}
      {filterOpen && (
        <div className="sched-modal-backdrop" onClick={() => setFilterOpen(false)}>
          <div className="sched-modal sched-filter-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="sched-modal-head">
              <div className="sched-modal-title">{t('schedule.filters')}</div>
              <button className="sched-modal-close" aria-label={t('schedule.close')} onClick={() => setFilterOpen(false)}>×</button>
            </div>
            <div className="sched-filters-list">
              {ALL_KINDS.map(k => {
                const on = enabledKinds.has(k)
                return (
                  <label key={k} className={`sched-filter${on ? ' on' : ''}`}>
                    <input name={`kind-m-${k}`} type="checkbox" checked={on} onChange={() => toggleKind(k)} />
                    <span className={`sched-dot kind-${k}`} />
                    <span>{KIND_LABEL[k]}</span>
                  </label>
                )
              })}
            </div>
            <div className="sched-filter-foot">
              <button className="sched-filters-clear" onClick={() => setEnabledKinds(new Set(ALL_KINDS))}>{t('schedule.reset')}</button>
              <button className="sched-filter-done" onClick={() => setFilterOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
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
