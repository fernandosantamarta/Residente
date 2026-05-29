// Vendor ratings — residents can rate any vendor 1-5 stars with an
// optional written review.
//
// Three layers feed the effective rating shown on the Vendors page:
//   - DEMO_RATINGS (in code) — sample reviews from "other residents" so
//     the count next to each demo vendor isn't 0 from day one.
//   - db (Supabase `vendor_ratings`) — every resident's rating across the
//     whole community, so averages reflect the community, not just you.
//   - mine (localStorage) — the current resident's rating, written
//     optimistically so the UI updates instantly and still works offline /
//     in preview mode where there's no Supabase session.
//
// "Mine" is upserted by vendor_id: one rating per resident per vendor. The
// hook writes through to Supabase when a session exists (see vendor-ratings.sql
// for the table + RLS) and always mirrors to localStorage as the offline cache.

import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

export type Stars = 1 | 2 | 3 | 4 | 5

export type Rating = {
  id: string
  vendor_id: string
  stars: Stars
  review: string
  created_at: string
  profile_id?: string
  source?: 'demo' | 'mine' | 'db'
}

// Seeded "other resident" reviews. Distribute across the featured
// vendors so the table shows real averages rather than static numbers.
export const DEMO_RATINGS: Rating[] = [
  // GreenScape (v1) → ~4.9
  { id: 'd-v1-1', vendor_id: 'v1', stars: 5, review: 'Lawn looks better than it has in years.',     created_at: '2026-03-08', source: 'demo' },
  { id: 'd-v1-2', vendor_id: 'v1', stars: 5, review: 'Crew is on time every week. Very respectful.', created_at: '2026-03-22', source: 'demo' },
  { id: 'd-v1-3', vendor_id: 'v1', stars: 5, review: 'Saved our hibiscus from spider mites.',       created_at: '2026-04-04', source: 'demo' },
  { id: 'd-v1-4', vendor_id: 'v1', stars: 4, review: '',                                            created_at: '2026-04-15', source: 'demo' },

  // Coastal Maintenance (v2) → ~4.8
  { id: 'd-v2-1', vendor_id: 'v2', stars: 5, review: 'Quick to respond to common-area issues.',     created_at: '2026-03-12', source: 'demo' },
  { id: 'd-v2-2', vendor_id: 'v2', stars: 5, review: 'Touch-up painting in the lobby is perfect.',  created_at: '2026-04-02', source: 'demo' },
  { id: 'd-v2-3', vendor_id: 'v2', stars: 4, review: 'Fair pricing, fast.',                         created_at: '2026-04-20', source: 'demo' },

  // Shield Security (v3) → ~4.7
  { id: 'd-v3-1', vendor_id: 'v3', stars: 5, review: 'Camera quality at the gate is excellent.',    created_at: '2026-03-05', source: 'demo' },
  { id: 'd-v3-2', vendor_id: 'v3', stars: 4, review: 'After-hours patrol shows up reliably.',       created_at: '2026-04-09', source: 'demo' },
  { id: 'd-v3-3', vendor_id: 'v3', stars: 5, review: '',                                            created_at: '2026-04-25', source: 'demo' },

  // Flow Right (v4) → ~4.6
  { id: 'd-v4-1', vendor_id: 'v4', stars: 5, review: 'Showed up within an hour for a leak.',        created_at: '2026-04-10', source: 'demo' },
  { id: 'd-v4-2', vendor_id: 'v4', stars: 4, review: 'Fixture install went smoothly.',              created_at: '2026-04-22', source: 'demo' },

  // Sunset Electrical (v5) → ~4.7
  { id: 'd-v5-1', vendor_id: 'v5', stars: 5, review: 'EV charger install was clean and quick.',     created_at: '2026-04-14', source: 'demo' },
  { id: 'd-v5-2', vendor_id: 'v5', stars: 4, review: 'Pricing is on the higher side but worth it.', created_at: '2026-05-01', source: 'demo' },

  // Pristine (v6)
  { id: 'd-v6-1', vendor_id: 'v6', stars: 5, review: 'Lobby is spotless after their visits.',       created_at: '2026-04-18', source: 'demo' },
  { id: 'd-v6-2', vendor_id: 'v6', stars: 4, review: '',                                            created_at: '2026-05-04', source: 'demo' },

  // BluFresh (v7)
  { id: 'd-v7-1', vendor_id: 'v7', stars: 4, review: 'Annual elevator inspection went smoothly.',   created_at: '2026-03-30', source: 'demo' },

  // Apex HVAC (v8)
  { id: 'd-v8-1', vendor_id: 'v8', stars: 5, review: 'Replaced our compressor in a day.',           created_at: '2026-04-06', source: 'demo' },
  { id: 'd-v8-2', vendor_id: 'v8', stars: 4, review: '',                                            created_at: '2026-04-28', source: 'demo' },

  // Atlas Pest (v9)
  { id: 'd-v9-1', vendor_id: 'v9', stars: 4, review: 'No more ants in the clubhouse.',              created_at: '2026-04-11', source: 'demo' },
]

const STORAGE_KEY = 'residente-vendor-ratings'

// Vendor ids are uuids in the DB; the in-code demo seed uses 'v1'..'v9'.
// Only push real uuids to Supabase — rating a demo-seed vendor (e.g. when a
// community has no vendor rows yet) stays a localStorage-only action.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (s: string) => UUID_RE.test(s)

export function getMyRatings(): Rating[] {
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

export function setMyRatings(next: Rating[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('residente-vendor-ratings-change'))
}

// Optimistic localStorage upsert: one rating per vendor for the current
// resident. Returns the new rating record. DB write-through is handled by the
// hook's `submit`, which calls this first so the UI updates instantly.
export function submitRating(vendor_id: string, stars: Stars, review: string): Rating {
  const existing = getMyRatings()
  const idx = existing.findIndex(r => r.vendor_id === vendor_id)
  const row: Rating = {
    id: idx >= 0 ? existing[idx].id : `u-${Date.now().toString(36)}`,
    vendor_id,
    stars,
    review: review.trim(),
    created_at: new Date().toISOString().slice(0, 10),
    source: 'mine',
  }
  const next = idx >= 0
    ? existing.map((r, i) => (i === idx ? row : r))
    : [...existing, row]
  setMyRatings(next)
  return row
}

export function removeMyRating(vendor_id: string) {
  setMyRatings(getMyRatings().filter(r => r.vendor_id !== vendor_id))
}

// React hook — merges the demo seed, the community's DB ratings, and the
// resident's own (optimistic) reviews, and exposes submit/remove that write
// through to Supabase. Listens for sibling-tab + sibling-component changes.
export function useVendorRatings() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const profileId = profile?.id

  const [mine, setMine] = useState<Rating[]>([])
  const [db, setDb] = useState<Rating[]>([])

  // Local (optimistic) layer — instant UI + offline/preview fallback.
  useEffect(() => {
    const refresh = () => setMine(getMyRatings())
    refresh()
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) refresh() }
    const onLocal = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('residente-vendor-ratings-change', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('residente-vendor-ratings-change', onLocal)
    }
  }, [])

  // Community layer — every resident's rating from Supabase.
  const loadDb = async () => {
    if (!hasSupabase || !supabase || !communityId) { setDb([]); return }
    try {
      const { data, error } = await supabase
        .from('vendor_ratings')
        .select('id, vendor_id, stars, review, created_at, profile_id')
        .eq('community_id', communityId)
      if (error || !data) return
      setDb(data.map((r: any) => ({
        id: r.id,
        vendor_id: r.vendor_id,
        stars: r.stars as Stars,
        review: r.review || '',
        created_at: (r.created_at || '').slice(0, 10),
        profile_id: r.profile_id,
        source: 'db' as const,
      })))
    } catch { /* keep whatever we have — demo + localStorage still render */ }
  }
  useEffect(() => { loadDb() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [communityId])

  // Write-through helpers. Always update localStorage optimistically; push to
  // Supabase when there's a session and the vendor is a real (uuid) row.
  const submit = async (vendor_id: string, stars: Stars, review: string) => {
    submitRating(vendor_id, stars, review)
    if (hasSupabase && supabase && communityId && profileId && isUuid(vendor_id)) {
      try {
        await supabase.from('vendor_ratings').upsert(
          {
            community_id: communityId,
            vendor_id,
            profile_id: profileId,
            stars,
            review: review.trim() || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'vendor_id,profile_id' },
        )
        await loadDb()
      } catch { /* optimistic localStorage copy already applied */ }
    }
  }

  const remove = async (vendor_id: string) => {
    removeMyRating(vendor_id)
    if (hasSupabase && supabase && profileId && isUuid(vendor_id)) {
      try {
        await supabase.from('vendor_ratings').delete()
          .eq('vendor_id', vendor_id).eq('profile_id', profileId)
        await loadDb()
      } catch { /* optimistic localStorage removal already applied */ }
    }
  }

  // Effective set: demo seed + community DB rows (minus my own, which the
  // optimistic localStorage copy represents) + my localStorage rating. This
  // keeps exactly one copy of my rating and makes it update instantly.
  const dbOthers = profileId ? db.filter(r => r.profile_id !== profileId) : db
  const all = [...DEMO_RATINGS, ...dbOthers, ...mine]

  const myByVendor = new Map<string, Rating>(mine.map(r => [r.vendor_id, r]))

  const ratingsFor = (vendor_id: string) =>
    all.filter(r => r.vendor_id === vendor_id)

  const countFor = (vendor_id: string) => ratingsFor(vendor_id).length

  const averageFor = (vendor_id: string): number | null => {
    const list = ratingsFor(vendor_id)
    if (list.length === 0) return null
    const sum = list.reduce((s, r) => s + r.stars, 0)
    return sum / list.length
  }

  const myRating = (vendor_id: string): Rating | undefined =>
    myByVendor.get(vendor_id)

  return { all, mine, myRating, ratingsFor, countFor, averageFor, submit, remove }
}
