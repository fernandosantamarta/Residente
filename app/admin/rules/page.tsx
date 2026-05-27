'use client'

import { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import {
  addStoredCategory,
  addStoredRule,
  deleteAllRules,
  getHideDemo,
  hideBuiltInCategory,
  removeStoredCategory,
  removeStoredRule,
  restoreDemoRules,
  RULE_CATEGORIES,
  useCategoriesData,
  useRulesData,
} from '@/lib/rules'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const RULE_BOOK_PAGE_SIZE = 6

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtPubDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}
const EMPTY = { section: '', title: '', body: '', fine: '' }

// Admin → Rules. Board adds covenants and house rules; each one shows on
// every resident's Rules page, grouped by section.
export default function Rules() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')   // loading | ready | none | error
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfStatus, setPdfStatus] = useState<string>('')
  const pdfInputRef = useRef<HTMLInputElement | null>(null)

  // Categories + filter state
  const categories = useCategoriesData()
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterPeriod, setFilterPeriod] = useState<
    'all' | 'week' | 'month' | 'past-week' | 'past-month' | 'past-year'
  >('all')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  // Auto-dismiss the green confirmation banner after 4 seconds so it
  // never lingers between actions.
  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  // Shared rule book — local DEMO + localStorage. The board sees the
  // same rules the residents see at /app/rules. When Supabase is wired
  // up, swap this hook for a real query.
  const shared = useRulesData()
  useEffect(() => {
    setRows(shared as any)
    setStatus('ready')
  }, [shared])

  const load = useCallback(async () => {
    // No-op in the shared-storage path; kept for the retry button.
    setStatus('ready')
  }, [])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const add = (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Give the rule a title'); return }
    setSaving(true); setError('')
    try {
      const section = form.section.trim() || null
      const title = form.title.trim()
      // If the section the board typed isn't on the list yet (and they
      // didn't hide it), auto-create it as a category so it shows up as
      // a chip on the resident /app/rules page right alongside the rule.
      const newCategoryCreated = section && !categories.includes(section)
      if (newCategoryCreated) {
        addStoredCategory(section!)
      }
      addStoredRule({
        section,
        title,
        body: form.body.trim() || null,
        fine: form.fine === '' ? null : Number(form.fine),
        sort_order: rows.length,
      })
      setForm(EMPTY)
      setSuccessMsg(
        newCategoryCreated
          ? `Added "${title}" — "${section}" is now a category too.`
          : `Added "${title}" to the rule book.`
      )
    } catch (err) {
      setError((err as any)?.message || 'Could not add the rule')
    } finally {
      setSaving(false)
    }
  }

  const onPickPdf = (e: ChangeEvent<HTMLInputElement>) => {
    setPdfFile(e.target.files?.[0] || null)
    setPdfStatus('')
  }
  const importPdf = () => {
    if (!pdfFile) return
    // TODO: wire to /api/parse-rules-pdf that returns a list of
    // {section, title, body, fine} for the board to confirm before
    // inserting. For now this is the upload stub.
    setPdfStatus(`Received ${pdfFile.name} — PDF parsing isn't wired yet, but the file is ready.`)
  }

  const remove = (id) => {
    // Seeded demo rules (r-*) live in code and can't be deleted from
    // here. Anything the board has added carries a "u-" prefix and
    // goes through localStorage.
    if (typeof id === 'string' && id.startsWith('r-')) {
      setError("That's a seeded sample rule — can't be removed from here.")
      return
    }
    removeStoredRule(id)
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Rules</div>
      <h1 className="admin-h1">Community rules</h1>
      <p className="admin-dek">
        Covenants and house rules. Everything here shows on each resident's
        Rules page, grouped by section.
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked yet, or the rules table isn't set up. Run the
          rules &amp; documents setup SQL (see supabase/rules-and-documents.sql),
          then reload.
        </div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          <form className="admin-form" onSubmit={add}>
            <div className="admin-field">
              <span className="admin-field-label">Section</span>
              <Dropdown<string>
                value={form.section}
                onChange={v => setField('section', v)}
                ariaLabel="Rule section"
                placeholder="Choose a section…"
                searchable
                onCreate={name => {
                  addStoredCategory(name)
                  setField('section', name)
                  setSuccessMsg(`Added "${name}" as a category.`)
                }}
                onDelete={name => {
                  const isBuiltIn = (RULE_CATEGORIES as readonly string[]).includes(name)
                  if (isBuiltIn) hideBuiltInCategory(name)
                  else removeStoredCategory(name)
                  if (form.section === name) setField('section', '')
                  setSuccessMsg(`Removed "${name}" category.`)
                }}
                options={categories.map(c => ({ value: c, label: c }))}
              />
              <span className="admin-field-hint">
                Search to filter, or type a new section and click <strong>Add</strong>.
              </span>
            </div>
            <label className="admin-field">
              <span className="admin-field-label">Rule</span>
              <input className="admin-input" placeholder="Trash bins stored out of street view"
                value={form.title} onChange={e => setField('title', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Detail (optional)</span>
              <textarea className="admin-input admin-textarea" rows={3}
                placeholder="Plain-language explanation residents will read."
                value={form.body} onChange={e => setField('body', e.target.value)} />
            </label>
            <label className="admin-field" style={{ maxWidth: 200 }}>
              <span className="admin-field-label">Fine $ (optional)</span>
              <input className="admin-input" type="number" placeholder="50"
                value={form.fine} onChange={e => setField('fine', e.target.value)} />
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn" disabled={saving}>
                {saving ? 'Adding…' : 'Add rule'}
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <div className="admin-rules-bulk">
            <div className="admin-rules-bulk-head">
              <h2 className="bc-title">Bulk upload</h2>
              <span className="bc-sub">
                Got a CC&amp;R packet or rule book PDF? Drop it here.
              </span>
            </div>
            <div className="admin-bulk-box admin-bulk-pdf">
              <div className="admin-bulk-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <path d="M14 3v6h6" />
                  <text x="7" y="17" fontSize="6" fontWeight="700" fill="currentColor" stroke="none">PDF</text>
                </svg>
              </div>
              <div className="admin-bulk-body">
                <div className="admin-bulk-title">Rule book PDF</div>
                <div className="admin-bulk-sub">
                  We&rsquo;ll pull rule titles, sections, and fines out automatically so you don&rsquo;t have to retype them.
                </div>
                {pdfFile && <div className="admin-bulk-file">{pdfFile.name}</div>}
                {pdfStatus && <div className="admin-bulk-file" style={{ background: 'rgba(125,140,92,0.14)' }}>{pdfStatus}</div>}
                <div className="admin-bulk-actions">
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={onPickPdf}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="admin-secondary-btn"
                    onClick={() => pdfInputRef.current?.click()}
                  >
                    {pdfFile ? 'Pick another file' : 'Choose file'}
                  </button>
                  <button
                    type="button"
                    className="admin-primary-btn"
                    onClick={importPdf}
                    disabled={!pdfFile}
                  >
                    Import
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bc-head" style={{ marginTop: 40, marginBottom: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 className="bc-title">Rule book</h2>
              <span className="bc-sub">
                {rows.length} {rows.length === 1 ? 'rule' : 'rules'} published.
              </span>
            </div>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              {getHideDemo() && (
                <button
                  type="button"
                  className="admin-btn-ghost"
                  onClick={() => restoreDemoRules()}
                >
                  Restore samples
                </button>
              )}
              <button
                type="button"
                className="admin-rules-danger"
                onClick={() => {
                  if (window.confirm('Delete every rule (including the seeded samples)? You can restore the samples afterward.')) {
                    deleteAllRules()
                  }
                }}
              >
                Delete all
              </button>
            </div>
          </div>

          {/* Filters above the rule book list — same Category +
              Time period pattern as /admin/schedule. */}
          <div className="admin-sched-filters" style={{ marginTop: 4, marginBottom: 12 }}>
            <div className="admin-sched-filter">
              <label>Category</label>
              <Dropdown<string>
                value={filterCategory}
                onChange={setFilterCategory}
                ariaLabel="Filter rules by category"
                options={[
                  { value: 'all', label: `All (${rows.length})` },
                  ...categories.map(c => ({
                    value: c,
                    label: `${c} (${rows.filter((r: any) => (r.section || '') === c).length})`,
                  })),
                ]}
              />
            </div>
            <div className="admin-sched-filter">
              <label>Time period</label>
              <Dropdown<typeof filterPeriod>
                value={filterPeriod}
                onChange={setFilterPeriod}
                ariaLabel="Filter rules by when added"
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

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="bc-empty">No rules yet — add the first one above.</div>
          )}
          {(() => {
            // Filter first so pagination operates on the visible set.
            const filtered = rows.filter((r: any) => {
              if (filterCategory !== 'all' && (r.section || '') !== filterCategory) return false
              if (filterPeriod === 'all') return true
              const added = r.created_at ? new Date(r.created_at) : null
              if (!added) return false
              const today = new Date()
              const dayMs = 24 * 60 * 60 * 1000
              const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay())
              const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
              const past7  = new Date(today.getTime() -   7 * dayMs)
              const past30 = new Date(today.getTime() -  30 * dayMs)
              const past365 = new Date(today.getTime() - 365 * dayMs)
              switch (filterPeriod) {
                case 'week':       return added >= weekStart
                case 'month':      return added >= monthStart
                case 'past-week':  return added >= past7
                case 'past-month': return added >= past30
                case 'past-year':  return added >= past365
              }
            })
            const visible = paginate(filtered, page, RULE_BOOK_PAGE_SIZE)
            return (
              <>
                <div className="bd-list">
                  {visible.map((r: any) => {
                    const open = expandedId === r.id
                    return (
                      <div className={`bd-row${open ? ' open' : ''}`} key={r.id}>
                        <button
                          type="button"
                          className="bd-row-toggle"
                          onClick={() => setExpandedId(open ? null : r.id)}
                          aria-expanded={open}
                        >
                          <div className="bd-main">
                            <div className="bd-title">{r.title}</div>
                            <div className="bd-meta">
                              {r.section && <><span>{r.section}</span><span className="bd-dot">·</span></>}
                              <span>Published {fmtPubDate(r.created_at) || '—'}</span>
                              {r.body && !open && (
                                <>
                                  <span className="bd-dot">·</span>
                                  <span>{r.body.slice(0, 64)}{r.body.length > 64 ? '…' : ''}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {r.fine != null && Number(r.fine) > 0 && (
                            <div className="bd-amount">{fmtMoney(r.fine)}</div>
                          )}
                          <svg className="bd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {open && (
                          <div className="bd-body">
                            {r.body
                              ? <p>{r.body}</p>
                              : <p className="bd-body-empty">No additional detail for this rule.</p>}
                            <div className="bd-body-meta">
                              <span><strong>Section:</strong> {r.section || 'Unsectioned'}</span>
                              <span><strong>Published:</strong> {fmtPubDate(r.created_at) || 'unknown'}</span>
                              {r.fine != null && Number(r.fine) > 0 && (
                                <span><strong>Fine:</strong> {fmtMoney(r.fine)}</span>
                              )}
                            </div>
                          </div>
                        )}
                        <button type="button" className="bc-del" onClick={(e) => { e.stopPropagation(); remove(r.id) }}
                          aria-label="Remove rule">&times;</button>
                      </div>
                    )
                  })}
                </div>
                <Pagination
                  page={page}
                  pageSize={RULE_BOOK_PAGE_SIZE}
                  total={filtered.length}
                  onPageChange={setPage}
                />
              </>
            )
          })()}
        </>
      )}
    </div>
  )
}
