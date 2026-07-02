'use client'

import Link from 'next/link'
import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { useCategoriesData, useRulesData, DEMO_RULES } from '@/lib/rules'
import { computeStats, useViolationsData, useMyViolations, payFine } from '@/lib/violations'
import { useCommunityData } from '@/hooks/useCommunityData'
import { useDocuments } from '@/hooks/useDocuments'
import { supabase } from '@/lib/supabase'
import { DetailDialog } from '../track/_sections/DetailDialog'
import { ContestFineControl } from '../track/_sections/ContestFineControl'
import { Dropdown } from '@/components/Dropdown'
import { useCheckout } from '@/components/CheckoutProvider'
import { useT } from '@/lib/i18n'

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

// Render a heading string with the clean "&" (rb-amp) instead of the ornate
// Fraunces serif ampersand — matches the "Rules & Guidelines" hero.
function withAmp(text: string): ReactNode {
  return text.split(' & ').map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="rb-amp"> &amp; </span>}
      {part}
    </Fragment>
  ))
}

function describeSection(name: string, count: number, t: (k: string, v?: Record<string, any>) => string): string {
  const base = name.toLowerCase()
  if (base.includes('noise'))       return t('documents.sectionDescNoise')
  if (base.includes('pet'))         return t('documents.sectionDescPets')
  if (base.includes('parking') || base.includes('vehicle')) return t('documents.sectionDescParking')
  if (base.includes('pool') || base.includes('amenit'))     return t('documents.sectionDescPool')
  if (base.includes('architect') || base.includes('aesth')) return t('documents.sectionDescArchitectural')
  if (base.includes('safety') || base.includes('security')) return t('documents.sectionDescSafety')
  if (base.includes('landscape'))   return t('documents.sectionDescLandscape')
  if (base.includes('fire'))        return t('documents.sectionDescFire')
  if (base.includes('trash') || base.includes('recycl'))    return t('documents.sectionDescTrash')
  return t('documents.sectionDescCount', { count, rules: count === 1 ? t('documents.ruleSingular') : t('documents.rulePlural') })
}

// ─── Documents section helpers ─────────────────────────────────────────────

type DocCatIcon = 'gov' | 'finance' | 'rules' | 'forms' | 'notice' | 'minutes' | 'insurance' | 'vendor' | 'maps' | 'director' | 'inspection'
const CATEGORY_GRID: { key: DocCatIcon; label: string; desc: string }[] = [
  { key: 'gov',        label: 'Governing Documents',     desc: 'Declaration, bylaws, CC&Rs.' },
  { key: 'finance',    label: 'Financial Documents',     desc: 'Budgets, audits, reserves.' },
  { key: 'rules',      label: 'Rules & Policies',        desc: 'House rules and enforcement policy.' },
  { key: 'forms',      label: 'Forms & Applications',    desc: 'ARC, leases, pet registrations.' },
  { key: 'notice',     label: 'Notices & Announcements', desc: 'Posted board notices and notifications.' },
  { key: 'minutes',    label: 'Reports & Meeting Minutes', desc: 'Monthly minutes and committee reports.' },
  { key: 'insurance',  label: 'Insurance',               desc: 'Master policy and certificates.' },
  { key: 'vendor',     label: 'Vendor & Contracts',      desc: 'Active service contracts on file.' },
  { key: 'director',   label: 'Director Records',        desc: 'Certifications and conflict-of-interest disclosures.' },
  { key: 'inspection', label: 'Inspection Reports',      desc: 'Structural, life-safety, and reserve studies.' },
  { key: 'maps',       label: 'Maps & Layouts',          desc: 'Site plan, parking, common areas.' },
]

const DEMO_PINNED = [
  { id: 'p1', title: 'Declaration of Condominium', category: 'Governing Documents',  date: '2024-07-01' },
  { id: 'p2', title: 'Bylaws',                      category: 'Governing Documents',  date: '2024-08-30' },
  { id: 'p3', title: 'Rules & Regulations',         category: 'Rules & Policies',     date: '2024-04-25' },
  { id: 'p4', title: '2024 Budget',                 category: 'Financial Documents',  date: '2024-04-30' },
]

// Rules fallback for preview / no-auth — the lib ships DEMO_RULES (no ids);
// give them stable keys + a demo enforcement summary so the Rules tab shows its
// full layout instead of the empty state.
const DEMO_RULES_SEEDED = DEMO_RULES.map((r, i) => ({ ...r, id: `demo-rule-${i}`, created_at: '' }))
const DEMO_RULE_SECTIONS = Array.from(new Set(DEMO_RULES.map(r => r.section || 'General')))
const DEMO_VIOLATION_STATS = { warnings: 12, fines: 1850, resolved: 9, appeals: 2 }

const DEMO_POPULAR = [
  { id: 'pop1', label: 'Community Map' },
  { id: 'pop2', label: 'Amenity Reservation Form' },
  { id: 'pop3', label: 'Move-In / Move-Out Guide' },
  { id: 'pop4', label: 'Key Fob Agreement' },
]

// ─── Main page ─────────────────────────────────────────────────────────────

// Category-chip carousel page size. Five fit a desktop row, but on a phone that
// squeezes each chip to ~24px of label and the names shatter mid-word. Drop to
// 3 on phones, 4 on small tablets. Desktop stays 5 (unchanged).
function useChipsPerPage() {
  const [n, setN] = useState(5)
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth
      setN(w <= 480 ? 3 : w <= 768 ? 4 : 5)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])
  return n
}

export default function EasyDocs() {
  const t = useT()
  const { community } = useCommunityData()
  const communityName = community?.name || 'Sunset Lakes'
  const chipsPerPage = useChipsPerPage()

  // My Violations moved to Easy Track (Pay · Violations · Vendors · Reports).
  const DOC_TABS: SegTab[] = [
    { id: 'documents',  label: t('documents.tabDocuments') },
    { id: 'rules',      label: t('documents.tabRules') },
  ]

  // Which section is showing. The segmented control switches between them;
  // only the active section renders (a real switch, not a scroll-spy).
  // Default to the first tab (Documents) when opening the page with no hash —
  // clicking the Documents nav always lands here, not on Rules.
  const [tab, setTab] = useState('documents')

  // Honor the URL hash (#rules / #documents / #violations) so deep links and the
  // "Back to My Violations" link from /app/enforcement open the right tab.
  useEffect(() => {
    const ids = ['rules', 'documents']
    const fromHash = () => {
      const h = window.location.hash.replace('#', '')
      if (ids.includes(h)) setTab(h)
    }
    // A fine-payment return (?fine_paid=1#violations) now belongs to Easy Track.
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fine_paid')) {
      window.location.replace('/app/track?fine_paid=1#violations')
      return
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])

  // ── Rules state ──────────────────────────────────────────────────────────
  // Real community rules, or the demo seed (preview/no-auth) so the Rules tab
  // shows its full layout instead of the empty state.
  const rawRules = useRulesData()
  // Demo rules ONLY in the logged-out preview — a real community with no
  // rules yet gets the honest empty state, never a fake rule book (this also
  // gates the demo violation stats below).
  const usingDemoRules = !community && rawRules.length === 0
  const rulesList = usingDemoRules ? (DEMO_RULES_SEEDED as any[]) : rawRules
  const rawCategories = useCategoriesData()
  const allCategories = usingDemoRules ? DEMO_RULE_SECTIONS : rawCategories
  const [ruleSearch, setRuleSearch] = useState('')
  const [globalSearch, setGlobalSearch] = useState('') // unified search across rules + documents
  const [activeCategory, setActiveCategory] = useState<string>('all')
  // Pressing Enter in the rules search jumps straight to the best matching rule
  // in a popup (instead of leaving you to hunt through the category cards).
  const [ruleDetail, setRuleDetail] = useState<any | null>(null)
  const openTopRuleMatch = () => {
    const q = ruleSearch.trim().toLowerCase()
    if (!q) return
    const hit = rulesList.find(r =>
      `${r.title || ''} ${r.body || ''} ${(r.section || 'General')}`.toLowerCase().includes(q))
    if (hit) setRuleDetail(hit)
  }
  const [chipPage, setChipPage] = useState(0)   // category-chip carousel page
  // No auto-scroll: the rules now render right under the category carousel
  // (replacing the cards), so scrolling into view just caused a jarring jump.

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
  const violations = useMemo(
    () => (violationsList.length === 0 && usingDemoRules ? DEMO_VIOLATION_STATS : computeStats(violationsList)),
    [violationsList, usingDemoRules],
  )
  // Total dollars FINED to the resident (issued), not just what's been collected —
  // more meaningful for someone viewing their own violations.
  const finesIssued = useMemo(
    () => violationsList.reduce((s, v) => s + (v.kind === 'fine' ? Number(v.amount) || 0 : 0), 0),
    [violationsList],
  )

  // ── Documents state ──────────────────────────────────────────────────────
  const { documents, loading: docLoading } = useDocuments() as { documents: any[]; loading: boolean }
  const docList = documents || []
  // The genuinely pinned-worthy set for a REAL community: its governing docs.
  // The demo pinned/popular cards render only in the logged-out preview.
  const pinnedDocs = useMemo(
    () => docList.filter((d: any) => /declaration|bylaw|cc&r|covenant|articles|rules|budget/i.test(String(d.category || ''))).slice(0, 4),
    [docList],
  )
  const [docSearch, setDocSearch] = useState('')
  const [docFilterCategory, setDocFilterCategory] = useState<string>('all')
  const [docFilterPeriod, setDocFilterPeriod] = useState<'recent' | 'oldest'>('recent')
  const [busy, setBusy] = useState<string | null>(null)
  const [docError, setDocError] = useState('')
  // In-place popups: a single document detail + the "View all" lists.
  const [docDetail, setDocDetail] = useState<{ title: string; category?: string; date?: string; size?: string; doc?: any } | null>(null)
  const [listOpen, setListOpen] = useState<null | 'pinned' | 'recent' | 'popular'>(null)
  const [catOpen, setCatOpen] = useState(false)       // phone-only "all doc categories" popup
  const [ruleCatOpen, setRuleCatOpen] = useState(false)   // phone-only "all rule categories" popup
  // The "Recent documents" results card — picking a category on a phone scrolls
  // it into view so the filter visibly takes effect (the grid sits above it).
  const docResultsRef = useRef<HTMLDivElement>(null)
  const scrollToDocResults = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 760) {
      requestAnimationFrame(() => docResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  async function openDoc(doc: any) {
    setBusy(doc.id); setDocError('')
    try {
      const { data, error } = await supabase.storage
        .from('documents').createSignedUrl(doc.storage_path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('No link')
      window.open(data.signedUrl, '_blank', 'noopener')
    } catch {
      setDocError(t('documents.openError'))
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

  // Unified instant search across BOTH rules and documents. Ranks title matches
  // over section/category over body, returns the best mixed results. A rule match
  // shows a snippet of the rule text around the term; clicking opens its detail.
  const globalResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return [] as { type: 'rule' | 'doc'; item: any; title: string; snippet: string; score: number }[]
    const out: { type: 'rule' | 'doc'; item: any; title: string; snippet: string; score: number }[] = []
    for (const r of rulesList) {
      const title = (r.title || '').toLowerCase()
      const section = (r.section || 'General').toLowerCase()
      const body = (r.body || '').toLowerCase()
      let score = 0
      if (title.includes(q)) score += 100
      if (section.includes(q)) score += 40
      if (body.includes(q)) score += 20
      if (!score) continue
      let snippet = (r.section || 'General') as string
      const bi = body.indexOf(q)
      if (bi >= 0 && r.body) {
        const start = Math.max(0, bi - 30)
        snippet = (start > 0 ? '…' : '') + String(r.body).slice(start, bi + q.length + 70).trim() + '…'
      }
      out.push({ type: 'rule', item: r, title: r.title || r.section || 'Rule', snippet, score })
    }
    for (const d of docList) {
      const title = (d.title || '').toLowerCase()
      const cat = (d.category || '').toLowerCase()
      let score = 0
      if (title.includes(q)) score += 90
      if (cat.includes(q)) score += 30
      if (!score) continue
      out.push({ type: 'doc', item: d, title: d.title || 'Document', snippet: d.category || '', score })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 12)
  }, [globalSearch, rulesList, docList])

  // Click a result → see more: a rule opens its detail popup, a doc opens the file.
  const onSearchResult = (res: { type: 'rule' | 'doc'; item: any }) => {
    if (res.type === 'rule') setRuleDetail(res.item)
    else openDoc(res.item)
    setGlobalSearch('')
  }

  // The smart cross-search results panel (rules + documents), dropped under
  // whichever tab's long search bar is active. Click a result to open it. Lives
  // in the per-tab bars now — there's no separate search box up top.
  const smartPanel = globalSearch.trim() ? (
    <div className="easydocs-smartsearch-results" role="listbox"
      style={{ position: 'absolute', zIndex: 40, top: '100%', left: 0, right: 0, marginTop: 6, background: '#fff', border: '1px solid rgba(10,36,64,0.12)', borderRadius: 12, boxShadow: '0 14px 44px rgba(10,36,64,0.18)', maxHeight: 440, overflowY: 'auto', padding: 6 }}>
      {globalResults.length === 0 ? (
        <div style={{ padding: '16px 12px', color: '#6b6f7d', fontSize: 13.5 }}>{t('documents.smartSearchNoResults')}</div>
      ) : globalResults.map((res, i) => (
        <button key={`${res.type}-${i}`} type="button" role="option" onClick={() => onSearchResult(res)}
          style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '10px', borderRadius: 8 }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(10,36,64,0.04)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, marginTop: 1,
            color: res.type === 'rule' ? '#6941C6' : '#0E7490', background: res.type === 'rule' ? 'rgba(105,65,198,0.12)' : 'rgba(14,116,144,0.12)', borderRadius: 5, padding: '3px 6px' }}>
            {res.type === 'rule' ? t('documents.smartSearchRule') : t('documents.smartSearchDoc')}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: '#0A2440' }}>{res.title}</span>
            <span style={{ display: 'block', fontSize: 12, color: '#6b6f7d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{res.snippet}</span>
          </span>
        </button>
      ))}
    </div>
  ) : null

  const recent = docFiltered.slice(0, 6)

  // Localized label for the currently-selected document category (the filter
  // value stores the raw English label that the DB category matches against).
  const activeCatLabel = useMemo(() => {
    const m = CATEGORY_GRID.find(c => c.label.toLowerCase() === docFilterCategory.toLowerCase())
    return m ? t(`documents.cat_${m.key}_label`) : docFilterCategory
  }, [docFilterCategory, t])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="easydocs-combined">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Documents</h1>
        <p className="voice-page-sub">{t('documents.hubSub')}</p>
      </div>

      <div className="track-segtabs">
        <SegTabs tabs={DOC_TABS} active={tab} onChange={setTab} ariaLabel={t('documents.sectionsAria')} />
      </div>

      {/* ════════════════════════════════════════════════════════════════
          RULES SECTION
      ════════════════════════════════════════════════════════════════ */}
      {tab === 'rules' && (
      <section id="easydocs-rules" style={{ scrollMarginTop: 56 }}>
        <div className="rb-wrap">
          <section className="rb-hero">
            <div className="rb-hero-content">
              <h1 className="rb-hero-title">{t('documents.rulesHeroTitlePre')} <span className="rb-amp">&amp;</span> {t('documents.rulesHeroTitlePost')}</h1>
              <div className="rb-hero-sub">
                {t('documents.rulesHeroSub', { community: communityName })}
              </div>
            </div>
          </section>

          <div className="rb-toolbar" style={{ position: 'relative' }}>
            <div className="rb-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input
                name="rules-search"
                type="search"
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (globalResults[0]) onSearchResult(globalResults[0]) } }}
                placeholder={t('documents.smartSearchPlaceholder')}
              />
            </div>
            {smartPanel}
            <Dropdown<string>
              value={activeCategory}
              onChange={v => setActiveCategory(v)}
              ariaLabel={t('documents.allRules')}
              options={[
                { value: 'all', label: t('documents.allRules') },
                ...sections.map(name => ({ value: name, label: name })),
              ]}
            />
          </div>

          {rulesList.length === 0 && (
            <div className="rb-empty">
              <div className="rb-empty-title">{t('documents.noRulesTitle')}</div>
              <div className="rb-empty-sub">
                {t('documents.noRulesSub')}
              </div>
            </div>
          )}

          {rulesList.length > 0 && (
            <>
              <div className="rb-grid">
                <section className="rb-col">
                  <div className="rb-col-head">{t('documents.browseByCategory')}</div>

                  {/* Category chips — always on top, so picking one keeps the
                      selector visible. The active chip stays highlighted. */}
                  {(() => {
                    type Chip = {
                      key: string; label: string; count: number
                      icon: CatIconName; onClick: () => void; isActive: boolean
                    }
                    const chips: Chip[] = [
                      {
                        key: '__all__', label: t('documents.allRules'), count: rulesList.length,
                        icon: 'shield', onClick: () => setActiveCategory('all'), isActive: activeCategory === 'all',
                      },
                      ...sections.map(name => ({
                        key: name, label: name, count: bySection[name]?.length || 0,
                        icon: iconFor(name),
                        onClick: () => setActiveCategory(name),
                        isActive: activeCategory === name,
                      })),
                    ]
                    // Carousel: show one row of boxes; orange arrows below page
                    // through the rest. Keeps the boxes a comfortable size — no
                    // second row, no scrollbar.
                    const PER_PAGE = chipsPerPage
                    const pageCount = Math.ceil(chips.length / PER_PAGE)
                    const page = Math.min(chipPage, pageCount - 1)
                    const pageChips = chips.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
                    return (
                      <>
                        <div className="rb-chips rb-chips-inline" style={{ gridTemplateColumns: `repeat(${PER_PAGE}, 1fr)` }}>
                          {pageChips.map(c => (
                            <button key={c.key} className={`rb-chip${c.isActive ? ' active' : ''}`} onClick={c.onClick}>
                              <span className="rb-chip-icon"><CatIconRules name={c.icon} /></span>
                              <span className="rb-chip-label">{c.label}</span>
                              <span className="rb-chip-count">{c.count} {c.count === 1 ? t('documents.ruleSingular') : t('documents.rulePlural')}</span>
                            </button>
                          ))}
                        </div>
                        {pageCount > 1 && (
                          <div className="rb-chip-pager">
                            <button type="button" className="rb-chip-arrow" aria-label={t('documents.prevCategories')}
                              onClick={() => setChipPage(p => Math.max(0, p - 1))} disabled={page === 0}>&lsaquo;</button>
                            <span className="rb-chip-dots">
                              {Array.from({ length: pageCount }).map((_, i) => (
                                <span key={i} className={`rb-chip-dot${i === page ? ' on' : ''}`} />
                              ))}
                            </span>
                            <button type="button" className="rb-chip-arrow" aria-label={t('documents.moreCategories')}
                              onClick={() => setChipPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>&rsaquo;</button>
                          </div>
                        )}
                      </>
                    )
                  })()}

                  {/* Below the chips: the category cards when nothing is picked,
                      or just the chosen category's rules once one is. */}
                  {activeCategory === 'all' ? (() => {
                    const q = ruleSearch.trim().toLowerCase()
                    // While searching, show the matching RULES themselves (live, as
                    // you type) — not the category cards you'd have to click into.
                    if (q) {
                      if (rulesFiltered.length === 0) {
                        return (
                          <div className="rb-empty rb-empty-card">
                            <div className="rb-empty-title">{t('documents.noCategoriesMatch')}</div>
                            <div className="rb-empty-sub">{t('documents.noCategoriesMatchSub')}</div>
                          </div>
                        )
                      }
                      return (
                        <div className="rb-rule-list">
                          {rulesFiltered.map((r: any) => (
                            <div className="rb-rule" key={r.id}>
                              <div className="rb-rule-head">
                                <div className="rb-rule-title">{r.title}</div>
                                {r.fine != null && Number(r.fine) > 0 && (
                                  <span className="rb-rule-fine">{t('documents.fineLabel', { amount: fmtMoney(r.fine) })}</span>
                                )}
                              </div>
                              {(r.section || '').trim() && (
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pink)', marginTop: 2 }}>{(r.section || '').trim()}</div>
                              )}
                              {r.body && <div className="rb-rule-body">{r.body}</div>}
                            </div>
                          ))}
                        </div>
                      )
                    }
                    const cardCategories = sections.filter(name => {
                      if (!q) return true
                      if (name.toLowerCase().includes(q)) return true
                      return (filteredBySection[name]?.length || 0) > 0
                    })
                    if (cardCategories.length === 0) {
                      return (
                        <div className="rb-empty rb-empty-card">
                          <div className="rb-empty-title">{t('documents.noCategoriesMatch')}</div>
                          <div className="rb-empty-sub">{t('documents.noCategoriesMatchSub')}</div>
                        </div>
                      )
                    }
                    return (
                      <>
                        {/* Desktop shows every category card. On phones CSS caps
                            this at the first 3 and the "More" link reveals the
                            rest in a popup. */}
                        <div className="rb-cat-list">
                          {cardCategories.map(name => {
                            const count = filteredBySection[name]?.length || 0
                            return (
                              <button key={name} className="rb-cat-card" onClick={() => setActiveCategory(name)}>
                                <span className="rb-cat-card-icon"><CatIconRules name={iconFor(name)} /></span>
                                <span className="rb-cat-card-body">
                                  <span className="rb-cat-card-title">{name}</span>
                                  <span className="rb-cat-card-desc">{describeSection(name, count, t)}</span>
                                </span>
                                <span className="rb-cat-card-count">{count} {count === 1 ? t('documents.ruleSingular') : t('documents.rulePlural')}</span>
                              </button>
                            )
                          })}
                        </div>
                        {cardCategories.length > 3 && (
                          <button type="button" className="rb-cat-more" onClick={() => setRuleCatOpen(true)}>
                            {t('documents.moreCategories')}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                        )}
                      </>
                    )
                  })() : (
                    <div className="rb-active-section">
                      <div className="rb-active-head">
                        <h2>{withAmp(activeCategory)}</h2>
                        <button className="rb-active-clear" onClick={() => setActiveCategory('all')}>{t('documents.showAllCategories')}</button>
                      </div>
                      {(!filteredBySection[activeCategory] || filteredBySection[activeCategory].length === 0) ? (
                        <div className="rb-empty rb-empty-card">
                          <div className="rb-empty-title">{t('documents.noRulesInCategory', { category: activeCategory })}</div>
                          <div className="rb-empty-sub">
                            {t('documents.noRulesInCategorySub', { category: activeCategory.toLowerCase() })}
                          </div>
                        </div>
                      ) : (
                        <div className="rb-rule-list">
                          {filteredBySection[activeCategory].map((r: any) => (
                            <div className="rb-rule" key={r.id}>
                              <div className="rb-rule-head">
                                <div className="rb-rule-title">{r.title}</div>
                                {r.fine != null && Number(r.fine) > 0 && (
                                  <span className="rb-rule-fine">{t('documents.fineLabel', { amount: fmtMoney(r.fine) })}</span>
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
                  {/* View counts aren't tracked — the "most viewed" framing +
                      numbers are preview-only; real communities get a plain
                      quick-reference list of their own rules. */}
                  <div className="rb-col-head">{usingDemoRules ? t('documents.mostViewedRules') : t('documents.rulesQuickRef')}</div>
                  <ol className="rb-most-list">
                    {mostViewed.map((r: any, i: number) => {
                      const views = MOST_VIEWED_DEMO_COUNTS[i] ?? Math.max(20, 60 - i * 8)
                      return (
                        <li className="rb-most-item" key={r.id}>
                          <span className="rb-most-rank">{i + 1}</span>
                          <div className="rb-most-body">
                            <div className="rb-most-title">{r.title}</div>
                            <div className="rb-most-meta">{r.section || t('documents.generalCategory')}</div>
                          </div>
                          {usingDemoRules && (
                            <div className="rb-most-views">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                                <circle cx="12" cy="12" r="3"/>
                              </svg>
                              <span>{views.toLocaleString('en-US')}</span>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                </aside>
              </div>

              <div className="rb-suggest">
                <div className="rb-suggest-body">
                  <div className="rb-suggest-eyebrow">{t('documents.suggestEyebrow')}</div>
                  <div className="rb-suggest-title">{t('documents.suggestTitle')}</div>
                  <div className="rb-suggest-sub">
                    {t('documents.suggestSub')}
                  </div>
                </div>
                <Link href="/app/voice?cat=rule_proposal#contact" className="rb-suggest-cta">
                  {t('documents.suggestCta')}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
                  </svg>
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
      )}

      {/* ════════════════════════════════════════════════════════════════
          DOCUMENTS SECTION
      ════════════════════════════════════════════════════════════════ */}
      {tab === 'documents' && (
      <section id="easydocs-documents" style={{ scrollMarginTop: 56 }}>
        <div className="doc-wrap">
          <section className="doc-hero">
            <div className="doc-hero-content">
              <h1 className="doc-hero-title">{t('documents.docsHeroTitle')}</h1>
              <div className="doc-hero-sub">
                {t('documents.docsHeroSub')}
              </div>
            </div>
          </section>

          <div className="doc-toolbar" style={{ position: 'relative' }}>
            <div className="doc-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
              </svg>
              <input
                name="doc-search"
                type="search"
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (globalResults[0]) onSearchResult(globalResults[0]) } }}
                placeholder={t('documents.smartSearchPlaceholder')}
              />
            </div>
            {smartPanel}
            <Dropdown<string>
              value={docFilterCategory}
              onChange={v => setDocFilterCategory(v)}
              ariaLabel={t('documents.allCategories')}
              options={[
                { value: 'all', label: t('documents.allCategories') },
                ...CATEGORY_GRID.map(c => ({ value: c.label, label: t(`documents.cat_${c.key}_label`) })),
              ]}
            />
            <div className="rsv-web">
              <Dropdown<string>
                value={docFilterPeriod}
                onChange={v => setDocFilterPeriod(v as any)}
                ariaLabel={t('documents.recentlyUpdated')}
                options={[
                  { value: 'recent', label: t('documents.recentlyUpdated') },
                  { value: 'oldest', label: t('documents.oldestFirst') },
                ]}
              />
            </div>
          </div>

          <div className="doc-rows">
            <div className="doc-row">
              <section className="doc-card">
                <h2 className="doc-card-title">{t('documents.documentCategories')}</h2>
                {/* Desktop shows the full grid. On phones, CSS hides everything
                    past the first 4 cards and the "More" link below reveals the
                    rest in a popup. */}
                <div className="doc-cat-grid">
                  {CATEGORY_GRID.map(c => {
                    const count = categoryCounts[c.label.toLowerCase()] || 0
                    const active = docFilterCategory.toLowerCase() === c.label.toLowerCase()
                    return (
                      <button key={c.key} type="button" className={`doc-cat${active ? ' active' : ''}`}
                        aria-pressed={active}
                        onClick={() => { setDocFilterCategory(active ? 'all' : c.label); scrollToDocResults() }}>
                        <span className="doc-cat-icon"><DocCatIcon name={c.key} /></span>
                        <span className="doc-cat-body">
                          <span className="doc-cat-label">{t(`documents.cat_${c.key}_label`)}</span>
                          <span className="doc-cat-desc">{t(`documents.cat_${c.key}_desc`)}</span>
                          {count > 0 && <span className="doc-cat-count">{count} {count === 1 ? t('documents.docSingular') : t('documents.docPlural')}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button type="button" className="doc-cat-more" onClick={() => setCatOpen(true)}>
                  {t('documents.moreCategories')}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </section>

              {(!community || pinnedDocs.length > 0) && (
              <section className="doc-card">
                <div className="doc-card-head">
                  <h2 className="doc-card-title">{t('documents.pinnedImportant')}</h2>
                  <button type="button" className="doc-card-link" onClick={() => setListOpen('pinned')}>{t('documents.viewAll')}</button>
                </div>
                <div className="doc-pinned-grid">
                  {community ? pinnedDocs.map((d: any) => (
                    <button key={d.id} type="button" className="doc-pinned" onClick={() => openDoc(d)}>
                      <span className="doc-pinned-icon"><PdfIcon /></span>
                      <span className="doc-pinned-tag">{d.category || t('documents.otherCategory')}</span>
                      <span className="doc-pinned-title">{d.title}</span>
                      <span className="doc-pinned-meta">{fmtDate(d.uploaded_at)}</span>
                    </button>
                  )) : DEMO_PINNED.map(p => (
                    <button key={p.id} type="button" className="doc-pinned"
                      onClick={() => setDocDetail({ title: p.title, category: p.category, date: p.date })}>
                      <span className="doc-pinned-icon"><PdfIcon /></span>
                      <span className="doc-pinned-tag">{p.category}</span>
                      <span className="doc-pinned-title">{p.title}</span>
                      <span className="doc-pinned-meta">PDF &middot; {fmtDate(p.date)}</span>
                    </button>
                  ))}
                </div>
              </section>
              )}
            </div>

            <div className="doc-row rsv-web">
              <section className="doc-card doc-need">
                <div className="doc-need-icon" aria-hidden="true"><IconHelp /></div>
                <div className="doc-need-body">
                  <div className="doc-need-title">{t('documents.needDocTitle')}</div>
                  <div className="doc-need-sub">
                    {t('documents.needDocSub')}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <Link href="/app/voice#contact" className="doc-cta-primary">{t('documents.requestDocument')}</Link>
                  {/* Statutory right to inspect official records — FS 718.111(12)(c) / 720.303(5).
                      Routes to the request form; the resident picks "Records inspection". */}
                  <Link href="/app/voice#contact" className="doc-card-link" style={{ fontSize: 12.5 }}>
                    Request to inspect official records →
                  </Link>
                </div>
              </section>

              <section className="doc-card doc-stay">
                <div className="doc-stay-bell" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 19a2 2 0 0 0 4 0"/>
                  </svg>
                </div>
                <div className="doc-stay-body">
                  <div className="doc-stay-title">{t('documents.stayInformedTitle')}</div>
                  <div className="doc-stay-sub">
                    {t('documents.stayInformedSub')}
                  </div>
                </div>
                <Link href="/app/settings" className="doc-cta-secondary">{t('documents.manageNotifications')}</Link>
              </section>
            </div>

            <div className="doc-row" ref={docResultsRef}>
              <section className="doc-card">
                <div className="doc-card-head">
                  <h2 className="doc-card-title">{t('documents.recentDocuments')}</h2>
                  {(docFilterCategory !== 'all' || docSearch.trim())
                    ? <button type="button" className="doc-card-link" onClick={() => { setDocFilterCategory('all'); setDocSearch('') }}>{t('documents.clearFilter')}</button>
                    : <button type="button" className="doc-card-link" onClick={() => setListOpen('recent')}>{t('documents.viewAll')}</button>}
                </div>
                {docFilterCategory !== 'all' && (
                  <div className="doc-filter-note">{t('documents.showingCategory', { category: activeCatLabel })}</div>
                )}
                {docError && <div className="doc-err">{docError}</div>}
                {docLoading && <div className="doc-empty">{t('documents.loading')}</div>}
                {!docLoading && recent.length === 0 && (
                  <div className="doc-empty">
                    {(docFilterCategory !== 'all' || docSearch.trim())
                      ? t('documents.noDocumentsMatch')
                      : t('documents.noDocumentsYet')}
                  </div>
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
                            {d.category || t('documents.otherCategory')}
                            {d.size_bytes ? <> &middot; {fmtSize(d.size_bytes)}</> : null}
                          </span>
                        </span>
                        <span className="doc-recent-date">{fmtDate(d.uploaded_at)}</span>
                        <span className="doc-recent-action">{busy === d.id ? t('documents.opening') : t('documents.open')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* "Popular downloads" needs download tracking we don't have —
                  it's preview-only. Real communities have the honest Recent
                  documents list instead. */}
              {!community && (
              <section className="doc-card">
                <div className="doc-card-head">
                  <h2 className="doc-card-title">{t('documents.popularDownloads')}</h2>
                  <button type="button" className="doc-card-link" onClick={() => setListOpen('popular')}>{t('documents.viewAll')}</button>
                </div>
                <div className="doc-popular">
                  {DEMO_POPULAR.map(p => (
                    <button key={p.id} type="button" className="doc-popular-row"
                      onClick={() => setDocDetail({ title: p.label })}>
                      <span className="doc-popular-icon"><PdfIcon /></span>
                      <span className="doc-popular-title">{p.label}</span>
                      <span className="doc-popular-dl" aria-label={t('documents.open')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M5 20h14"/>
                        </svg>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              )}
            </div>

          </div>
        </div>
      </section>
      )}

      {/* My Violations moved to Easy Track (/app/track → Violations tab). */}

      {/* A single document — detail in place. */}
      {docDetail && (
        <DetailDialog
          eyebrow={docDetail.category || t('documents.documentEyebrow')}
          title={docDetail.title}
          period={docDetail.date ? `PDF · ${fmtDate(docDetail.date)}` : undefined}
          onClose={() => setDocDetail(null)}
          footer={docDetail.doc ? (
            <button type="button" className="ven-cta-primary" onClick={() => { const d = docDetail.doc; setDocDetail(null); openDoc(d) }}>{t('documents.openDocument')}</button>
          ) : undefined}
        >
          <div className="rd-bd-table">
            {docDetail.category && <div className="rd-bd-row"><span className="rd-bd-cat">{t('documents.detailCategory')}</span><span className="rd-bd-amt">{docDetail.category}</span><span /></div>}
            {docDetail.date && <div className="rd-bd-row"><span className="rd-bd-cat">{t('documents.detailUpdated')}</span><span className="rd-bd-amt">{fmtDate(docDetail.date)}</span><span /></div>}
            {docDetail.size && <div className="rd-bd-row"><span className="rd-bd-cat">{t('documents.detailSize')}</span><span className="rd-bd-amt">{docDetail.size}</span><span /></div>}
          </div>
          {!docDetail.doc && (
            <p className="rd-detail-foot-note">
              {t('documents.boardPublishedNote')}
            </p>
          )}
        </DetailDialog>
      )}

      {/* A single rule — opened by pressing Enter in the rules search. */}
      {ruleDetail && (
        <DetailDialog
          eyebrow={(ruleDetail.section || '').trim() || t('documents.generalCategory')}
          title={ruleDetail.title}
          onClose={() => setRuleDetail(null)}
          footer={
            <button type="button" className="ven-cta-primary"
              onClick={() => { const s = (ruleDetail.section || '').trim(); setRuleDetail(null); setTab('rules'); setActiveCategory(s || 'all') }}>
              {t('documents.ruleViewCategory')}
            </button>
          }
        >
          {ruleDetail.fine != null && Number(ruleDetail.fine) > 0 && (
            <div style={{ marginBottom: 12 }}>
              <span className="rb-rule-fine">{t('documents.fineLabel', { amount: fmtMoney(ruleDetail.fine) })}</span>
            </div>
          )}
          {ruleDetail.body && (
            <p style={{ fontSize: 14.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text)' }}>{ruleDetail.body}</p>
          )}
        </DetailDialog>
      )}

      {/* "View all" lists — pinned / recent / popular. */}
      {listOpen && (
        <DetailDialog
          eyebrow={t('documents.documentsEyebrow')}
          title={listOpen === 'pinned' ? t('documents.pinnedImportant') : listOpen === 'recent' ? t('documents.recentDocuments') : t('documents.popularDownloads')}
          size="wide"
          onClose={() => setListOpen(null)}
        >
          <div className="rd-list">
            {listOpen === 'pinned' && (community ? pinnedDocs : DEMO_PINNED as any[]).map((p: any) => (
              <button type="button" className="rd-list-row" key={p.id}
                onClick={() => { setListOpen(null); community ? openDoc(p) : setDocDetail({ title: p.title, category: p.category, date: p.date }) }}>
                <span className="doc-pinned-icon"><PdfIcon /></span>
                <span className="rd-list-body"><span className="rd-list-title">{p.title}</span><span className="rd-list-meta">{p.category || t('documents.otherCategory')} · {fmtDate(community ? p.uploaded_at : p.date)}</span></span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
            {listOpen === 'recent' && (docFiltered.length === 0 ? (
              <p className="rd-detail-foot-note" style={{ marginTop: 0 }}>{t('documents.noDocumentsShort')}</p>
            ) : docFiltered.map(d => (
              <button type="button" className="rd-list-row" key={d.id}
                onClick={() => { setListOpen(null); openDoc(d) }}>
                <span className="doc-pinned-icon"><PdfIcon /></span>
                <span className="rd-list-body"><span className="rd-list-title">{d.title}</span><span className="rd-list-meta">{d.category || t('documents.otherCategory')}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''} · {fmtDate(d.uploaded_at)}</span></span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            )))}
            {listOpen === 'popular' && DEMO_POPULAR.map(p => (
              <button type="button" className="rd-list-row" key={p.id}
                onClick={() => { setListOpen(null); setDocDetail({ title: p.label }) }}>
                <span className="doc-pinned-icon"><PdfIcon /></span>
                <span className="rd-list-body"><span className="rd-list-title">{p.label}</span></span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        </DetailDialog>
      )}

      {/* Phone-only: all document categories (the home grid shows just 4). */}
      {catOpen && (
        <DetailDialog
          eyebrow={t('documents.documentsEyebrow')}
          title={t('documents.documentCategories')}
          size="wide"
          onClose={() => setCatOpen(false)}
        >
          <div className="rd-list">
            {CATEGORY_GRID.map(c => {
              const count = categoryCounts[c.label.toLowerCase()] || 0
              return (
                <button type="button" className="rd-list-row" key={c.key}
                  onClick={() => { setCatOpen(false); setDocFilterCategory(c.label); scrollToDocResults() }}>
                  <span className="doc-cat-icon"><DocCatIcon name={c.key} /></span>
                  <span className="rd-list-body">
                    <span className="rd-list-title">{t(`documents.cat_${c.key}_label`)}</span>
                    <span className="rd-list-meta">
                      {t(`documents.cat_${c.key}_desc`)}
                      {count > 0 ? ` · ${count} ${count === 1 ? t('documents.docSingular') : t('documents.docPlural')}` : ''}
                    </span>
                  </span>
                  <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              )
            })}
          </div>
        </DetailDialog>
      )}

      {/* Phone-only: all rule categories (the Rules grid shows just 3). */}
      {ruleCatOpen && (
        <DetailDialog
          eyebrow={t('documents.tabRules')}
          title={t('documents.browseByCategory')}
          size="wide"
          onClose={() => setRuleCatOpen(false)}
        >
          <div className="rd-list">
            {sections.map(name => {
              const count = bySection[name]?.length || 0
              return (
                <button type="button" className="rd-list-row" key={name}
                  onClick={() => { setRuleCatOpen(false); setActiveCategory(name) }}>
                  <span className="rb-cat-card-icon"><CatIconRules name={iconFor(name)} /></span>
                  <span className="rd-list-body">
                    <span className="rd-list-title">{name}</span>
                    <span className="rd-list-meta">{count} {count === 1 ? t('documents.ruleSingular') : t('documents.rulePlural')}</span>
                  </span>
                  <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              )
            })}
          </div>
        </DetailDialog>
      )}
    </div>
  )
}

// ─── Your violations (moved here from Contact) ──────────────────────────────

const VIOL_PAGE = 5
const DEMO_VIOLATIONS = [
  { id: 'dv1', kind: 'warning', rule_title: 'Trash bins left out', amount: null, status: 'open',   resolution: null, opened_at: '2026-05-20', notes: 'Bins must be stored by 8 PM on collection day.' },
  { id: 'dv2', kind: 'fine',    rule_title: 'Unauthorized parking', amount: 50,  status: 'open',   resolution: null, opened_at: '2026-05-10', notes: null },
  { id: 'dv3', kind: 'warning', rule_title: 'Noise after quiet hours', amount: null, status: 'closed', resolution: 'Resolved', opened_at: '2026-04-28', notes: null },
  { id: 'dv4', kind: 'warning', rule_title: 'Holiday decor past Jan 15', amount: null, status: 'closed', resolution: 'Resolved', opened_at: '2026-02-01', notes: null },
  { id: 'dv5', kind: 'fine',    rule_title: 'Pet off-leash', amount: 25, status: 'closed', resolution: 'Paid', opened_at: '2026-01-12', notes: null },
  { id: 'dv6', kind: 'warning', rule_title: 'Balcony storage', amount: null, status: 'open', resolution: null, opened_at: '2026-05-30', notes: 'Items must be removed from the balcony railing.' },
]

// The resident's own violations (RLS-scoped to their profile). Read-only here;
// appeals are filed through Contact the board. 5 per page with pagination.
// Demo fallback so it renders in preview.
function MyViolationsPanel() {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { violations } = useMyViolations()
  const data: any[] = violations.length ? violations : DEMO_VIOLATIONS
  const isReal = violations.length > 0
  const [page, setPage] = useState(0)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const pages = Math.max(1, Math.ceil(data.length / VIOL_PAGE))
  const shown = data.slice(page * VIOL_PAGE, page * VIOL_PAGE + VIOL_PAGE)

  // Open, payable fine on a real (non-demo) row → resident can pay it online.
  // A fine with a pending contest isn't payable until the committee rules.
  const payable = (v: any) =>
    isReal && v.kind === 'fine' && v.status !== 'closed' && Number(v.amount) > 0 &&
    v.dispute_status !== 'filed' && v.dispute_status !== 'under_review'

  // What the resident actually pays — the reduced amount once a committee cut it.
  const payAmount = (v: any) =>
    v.dispute_status === 'reduced' && v.reduced_amount != null ? Number(v.reduced_amount) : Number(v.amount)

  // A settled fine — paid via Stripe or marked paid by the board.
  const isPaid = (v: any) =>
    v.status === 'closed' && (v.resolution === 'stripe-paid' || v.resolution === 'manual-paid' || v.resolution === 'Paid')

  // Friendly closed-state label (raw resolutions like "stripe-paid" shouldn't show).
  const resolvedLabel = (v: any): string => {
    if (isPaid(v)) return t('documents.statusPaid')
    if (v.resolution === 'waived') return t('documents.statusWaived')
    if (v.resolution === 'dismissed') return t('documents.statusClosed')
    return v.resolution || t('documents.statusClosed')   // demo strings (e.g. "Resolved")
  }

  // A fine awaiting the committee's ruling on a contest.
  const underReview = (v: any) =>
    v.status === 'appealed' || v.dispute_status === 'filed' || v.dispute_status === 'under_review'

  // The status pill text + tone (drives its colour) for a violation.
  const statusLabel = (v: any): string =>
    v.status === 'closed' ? resolvedLabel(v)
    : underReview(v) ? t('documents.statusUnderReview')
    : t('documents.statusOpen')
  const statusTone = (v: any): string =>
    isPaid(v) ? 'paid' : v.status === 'closed' ? 'closed' : underReview(v) ? 'review' : 'open'

  const onPay = (v: any) => {
    setPayError(null)
    openCheckout({ fn: 'create-fine-checkout', body: { violation_id: v.id }, returnUrl: '/app/documents?fine_paid=1#violations' })
  }

  return (
    <section className="doc-card" style={{ gridColumn: '1 / -1' }}>
      <div className="doc-card-head">
        <h2 className="doc-card-title">{t('documents.yourViolations')}</h2>
      </div>
      <p style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(10,36,64,0.55)', margin: '-2px 0 14px' }}>{t('documents.appealsNote')}</p>
      {payError && <div className="myv-pay-err">{payError}</div>}
      {data.length === 0 ? (
        <div className="doc-empty">{t('documents.noViolations')}</div>
      ) : (
        <div className="myv-list">
          {shown.map(v => {
            const isFine = v.kind === 'fine'
            const canContest = isReal && isFine && v.status !== 'closed'
            const hasActions = payable(v) || canContest
            return (
              <div className="myv-card" key={v.id}>
                <div className="myv-card-top">
                  <div className="myv-tags">
                    <span className={`myv-tag myv-tag-${v.kind}`}>{isFine ? t('documents.tagFine') : t('documents.tagWarning')}</span>
                    <span className={`myv-status myv-status-${statusTone(v)}`}>{statusLabel(v)}</span>
                  </div>
                  {isFine && v.amount != null && Number(v.amount) > 0 && (
                    <div className="myv-amt">{fmtMoney(payAmount(v))}</div>
                  )}
                </div>
                <div className="myv-title">{v.rule_title || t('documents.communityRule')}</div>
                <div className="myv-meta">{t('documents.openedOn', { date: fmtDate(v.opened_at) })}</div>
                {v.notes && <p className="myv-note">{v.notes}</p>}
                {hasActions && (
                  <div className="myv-actions">
                    {payable(v) && (
                      <button
                        type="button"
                        className="myv-pay-btn"
                        onClick={() => onPay(v)}
                        disabled={payingId === v.id}
                      >
                        {payingId === v.id ? t('documents.payingFine') : t('documents.payFine', { amount: fmtMoney(payAmount(v)) })}
                      </button>
                    )}
                    {canContest && (
                      <ContestFineControl violation={v} className="myv-pay-btn myv-contest-btn" />
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {pages > 1 && (
            <div className="con-pager">
              <button type="button" className="con-pager-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>&lsaquo; {t('documents.prev')}</button>
              <span className="con-pager-info">{t('documents.pageOf', { page: page + 1, pages })}</span>
              <button type="button" className="con-pager-btn" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>{t('documents.next')} &rsaquo;</button>
            </div>
          )}
        </div>
      )}
    </section>
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
    vendor:     <><path d="M3 7h18l-1.4 11.2A2 2 0 0 1 17.6 20H6.4a2 2 0 0 1-2-1.8z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></>,
    director:   <><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><path d="M16 3l1.5 1.5L20 2"/></>,
    inspection: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/><path d="m14 14 2 2 4-4"/></>,
    maps:       <><path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/></>,
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
