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
import { EasyDocsTabs } from '../EasyDocsTabs'

const RULE_BOOK_PAGE_SIZE = 6
const DOCS_PAGE_SIZE = 8

const withTimeoutRules = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const withTimeoutDocs = (p, ms = 30000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtPubDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}
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

const RULE_EMPTY = { section: '', title: '', body: '', fine: '' }
// Categories aligned with FL 718.111(12)(g) (condos) and FL 720.303(4)(b) (HOAs)
// and the resident-facing CATEGORY_GRID in app/documents/page.tsx.
const DOC_CATEGORIES = [
  'Governing Documents',       // Declaration, bylaws, articles of incorporation, amendments
  'Financial Documents',       // Annual budget, monthly statements, audits, reserve studies
  'Rules & Policies',          // Current rules, CC&Rs, enforcement policies
  'Reports & Meeting Minutes', // Board + member meeting minutes (FL: post within 7 days, retain 7 yrs)
  'Notices & Announcements',   // Meeting notices and agendas (FL: post ≥14 days before member meetings)
  'Insurance',                 // Master policy, certificates of insurance
  'Vendor & Contracts',        // Service contracts >$500, bid summaries, conflict-of-interest contracts
  'Director Records',          // Director certifications, conflict-of-interest disclosures
  'Inspection Reports',        // Structural, life-safety, reserve studies (FL 718.111(12)(g))
  'Forms & Applications',      // ARC, pet, lease, move-in/out forms
  'Maps & Layouts',            // Site plan, parking, common areas
  'Other',
] as const
type DocCategory = typeof DOC_CATEGORIES[number]

// FL-required document types an association must post online.
// Labels must exactly match a DOC_CATEGORIES entry — TypeScript enforces this.
const FL_REQUIRED_CATEGORIES: { label: DocCategory; statute: string }[] = [
  { label: 'Governing Documents',       statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Financial Documents',       statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Rules & Policies',          statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Reports & Meeting Minutes', statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Insurance',                 statute: '720.303(4)(b)1' },
  { label: 'Vendor & Contracts',        statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Director Records',          statute: '718.111(12)(g)2 / 720.303(4)(b)1' },
  { label: 'Inspection Reports',        statute: '718.111(12)(g)2' },
]
const DOC_EMPTY: { title: string; category: DocCategory } = { title: '', category: 'Governing Documents' }

export default function AdminEasyDocs() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id

  // Which section shows: 'rules' or 'documents'. Driven by the URL hash so the
  // Easy Documents sub-nav (Rules / Documents / Violations) can switch Rules
  // and Documents in-page while Violations is its own route. Only the active
  // section renders.
  const [tab, setTab] = useState<'rules' | 'documents'>('rules')
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash.replace(/^#/, '')
      if (h === 'rules' || h === 'documents') setTab(h)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  // ── Rules state ──────────────────────────────────────────────────────────
  const [ruleError, setRuleError] = useState('')
  const [ruleForm, setRuleForm] = useState(RULE_EMPTY)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfStatus, setPdfStatus] = useState<string>('')
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const categories = useCategoriesData()
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterPeriod, setFilterPeriod] = useState<
    'all' | 'week' | 'month' | 'past-week' | 'past-month' | 'past-year'
  >('all')
  const [rulePage, setRulePage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [ruleSuccessMsg, setRuleSuccessMsg] = useState('')
  const rows = useRulesData() as any[]
  const ruleStatus = 'ready' as const

  useEffect(() => {
    if (!ruleSuccessMsg) return
    const id = setTimeout(() => setRuleSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [ruleSuccessMsg])

  const setRuleField = (k, v) => setRuleForm(f => ({ ...f, [k]: v }))

  const addRule = (e) => {
    e.preventDefault()
    if (!ruleForm.title.trim()) { setRuleError('Give the rule a title'); return }
    setRuleSaving(true); setRuleError('')
    try {
      const section = ruleForm.section.trim() || null
      const title = ruleForm.title.trim()
      const newCategoryCreated = section && !categories.includes(section)
      if (newCategoryCreated) addStoredCategory(section!)
      addStoredRule({
        section, title,
        body: ruleForm.body.trim() || null,
        fine: ruleForm.fine === '' ? null : Number(ruleForm.fine),
        sort_order: rows.length,
      })
      setRuleForm(RULE_EMPTY)
      setRuleSuccessMsg(
        newCategoryCreated
          ? `Added "${title}" — "${section}" is now a category too.`
          : `Added "${title}" to the rule book.`
      )
    } catch (err) {
      setRuleError((err as any)?.message || 'Could not add the rule')
    } finally {
      setRuleSaving(false)
    }
  }

  const onPickPdf = (e: ChangeEvent<HTMLInputElement>) => {
    setPdfFile(e.target.files?.[0] || null)
    setPdfStatus('')
  }
  const importPdf = () => {
    if (!pdfFile) return
    setPdfStatus(`Received ${pdfFile.name} — PDF parsing isn't wired yet, but the file is ready.`)
  }

  const removeRule = (id) => {
    if (typeof id === 'string' && id.startsWith('r-')) {
      setRuleError("That's a seeded sample rule — can't be removed from here.")
      return
    }
    removeStoredRule(id)
  }

  // ── Documents state ──────────────────────────────────────────────────────
  const [docRows, setDocRows] = useState([])
  const [docStatus, setDocStatus] = useState('loading')
  const [docError, setDocError] = useState('')
  const [docForm, setDocForm] = useState(DOC_EMPTY)
  const [docFile, setDocFile] = useState(null)
  const [docSaving, setDocSaving] = useState(false)
  const [docSuccessMsg, setDocSuccessMsg] = useState('')
  const [docPage, setDocPage] = useState(1)
  const docFileRef = useRef(null)

  useEffect(() => {
    if (!docSuccessMsg) return
    const id = setTimeout(() => setDocSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [docSuccessMsg])

  const loadDocs = useCallback(async () => {
    if (!hasSupabase || !communityId) { setDocStatus('none'); return }
    setDocStatus('loading'); setDocError('')
    try {
      const { data, error } = await withTimeoutDocs(
        supabase.from('documents').select('*')
          .eq('community_id', communityId)
          .order('uploaded_at', { ascending: false })
      )
      if (error) throw error
      setDocRows(data || [])
      setDocStatus('ready')
    } catch (err) {
      const msg = err?.message || ''
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setDocStatus('none')
      } else {
        setDocError(msg || 'Could not load documents')
        setDocStatus('error')
      }
    }
  }, [communityId])

  useEffect(() => { loadDocs() }, [loadDocs])

  const setDocField = (k, v) => setDocForm(f => ({ ...f, [k]: v }))

  const uploadDoc = async (e) => {
    e.preventDefault()
    if (!docFile) { setDocError('Choose a file to upload'); return }
    if (!docForm.title.trim()) { setDocError('Give the document a title'); return }
    setDocSaving(true); setDocError('')
    try {
      const ext = docFile.name.includes('.') ? docFile.name.split('.').pop().toLowerCase() : 'bin'
      const path = `${communityId}/${crypto.randomUUID()}.${ext}`
      const up = await withTimeoutDocs(supabase.storage.from('documents').upload(path, docFile))
      if (up.error) throw up.error
      const row = {
        community_id: communityId,
        title: docForm.title.trim(),
        category: docForm.category,
        storage_path: path,
        file_size: docFile.size,
      }
      const { data, error } = await withTimeoutDocs(
        supabase.from('documents').insert(row).select().single()
      )
      if (error) {
        supabase.storage.from('documents').remove([path])
        throw error
      }
      setDocRows(rs => [data, ...rs])
      setDocForm(DOC_EMPTY)
      setDocFile(null)
      if (docFileRef.current) docFileRef.current.value = ''
      setDocSuccessMsg(`Uploaded "${row.title}".`)
    } catch (err) {
      setDocError(err?.message || 'Upload failed')
    } finally {
      setDocSaving(false)
    }
  }

  const removeDoc = async (doc) => {
    const prev = docRows
    setDocRows(rs => rs.filter(r => r.id !== doc.id))
    try {
      await withTimeoutDocs(supabase.storage.from('documents').remove([doc.storage_path]))
      const { error } = await withTimeoutDocs(supabase.from('documents').delete().eq('id', doc.id))
      if (error) throw error
      setDocSuccessMsg(`Removed "${doc.title}".`)
    } catch (err) {
      setDocRows(prev)
      setDocError(err?.message || 'Could not remove that document')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="easydocs-combined">
      <EasyDocsTabs active={tab} />

      {/* ════════════════════════════════════════════════════════════════
          RULES SECTION
      ════════════════════════════════════════════════════════════════ */}
      {tab === 'rules' && (
      <section id="easydocs-rules" style={{ scrollMarginTop: 56 }}>
        <div className="admin-page">
          <div className="admin-kicker">Rules</div>
          <h1 className="admin-h1">Community rules</h1>
          <p className="admin-dek">
            Covenants and house rules. Everything here shows on each resident's
            Rules page, grouped by section.
          </p>

          {ruleSuccessMsg && (
            <div className="admin-success" role="status">
              <span className="admin-success-check" aria-hidden="true">✓</span>
              {ruleSuccessMsg}
            </div>
          )}

          <form className="admin-form" onSubmit={addRule}>
            <div className="admin-field">
              <span className="admin-field-label">Section</span>
              <Dropdown<string>
                value={ruleForm.section}
                onChange={v => setRuleField('section', v)}
                ariaLabel="Rule section"
                placeholder="Choose a section…"
                searchable
                onCreate={name => {
                  addStoredCategory(name)
                  setRuleField('section', name)
                  setRuleSuccessMsg(`Added "${name}" as a category.`)
                }}
                onDelete={name => {
                  const isBuiltIn = (RULE_CATEGORIES as readonly string[]).includes(name)
                  if (isBuiltIn) hideBuiltInCategory(name)
                  else removeStoredCategory(name)
                  if (ruleForm.section === name) setRuleField('section', '')
                  setRuleSuccessMsg(`Removed "${name}" category.`)
                }}
                options={categories.map(c => ({ value: c, label: c }))}
              />
              <span className="admin-field-hint">
                Search to filter, or type a new section and click <strong>Add</strong>.
              </span>
            </div>
            <label className="admin-field">
              <span className="admin-field-label">Rule</span>
              <input name="title" className="admin-input" placeholder="Trash bins stored out of street view"
                value={ruleForm.title} onChange={e => setRuleField('title', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Detail (optional)</span>
              <textarea name="body" className="admin-input admin-textarea" rows={3}
                placeholder="Plain-language explanation residents will read."
                value={ruleForm.body} onChange={e => setRuleField('body', e.target.value)} />
            </label>
            <label className="admin-field" style={{ maxWidth: 200 }}>
              <span className="admin-field-label">Fine $ (optional)</span>
              <input name="fine" className="admin-input" type="number" placeholder="50"
                value={ruleForm.fine} onChange={e => setRuleField('fine', e.target.value)} />
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn" disabled={ruleSaving}>
                {ruleSaving ? 'Adding…' : 'Add rule'}
              </button>
              {ruleError && <span className="admin-err-inline">{ruleError}</span>}
            </div>
          </form>

          <div className="admin-rules-bulk">
            <div className="admin-rules-bulk-head">
              <h2 className="bc-title">Bulk upload</h2>
              <span className="bc-sub">Got a CC&amp;R packet or rule book PDF? Drop it here.</span>
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
                  <input name="rule-book-pdf" ref={pdfInputRef} type="file" accept="application/pdf"
                    onChange={onPickPdf} style={{ display: 'none' }} />
                  <button type="button" className="admin-secondary-btn"
                    onClick={() => pdfInputRef.current?.click()}>
                    {pdfFile ? 'Pick another file' : 'Choose file'}
                  </button>
                  <button type="button" className="admin-primary-btn" onClick={importPdf} disabled={!pdfFile}>
                    Import
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bc-head" style={{ marginTop: 40, marginBottom: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 className="bc-title">Rule book</h2>
              <span className="bc-sub">{rows.length} {rows.length === 1 ? 'rule' : 'rules'} published.</span>
            </div>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              {getHideDemo() && (
                <button type="button" className="admin-btn-ghost" onClick={() => restoreDemoRules()}>
                  Restore samples
                </button>
              )}
              <button type="button" className="admin-rules-danger"
                onClick={() => {
                  if (window.confirm('Delete every rule (including the seeded samples)? You can restore the samples afterward.')) {
                    deleteAllRules()
                  }
                }}>
                Delete all
              </button>
            </div>
          </div>

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

          {rows.length === 0 && (
            <div className="bc-empty">No rules yet — add the first one above.</div>
          )}

          {(() => {
            const filtered = rows.filter((r: any) => {
              if (filterCategory !== 'all' && (r.section || '') !== filterCategory) return false
              if (filterPeriod === 'all') return true
              const added = r.created_at ? new Date(r.created_at) : null
              if (!added) return false
              const today = new Date()
              const dayMs = 24 * 60 * 60 * 1000
              const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay())
              const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
              const past7   = new Date(today.getTime() -   7 * dayMs)
              const past30  = new Date(today.getTime() -  30 * dayMs)
              const past365 = new Date(today.getTime() - 365 * dayMs)
              switch (filterPeriod) {
                case 'week':       return added >= weekStart
                case 'month':      return added >= monthStart
                case 'past-week':  return added >= past7
                case 'past-month': return added >= past30
                case 'past-year':  return added >= past365
              }
            })
            const visible = paginate(filtered, rulePage, RULE_BOOK_PAGE_SIZE)
            return (
              <>
                <div className="bd-list">
                  {visible.map((r: any) => {
                    const open = expandedId === r.id
                    return (
                      <div className={`bd-row${open ? ' open' : ''}`} key={r.id}>
                        <button type="button" className="bd-row-toggle"
                          onClick={() => setExpandedId(open ? null : r.id)} aria-expanded={open}>
                          <div className="bd-main">
                            <div className="bd-title">{r.title}</div>
                            <div className="bd-meta">
                              {r.section && <><span>{r.section}</span><span className="bd-dot">·</span></>}
                              <span>Published {fmtPubDate(r.created_at) || '—'}</span>
                              {r.body && !open && (
                                <><span className="bd-dot">·</span>
                                  <span>{r.body.slice(0, 64)}{r.body.length > 64 ? '…' : ''}</span></>
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
                        <button type="button" className="bc-del"
                          onClick={(e) => { e.stopPropagation(); removeRule(r.id) }}
                          aria-label="Remove rule">&times;</button>
                      </div>
                    )
                  })}
                </div>
                <Pagination page={rulePage} pageSize={RULE_BOOK_PAGE_SIZE}
                  total={filtered.length} onPageChange={setRulePage} />
              </>
            )
          })()}
        </div>
      </section>
      )}

      {/* ════════════════════════════════════════════════════════════════
          DOCUMENTS SECTION
      ════════════════════════════════════════════════════════════════ */}
      {tab === 'documents' && (
      <section id="easydocs-documents" style={{ scrollMarginTop: 56 }}>
        <div className="admin-page">
          <div className="admin-kicker">Documents</div>
          <h1 className="admin-h1">Document archive</h1>
          <p className="admin-dek">
            Upload minutes, financials, insurance certificates and contracts.
            Every file shows on each resident's Documents page to download.
          </p>

          {docStatus === 'none' && (
            <div className="admin-note admin-note-warn">
              No community is linked yet, or the documents table and storage bucket
              aren't set up. Run the rules &amp; documents setup SQL (see
              supabase/rules-and-documents.sql), then reload.
            </div>
          )}
          {docStatus === 'error' && (
            <div className="admin-note admin-note-err">
              {docError}
              <button type="button" className="admin-btn-ghost" onClick={loadDocs}>Retry</button>
            </div>
          )}

          {docSuccessMsg && (
            <div className="admin-success" role="status">
              <span className="admin-success-check" aria-hidden="true">✓</span>
              {docSuccessMsg}
            </div>
          )}

          {docStatus === 'loading' && <div className="admin-note">Loading…</div>}
          {docStatus === 'ready' && (
            <>
              <div className="admin-note admin-note-info" style={{ marginBottom: 24 }}>
                <strong>Florida compliance — required document types</strong>
                <p style={{ margin: '8px 0 10px', fontSize: 13, opacity: 0.85 }}>
                  FL 718.111(12)(g) (condos, 25+ units) and FL 720.303(4)(b) (HOAs, 100+ parcels)
                  require associations to post the following document types online within 30 days of
                  creation or receipt. Types highlighted below are missing from your portal.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {FL_REQUIRED_CATEGORIES.map(({ label, statute }) => {
                    const present = docRows.some(
                      (d: any) => (d.category || '').toLowerCase() === label.toLowerCase()
                    )
                    return (
                      <span
                        key={label}
                        title={`FL §${statute}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                          background: present ? 'rgba(125,140,92,0.18)' : 'rgba(210,80,80,0.13)',
                          color: present ? 'var(--accent)' : '#c0392b',
                          border: `1px solid ${present ? 'rgba(125,140,92,0.3)' : 'rgba(210,80,80,0.25)'}`,
                        }}
                      >
                        <span>{present ? '✓' : '!'}</span> {label}
                      </span>
                    )
                  })}
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 12, opacity: 0.7 }}>
                  <strong>Public notices requirement (HOA only):</strong> FL 720.303(4)(b)(1)(l) requires
                  meeting notices to be posted in plain view on a public homepage or "Notices" subpage —
                  not just behind login. Contact your management company or attorney to determine how your
                  association will satisfy this requirement.
                </p>
              </div>

              <form className="admin-form" onSubmit={uploadDoc}>
                <label className="admin-field">
                  <span className="admin-field-label">Title</span>
                  <input name="title" className="admin-input" placeholder="April 2026 board meeting minutes"
                    value={docForm.title} onChange={e => setDocField('title', e.target.value)} />
                </label>
                <div className="admin-field" style={{ maxWidth: 240 }}>
                  <span className="admin-field-label">Category</span>
                  <Dropdown
                    value={docForm.category}
                    onChange={v => setDocField('category', v)}
                    ariaLabel="Document category"
                    options={[...DOC_CATEGORIES].map(c => ({ value: c, label: c }))}
                  />
                </div>
                <label className="admin-field">
                  <span className="admin-field-label">File</span>
                  <input name="document" ref={docFileRef} type="file" className="admin-file"
                    onChange={e => setDocFile(e.target.files?.[0] || null)} />
                </label>
                <div className="admin-form-actions">
                  <button type="submit" className="admin-primary-btn" disabled={docSaving}>
                    {docSaving ? 'Uploading…' : 'Upload document'}
                  </button>
                  {docError && <span className="admin-err-inline">{docError}</span>}
                </div>
              </form>

              <div className="bc-head" style={{ marginTop: 40, marginBottom: 14 }}>
                <h2 className="bc-title">Archive</h2>
                <span className="bc-sub">
                  {docRows.length} {docRows.length === 1 ? 'document' : 'documents'} published.
                </span>
              </div>

              {docRows.length === 0 && (
                <div className="bc-empty">No documents yet — upload the first one above.</div>
              )}
              <div className="bd-list">
                {paginate(docRows, docPage, DOCS_PAGE_SIZE).map(d => (
                  <div className="bd-row" key={d.id}>
                    <div className="bd-main">
                      <div className="bd-title">{d.title}</div>
                      <div className="bd-meta">
                        {d.category && <><span>{d.category}</span><span className="bd-dot">·</span></>}
                        <span>{fmtDate(d.uploaded_at)}</span>
                        {fmtSize(d.file_size) && <><span className="bd-dot">·</span><span>{fmtSize(d.file_size)}</span></>}
                      </div>
                    </div>
                    <button type="button" className="bc-del" onClick={() => removeDoc(d)}
                      aria-label="Remove document">&times;</button>
                  </div>
                ))}
              </div>
              <Pagination page={docPage} pageSize={DOCS_PAGE_SIZE}
                total={docRows.length} onPageChange={setDocPage} />
            </>
          )}
        </div>
      </section>
      )}
    </div>
  )
}
