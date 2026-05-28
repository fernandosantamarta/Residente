'use client'

import Link from 'next/link'
import { ReactNode, useMemo, useState } from 'react'
import { useDocuments } from '@/hooks/useDocuments'
import { supabase } from '@/lib/supabase'

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

// Canonical category list — icon + description per row, matched to the
// approved mockup so the resident sees a structured table of contents
// rather than a raw alphabetical list.
type CatIcon = 'gov' | 'finance' | 'rules' | 'forms' | 'notice' | 'minutes' | 'insurance' | 'vendor' | 'maps'
const CATEGORY_GRID: { key: CatIcon; label: string; desc: string }[] = [
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

// Pinned demo set — featured at the top so a brand-new resident sees the
// four documents that matter most first. Replace with a real
// is_pinned flag when the documents table grows one.
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

// Resident-facing Documents archive. Mockup layout: sunset hero,
// search + category filter, left-column category grid + "Need a
// document?" card, right-column pinned card + recent table + stay
// informed nudge + popular downloads.
export default function Documents() {
  const { documents, loading } = useDocuments() as { documents: any[]; loading: boolean }
  const list = documents || []
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterPeriod, setFilterPeriod] = useState<'recent' | 'oldest'>('recent')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function open(doc: any) {
    setBusy(doc.id); setError('')
    try {
      const { data, error } = await supabase.storage
        .from('documents').createSignedUrl(doc.storage_path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('No link')
      window.open(data.signedUrl, '_blank', 'noopener')
    } catch {
      setError('Could not open that document. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of list) {
      const c = (d.category || 'Other').toLowerCase()
      map[c] = (map[c] || 0) + 1
    }
    return map
  }, [list])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = list.filter(d => {
      if (filterCategory !== 'all'
          && (d.category || '').toLowerCase() !== filterCategory.toLowerCase()) return false
      if (!q) return true
      const hay = `${d.title || ''} ${d.category || ''}`.toLowerCase()
      return hay.includes(q)
    })
    out.sort((a, b) => {
      const at = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0
      const bt = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0
      return filterPeriod === 'recent' ? bt - at : at - bt
    })
    return out
  }, [list, search, filterCategory, filterPeriod])

  const recent = filtered.slice(0, 6)

  return (
    <div className="doc-wrap">
      <section className="doc-hero">
        <div className="doc-hero-content">
          <h1 className="doc-hero-title">Documents</h1>
          <div className="doc-hero-sub">
            Important community documents, resources, and forms &mdash; all in one place.
          </div>
        </div>
      </section>

      {/* Search + filter row (Upload removed — residents can't upload,
          they request via the "Need a document?" card below). */}
      <div className="doc-toolbar">
        <div className="doc-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <input
            name="doc-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents…"
          />
        </div>
        <select name="doc-category" className="doc-select" value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}>
          <option value="all">All Categories</option>
          {CATEGORY_GRID.map(c => (
            <option key={c.key} value={c.label}>{c.label}</option>
          ))}
        </select>
        <select name="doc-period" className="doc-select" value={filterPeriod}
          onChange={e => setFilterPeriod(e.target.value as any)}>
          <option value="recent">Recently Updated</option>
          <option value="oldest">Oldest First</option>
        </select>
      </div>

      {/* Three paired rows — each row's pair stretches to matched
          height so the bottom edges align. */}
      <div className="doc-rows">
        {/* Row 1: Document Categories | Pinned & Important */}
        <div className="doc-row">
          <section className="doc-card">
            <h2 className="doc-card-title">Document Categories</h2>
            <div className="doc-cat-grid">
              {CATEGORY_GRID.map(c => {
                const count = categoryCounts[c.label.toLowerCase()] || 0
                return (
                  <button
                    key={c.key}
                    type="button"
                    className="doc-cat"
                    onClick={() => setFilterCategory(c.label)}
                  >
                    <span className="doc-cat-icon"><CatIcon name={c.key} /></span>
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

        {/* Row 2: Need a Document | Stay Informed */}
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

        {/* Row 3: Recent Documents | Popular Downloads */}
        <div className="doc-row">
          <section className="doc-card">
            <div className="doc-card-head">
              <h2 className="doc-card-title">Recent Documents</h2>
              <Link href="#" className="doc-card-link">View all</Link>
            </div>
            {error && <div className="doc-err">{error}</div>}
            {loading && <div className="doc-empty">Loading…</div>}
            {!loading && recent.length === 0 && (
              <div className="doc-empty">No documents yet. Check back as the board adds them.</div>
            )}
            {!loading && recent.length > 0 && (
              <div className="doc-recent">
                {recent.map(d => (
                  <button
                    type="button"
                    key={d.id}
                    className="doc-recent-row"
                    onClick={() => open(d)}
                    disabled={busy === d.id}
                  >
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
  )
}

// -- category icons ------------------------------------------------

function CatIcon({ name }: { name: CatIcon }) {
  const paths: Record<CatIcon, ReactNode> = {
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
