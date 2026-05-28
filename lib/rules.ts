// Shared rule book. Mirrors lib/schedule.ts so the resident /app/rules
// page and the board /admin/rules page stay in sync without needing
// Supabase wired up for the demo path.
//
// When the real `rules` table is connected, swap the storage functions
// below for Supabase calls — the hook consumers don't change.

// Canonical category list — same set used by:
//   - the resident /app/rules chip strip (so every box always shows)
//   - the admin /admin/rules section dropdown (so the board picks from
//     these instead of free-typing a new variant every time)
export const RULE_CATEGORIES = [
  'General',
  'Noise & Conduct',
  'Pets',
  'Parking & Vehicles',
  'Pool & Amenities',
  'Architectural',
  'Trash & Recycling',
  'Security',
] as const

export type RuleCategory = typeof RULE_CATEGORIES[number]

export type Rule = {
  id: string
  section: string | null
  title: string
  body: string | null
  fine: number | null
  sort_order: number
  created_at: string
}

// Seeded demo rules — covers the common HOA categories so the rule
// book reads as lived-in immediately.
export const DEMO_RULES: Rule[] = [
  { id: 'r-g1', section: 'General',              title: 'Be a good neighbor',                  body: 'Treat staff, vendors, and other residents with respect. The board reserves the right to address conduct that disrupts the community.', fine: null,  sort_order:  1, created_at: '2026-01-15T09:00:00Z' },
  { id: 'r-g2', section: 'General',              title: 'Common areas are shared space',       body: 'Leave the clubhouse, pool deck, and shared rooms cleaner than you found them.',                                                              fine: null,  sort_order:  2, created_at: '2026-01-15T09:00:00Z' },

  { id: 'r-n1', section: 'Noise & Conduct',      title: 'Quiet hours: 10 PM to 7 AM',          body: 'Music, power tools, and outdoor gatherings should wind down by 10 PM on weekdays and 11 PM on weekends.',                                  fine: 50,    sort_order:  3, created_at: '2026-01-18T10:00:00Z' },
  { id: 'r-n2', section: 'Noise & Conduct',      title: 'No fireworks on community property',  body: 'Personal fireworks are prohibited outside community-organized events.',                                                                      fine: 100,   sort_order:  4, created_at: '2026-01-18T10:00:00Z' },

  { id: 'r-p1', section: 'Pets',                 title: 'Leashes required outside the unit',   body: 'Dogs must be on a leash no longer than 6 ft any time they are outside your home.',                                                          fine: 50,    sort_order:  5, created_at: '2026-02-01T11:00:00Z' },
  { id: 'r-p2', section: 'Pets',                 title: 'Clean up after your pet',             body: 'Waste must be bagged and discarded immediately. Pet stations are installed at each entrance.',                                              fine: 75,    sort_order:  6, created_at: '2026-02-01T11:00:00Z' },
  { id: 'r-p3', section: 'Pets',                 title: 'Max two pets per unit',               body: 'Service animals are excluded from this count and never require board approval.',                                                            fine: null,  sort_order:  7, created_at: '2026-02-01T11:00:00Z' },

  { id: 'r-pk1', section: 'Parking & Vehicles',  title: 'Resident spots are by unit number',   body: 'Each unit has one designated covered spot. Switching spots requires written approval from the board.',                                     fine: 50,    sort_order:  8, created_at: '2026-02-10T12:00:00Z' },
  { id: 'r-pk2', section: 'Parking & Vehicles',  title: 'Guest parking max 72 hours',          body: 'Vehicles left in guest spots longer than 72 hours will be tagged and may be towed.',                                                       fine: 75,    sort_order:  9, created_at: '2026-02-10T12:00:00Z' },
  { id: 'r-pk3', section: 'Parking & Vehicles',  title: 'No commercial vehicles overnight',    body: 'Trailers, boats, RVs, and work trucks over 1-ton must be stored offsite overnight.',                                                       fine: 100,   sort_order: 10, created_at: '2026-02-10T12:00:00Z' },

  { id: 'r-po1', section: 'Pool & Amenities',    title: 'Pool hours: 6 AM to 10 PM',           body: 'The pool deck is locked outside these hours. Children under 14 must be supervised by an adult.',                                            fine: 50,    sort_order: 11, created_at: '2026-03-05T13:00:00Z' },
  { id: 'r-po2', section: 'Pool & Amenities',    title: 'No glass on the pool deck',           body: 'Glass containers are prohibited in the pool area to keep barefoot guests safe.',                                                            fine: 50,    sort_order: 12, created_at: '2026-03-05T13:00:00Z' },

  { id: 'r-a1', section: 'Architectural',        title: 'Exterior paint approval required',    body: 'Submit color samples to the board for approval before painting any exterior surface visible from common areas.',                            fine: 250,   sort_order: 13, created_at: '2026-03-12T14:00:00Z' },
  { id: 'r-a2', section: 'Architectural',        title: 'No window AC units street-facing',    body: 'Window units must be installed on side or back-facing windows only.',                                                                       fine: 100,   sort_order: 14, created_at: '2026-03-12T14:00:00Z' },

  { id: 'r-t1', section: 'Trash & Recycling',    title: 'Bins stored out of street view',      body: 'Trash and recycling bins return to your designated storage area within 24 hours of pickup.',                                                fine: 25,    sort_order: 15, created_at: '2026-04-02T15:00:00Z' },

  { id: 'r-s1', section: 'Security',             title: 'Share gate codes with guests only',   body: 'Do not post the gate code online or share it with delivery services. Use the per-visit code generator in the app.',                          fine: 200,   sort_order: 16, created_at: '2026-04-10T16:00:00Z' },
]

const STORAGE_KEY = 'residente-rules'
const HIDE_DEMO_KEY = 'residente-rules-hide-demo'

export function getHideDemo(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(HIDE_DEMO_KEY) === 'true'
}

export function setHideDemo(hidden: boolean) {
  if (typeof window === 'undefined') return
  if (hidden) window.localStorage.setItem(HIDE_DEMO_KEY, 'true')
  else window.localStorage.removeItem(HIDE_DEMO_KEY)
  window.dispatchEvent(new CustomEvent('residente-rules-change'))
}

// Wipes both the stored (board-added) rules and the seeded demo set,
// leaving a blank rule book. Use sparingly — primarily for the
// "Delete all" button on /admin/rules before importing a fresh batch.
export function deleteAllRules() {
  setStoredRules([])
  setHideDemo(true)
}

// Brings the seeded demo rules back. The board's own additions are
// untouched.
export function restoreDemoRules() {
  setHideDemo(false)
}

// --- Custom categories ---
// Board can add categories beyond the seeded RULE_CATEGORIES set so the
// chip strip on /app/rules grows with whatever the community needs.
const CATEGORIES_KEY = 'residente-rule-categories'
const HIDDEN_CATEGORIES_KEY = 'residente-rule-categories-hidden'

// Track which built-in canonical categories the board has chosen to
// remove, so we can hide them from the resident chip strip without
// touching the seed list in code.
function getHiddenBuiltIns(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HIDDEN_CATEGORIES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : []
  } catch {
    return []
  }
}

function setHiddenBuiltIns(list: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify(list))
  window.dispatchEvent(new CustomEvent('residente-rules-change'))
}

export function hideBuiltInCategory(name: string) {
  const list = getHiddenBuiltIns()
  if (list.includes(name)) return
  setHiddenBuiltIns([...list, name])
}

export function restoreAllBuiltInCategories() {
  setHiddenBuiltIns([])
}

export function getStoredCategories(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CATEGORIES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function setStoredCategories(categories: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories))
  window.dispatchEvent(new CustomEvent('residente-rules-change'))
}

export function addStoredCategory(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  const all = new Set<string>([...(RULE_CATEGORIES as readonly string[]), ...getStoredCategories()])
  if (all.has(trimmed)) return
  setStoredCategories([...getStoredCategories(), trimmed])
}

export function removeStoredCategory(name: string) {
  setStoredCategories(getStoredCategories().filter(c => c !== name))
}

// React hook — canonical categories first, then custom ones the board
// has added. Deduped, and any built-ins the board has hidden are
// excluded.
export function useCategoriesData(): string[] {
  const [custom, setCustom] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])

  useEffect(() => {
    const refresh = () => {
      setCustom(getStoredCategories())
      setHidden(getHiddenBuiltIns())
    }
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === CATEGORIES_KEY || e.key === HIDDEN_CATEGORIES_KEY) refresh()
    }
    const onLocal = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('residente-rules-change', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('residente-rules-change', onLocal)
    }
  }, [])

  const hiddenSet = new Set(hidden)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of RULE_CATEGORIES) {
    if (hiddenSet.has(c)) continue
    if (!seen.has(c)) { seen.add(c); out.push(c) }
  }
  for (const c of custom) {
    if (!seen.has(c)) { seen.add(c); out.push(c) }
  }
  return out
}

export function getStoredRules(): Rule[] {
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

export function setStoredRules(rules: Rule[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
  window.dispatchEvent(new CustomEvent('residente-rules-change'))
}

export function addStoredRule(rule: Omit<Rule, 'id' | 'created_at'> & { id?: string; created_at?: string }) {
  const id = rule.id || `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const created_at = rule.created_at || new Date().toISOString()
  const next = [...getStoredRules(), { ...rule, id, created_at } as Rule]
  setStoredRules(next)
  return id
}

export function removeStoredRule(id: string) {
  setStoredRules(getStoredRules().filter(r => r.id !== id))
}

export function clearStoredRules() {
  setStoredRules([])
}

// React hook — combines DEMO_RULES + anything in localStorage. SSR
// returns DEMO only; client merges in stored on mount and listens
// for changes from other tabs OR sibling components.
import { useEffect, useState } from 'react'

export function useRulesData() {
  const [stored, setStored] = useState<Rule[]>([])
  const [hideDemo, setHideDemoState] = useState(false)

  useEffect(() => {
    const refresh = () => {
      setStored(getStoredRules())
      setHideDemoState(getHideDemo())
    }
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === HIDE_DEMO_KEY) refresh()
    }
    const onLocal = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('residente-rules-change', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('residente-rules-change', onLocal)
    }
  }, [])

  // Demo set first, then any rules the board has added since.
  // "Delete all" hides the demo so the rule book reads as a clean slate.
  return [...(hideDemo ? [] : DEMO_RULES), ...stored]
}
