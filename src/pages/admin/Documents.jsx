import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../App'
import { supabase, hasSupabase } from '../../lib/supabase'

// Uploads can be large — give them a longer leash than ordinary queries.
const withTimeout = (p, ms = 30000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const CATEGORIES = ['Minutes', 'Financials', 'Insurance', 'Contracts', 'Notices', 'Other']
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
const EMPTY = { title: '', category: 'Minutes' }

// Admin → Documents. Board uploads files to Supabase Storage; each upload
// records a row residents see (and download) on their Documents page.
export default function Documents() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')   // loading | ready | none | error
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.from('documents').select('*')
          .eq('community_id', communityId)
          .order('uploaded_at', { ascending: false })
      )
      if (error) throw error
      setRows(data || [])
      setStatus('ready')
    } catch (err) {
      const msg = err?.message || ''
      // Table missing → the setup SQL hasn't been run; show the friendly note.
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setStatus('none')
      } else {
        setError(msg || 'Could not load documents')
        setStatus('error')
      }
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const upload = async (e) => {
    e.preventDefault()
    if (!file) { setError('Choose a file to upload'); return }
    if (!form.title.trim()) { setError('Give the document a title'); return }
    setSaving(true); setError('')
    try {
      // Files live under <community_id>/… so Storage policies can scope access.
      const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'bin'
      const path = `${communityId}/${crypto.randomUUID()}.${ext}`
      const up = await withTimeout(supabase.storage.from('documents').upload(path, file))
      if (up.error) throw up.error
      const row = {
        community_id: communityId,
        title: form.title.trim(),
        category: form.category,
        storage_path: path,
        file_size: file.size,
      }
      const { data, error } = await withTimeout(
        supabase.from('documents').insert(row).select().single()
      )
      if (error) {
        // Metadata insert failed — don't leave an orphaned file behind.
        supabase.storage.from('documents').remove([path])
        throw error
      }
      setRows(rs => [data, ...rs])
      setForm(EMPTY)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err?.message || 'Upload failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (doc) => {
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== doc.id))   // optimistic
    try {
      await withTimeout(supabase.storage.from('documents').remove([doc.storage_path]))
      const { error } = await withTimeout(supabase.from('documents').delete().eq('id', doc.id))
      if (error) throw error
    } catch (err) {
      setRows(prev)   // roll back
      setError(err?.message || 'Could not remove that document')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Documents</div>
      <h1 className="admin-h1">Document archive</h1>
      <p className="admin-dek">
        Upload minutes, financials, insurance certificates and contracts.
        Every file shows on each resident's Documents page to download.
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked yet, or the documents table and storage bucket
          aren't set up. Run the rules &amp; documents setup SQL (see
          supabase/rules-and-documents.sql), then reload.
        </div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          <form className="admin-form" onSubmit={upload}>
            <label className="admin-field">
              <span className="admin-field-label">Title</span>
              <input className="admin-input" placeholder="April 2026 board meeting minutes"
                value={form.title} onChange={e => setField('title', e.target.value)} />
            </label>
            <label className="admin-field" style={{ maxWidth: 240 }}>
              <span className="admin-field-label">Category</span>
              <select className="admin-input" value={form.category}
                onChange={e => setField('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">File</span>
              <input ref={fileRef} type="file" className="admin-file"
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn" disabled={saving}>
                {saving ? 'Uploading…' : 'Upload document'}
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <div className="bc-head" style={{ marginTop: 40, marginBottom: 14 }}>
            <h2 className="bc-title">Archive</h2>
            <span className="bc-sub">
              {rows.length} {rows.length === 1 ? 'document' : 'documents'} published.
            </span>
          </div>

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="bc-empty">No documents yet — upload the first one above.</div>
          )}
          <div className="bd-list">
            {rows.map(d => (
              <div className="bd-row" key={d.id}>
                <div className="bd-main">
                  <div className="bd-title">{d.title}</div>
                  <div className="bd-meta">
                    {d.category && <><span>{d.category}</span><span className="bd-dot">·</span></>}
                    <span>{fmtDate(d.uploaded_at)}</span>
                    {fmtSize(d.file_size) && <><span className="bd-dot">·</span><span>{fmtSize(d.file_size)}</span></>}
                  </div>
                </div>
                <button type="button" className="bc-del" onClick={() => remove(d)}
                  aria-label="Remove document">&times;</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
