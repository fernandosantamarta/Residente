// Amenities for the Easy Schedule → Amenities tab.
//   - app/app/schedule/_sections/AmenitiesSection.tsx — resident browse + book
// Catalog (ev_amenities) is board-defined; reservations (ev_amenity_reservations)
// are the resident's own bookings. Both live in Supabase with realtime so a new
// booking shows up everywhere at once. When there's no Supabase session/community
// (preview mode, or a community with no rows yet) the hook serves a code-level
// DEMO catalog and keeps bookings in local state, so the tab is fully clickable
// before anything is seeded. Free to book in v1; price_cents is carried through
// so Stripe can bolt on later — see [[feedback_stripe_first_for_money_flows]].

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase, stripeEnabled } from '@/lib/supabase'

export type AmenityKind = 'pool' | 'clubhouse' | 'gym' | 'court' | 'marina' | 'other'

export type Amenity = {
  id: string
  kind: AmenityKind
  name: string
  description?: string
  location?: string
  capacity?: number
  hours?: string
  rules: string[]
  imageUrl?: string
  priceCents: number
  bookable: boolean
  slotMinutes: number
}

export type Reservation = {
  id: string
  amenityId: string
  reservedDate: string   // ISO date YYYY-MM-DD
  startTime: string      // "18:00"
  endTime?: string
  partySize: number
  status: 'confirmed' | 'cancelled'
  note?: string
  priceCents: number
  paymentStatus: 'none' | 'pending' | 'paid'
}

export const KIND_LABEL: Record<AmenityKind, string> = {
  pool:      'Pool',
  clubhouse: 'Clubhouse',
  gym:       'Fitness',
  court:     'Courts',
  marina:    'Marina',
  other:     'Amenity',
}

// Reservable time slots offered in the booking popup. Plain strings so they
// match ev_amenity_reservations.start_time (text, like ev_schedule_events.time).
export const TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00',
]

export function fmtSlot(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function priceLabel(cents: number) {
  return cents > 0 ? `$${(cents / 100).toFixed(0)}` : 'Free'
}

// Code-level demo catalog. Serves the tab before a community has seeded any
// real amenities (and in preview mode). Stable ids so demo bookings key off them.
export const DEMO_AMENITIES: Amenity[] = [
  {
    id: 'demo-clubhouse', kind: 'clubhouse', name: 'Clubhouse',
    description: 'Event space with a full kitchen and lounge — great for parties and meetings.',
    location: 'Main building', capacity: 40, hours: 'Daily 8am–10pm',
    rules: ['Reserve at least 48 hours ahead', 'Leave it clean for the next neighbor', 'No open flames indoors'],
    priceCents: 7500, bookable: true, slotMinutes: 120,
  },
  {
    id: 'demo-pool', kind: 'pool', name: 'Resort Pool',
    description: 'Heated pool and sun deck with cabanas.',
    location: 'Center courtyard', capacity: 30, hours: 'Daily 6am–9pm',
    rules: ['Children under 14 with an adult', 'No glass containers', 'Shower before entering'],
    priceCents: 0, bookable: true, slotMinutes: 60,
  },
  {
    id: 'demo-gym', kind: 'gym', name: 'Fitness Center',
    description: '24/7 gym with cardio machines and free weights.',
    location: 'East wing', capacity: 8, hours: 'Open 24 hours',
    rules: ['Wipe down equipment after use', 'Re-rack your weights', 'Residents only'],
    priceCents: 0, bookable: true, slotMinutes: 60,
  },
  {
    id: 'demo-tennis', kind: 'court', name: 'Tennis Courts',
    description: 'Two lit hard courts.',
    location: 'North lot', capacity: 4, hours: 'Daily 7am–10pm',
    rules: ['90-minute limit when others are waiting', 'Non-marking shoes only'],
    priceCents: 0, bookable: true, slotMinutes: 90,
  },
  {
    id: 'demo-marina', kind: 'marina', name: 'Marina',
    description: 'Guest slips and kayak launch on the waterfront.',
    location: 'Waterfront', capacity: 6, hours: 'Daily, daylight hours',
    rules: ['Guest slips are first-come', 'Life vests required for kayaks', 'No overnight docking'],
    priceCents: 0, bookable: false, slotMinutes: 60,
  },
]

const rowToAmenity = (r: any): Amenity => ({
  id:          r.id,
  kind:        r.kind,
  name:        r.name,
  description: r.description ?? undefined,
  location:    r.location ?? undefined,
  capacity:    r.capacity ?? undefined,
  hours:       r.hours ?? undefined,
  rules:       r.rules ?? [],
  imageUrl:    r.image_url ?? undefined,
  priceCents:  r.price_cents ?? 0,
  bookable:    r.bookable ?? true,
  slotMinutes: r.slot_minutes ?? 60,
})

const rowToReservation = (r: any): Reservation => ({
  id:           r.id,
  amenityId:    r.amenity_id,
  reservedDate: r.reserved_date,
  startTime:    r.start_time,
  endTime:      r.end_time ?? undefined,
  partySize:    r.party_size ?? 1,
  status:       r.status,
  note:         r.note ?? undefined,
  priceCents:   r.price_cents ?? 0,
  paymentStatus: r.payment_status ?? 'none',
})

export type BookInput = {
  amenityId: string
  reservedDate: string
  startTime: string
  endTime?: string
  partySize: number
  note?: string
  priceCents: number
}

// One hook driving the whole Amenities tab: the catalog, this resident's
// reservations, and book/cancel. `live` is true once we're reading the real
// Supabase catalog; false means we're on the demo catalog with local bookings.
export function useAmenityHub() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const profileId = profile?.id
  const canUseDb = !!(hasSupabase && supabase && communityId && profileId)

  const [dbAmenities, setDbAmenities] = useState<Amenity[]>([])
  const [dbReservations, setDbReservations] = useState<Reservation[]>([])
  const [localReservations, setLocalReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!canUseDb) { setLoading(false); return }
    try {
      const [aRes, rRes] = await Promise.all([
        supabase!
          .from('ev_amenities')
          .select('id, kind, name, description, location, capacity, hours, rules, image_url, price_cents, bookable, slot_minutes')
          .eq('community_id', communityId)
          .eq('active', true)
          .order('sort', { ascending: true })
          .order('name', { ascending: true }),
        supabase!
          .from('ev_amenity_reservations')
          .select('id, amenity_id, reserved_date, start_time, end_time, party_size, status, note, price_cents, payment_status')
          .eq('community_id', communityId)
          .eq('profile_id', profileId)
          .neq('status', 'cancelled')
          .order('reserved_date', { ascending: true }),
      ])
      if (aRes.error) throw aRes.error
      if (rRes.error) throw rRes.error
      setDbAmenities((aRes.data ?? []).map(rowToAmenity))
      setDbReservations((rRes.data ?? []).map(rowToReservation))
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Could not load amenities')
    } finally {
      setLoading(false)
    }
  }, [canUseDb, communityId, profileId])

  useEffect(() => { load() }, [load])

  // Realtime: any change to this community's amenities or reservations
  // refreshes the tab so a fresh booking shows up immediately.
  useEffect(() => {
    if (!canUseDb) return
    const channel = supabase!
      .channel(`amenities:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_amenities',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_amenity_reservations',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase!.removeChannel(channel) }
  }, [canUseDb, communityId, channelId, load])

  // Real catalog if the community has seeded amenities; otherwise the demo set.
  const live = canUseDb && dbAmenities.length > 0
  const amenities = live ? dbAmenities : DEMO_AMENITIES
  const reservations = live ? dbReservations : localReservations

  const book = useCallback(async (input: BookInput): Promise<string | null> => {
    if (live && canUseDb) {
      // Priced amenity + Stripe configured → hold the slot as 'pending' and
      // send the resident to Stripe; the webhook flips it to 'paid'. Free (or
      // no Stripe) → confirm immediately.
      const paid = input.priceCents > 0 && stripeEnabled
      const { data, error } = await supabase!
        .from('ev_amenity_reservations')
        .insert({
          community_id: communityId,
          amenity_id:   input.amenityId,
          profile_id:   profileId,
          reserved_date: input.reservedDate,
          start_time:   input.startTime,
          end_time:     input.endTime || null,
          party_size:   input.partySize,
          note:         input.note || null,
          price_cents:  input.priceCents,
          status:       'confirmed',
          payment_status: paid ? 'pending' : 'none',
        })
        .select('id')
        .single()
      if (error) throw error
      const id = data?.id ?? null

      if (paid && id) {
        const { data: co, error: coErr } = await supabase!.functions.invoke(
          'create-amenity-checkout',
          { body: { reservation_id: id } },
        )
        if (coErr || !co?.url) {
          // Couldn't start checkout — release the just-held slot so it isn't
          // stuck pending, then surface the error.
          await supabase!.from('ev_amenity_reservations').delete().eq('id', id)
          throw new Error(co?.error || coErr?.message || 'Could not start checkout')
        }
        if (typeof window !== 'undefined') window.location.href = co.url as string
        return id
      }

      await load()
      return id
    }
    // Demo / preview: keep the booking in local state so the flow is real to click.
    const id = `local-${input.amenityId}-${input.reservedDate}-${input.startTime}`
    setLocalReservations(prev =>
      prev.some(r => r.id === id)
        ? prev
        : [...prev, { ...input, id, status: 'confirmed', paymentStatus: 'none' }],
    )
    return id
  }, [live, canUseDb, communityId, profileId, load])

  const cancel = useCallback(async (id: string) => {
    if (live && canUseDb) {
      const { error } = await supabase!
        .from('ev_amenity_reservations')
        .update({ status: 'cancelled' })
        .eq('id', id)
      if (error) throw error
      await load()
      return
    }
    setLocalReservations(prev => prev.filter(r => r.id !== id))
  }, [live, canUseDb, load])

  // Slots already taken (by anyone, when live) for a given amenity + date, so
  // the booking popup can disable them. In demo mode we only know this
  // resident's own local bookings, which is enough to feel real.
  const takenSlots = useCallback(
    (amenityId: string, dateISO: string) =>
      new Set(
        reservations
          .filter(r => r.amenityId === amenityId && r.reservedDate === dateISO && r.status !== 'cancelled')
          .map(r => r.startTime),
      ),
    [reservations],
  )

  const byAmenity = useMemo(() => {
    const map: Record<string, Amenity> = {}
    for (const a of amenities) map[a.id] = a
    return map
  }, [amenities])

  return { amenities, reservations, byAmenity, loading, error, live, book, cancel, takenSlots }
}

// ---------------------------------------------------------------
// Board management surface (/admin/schedule → Amenities tab).
// Reads the community's real catalog (no demo fallback) and adds /
// edits / removes amenities. Mirrors useCommunitySchedule.
// ---------------------------------------------------------------

export type AmenityInput = {
  name: string
  kind: AmenityKind
  description?: string
  location?: string
  capacity?: number
  hours?: string
  rules: string[]
  priceCents: number
  bookable: boolean
  slotMinutes: number
  sort?: number
}

const inputToRow = (a: AmenityInput) => ({
  name:         a.name,
  kind:         a.kind,
  description:  a.description || null,
  location:     a.location || null,
  capacity:     a.capacity ?? null,
  hours:        a.hours || null,
  rules:        a.rules,
  price_cents:  a.priceCents,
  bookable:     a.bookable,
  slot_minutes: a.slotMinutes,
  sort:         a.sort ?? 0,
})

export function useManageAmenities() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const profileId = profile?.id
  const canUseDb = !!(hasSupabase && supabase && communityId)

  const [amenities, setAmenities] = useState<Amenity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!canUseDb) { setLoading(false); return }
    try {
      const { data, error } = await supabase!
        .from('ev_amenities')
        .select('id, kind, name, description, location, capacity, hours, rules, image_url, price_cents, bookable, slot_minutes')
        .eq('community_id', communityId)
        .eq('active', true)
        .order('sort', { ascending: true })
        .order('name', { ascending: true })
      if (error) throw error
      setAmenities((data ?? []).map(rowToAmenity))
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Could not load amenities')
    } finally {
      setLoading(false)
    }
  }, [canUseDb, communityId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!canUseDb) return
    const channel = supabase!
      .channel(`amenities-admin:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_amenities',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase!.removeChannel(channel) }
  }, [canUseDb, communityId, channelId, load])

  const addAmenity = useCallback(async (a: AmenityInput): Promise<string | null> => {
    if (!canUseDb) return null
    const { data, error } = await supabase!
      .from('ev_amenities')
      .insert({ ...inputToRow(a), community_id: communityId, created_by: profileId ?? null })
      .select('id')
      .single()
    if (error) throw error
    await load()
    return data?.id ?? null
  }, [canUseDb, communityId, profileId, load])

  const updateAmenity = useCallback(async (id: string, a: AmenityInput) => {
    if (!canUseDb) return
    const { error } = await supabase!
      .from('ev_amenities')
      .update(inputToRow(a))
      .eq('id', id)
    if (error) throw error
    await load()
  }, [canUseDb, load])

  // Soft-delete: keep the row (and any reservation history) but hide it from
  // residents. active=false drops it from every read path.
  const removeAmenity = useCallback(async (id: string) => {
    if (!canUseDb) return
    const { error } = await supabase!
      .from('ev_amenities')
      .update({ active: false })
      .eq('id', id)
    if (error) throw error
    await load()
  }, [canUseDb, load])

  return { amenities, loading, error, canUseDb, addAmenity, updateAmenity, removeAmenity }
}

// ---------------------------------------------------------------
// Board reservations oversight (/admin/schedule → Amenities tab).
// Reads EVERY reservation in the community (RLS lets the board do this,
// residents only see their own), cancels any of them, and books on a
// resident's behalf. Mirrors the resident hub but community-wide.
// ---------------------------------------------------------------

export type AdminReservation = {
  id: string
  amenityId: string
  reservedDate: string
  startTime: string
  partySize: number
  status: 'confirmed' | 'cancelled'
  note?: string
  residentName: string
  paymentStatus: 'none' | 'pending' | 'paid'
}

export type CommunityResident = { id: string; name: string }

export type BookForInput = BookInput & { profileId: string }

export function useAmenityBookings() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const canUseDb = !!(hasSupabase && supabase && communityId)

  const [reservations, setReservations] = useState<AdminReservation[]>([])
  const [residents, setResidents] = useState<CommunityResident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!canUseDb) { setLoading(false); return }
    try {
      const [rRes, pRes] = await Promise.all([
        supabase!
          .from('ev_amenity_reservations')
          .select('id, amenity_id, reserved_date, start_time, party_size, status, note, payment_status, profiles(full_name)')
          .eq('community_id', communityId)
          .neq('status', 'cancelled')
          .order('reserved_date', { ascending: true })
          .order('start_time', { ascending: true }),
        supabase!
          .from('profiles')
          .select('id, full_name')
          .eq('community_id', communityId)
          .order('full_name', { ascending: true }),
      ])
      if (rRes.error) throw rRes.error
      if (pRes.error) throw pRes.error
      setReservations((rRes.data ?? []).map((r: any) => ({
        id:           r.id,
        amenityId:    r.amenity_id,
        reservedDate: r.reserved_date,
        startTime:    r.start_time,
        partySize:    r.party_size ?? 1,
        status:       r.status,
        note:         r.note ?? undefined,
        residentName: r.profiles?.full_name || 'Resident',
        paymentStatus: r.payment_status ?? 'none',
      })))
      setResidents((pRes.data ?? []).map((p: any) => ({ id: p.id, name: p.full_name || 'Resident' })))
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Could not load reservations')
    } finally {
      setLoading(false)
    }
  }, [canUseDb, communityId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!canUseDb) return
    const channel = supabase!
      .channel(`amenity-bookings:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ev_amenity_reservations',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase!.removeChannel(channel) }
  }, [canUseDb, communityId, channelId, load])

  const cancel = useCallback(async (id: string) => {
    if (!canUseDb) return
    const { error } = await supabase!
      .from('ev_amenity_reservations')
      .update({ status: 'cancelled' })
      .eq('id', id)
    if (error) throw error
    await load()
  }, [canUseDb, load])

  const bookFor = useCallback(async (input: BookForInput): Promise<string | null> => {
    if (!canUseDb) return null
    const { data, error } = await supabase!
      .from('ev_amenity_reservations')
      .insert({
        community_id: communityId,
        amenity_id:   input.amenityId,
        profile_id:   input.profileId,
        reserved_date: input.reservedDate,
        start_time:   input.startTime,
        end_time:     input.endTime || null,
        party_size:   input.partySize,
        note:         input.note || null,
        price_cents:  input.priceCents,
        status:       'confirmed',
      })
      .select('id')
      .single()
    if (error) throw error
    await load()
    return data?.id ?? null
  }, [canUseDb, communityId, load])

  return { reservations, residents, loading, error, canUseDb, cancel, bookFor }
}
