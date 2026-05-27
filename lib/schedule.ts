// Shared schedule events. Used by:
//   - app/app/schedule/page.tsx — the calendar grid + side panel
//   - app/app/layout.tsx (RightRail) — the dashboard's "Up Next" list
// Both surfaces pull from this single source so the dashboard's rail
// stays in sync with whatever the resident sees on the calendar.

export type EventKind = 'meeting' | 'vote' | 'dues' | 'maintenance' | 'event' | 'inspection' | 'holiday'

export type ScheduleEvent = {
  id: string
  kind: EventKind
  title: string
  date: string       // ISO date (YYYY-MM-DD)
  time?: string
  vendor?: string
  location?: string
  href?: string
}

export const KIND_LABEL: Record<EventKind, string> = {
  meeting:     'Board Meeting',
  vote:        'Votes / Decisions',
  dues:        'Dues',
  maintenance: 'Maintenance',
  event:       'Community Events',
  inspection:  'Inspections',
  holiday:     'Holidays',
}

export const ALL_KINDS: EventKind[] = ['meeting', 'vote', 'dues', 'maintenance', 'event', 'inspection', 'holiday']

// US holidays — federal + popular observances. Pre-populated so the
// calendar feels lived-in from day one and residents can see the dates
// the community will be celebrating / closed for.
export const US_HOLIDAYS_2026: ScheduleEvent[] = [
  { id: 'h26-01', kind: 'holiday', date: '2026-01-01', title: "New Year's Day" },
  { id: 'h26-02', kind: 'holiday', date: '2026-01-19', title: 'Martin Luther King Jr. Day' },
  { id: 'h26-03', kind: 'holiday', date: '2026-02-14', title: "Valentine's Day" },
  { id: 'h26-04', kind: 'holiday', date: '2026-02-16', title: 'Presidents Day' },
  { id: 'h26-05', kind: 'holiday', date: '2026-03-17', title: "St. Patrick's Day" },
  { id: 'h26-06', kind: 'holiday', date: '2026-04-05', title: 'Easter' },
  { id: 'h26-07', kind: 'holiday', date: '2026-05-10', title: "Mother's Day" },
  { id: 'h26-08', kind: 'holiday', date: '2026-05-25', title: 'Memorial Day' },
  { id: 'h26-09', kind: 'holiday', date: '2026-06-14', title: 'Flag Day' },
  { id: 'h26-10', kind: 'holiday', date: '2026-06-19', title: 'Juneteenth' },
  { id: 'h26-11', kind: 'holiday', date: '2026-06-21', title: "Father's Day" },
  { id: 'h26-12', kind: 'holiday', date: '2026-07-04', title: 'Independence Day' },
  { id: 'h26-13', kind: 'holiday', date: '2026-09-07', title: 'Labor Day' },
  { id: 'h26-14', kind: 'holiday', date: '2026-10-12', title: 'Columbus Day' },
  { id: 'h26-15', kind: 'holiday', date: '2026-10-31', title: 'Halloween' },
  { id: 'h26-16', kind: 'holiday', date: '2026-11-11', title: 'Veterans Day' },
  { id: 'h26-17', kind: 'holiday', date: '2026-11-26', title: 'Thanksgiving' },
  { id: 'h26-18', kind: 'holiday', date: '2026-12-24', title: 'Christmas Eve' },
  { id: 'h26-19', kind: 'holiday', date: '2026-12-25', title: 'Christmas Day' },
  { id: 'h26-20', kind: 'holiday', date: '2026-12-31', title: "New Year's Eve" },
]

// Demo events covering May–June 2026. Replace with a real hook later.
export const DEMO_EVENTS: ScheduleEvent[] = [
  { id: 'e1',  kind: 'meeting',     date: '2026-05-01', title: 'Board Meeting',        time: '7:00 PM', location: 'Clubhouse', href: '/app/voice' },
  { id: 'e2',  kind: 'maintenance', date: '2026-05-02', title: 'Pool Maintenance',     time: '8:00 AM – 12:00 PM', vendor: 'SeaCare Pools' },
  { id: 'e3',  kind: 'maintenance', date: '2026-05-03', title: 'Pool Maintenance',     time: '8:00 AM – 12:00 PM', vendor: 'SeaCare Pools' },
  { id: 'e4',  kind: 'event',       date: '2026-05-04', title: 'Landscape Day',        time: '9:00 AM', vendor: 'Oak Ridge Nursery' },
  { id: 'e5',  kind: 'dues',        date: '2026-05-06', title: 'Dues Due',             time: 'All day' },
  { id: 'e6',  kind: 'event',       date: '2026-05-07', title: 'Sunset Cup',           time: '5:00 PM', location: 'Pavilion' },
  { id: 'e7',  kind: 'vote',        date: '2026-05-09', title: 'Vote: Pool vendor',    href: '/app/voice/demo-meeting-1' },
  { id: 'e8',  kind: 'maintenance', date: '2026-05-10', title: 'Gate Inspection',      time: '10:00 AM', vendor: 'SecureGate Co' },
  { id: 'e9',  kind: 'event',       date: '2026-05-11', title: 'Fire Drill',           time: '11:00 AM' },
  { id: 'e10', kind: 'maintenance', date: '2026-05-13', title: 'Landscape Day',        time: '7:00 AM', vendor: 'Oak Ridge Nursery' },
  { id: 'e11', kind: 'vote',        date: '2026-05-14', title: 'Vote: Holiday lights', href: '/app/voice' },
  { id: 'e12', kind: 'meeting',     date: '2026-05-15', title: 'Board Meeting',        time: '7:00 PM', location: 'Clubhouse', href: '/app/voice' },
  { id: 'e13', kind: 'inspection',  date: '2026-05-19', title: 'Elevator Inspection',  time: '10:00 AM' },
  { id: 'e14', kind: 'maintenance', date: '2026-05-22', title: 'Pool Maintenance',     time: '8:00 AM – 12:00 PM', vendor: 'SeaCare Pools' },
  { id: 'e15', kind: 'event',       date: '2026-05-24', title: 'Spring Picnic',        time: '12:00 PM', location: 'Pavilion' },
  // Today's stack — May 28
  { id: 'e16', kind: 'meeting',     date: '2026-05-28', title: 'Board Meeting',        time: '7:00 PM', location: 'Clubhouse', href: '/app/voice' },
  { id: 'e17', kind: 'maintenance', date: '2026-05-28', title: 'Pool Maintenance',     time: '8:00 AM – 4:00 PM', vendor: 'SeaCare Pools' },
  { id: 'e18', kind: 'inspection',  date: '2026-05-28', title: 'Monthly Inspection',   time: '11:00 AM' },
  { id: 'e19', kind: 'dues',        date: '2026-06-01', title: 'June Dues',            time: 'All day' },
  { id: 'e20', kind: 'meeting',     date: '2026-06-12', title: 'Monthly Board Meeting',time: '7:00 PM', location: 'Clubhouse', href: '/app/voice' },
]

// Map a calendar event kind to one of the right-rail tag styles
// (pending / renewed / hosted) the dashboard already styles. Future:
// give each kind its own tag.
export function kindToUpTag(kind: EventKind): 'pending' | 'renewed' | 'hosted' {
  switch (kind) {
    case 'meeting':     return 'hosted'
    case 'event':       return 'hosted'
    case 'holiday':     return 'hosted'
    case 'maintenance': return 'renewed'
    case 'vote':        return 'pending'
    case 'dues':        return 'pending'
    case 'inspection':  return 'pending'
  }
}

// Upcoming events from `from` (ISO date) forward, sorted ascending.
export function upcomingFrom(events: ScheduleEvent[], fromISO: string, limit?: number) {
  const list = events
    .filter(e => e.date >= fromISO)
    .sort((a, b) => a.date.localeCompare(b.date))
  return typeof limit === 'number' ? list.slice(0, limit) : list
}

// ---------------------------------------------------------------
// Local persistence — events added by the board via /admin/schedule
// live in localStorage until we wire up a Supabase events table.
// Storage event ensures sibling tabs (admin + resident view) stay
// in sync without a refresh.
// ---------------------------------------------------------------

const STORAGE_KEY = 'residente-schedule-events'

export function getStoredEvents(): ScheduleEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function setStoredEvents(events: ScheduleEvent[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  // Notify same-tab listeners (storage events only fire cross-tab natively).
  window.dispatchEvent(new CustomEvent('residente-schedule-change'))
}

export function addStoredEvent(event: Omit<ScheduleEvent, 'id'> & { id?: string }) {
  const id = event.id || `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const next = [...getStoredEvents(), { ...event, id } as ScheduleEvent]
  setStoredEvents(next)
  return id
}

export function removeStoredEvent(id: string) {
  setStoredEvents(getStoredEvents().filter(e => e.id !== id))
}

export function clearStoredEvents() {
  setStoredEvents([])
}

// React hook — combines DEMO_EVENTS with anything in localStorage.
// SSR returns DEMO only; client merges in stored on mount, then
// listens for changes from sibling tabs OR sibling components.
import { useEffect, useState } from 'react'

export function useScheduleEvents() {
  const [stored, setStored] = useState<ScheduleEvent[]>([])

  useEffect(() => {
    const refresh = () => setStored(getStoredEvents())
    refresh()
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) refresh() }
    const onLocal = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('residente-schedule-change', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('residente-schedule-change', onLocal)
    }
  }, [])

  // Holidays + demo events + admin-added (localStorage) events. Order
  // is normalized by date wherever events are rendered.
  return [...US_HOLIDAYS_2026, ...DEMO_EVENTS, ...stored]
}
