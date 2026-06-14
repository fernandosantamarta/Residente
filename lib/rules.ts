// Shared rule book, backed by the Supabase `rules` table. Used by:
//   - app/app/documents/page.tsx  — the resident rule book (read)
//   - app/admin/documents/page.tsx — the board's add / edit / delete
// Every surface reads the same community-scoped rows in realtime, so a rule
// the board publishes shows up on every resident's page immediately.
//
// Categories: the canonical RULE_CATEGORIES (in code) plus any distinct
// `section` actually used by the community's rules, plus locally-staged
// custom categories the board has typed but not yet attached to a rule.

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

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

// Starter rule book — seeded into the DB on demand via the "Restore samples"
// button so a new community's rule book reads as lived-in from day one.
export const DEMO_RULES: Omit<Rule, 'id' | 'created_at'>[] = [
  { section: 'General',             title: 'Be a good neighbor',                 body: 'Treat staff, vendors, and other residents with respect. The board reserves the right to address conduct that disrupts the community.', fine: null, sort_order: 1 },
  { section: 'General',             title: 'Common areas are shared space',      body: 'Leave the clubhouse, pool deck, and shared rooms cleaner than you found them.', fine: null, sort_order: 2 },
  { section: 'Noise & Conduct',     title: 'Quiet hours: 10 PM to 7 AM',         body: 'Music, power tools, and outdoor gatherings should wind down by 10 PM on weekdays and 11 PM on weekends.', fine: 50, sort_order: 3 },
  { section: 'Noise & Conduct',     title: 'No fireworks on community property', body: 'Personal fireworks are prohibited outside community-organized events.', fine: 100, sort_order: 4 },
  { section: 'Pets',                title: 'Leashes required outside the unit',  body: 'Dogs must be on a leash no longer than 6 ft any time they are outside your home.', fine: 50, sort_order: 5 },
  { section: 'Pets',                title: 'Clean up after your pet',            body: 'Waste must be bagged and discarded immediately. Pet stations are installed at each entrance.', fine: 75, sort_order: 6 },
  { section: 'Pets',                title: 'Max two pets per unit',              body: 'Service animals are excluded from this count and never require board approval.', fine: null, sort_order: 7 },
  { section: 'Parking & Vehicles',  title: 'Resident spots are by unit number',  body: 'Each unit has one designated covered spot. Switching spots requires written approval from the board.', fine: 50, sort_order: 8 },
  { section: 'Parking & Vehicles',  title: 'Guest parking max 72 hours',         body: 'Vehicles left in guest spots longer than 72 hours will be tagged and may be towed.', fine: 75, sort_order: 9 },
  { section: 'Parking & Vehicles',  title: 'No commercial vehicles overnight',   body: 'Trailers, boats, RVs, and work trucks over 1-ton must be stored offsite overnight.', fine: 100, sort_order: 10 },
  { section: 'Pool & Amenities',    title: 'Pool hours: 6 AM to 10 PM',          body: 'The pool deck is locked outside these hours. Children under 14 must be supervised by an adult.', fine: 50, sort_order: 11 },
  { section: 'Pool & Amenities',    title: 'No glass on the pool deck',          body: 'Glass containers are prohibited in the pool area to keep barefoot guests safe.', fine: 50, sort_order: 12 },
  { section: 'Architectural',       title: 'Exterior paint approval required',   body: 'Submit color samples to the board for approval before painting any exterior surface visible from common areas.', fine: 250, sort_order: 13 },
  { section: 'Architectural',       title: 'No window AC units street-facing',    body: 'Window units must be installed on side or back-facing windows only.', fine: 100, sort_order: 14 },
  { section: 'Trash & Recycling',   title: 'Bins stored out of street view',     body: 'Trash and recycling bins return to your designated storage area within 24 hours of pickup.', fine: 25, sort_order: 15 },
  { section: 'Security',            title: 'Share gate codes with guests only',  body: 'Do not post the gate code online or share it with delivery services. Use the per-visit code generator in the app.', fine: 200, sort_order: 16 },
]

// ---------------------------------------------------------------
// Locally-staged custom categories. A category only becomes globally
// visible once a rule uses it (its `section` shows up in the DB); until
// then it lives here so the board can pick it while drafting. Built-in
// categories the board has hidden are tracked the same way.
// ---------------------------------------------------------------
const CATEGORIES_KEY = 'residente-rule-categories'
const HIDDEN_CATEGORIES_KEY = 'residente-rule-categories-hidden'

function readList(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : []
  } catch { return [] }
}
function writeList(key: string, list: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(list))
  window.dispatchEvent(new CustomEvent('residente-rules-change'))
}

export function getStoredCategories(): string[] { return readList(CATEGORIES_KEY) }
function getHiddenBuiltIns(): string[] { return readList(HIDDEN_CATEGORIES_KEY) }

export function addStoredCategory(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  const all = new Set<string>([...(RULE_CATEGORIES as readonly string[]), ...getStoredCategories()])
  if (all.has(trimmed)) return
  writeList(CATEGORIES_KEY, [...getStoredCategories(), trimmed])
}
export function removeStoredCategory(name: string) {
  writeList(CATEGORIES_KEY, getStoredCategories().filter(c => c !== name))
}
export function hideBuiltInCategory(name: string) {
  const list = getHiddenBuiltIns()
  if (list.includes(name)) return
  writeList(HIDDEN_CATEGORIES_KEY, [...list, name])
}
export function restoreAllBuiltInCategories() { writeList(HIDDEN_CATEGORIES_KEY, []) }

// ---------------------------------------------------------------
// Supabase-backed rules (the `rules` table).
// ---------------------------------------------------------------
export function useCommunityRules() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  // Unique per instance — a page can mount this twice (useRulesData +
  // useCategoriesData, or useRulesAdmin); supabase-js rejects duplicate
  // channel topics.
  const [channelId] = useState(() => Math.random().toString(36).slice(2))

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    try {
      const { data, error } = await supabase
        .from('rules')
        .select('id, section, title, body, fine, sort_order, created_at')
        .eq('community_id', communityId)
        .order('sort_order', { ascending: true })
      if (error) throw error
      setRules((data ?? []) as Rule[])
    } finally {
      setLoading(false)
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const channel = supabase
      .channel(`rules:${communityId}:${channelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'rules',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [communityId, channelId, load])

  return { rules, loading, reload: load, communityId }
}

// Resident + shared read surface.
export function useRulesData(): Rule[] {
  return useCommunityRules().rules
}

// Category chips: canonical (minus hidden) + sections actually used by the
// community's rules + locally-staged custom categories. Deduped, order
// preserved (canonical first).
export function useCategoriesData(): string[] {
  const { rules } = useCommunityRules()
  const [custom, setCustom] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])

  useEffect(() => {
    const refresh = () => { setCustom(getStoredCategories()); setHidden(getHiddenBuiltIns()) }
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === CATEGORIES_KEY || e.key === HIDDEN_CATEGORIES_KEY) refresh()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('residente-rules-change', refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('residente-rules-change', refresh)
    }
  }, [])

  const hiddenSet = new Set(hidden)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of RULE_CATEGORIES) {
    if (hiddenSet.has(c) || seen.has(c)) continue
    seen.add(c); out.push(c)
  }
  for (const r of rules) {
    const s = r.section
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  for (const c of custom) {
    if (!seen.has(c)) { seen.add(c); out.push(c) }
  }
  return out
}

// Management surface for /admin/documents: the community's rules + async
// add / remove / delete-all / restore-samples.
export function useRulesAdmin() {
  const { rules, loading, reload, communityId } = useCommunityRules()

  const addRule = useCallback(
    async (r: Omit<Rule, 'id' | 'created_at'>): Promise<string | null> => {
      if (!hasSupabase || !supabase || !communityId) return null
      const { data, error } = await supabase
        .from('rules')
        .insert({
          community_id: communityId,
          section: r.section,
          title: r.title,
          body: r.body,
          fine: r.fine,
          sort_order: r.sort_order,
        })
        .select('id')
        .single()
      if (error) throw error
      await reload()
      return data?.id ?? null
    },
    [communityId, reload]
  )

  const removeRule = useCallback(async (id: string) => {
    if (!hasSupabase || !supabase) return
    const { error } = await supabase.from('rules').delete().eq('id', id)
    if (error) throw error
    await reload()
  }, [reload])

  const updateRule = useCallback(async (
    id: string,
    patch: Partial<Pick<Rule, 'section' | 'title' | 'body' | 'fine'>>,
  ) => {
    if (!hasSupabase || !supabase) return
    const { error } = await supabase.from('rules').update(patch).eq('id', id)
    if (error) throw error
    await reload()
  }, [reload])

  const deleteAll = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) return
    const { error } = await supabase.from('rules').delete().eq('community_id', communityId)
    if (error) throw error
    await reload()
  }, [communityId, reload])

  // Seed the starter rule book, skipping any title that already exists so a
  // second click doesn't duplicate rows.
  const restoreDemo = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) return
    const have = new Set(rules.map(r => r.title))
    const toAdd = DEMO_RULES.filter(d => !have.has(d.title))
      .map(d => ({ ...d, community_id: communityId }))
    if (toAdd.length) {
      const { error } = await supabase.from('rules').insert(toAdd)
      if (error) throw error
    }
    await reload()
  }, [communityId, rules, reload])

  return { rules, loading, reload, addRule, removeRule, updateRule, deleteAll, restoreDemo }
}
