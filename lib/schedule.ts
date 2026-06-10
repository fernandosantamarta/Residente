// Shared schedule events. Used by:
//   - app/app/schedule/page.tsx — the calendar grid + side panel
//   - app/app/layout.tsx (RightRail) — the dashboard's "Up Next" list
//   - app/admin/schedule/page.tsx — the board's add / remove management
// All surfaces pull from one Supabase source (ev_schedule_events), so the
// board, every resident, and the dashboard rail stay in sync in realtime.

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

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

// US holidays — federal + popular observances. These live in code (not the
// DB) so every community gets them for free and they never need seeding.
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

// Map a calendar event kind to one of the right-rail tag styles
// (pending / renewed / hosted) the dashboard already styles.
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
// Supabase-backed community events (ev_schedule_events).
// ---------------------------------------------------------------

type NewEvent = Omit<ScheduleEvent, 'id'>

const rowToEvent = (r: any): ScheduleEvent => ({
  id:       r.id,
  kind:     r.kind,
  title:    r.title,
  date:     r.event_date,
  time:     r.time ?? undefined,
  vendor:   r.vendor ?? undefined,
  location: r.location ?? undefined,
  href:     r.href ?? undefined,
})

// Core fetch + realtime subscription for a community's events. Shared by
// both the read-only `useScheduleEvents` (calendar + rail) and the
// management `useCommunitySchedule` (admin add/remove).
function useCommunityEvents() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Unique per hook instance. A page can mount this hook twice (e.g. admin
  // uses both useScheduleEvents + useCommunitySchedule); supabase-js throws
  // if two channels share a topic name, so each instance gets its own.
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    try {
      const { data, error } = await supabase
        .from('ev_schedule_events')
        .select('id, kind, title, event_date, time, vendor, location, href')
        .eq('community_id', communityId)
        .order('event_date', { ascending: true })
      if (error) throw error
      setEvents((data ?? []).map(rowToEvent))
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Could not load the calendar')
    } finally {
      setLoading(false)
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  // Realtime: any insert/update/delete in this community's events refreshes
  // every open surface (board's admin view, residents' calendars, the rail).
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const channel = supabase
      .channel(`schedule:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_schedule_events',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [communityId, channelId, load])

  return { events, loading, error, reload: load, communityId, profileId: profile?.id }
}

// Read surface: holidays (from code) + this community's events (from the DB).
// Returns a plain array so existing consumers (calendar grid, "Up next" rail)
// don't change. Empty community list until the fetch resolves.
export function useScheduleEvents(): ScheduleEvent[] {
  const { events } = useCommunityEvents()
  return [...US_HOLIDAYS_2026, ...events]
}

// Management surface for /admin/schedule: the community's events plus async
// add / remove. `notify` defaults to true for single adds (fires a bell
// notice); CSV bulk imports pass notify:false to avoid flooding the bell.
export function useCommunitySchedule() {
  const { events, loading, error, reload, communityId, profileId } = useCommunityEvents()

  const addEvent = useCallback(
    async (e: NewEvent, opts: { notify?: boolean } = {}): Promise<string | null> => {
      if (!hasSupabase || !supabase || !communityId) return null
      const { data, error } = await supabase
        .from('ev_schedule_events')
        .insert({
          community_id: communityId,
          kind:       e.kind,
          title:      e.title,
          event_date: e.date,
          time:       e.time || null,
          vendor:     e.vendor || null,
          location:   e.location || null,
          href:       e.href || null,
          notify:     opts.notify ?? true,
          created_by: profileId ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      await reload()
      return data?.id ?? null
    },
    [communityId, profileId, reload]
  )

  // Edit a board-added event in place. Only the passed fields change; maps the
  // ScheduleEvent shape onto the table columns (date → event_date).
  const updateEvent = useCallback(async (id: string, patch: Partial<NewEvent>) => {
    if (!hasSupabase || !supabase) return
    const row: Record<string, any> = {}
    if (patch.kind !== undefined)     row.kind = patch.kind
    if (patch.title !== undefined)    row.title = patch.title
    if (patch.date !== undefined)     row.event_date = patch.date
    if (patch.time !== undefined)     row.time = patch.time || null
    if (patch.vendor !== undefined)   row.vendor = patch.vendor || null
    if (patch.location !== undefined) row.location = patch.location || null
    const { error } = await supabase.from('ev_schedule_events').update(row).eq('id', id)
    if (error) throw error
    await reload()
  }, [reload])

  const removeEvent = useCallback(async (id: string) => {
    if (!hasSupabase || !supabase) return
    const { error } = await supabase.from('ev_schedule_events').delete().eq('id', id)
    if (error) throw error
    await reload()
  }, [reload])

  return { events, loading, error, reload, addEvent, updateEvent, removeEvent }
}
