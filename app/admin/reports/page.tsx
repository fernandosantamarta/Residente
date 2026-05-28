'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const REPORT_PAGE_SIZE = 8

// Uploads can be large — give them a longer leash than ordinary queries.
const withTimeout = <T,>(p: Promise<T>, ms = 30000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

type ReportCat =
  | 'financial' | 'maintenance' | 'operations' | 'community'
  | 'safety' | 'vendor' | 'compliance' | 'board'
type ReportStatus = 'published' | 'updated' | 'draft'

const CATS: { value: ReportCat; label: string }[] = [
  { value: 'financial',   label: 'Financial' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'operations',  label: 'Operations' },
  { value: 'community',   label: 'Community' },
  { value: 'safety',      label: 'Safety' },
  { value: 'vendor',      label: 'Vendor' },
  { value: 'compliance',  label: 'Compliance' },
  { value: 'board',       label: 'Board' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))

const STATUSES: { value: ReportStatus; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'updated',   label: 'Updated' },
  { value: 'draft',     label: 'Draft (board-only)' },
]
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map(s => [s.value, s.label]))

const fmtSize = (b?: number | null) => {
  const n = Number(b) || 0
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try {
    return new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

const today = () => new Date().toISOString().slice(0, 10)
const EMPTY = {
  title: '', category: 'financial' as ReportCat, status: 'published' as ReportStatus,
  blurb: '', report_date: today(),
}

type Report = {
  id: string
  title: string
  category: string
  status: string
  blurb: string | null
  storage_path: string | null
  file_size: number | null
  featured: boolean
  report_date: string | null
  created_at?: string
}

// Admin → Reports. Board publishes financials, minutes and operational
// reports residents browse at /app/reports. Each report can carry a PDF
// (stored in the private `reports` bucket) or stand alone as a summary.
export default function ReportsAdmin() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<Report[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [filterCategory, setFilterCategory] = useState<'all' | ReportCat>('all')
  const [page, setPage] = useState(1)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase!.from('reports').select('*')
          .eq('community_id', communityId)
          .order('featured', { ascending: false })
          .order('report_date', { ascending: false })
      )
      if (error) throw error
      setRows((data as Report[]) || [])
      setStatus('ready')
    } catch (err: any) {
      const msg = err?.message || ''
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setStatus('none')
      } else {
        setError(msg || 'Could not load reports')
        setStatus('error')
      }
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setField = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Give the report a title'); return }
    setSaving(true); setError('')
    let uploadedPath: string | null = null
    try {
      let storage_path: string | null = null
      let file_size: number | null = null
      if (file) {
        const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${communityId}/${crypto.randomUUID()}.${ext}`
        const up = await withTimeout(supabase!.storage.from('reports').upload(path, file))
        if (up.error) throw up.error
        uploadedPath = path
        storage_path = path
        file_size = file.size
      }
      const row = {
        community_id: communityId,
        title: form.title.trim(),
        category: form.category,
        status: form.status,
        blurb: form.blurb.trim() || null,
        report_date: form.report_date || today(),
        storage_path,
        file_size,
      }
      const { data, error } = await withTimeout(
        supabase!.from('reports').insert(row).select().single()
      )
      if (error) {
        // Metadata insert failed — don't leave an orphaned file behind.
        if (uploadedPath) supabase!.storage.from('reports').remove([uploadedPath])
        throw error
      }
      setRows(rs => [data as Report, ...rs])
      setForm(EMPTY)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setSuccessMsg(`Published "${row.title}".`)
    } catch (err: any) {
      setError(err?.message || 'Could not publish the report')
    } finally {
      setSaving(false)
    }
  }

  const toggleFeatured = async (r: Report) => {
    const next = !r.featured
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, featured: next } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('reports').update({ featured: next }).eq('id', r.id)
      )
      if (error) throw error
      setSuccessMsg(next ? `Featured "${r.title}".` : `Removed "${r.title}" from featured.`)
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, featured: r.featured } : x))   // roll back
      setError(err?.message || 'Could not update that report')
    }
  }

  const remove = async (r: Report) => {
    const prev = rows
    setRows(rs => rs.filter(x => x.id !== r.id))   // optimistic
    try {
      if (r.storage_path) {
        await withTimeout(supabase!.storage.from('reports').remove([r.storage_path]))
      }
      const { error } = await withTimeout(supabase!.from('reports').delete().eq('id', r.id))
      if (error) throw error
    } catch (err: any) {
      setRows(prev)   // roll back
      setError(err?.message || 'Could not remove that report')
    }
  }

  const filtered = rows.filter(r => filterCategory === 'all' || r.category === filterCategory)
  const visible = paginate(filtered, page, REPORT_PAGE_SIZE)

  return (
    <div className="admin-page">
      <div className="admin-kicker">Reports</div>
      <h1 className="admin-h1">Published reports</h1>
      <p className="admin-dek">
        Financials, minutes and operational reports. Published &amp; updated
        reports show on each resident&rsquo;s Reports page; drafts stay board-only.
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked yet, or the reports table isn&rsquo;t set up. Run the
          vendors &amp; reports setup SQL (see supabase/vendors-and-reports.sql),
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
            <label className="admin-field">
              <span className="admin-field-label">Title</span>
              <input name="title" className="admin-input" placeholder="May 2026 financial summary"
                value={form.title} onChange={e => setField('title', e.target.value)} />
            </label>
            <div className="admin-field" style={{ maxWidth: 260 }}>
              <span className="admin-field-label">Category</span>
              <Dropdown<ReportCat>
                value={form.category}
                onChange={v => setField('category', v)}
                ariaLabel="Report category"
                options={CATS}
              />
            </div>
            <div className="admin-field" style={{ maxWidth: 260 }}>
              <span className="admin-field-label">Status</span>
              <Dropdown<ReportStatus>
                value={form.status}
                onChange={v => setField('status', v)}
                ariaLabel="Report status"
                options={STATUSES}
              />
            </div>
            <label className="admin-field" style={{ maxWidth: 220 }}>
              <span className="admin-field-label">Report date</span>
              <input name="report_date" type="date" className="admin-input"
                value={form.report_date} onChange={e => setField('report_date', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Summary (optional)</span>
              <textarea name="blurb" className="admin-input admin-textarea" rows={2}
                placeholder="One-line description residents will read."
                value={form.blurb} onChange={e => setField('blurb', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">File (optional PDF)</span>
              <input name="report-file" ref={fileRef} type="file" className="admin-file"
                onChange={e => setFile(e.target.files?.[0] || null)} />
              <span className="admin-field-hint">
                Leave empty for a summary-only report.
              </span>
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? 'Publishing…' : 'Publish report'}
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <div className="bc-head" style={{ marginTop: 40, marginBottom: 14 }}>
            <h2 className="bc-title">Report log</h2>
            <span className="bc-sub">
              {rows.length} {rows.length === 1 ? 'report' : 'reports'} published.
            </span>
          </div>

          <div className="admin-sched-filters" style={{ marginTop: 4, marginBottom: 12 }}>
            <div className="admin-sched-filter">
              <label>Category</label>
              <Dropdown<'all' | ReportCat>
                value={filterCategory}
                onChange={v => { setFilterCategory(v); setPage(1) }}
                ariaLabel="Filter reports by category"
                options={[
                  { value: 'all', label: `All (${rows.length})` },
                  ...CATS.map(c => ({
                    value: c.value,
                    label: `${c.label} (${rows.filter(r => r.category === c.value).length})`,
                  })),
                ]}
              />
            </div>
          </div>

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="bc-empty">No reports yet — publish the first one above.</div>
          )}
          {status === 'ready' && rows.length > 0 && filtered.length === 0 && (
            <div className="bc-empty">No reports in this category.</div>
          )}

          <div className="bd-list">
            {visible.map(r => (
              <div className="bd-row" key={r.id}>
                <div className="bd-main">
                  <div className="bd-title">{r.title}</div>
                  <div className="bd-meta">
                    <span>{CAT_LABEL[r.category] || r.category}</span>
                    <span className="bd-dot">·</span>
                    <span>{STATUS_LABEL[r.status] || r.status}</span>
                    <span className="bd-dot">·</span>
                    <span>{fmtDate(r.report_date) || fmtDate(r.created_at) || '—'}</span>
                    {r.storage_path
                      ? <><span className="bd-dot">·</span><span>PDF{fmtSize(r.file_size) ? ` · ${fmtSize(r.file_size)}` : ''}</span></>
                      : <><span className="bd-dot">·</span><span>Summary</span></>}
                  </div>
                </div>
                <button
                  type="button"
                  className={`admin-btn-ghost${r.featured ? ' on' : ''}`}
                  onClick={() => toggleFeatured(r)}
                  title={r.featured ? 'Unfeature' : 'Feature on the resident page'}
                >
                  {r.featured ? '★ Featured' : '☆ Feature'}
                </button>
                <button type="button" className="bc-del" onClick={() => remove(r)}
                  aria-label="Remove report">&times;</button>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={REPORT_PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
