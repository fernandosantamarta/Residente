'use client'

import { useMemo, useState } from 'react'
import { useDocuments } from '@/hooks/useDocuments'
import { supabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const DOCS_PAGE_SIZE = 10

const fmtSize = (b) => {
  const n = Number(b) || 0
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '')

// Resident-facing document archive — files the board has uploaded, grouped
// by category. Filterable by category and by when uploaded.
export default function Documents() {
  const { documents, loading } = useDocuments()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const list = documents || []

  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterPeriod, setFilterPeriod] = useState<
    'all' | 'week' | 'month' | 'past-week' | 'past-month' | 'past-year'
  >('all')
  const [page, setPage] = useState(1)

  async function open(doc) {
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

  // Available categories — fed to the Category dropdown.
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of list) {
      const c = d.category || 'Other'
      map[c] = (map[c] || 0) + 1
    }
    return map
  }, [list])
  const categoriesList = useMemo(() => Object.keys(categoryCounts), [categoryCounts])

  // Filter the document list by category + upload period.
  const visible = useMemo(() => {
    const today = new Date()
    const dayMs = 24 * 60 * 60 * 1000
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay())
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const past7  = new Date(today.getTime() -   7 * dayMs)
    const past30 = new Date(today.getTime() -  30 * dayMs)
    const past365 = new Date(today.getTime() - 365 * dayMs)

    return list.filter(d => {
      const cat = d.category || 'Other'
      if (filterCategory !== 'all' && cat !== filterCategory) return false
      if (filterPeriod === 'all') return true
      const uploaded = d.uploaded_at ? new Date(d.uploaded_at) : null
      if (!uploaded) return filterPeriod === 'all'
      switch (filterPeriod) {
        case 'week':       return uploaded >= weekStart
        case 'month':      return uploaded >= monthStart
        case 'past-week':  return uploaded >= past7
        case 'past-month': return uploaded >= past30
        case 'past-year':  return uploaded >= past365
        default:           return true
      }
    })
  }, [list, filterCategory, filterPeriod])

  // Group filtered documents by category, newest-first within each.
  const categories: string[] = []
  const byCategory: Record<string, typeof list> = {}
  visible.forEach(d => {
    const c = d.category || 'Other'
    if (!byCategory[c]) { byCategory[c] = []; categories.push(c) }
    byCategory[c].push(d)
  })

  return (
    <div className="docs-wrap">
      <div className="docs-kicker">Community Archive</div>
      <h1 className="docs-h1">Documents</h1>
      <p className="docs-dek">
        Meeting minutes, financials, insurance, and contracts — published by your board.
      </p>

      {!loading && list.length > 0 && (
        <div className="admin-sched-filters" style={{ margin: '18px 0 22px' }}>
          <div className="admin-sched-filter">
            <label>Category</label>
            <Dropdown<string>
              value={filterCategory}
              onChange={setFilterCategory}
              ariaLabel="Filter documents by category"
              options={[
                { value: 'all', label: `All categories (${list.length})` },
                ...categoriesList.map(c => ({ value: c, label: `${c} (${categoryCounts[c]})` })),
              ]}
            />
          </div>
          <div className="admin-sched-filter">
            <label>When uploaded</label>
            <Dropdown<typeof filterPeriod>
              value={filterPeriod}
              onChange={setFilterPeriod}
              ariaLabel="Filter documents by when uploaded"
              options={[
                { value: 'all',        label: 'All time' },
                { value: 'week',       label: 'This week' },
                { value: 'month',      label: 'This month' },
                { value: 'past-week',  label: 'Past week' },
                { value: 'past-month', label: 'Past month' },
                { value: 'past-year',  label: 'Past year' },
              ]}
            />
          </div>
        </div>
      )}

      {error && <div className="docs-error">{error}</div>}

      {loading && <div className="docs-empty">Loading the archive…</div>}

      {!loading && list.length === 0 && (
        <div className="docs-empty">
          <div className="docs-empty-title">No documents yet</div>
          <div className="docs-empty-sub">
            When your board uploads minutes, financials, or other records,
            they appear here to download.
          </div>
        </div>
      )}

      {!loading && list.length > 0 && visible.length === 0 && (
        <div className="docs-empty">
          <div className="docs-empty-title">No documents match these filters</div>
          <div className="docs-empty-sub">
            Try a different category or time period.
          </div>
        </div>
      )}

      {/* Paginated flat list — the page slice is then re-grouped by
          category so existing visual structure (section titles) is
          preserved while still letting the resident page through. */}
      {!loading && visible.length > 0 && (() => {
        const pageItems = paginate(visible, page, DOCS_PAGE_SIZE)
        const pageCats: string[] = []
        const pageByCat: Record<string, typeof visible> = {}
        pageItems.forEach(d => {
          const c = d.category || 'Other'
          if (!pageByCat[c]) { pageByCat[c] = []; pageCats.push(c) }
          pageByCat[c].push(d)
        })
        return (
          <>
            {pageCats.map(c => (
              <div className="docs-section" key={c}>
                <div className="docs-section-title">{c}</div>
                <div className="docs-list">
                  {pageByCat[c].map(d => (
                    <button
                      className="doc-item"
                      key={d.id}
                      onClick={() => open(d)}
                      disabled={busy === d.id}
                    >
                      <svg className="doc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                        <path d="M14 3v6h6"/>
                      </svg>
                      <div className="doc-main">
                        <div className="doc-title">{d.title}</div>
                        <div className="doc-meta">
                          {fmtDate(d.uploaded_at)}
                          {fmtSize(d.file_size) && ` · ${fmtSize(d.file_size)}`}
                        </div>
                      </div>
                      <span className="doc-action">{busy === d.id ? 'Opening…' : 'Open'}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <Pagination
              page={page}
              pageSize={DOCS_PAGE_SIZE}
              total={visible.length}
              onPageChange={setPage}
            />
          </>
        )
      })()}
    </div>
  )
}
