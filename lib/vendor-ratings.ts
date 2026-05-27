// Vendor ratings — residents can rate any vendor 1-5 stars with an
// optional written review. Stored in localStorage for the demo path;
// when the real `vendor_ratings` table is wired, swap the storage
// functions and the hook consumers don't change.
//
// Two layers:
//   - DEMO_RATINGS (in code) — sample reviews from "other residents"
//     so the count next to each vendor isn't 0 from day one.
//   - mine (in localStorage) — the current resident's reviews.
//
// "Mine" is upserted by vendor_id: one rating per resident per vendor.
// Both layers feed averageFor() so the effective rating reflects the
// whole community.

import { useEffect, useState } from 'react'

export type Stars = 1 | 2 | 3 | 4 | 5

export type Rating = {
  id: string
  vendor_id: string
  stars: Stars
  review: string
  created_at: string
  source?: 'demo' | 'mine'
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

// Upsert: one rating per vendor for the current resident. Returns the
// new rating record.
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

// React hook — combines the demo seed with the resident's stored
// reviews, listens for sibling-tab + sibling-component changes.
export function useVendorRatings() {
  const [mine, setMine] = useState<Rating[]>([])

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

  const all = [...DEMO_RATINGS, ...mine]

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

  return { all, mine, myRating, ratingsFor, countFor, averageFor }
}
