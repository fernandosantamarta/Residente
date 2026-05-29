'use client'

import Link from 'next/link'
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EasyDocsTabs } from '../EasyDocsTabs'
import { useCategoriesData, useRulesData } from '@/lib/rules'
import { computeStats, useViolationsData } from '@/lib/violations'
import { useCommunityData } from '@/hooks/useCommunityData'
import { useDocuments } from '@/hooks/useDocuments'
import { supabase } from '@/lib/supabase'

// ─── shared helpers ────────────────────────────────────────────────────────

const fmtMoney = (n: number | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtNum = (n: number) => n.toLocaleString('en-US')
const fmtDate = (d: string | Date | null | undefined) => (d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—')
const fmtSize = (b?: number | string | null) => {
  const n = Number(b) || 0
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ─── Rules section helpers ─────────────────────────────────────────────────

const MOST_VIEWED_DEMO_COUNTS = [247, 189, 142, 96, 63]

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

function CatIconRules({ name }: { name: CatIconName }) {
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

// ─── Documents section helpers ─────────────────────────────────────────────

type DocCatIcon = 'gov' | 'finance' | 'rules' | 'forms' | 'notice' | 'minutes' | 'insurance' | 'vendor' | 'maps'
const CATEGORY_GRID: { key: DocCatIcon; label: string; desc: string }[] = [
  { key: 'gov',       label: 'Governing Documents',     desc: 'Declaration, bylaws, CC&Rs.' },
  { key: 'finance',   label: 'Financial Documents',     desc: 'Budgets, audits, reserves.' },
  { key: 'rules',     label: 'Rules & Policies',        desc: 'House rules and enforcement policy.' },
  { key: 'forms',     label: 'Forms & Applications',    desc: 'ARC, leases, pet registrations.' },
  { key: 'notice',    label: 'Notices & Announcements', desc: 'Posted board notices and notifications.' },
  { key: 'minutes',   label: 'Reports & Meeting Minutes', desc: 'Monthly minutes and committee reports.' },
  { key: 'insurance', label: 'Insurance',               desc: 'Master policy and certificates.' },
  { key: 'vendor',    label: 'Vendor & Contracts',      desc: 'Active service contracts on file.' },
  { key: 'maps',      label: 'Maps & Layouts',          desc: 'Site plan, parking, common areas.' },
]

const DEMO_PINNED = [
  { id: 'p1', title: 'Declaration of Condominium', category: 'Governing',  date: '2024-07-01' },
  { id: 'p2', title: 'Bylaws',                      category: 'Governing',  date: '2024-08-30' },
  { id: 'p3', title: 'Rules & Regulations',         category: 'Rules',      date: '2024-04-25' },
  { id: 'p4', title: '2024 Budget',                 category: 'Financial',  date: '2024-04-30' },
]

const DEMO_POPULAR = [
  { id: 'pop1', label: 'Community Map' },
  { id: 'pop2', label: 'Amenity Reservation Form' },
  { id: 'pop3', label: 'Move-In / Move-Out Guide' },
  { id: 'pop4', label: 'Key Fob Agreement' },
]

// ─── Main page ─────────────────────────────────────────────────────────────

export default function EasyDocs() {
  const { community } = useCommunityData()
  const communityName = community?.name || 'Sunset Lakes'

  // ── Rules state ──────────────────────────────────────────────────────────
  const rulesList = useRulesData()
  const allCategories = useCategoriesData()
  const [ruleSearch, setRuleSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const activeSectionRef = useRef<HTMLDivElement>(null)
  const chipStripRef = useRef<HTMLDivElement>(null)
  const [firstRowCount, setFirstRowCount] = useState<number | null>(null)

  useEffect(() => {
    if (activeCategory === 'all') return
    const id = requestAnimationFrame(() => {
      activeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(id)
  }, [activeCategory])

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
      setFirstRowCount(prev => prev === count ? prev : count)
    }
    const raf = requestAnimationFrame(measure)
    const ro = new ResizeObserver(() => requestAnimationFrame(measure))
    ro.observe(strip)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [rulesList.length, allCategories.length])

  const bySection = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const r of rulesList) {
      const name = (r.section || 'General').trim()
      ;(map[name] ||= []).push(r)
    }
    return map
  }, [rulesList])

  const sections = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const name of allCategories) { if (!seen.has(name)) { seen.add(name); out.push(name) } }
    for (const name of Object.keys(bySection)) { if (!seen.has(name)) { seen.add(name); out.push(name) } }
    return out
  }, [allCategories, bySection])

  const rulesFiltered = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase()
    return rulesList.filter(r => {
      const section = (r.section || 'General').trim()
      if (activeCategory !== 'all' && section !== activeCategory) return false
      if (!q) return true
      return `${r.title || ''} ${r.body || ''} ${section}`.toLowerCase().includes(q)
    })
  }, [rulesList, activeCategory, ruleSearch])

  const filteredBySection = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const r of rulesFiltered) {
      const name = (r.section || 'General').trim()
      ;(map[name] ||= []).push(r)
    }
    return map
  }, [rulesFiltered])

  const mostViewed = useMemo(() =>
    [...rulesList].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).slice(0, 5),
  [rulesList])

  const violationsList = useViolationsData()
  const violations = useMemo(() => computeStats(violationsList), [violationsList])

  // ── Documents state ──────────────────────────────────────────────────────
  const { documents, loading: docLoading } = useDocuments() as { documents: any[]; loading: boolean }
  const docList = documents || []
  const [docSearch, setDocSearch] = useState('')
  const [docFilterCategory, setDocFilterCategory] = useState<string>('all')
  const [docFilterPeriod, setDocFilterPeriod] = useState<'recent' | 'oldest'>('recent')
  const [busy, setBusy] = useState<string | null>(null)
  const [docError, setDocError] = useState('')

  async function openDoc(doc: any) {
    setBusy(doc.id); setDocError('')
    try {
      const { data, error } = await supabase.storage
        .from('documents').createSignedUrl(doc.storage_path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('No link')
      window.open(data.signedUrl, '_blank', 'noopener')
    } catch {
      setDocError('Could not open that document. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of docList) {
      const c = (d.category || 'Other').toLowerCase()
      map[c] = (map[c] || 0) + 1
    }
    return map
  }, [docList])

  const docFiltered = useMemo(() => {
    const q = docSearch.trim().toLowerCase()
    let out = docList.filter(d => {
      if (docFilterCategory !== 'all'
          && (d.category || '').toLowerCase() !== docFilterCategory.toLowerCase()) return false
      if (!q) return true
      return `${d.title || ''} ${d.category || ''}`.toLowerCase().includes(q)
    })
    out.sort((a, b) => {
      const at = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0
      const bt = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0
      return docFilterPeriod === 'recent' ? bt - at : at - bt
    })
    return out
  }, [docList, docSearch, docFilterCategory, docFilterPeriod])

  const recent = docFiltered.slice(0, 6)

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="easydocs-combined">
      <EasyDocsTabs />

      {/* ════════════════════════════════════════════════════════════════
          RULES SECTION
      ════════════════════════════════════════════════════════════════ */}
      <section id="easydocs-rules" style={{ scrollMarginTop: 56 }}>
        <div className="rb-wrap">
          <section className="rb-hero">
            <div className="rb-hero-content">
              <h1 className="rb-hero-title">Rules <span className="rb-amp">&amp;</span> Guidelines</h1>
              <div className="rb-hero-sub">
                Community standards that help keep {communityName} safe,
                beautiful, and enjoyable for everyone.
              </div>
            </div>
          </section>

          <div className="rb-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              name="rules-search"
              type="search"
              value={ruleSearch}
              onChange={e => setRuleSearch(e.target.value)}
              placeholder="Search rules and policies…"
            />
          </div>

          {rulesList.length > 0 && (
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

          {rulesList.length === 0 && (
            <div className="rb-empty">
              <div className="rb-empty-title">No rules published yet</div>
              <div className="rb-empty-sub">
                When your board adds covenants and house rules, they appear here for everyone.
              </div>
            </div>
          )}

          {rulesList.length > 0 && (
            <>
              <div className="rb-grid">
                <section className="rb-col">
                  <div className="rb-col-head">Browse rules by category</div>

                  {(() => {
                    type Chip = {
                      key: string; label: string; count: number
                      icon: CatIconName; onClick: () => void; isActive: boolean
                    }
                    const chips: Chip[] = [
                      {
                        key: '__all__', label: 'All Rules', count: rulesList.length,
                        icon: 'shield', onClick: () => setActiveCategory('all'), isActive: activeCategory === 'all',
                      },
                      ...sections.map(name => ({
                        key: name, label: name, count: bySection[name]?.length || 0,
                        icon: iconFor(name),
                        onClick: () => setActiveCategory(name),
                        isActive: activeCategory === name,
                      })),
                    ]
                    const renderChip = (c: Chip) => (
                      <button key={c.key} className={`rb-chip${c.isActive ? ' active' : ''}`} onClick={c.onClick}>
                        <span className="rb-chip-icon"><CatIconRules name={c.icon} /></span>
                        <span className="rb-chip-label">{c.label}</span>
                        <span className="rb-chip-count">{c.count} {c.count === 1 ? 'rule' : 'rules'}</span>
                      </button>
                    )
                    const splitAt = firstRowCount ?? chips.length
                    const visible = chips.slice(0, splitAt)
                    return (
                      <div className="rb-chips rb-chips-inline" ref={chipStripRef}>
                        {(firstRowCount === null ? chips : visible).map(renderChip)}
                      </div>
                    )
                  })()}

                  {(() => {
                    const q = ruleSearch.trim().toLowerCase()
                    const cardCategories = sections.filter(name => {
                      if (!q) return true
                      if (name.toLowerCase().includes(q)) return true
                      return (filteredBySection[name]?.length || 0) > 0
                    })
                    if (cardCategories.length === 0) {
                      return (
                        <div className="rb-empty rb-empty-card">
                          <div className="rb-empty-title">No categories match your search.</div>
                          <div className="rb-empty-sub">Try a different keyword or clear your search.</div>
                        </div>
                      )
                    }
                    return (
                      <div className="rb-cat-list">
                        {cardCategories.map(name => {
                          const count = filteredBySection[name]?.length || 0
                          return (
                            <button key={name} className="rb-cat-card" onClick={() => setActiveCategory(name)}>
                              <span className="rb-cat-card-icon"><CatIconRules name={iconFor(name)} /></span>
                              <span className="rb-cat-card-body">
                                <span className="rb-cat-card-title">{name}</span>
                                <span className="rb-cat-card-desc">{describeSection(name, count)}</span>
                              </span>
                              <span className="rb-cat-card-count">{count} {count === 1 ? 'rule' : 'rules'}</span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {activeCategory !== 'all' && (
                    <div className="rb-active-section" ref={activeSectionRef}>
                      <div className="rb-active-head">
                        <h2>{activeCategory}</h2>
                        <button className="rb-active-clear" onClick={() => setActiveCategory('all')}>Show all categories</button>
                      </div>
                      {(!filteredBySection[activeCategory] || filteredBySection[activeCategory].length === 0) ? (
                        <div className="rb-empty rb-empty-card">
                          <div className="rb-empty-title">No rules in {activeCategory} yet</div>
                          <div className="rb-empty-sub">
                            When your board adds {activeCategory.toLowerCase()} rules, they appear here.
                          </div>
                        </div>
                      ) : (
                        <div className="rb-rule-list">
                          {filteredBySection[activeCategory].map((r: any) => (
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
                            <div className="rb-most-meta">{r.section || 'General'}</div>
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
                <Link href="/app/voice#contact" className="rb-suggest-cta">
                  Suggest a change
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
                  </svg>
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          DOCUMENTS SECTION
      ════════════════════════════════════════════════════════════════ */}
      <section id="easydocs-documents" style={{ scrollMarginTop: 56 }}>
        <div className="doc-wrap">
          <section className="doc-hero">
            <div className="doc-hero-content">
              <h1 className="doc-hero-title">Documents</h1>
              <div className="doc-hero-sub">
                Important community documents, resources, and forms &mdash; all in one place.
              </div>
            </div>
          </section>

          <div className="doc-toolbar">
            <div className="doc-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
              </svg>
              <input
                name="doc-search"
                type="search"
                value={docSearch}
                onChange={e => setDocSearch(e.target.value)}
                placeholder="Search documents…"
              />
            </div>
            <select name="doc-category" className="doc-select" value={docFilterCategory}
              onChange={e => setDocFilterCategory(e.target.value)}>
              <option value="all">All Categories</option>
              {CATEGORY_GRID.map(c => (
                <option key={c.key} value={c.label}>{c.label}</option>
              ))}
            </select>
            <select name="doc-period" className="doc-select" value={docFilterPeriod}
              onChange={e => setDocFilterPeriod(e.target.value as any)}>
              <option value="recent">Recently Updated</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>

          <div className="doc-rows">
            <div className="doc-row">
              <section className="doc-card">
                <h2 className="doc-card-title">Document Categories</h2>
                <div className="doc-cat-grid">
                  {CATEGORY_GRID.map(c => {
                    const count = categoryCounts[c.label.toLowerCase()] || 0
                    return (
                      <button key={c.key} type="button" className="doc-cat"
                        onClick={() => setDocFilterCategory(c.label)}>
                        <span className="doc-cat-icon"><DocCatIcon name={c.key} /></span>
                        <span className="doc-cat-body">
                          <span className="doc-cat-label">{c.label}</span>
                          <span className="doc-cat-desc">{c.desc}</span>
                          {count > 0 && <span className="doc-cat-count">{count} {count === 1 ? 'doc' : 'docs'}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="doc-card">
                <div className="doc-card-head">
                  <h2 className="doc-card-title">Pinned &amp; Important</h2>
                  <Link href="#" className="doc-card-link">View all</Link>
                </div>
                <div className="doc-pinned-grid">
                  {DEMO_PINNED.map(p => (
                    <a key={p.id} href="#" className="doc-pinned">
                      <span className="doc-pinned-icon"><PdfIcon /></span>
                      <span className="doc-pinned-tag">{p.category}</span>
                      <span className="doc-pinned-title">{p.title}</span>
                      <span className="doc-pinned-meta">PDF &middot; {fmtDate(p.date)}</span>
                    </a>
                  ))}
                </div>
              </section>
            </div>

            <div className="doc-row">
              <section className="doc-card doc-need">
                <div className="doc-need-icon" aria-hidden="true"><IconHelp /></div>
                <div className="doc-need-body">
                  <div className="doc-need-title">Need a document?</div>
                  <div className="doc-need-sub">
                    Can&rsquo;t find what you&rsquo;re looking for? Request it from
                    the board and they&rsquo;ll surface it here.
                  </div>
                </div>
                <Link href="/app/voice#contact" className="doc-cta-primary">Request a Document</Link>
              </section>

              <section className="doc-card doc-stay">
                <div className="doc-stay-bell" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 19a2 2 0 0 0 4 0"/>
                  </svg>
                </div>
                <div className="doc-stay-body">
                  <div className="doc-stay-title">Stay Informed</div>
                  <div className="doc-stay-sub">
                    Get notified when new documents are uploaded or updated.
                  </div>
                </div>
                <Link href="/app/settings" className="doc-cta-secondary">Manage Notifications</Link>
              </section>
            </div>

            <div className="doc-row">
              <section className="doc-card">
                <div className="doc-card-head">
                  <h2 className="doc-card-title">Recent Documents</h2>
                  <Link href="#" className="doc-card-link">View all</Link>
                </div>
                {docError && <div className="doc-err">{docError}</div>}
                {docLoading && <div className="doc-empty">Loading…</div>}
                {!docLoading && recent.length === 0 && (
                  <div className="doc-empty">No documents yet. Check back as the board adds them.</div>
                )}
                {!docLoading && recent.length > 0 && (
                  <div className="doc-recent">
                    {recent.map(d => (
                      <button type="button" key={d.id} className="doc-recent-row"
                        onClick={() => openDoc(d)} disabled={busy === d.id}>
                        <span className="doc-recent-icon"><PdfIcon /></span>
                        <span className="doc-recent-body">
                          <span className="doc-recent-title">{d.title}</span>
                          <span className="doc-recent-meta">
                            {d.category || 'Other'}
                            {d.size_bytes ? <> &middot; {fmtSize(d.size_bytes)}</> : null}
                          </span>
                        </span>
                        <span className="doc-recent-date">{fmtDate(d.uploaded_at)}</span>
                        <span className="doc-recent-action">{busy === d.id ? 'Opening…' : 'Open'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="doc-card">
                <div className="doc-card-head">
                  <h2 className="doc-card-title">Popular Downloads</h2>
                  <Link href="#" className="doc-card-link">View all</Link>
                </div>
                <div className="doc-popular">
                  {DEMO_POPULAR.map(p => (
                    <a key={p.id} href="#" className="doc-popular-row">
                      <span className="doc-popular-icon"><PdfIcon /></span>
                      <span className="doc-popular-title">{p.label}</span>
                      <span className="doc-popular-dl" aria-label="Download">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M5 20h14"/>
                        </svg>
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ─── Icon components ────────────────────────────────────────────────────────

function DocCatIcon({ name }: { name: DocCatIcon }) {
  const paths: Record<DocCatIcon, ReactNode> = {
    gov:       <><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/></>,
    finance:   <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h3M14 15h3"/></>,
    rules:     <><path d="M4 4h12l4 4v12H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
    forms:     <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></>,
    notice:    <><path d="M3 11l16-6v14L3 13z"/><path d="M7 13v5a2 2 0 0 0 4 0v-3"/></>,
    minutes:   <><path d="M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    insurance: <><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></>,
    vendor:    <><path d="M3 7h18l-1.4 11.2A2 2 0 0 1 17.6 20H6.4a2 2 0 0 1-2-1.8z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></>,
    maps:      <><path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/></>,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <path d="M14 3v6h6"/>
      <text x="7" y="17" fontSize="5.5" fontWeight="700" fill="currentColor" stroke="none">PDF</text>
    </svg>
  )
}

function IconHelp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5"/>
      <circle cx="12" cy="17.5" r="0.5" fill="currentColor"/>
    </svg>
  )
}
