'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useCategoriesData, useRulesData } from '@/lib/rules'
import { computeStats, useViolationsData } from '@/lib/violations'
import { useCommunityData } from '@/hooks/useCommunityData'

// Demo view counts for the "Most Viewed Rules" list — replace with a
// real views_count column from the rules table when tracking is wired.
const MOST_VIEWED_DEMO_COUNTS = [247, 189, 142, 96, 63]

const fmtMoney = (n: number | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtNum = (n: number) => n.toLocaleString('en-US')

// Resident-facing rule book — sunset hero, search + category chips,
// Browse by Category on the left, Most Viewed on the right, and a
// Violations & Enforcement strip at the bottom.
//
// Sourced from useRules() — the same hook the board admin writes to.
// "Most viewed" is currently a sort-order proxy because we don't have
// a real view-count field yet; swap to the real metric when wired.

type CatIconName =
  | 'doc' | 'volume' | 'paw' | 'car' | 'wave' | 'home' | 'shield' | 'leaf' | 'fire'

const CATEGORY_ICON: Record<string, CatIconName> = {
  general:        'doc',
  'noise & conduct': 'volume',
  noise:          'volume',
  pets:           'paw',
  parking:        'car',
  'parking & vehicles': 'car',
  pool:           'wave',
  'pool & amenities': 'wave',
  amenities:      'wave',
  architectural:  'home',
  'architectural & aesthetics': 'home',
  safety:         'shield',
  'safety & security': 'shield',
  landscape:      'leaf',
  fire:           'fire',
}
function iconFor(section: string | null | undefined): CatIconName {
  const key = (section || 'general').toLowerCase().trim()
  return CATEGORY_ICON[key] || 'doc'
}

function CatIcon({ name }: { name: CatIconName }) {
  const paths: Record<CatIconName, React.ReactNode> = {
    doc:    <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/></>,
    paw:    <><ellipse cx="12" cy="16" rx="5" ry="4"/><circle cx="6" cy="10" r="2"/><circle cx="18" cy="10" r="2"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/></>,
    car:    <><path d="M5 11l2-5h10l2 5"/><rect x="3" y="11" width="18" height="7" rx="2"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/></>,
    wave:   <><path d="M3 12c2 0 3-2 6-2s4 2 6 2 3-2 6-2"/><path d="M3 17c2 0 3-2 6-2s4 2 6 2 3-2 6-2"/><path d="M3 7c2 0 3-2 6-2s4 2 6 2 3-2 6-2"/></>,
    home:   <><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></>,
    shield: <><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></>,
    leaf:   <><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19l7-7"/></>,
    fire:   <><path d="M12 3c-1 4-5 5-5 9a5 5 0 0 0 10 0c0-3-3-4-2-7-1 2-2 3-3 4z"/></>,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function describeSection(name: string, count: number): string {
  const base = name.toLowerCase()
  if (base.includes('noise'))       return 'Quiet hours, music, and respectful living.'
  if (base.includes('pet'))         return 'Approved pets, leashes, and clean-up.'
  if (base.includes('parking') || base.includes('vehicle')) return 'Resident, guest, and overflow parking.'
  if (base.includes('pool') || base.includes('amenit'))     return 'Pool, gym, clubhouse, and shared spaces.'
  if (base.includes('architect') || base.includes('aesth')) return 'Exterior changes, paint, and approvals.'
  if (base.includes('safety') || base.includes('security')) return 'Gate access, cameras, and emergency rules.'
  if (base.includes('landscape'))   return 'Lawn, planters, and shared green areas.'
  if (base.includes('fire'))        return 'Grills, fire pits, and burn safety.'
  if (base.includes('trash') || base.includes('recycl'))    return 'Bin storage, pickup days, and recycling.'
  return `${count} ${count === 1 ? 'rule' : 'rules'} in this section.`
}

export default function Rules() {
  const { community } = useCommunityData()
  const communityName = community?.name || 'Sunset Lakes'
  // Shared rule book — DEMO seed + anything the board has added via
  // /admin/rules. Lives in lib/rules.ts; swap for Supabase later.
  const list = useRulesData()
  const allCategories = useCategoriesData()
  const loading = false

  const [search, setSearch] = useState('')
  const [active, setActive] = useState<string>('all') // 'all' or a section name
  const activeSectionRef = useRef<HTMLDivElement>(null)
  const chipStripRef = useRef<HTMLDivElement>(null)
  // How many chips fit in row 1 of the strip — the rest spill into the
  // "All categories" panel below. `null` means we haven't measured yet,
  // in which case we show everything in one wrapping strip (the
  // measurement runs in a useLayoutEffect so the user won't see this
  // intermediate state).
  const [firstRowCount, setFirstRowCount] = useState<number | null>(null)

  // When the resident picks a category chip, scroll down to the rules
  // for that category so they don't have to hunt for them. Only fires
  // when a specific section is selected (not "All Rules").
  useEffect(() => {
    if (active === 'all') return
    const id = requestAnimationFrame(() => {
      activeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(id)
  }, [active])

  // Measure how many chips fit in the strip's first row. Re-measure
  // on viewport changes via ResizeObserver. Renders with flex-wrap on
  // first pass so the browser positions each chip naturally; we then
  // count which ones share the top row and split rendering on update.
  useLayoutEffect(() => {
    const strip = chipStripRef.current
    if (!strip) return
    const measure = () => {
      const chips = Array.from(strip.children) as HTMLElement[]
      if (chips.length === 0) { setFirstRowCount(null); return }
      const top = chips[0].offsetTop
      let count = 0
      for (const c of chips) {
        if (c.offsetTop > top) break
        count++
      }
      // Re-render the split only if it actually changed, to avoid
      // resize-loop thrash with the ResizeObserver.
      setFirstRowCount(prev => prev === count ? prev : count)
    }
    // Defer one frame so initial flex-wrap layout has settled.
    const raf = requestAnimationFrame(measure)
    const ro = new ResizeObserver(() => requestAnimationFrame(measure))
    ro.observe(strip)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [list.length, allCategories.length])

  // Group everything by section once for the chip strip + category cards.
  const bySection = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const r of list) {
      const name = (r.section || 'General').trim()
      ;(map[name] ||= []).push(r)
    }
    return map
  }, [list])
  // Chip-strip sections: every canonical + custom category from
  // useCategoriesData(), plus any one-off sections that appear in the
  // rule data (in case the board edits a rule directly). Deduped.
  const sections = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const name of allCategories) { if (!seen.has(name)) { seen.add(name); out.push(name) } }
    for (const name of Object.keys(bySection)) { if (!seen.has(name)) { seen.add(name); out.push(name) } }
    return out
  }, [allCategories, bySection])

  // Filter set = matches active chip AND search text.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter(r => {
      const section = (r.section || 'General').trim()
      if (active !== 'all' && section !== active) return false
      if (!q) return true
      const hay = `${r.title || ''} ${r.body || ''} ${section}`.toLowerCase()
      return hay.includes(q)
    })
  }, [list, active, search])

  // Group the filtered set for the Browse By Category column.
  const filteredBySection = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const r of filtered) {
      const name = (r.section || 'General').trim()
      ;(map[name] ||= []).push(r)
    }
    return map
  }, [filtered])
  const filteredSections = useMemo(() => Object.keys(filteredBySection), [filteredBySection])

  // "Most viewed" — sort_order proxy. Top 5 across the whole rule book,
  // not just the active filter, so it always has content.
  const mostViewed = useMemo(() => {
    return [...list]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .slice(0, 5)
  }, [list])

  // Derived from the shared violations log — same source the board
  // writes to from /admin/violations. Numbers update live as the
  // board adds entries or moves them through the workflow.
  const violationsList = useViolationsData()
  const violations = useMemo(() => computeStats(violationsList), [violationsList])

  return (
    <div className="rb-wrap">
      {/* Bare title — no banner, matches the Schedule page. */}
      <section className="rb-hero">
        <div className="rb-hero-content">
          <h1 className="rb-hero-title">Rules <span className="rb-amp">&amp;</span> Guidelines</h1>
          <div className="rb-hero-sub">
            Community standards that help keep {communityName} safe,
            beautiful, and enjoyable for everyone.
          </div>
        </div>
      </section>

      {/* Search input — standalone, sits above the category strip. */}
      <div className="rb-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          name="rules-search"
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rules and policies…"
        />
      </div>

      {/* Violations & Enforcement — moved above the main grid so the
          board's enforcement signal is the first thing residents see
          after the title + search. */}
      {!loading && list.length > 0 && (
        <section className="rb-vi">
          <div className="rb-vi-head">
            <h2>Violations <span className="rb-amp">&amp;</span> Enforcement</h2>
            <span className="rb-vi-sub">How the board keeps the rule book real.</span>
          </div>
          <div className="rb-vi-stats">
            <div className="rb-vi-stat">
              <div className="rb-vi-stat-n">{fmtNum(violations.warnings)}</div>
              <div className="rb-vi-stat-l">Warnings issued</div>
              <div className="rb-vi-stat-d">First touch — no fine attached.</div>
            </div>
            <div className="rb-vi-stat">
              <div className="rb-vi-stat-n">{fmtMoney(violations.fines)}</div>
              <div className="rb-vi-stat-l">Fines collected</div>
              <div className="rb-vi-stat-d">Returned to the community reserve.</div>
            </div>
            <div className="rb-vi-stat">
              <div className="rb-vi-stat-n">{fmtNum(violations.resolved)}</div>
              <div className="rb-vi-stat-l">Resolved</div>
              <div className="rb-vi-stat-d">Closed within 30 days.</div>
            </div>
            <div className="rb-vi-stat">
              <div className="rb-vi-stat-n">{fmtNum(violations.appeals)}</div>
              <div className="rb-vi-stat-l">Appeals</div>
              <div className="rb-vi-stat-d">Reviewed at the next board meeting.</div>
            </div>
          </div>
        </section>
      )}

      {loading && <div className="rb-empty">Loading the rule book…</div>}

      {!loading && list.length === 0 && (
        <div className="rb-empty">
          <div className="rb-empty-title">No rules published yet</div>
          <div className="rb-empty-sub">
            When your board adds covenants and house rules, they appear here for everyone.
          </div>
        </div>
      )}

      {!loading && list.length > 0 && (
        <>
          <div className="rb-grid">
            {/* LEFT — Browse rules by category */}
            <section className="rb-col">
              <div className="rb-col-head">Browse rules by category</div>

              {/* Category chip strip — the chips that fit in row 1
                  render here; the rest fall into an "All categories"
                  panel below. Measurement happens in a layout effect
                  so the wrap-and-split is invisible to the user. */}
              {(() => {
                type Chip = {
                  key: string
                  label: string
                  count: number
                  icon: CatIconName
                  onClick: () => void
                  isActive: boolean
                }
                const chips: Chip[] = [
                  {
                    key: '__all__',
                    label: 'All Rules',
                    count: list.length,
                    icon: 'shield',
                    onClick: () => setActive('all'),
                    isActive: active === 'all',
                  },
                  ...sections.map(name => ({
                    key: name,
                    label: name,
                    count: bySection[name]?.length || 0,
                    icon: iconFor(name),
                    onClick: () => setActive(name),
                    isActive: active === name,
                  })),
                ]
                const renderChip = (c: Chip) => (
                  <button
                    key={c.key}
                    className={`rb-chip${c.isActive ? ' active' : ''}`}
                    onClick={c.onClick}
                  >
                    <span className="rb-chip-icon"><CatIcon name={c.icon} /></span>
                    <span className="rb-chip-label">{c.label}</span>
                    <span className="rb-chip-count">
                      {c.count} {c.count === 1 ? 'rule' : 'rules'}
                    </span>
                  </button>
                )
                // Before measurement (firstRowCount == null): render
                // every chip in the strip with flex-wrap so the browser
                // can show them where row 1 ends. After measurement:
                // first N stay in the strip, the rest go below.
                const splitAt = firstRowCount ?? chips.length
                const visible = chips.slice(0, splitAt)
                const overflow = chips.slice(splitAt)
                return (
                  <div className="rb-chips rb-chips-inline" ref={chipStripRef}>
                    {(firstRowCount === null ? chips : visible).map(renderChip)}
                  </div>
                )
              })()}

              {(() => {
                // Every category gets a card here — the chip strip up
                // top only shows what fits in row 1, but this list is
                // the canonical "all categories" view. Counts reflect
                // the current filter (search + active chip).
                const q = search.trim().toLowerCase()
                const cardCategories = sections.filter(name => {
                  if (!q) return true
                  // Show if the name matches OR there's at least one
                  // rule in this section that matches the search.
                  if (name.toLowerCase().includes(q)) return true
                  return (filteredBySection[name]?.length || 0) > 0
                })
                if (cardCategories.length === 0) {
                  return (
                    <div className="rb-empty rb-empty-card">
                      <div className="rb-empty-title">No categories match your search.</div>
                      <div className="rb-empty-sub">
                        Try a different keyword or clear your search.
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="rb-cat-list">
                    {cardCategories.map(name => {
                      const count = filteredBySection[name]?.length || 0
                      return (
                        <button
                          key={name}
                          className="rb-cat-card"
                          onClick={() => setActive(name)}
                        >
                          <span className="rb-cat-card-icon">
                            <CatIcon name={iconFor(name)} />
                          </span>
                          <span className="rb-cat-card-body">
                            <span className="rb-cat-card-title">{name}</span>
                            <span className="rb-cat-card-desc">
                              {describeSection(name, count)}
                            </span>
                          </span>
                          <span className="rb-cat-card-count">
                            {count} {count === 1 ? 'rule' : 'rules'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}

              {/* When a chip is active, show the actual rule items below
                  the category list so the resident can read them in-place.
                  Renders even when the section has 0 rules so the scroll
                  target exists and the user gets a clear empty state. */}
              {active !== 'all' && (
                <div className="rb-active-section" ref={activeSectionRef}>
                  <div className="rb-active-head">
                    <h2>{active}</h2>
                    <button className="rb-active-clear" onClick={() => setActive('all')}>Show all categories</button>
                  </div>
                  {(!filteredBySection[active] || filteredBySection[active].length === 0) ? (
                    <div className="rb-empty rb-empty-card">
                      <div className="rb-empty-title">No rules in {active} yet</div>
                      <div className="rb-empty-sub">
                        When your board adds {active.toLowerCase()} rules, they appear here.
                      </div>
                    </div>
                  ) : (
                    <div className="rb-rule-list">
                      {filteredBySection[active].map((r: any) => (
                        <div className="rb-rule" key={r.id}>
                          <div className="rb-rule-head">
                            <div className="rb-rule-title">{r.title}</div>
                            {r.fine != null && Number(r.fine) > 0 && (
                              <span className="rb-rule-fine">{fmtMoney(r.fine)} fine</span>
                            )}
                          </div>
                          {r.body && <div className="rb-rule-body">{r.body}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* RIGHT — Most viewed rules, with a per-rule view count
                so residents can see what their neighbors are looking
                at. Demo numbers until a real view-tracking field is
                wired into the rules table. */}
            <aside className="rb-aside">
              <div className="rb-col-head">Most viewed rules</div>
              <ol className="rb-most-list">
                {mostViewed.map((r: any, i: number) => {
                  const views = MOST_VIEWED_DEMO_COUNTS[i] ?? Math.max(20, 60 - i * 8)
                  return (
                    <li className="rb-most-item" key={r.id}>
                      <span className="rb-most-rank">{i + 1}</span>
                      <div className="rb-most-body">
                        <div className="rb-most-title">{r.title}</div>
                        <div className="rb-most-meta">{(r.section || 'General')}</div>
                      </div>
                      <div className="rb-most-views">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        <span>{views.toLocaleString('en-US')}</span>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </aside>
          </div>

          <div className="rb-suggest">
            <div className="rb-suggest-body">
              <div className="rb-suggest-eyebrow">Know a rule that could be clearer?</div>
              <div className="rb-suggest-title">Suggest a rule change</div>
              <div className="rb-suggest-sub">
                Send the board a proposal — they review every suggestion at the next meeting.
              </div>
            </div>
            <Link href="/app/contact" className="rb-suggest-cta">
              Suggest a change
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
              </svg>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
