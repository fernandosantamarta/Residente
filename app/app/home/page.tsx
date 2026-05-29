'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/providers'
import { useMyResident } from '@/hooks/useMyResident'
import {
  listHomeDocs, uploadHomeDoc, setConveys, deleteHomeDoc, homeDocUrl,
  HOME_DOC_CATEGORIES, type HomeDoc,
} from '@/lib/homeVault'
import './home.css'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function HomePage() {
  const { profile } = useAuth() || {}
  const { resident } = useMyResident()
  const profileId = profile?.id

  const [docs, setDocs] = useState<HomeDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!profileId) { setDocsLoading(false); return }
    setDocsLoading(true)
    try { setDocs(await listHomeDocs(profileId)) }
    catch (e) { setErr((e as Error).message) }
    finally { setDocsLoading(false) }
  }, [profileId])
  useEffect(() => { reload() }, [reload])

  const doneCategories = new Set(docs.map(d => d.category))

  return (
    <div className="hv">
      <div className="hv-kicker">Your home</div>
      <h1 className="hv-h1">{resident?.unit_number ? `Unit ${resident.unit_number}` : 'My home'}</h1>
      <p className="hv-dek">Keep your home&apos;s records in one place — deed, insurance, warranties, permits. The files you mark as conveying pass to the next owner when you sell.</p>

      {err && <div className="hv-err">{err} <button className="hv-link" onClick={() => { setErr(null); reload() }}>Retry</button></div>}

      <DocsCard
        docs={docs} loading={docsLoading} doneCategories={doneCategories}
        resident={resident} profileId={profileId} onChange={reload} setErr={setErr}
      />
    </div>
  )
}

/* ----------------------------- documents ----------------------------- */

function DocsCard({ docs, loading, doneCategories, resident, profileId, onChange, setErr }: any) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>(HOME_DOC_CATEGORIES[0])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !profileId) return
    setBusy(true)
    try {
      await uploadHomeDoc({
        file, title, category,
        profileId, communityId: resident?.community_id ?? null, residentId: resident?.id ?? null,
      })
      setFile(null); setTitle(''); if (fileRef.current) fileRef.current.value = ''
      setOpen(false); onChange()
    } catch (e2) { setErr((e2 as Error).message || 'Upload failed.') }
    finally { setBusy(false) }
  }

  const openDoc = async (d: HomeDoc) => {
    const url = await homeDocUrl(d.storage_path)
    if (url) window.open(url, '_blank', 'noopener')
  }
  const remove = async (d: HomeDoc) => { try { await deleteHomeDoc(d); onChange() } catch (e) { setErr((e as Error).message) } }
  const toggle = async (d: HomeDoc) => { try { await setConveys(d.id, !d.conveys); onChange() } catch (e) { setErr((e as Error).message) } }

  return (
    <section className="hv-card">
      <div className="hv-card-head">
        <h2 className="hv-card-title">Home documents</h2>
        {!open && <button className="hv-btn" onClick={() => setOpen(true)}>Add a document</button>}
      </div>

      {open && (
        <form className="hv-form" onSubmit={submit}>
          <label className="hv-field">
            <span className="hv-label">File</span>
            <input className="hv-input" ref={fileRef} type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <div className="hv-form-row">
            <label className="hv-field">
              <span className="hv-label">Title</span>
              <input className="hv-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Roof warranty" />
            </label>
            <label className="hv-field">
              <span className="hv-label">Category</span>
              <select className="hv-input" value={category} onChange={e => setCategory(e.target.value)}>
                {HOME_DOC_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="hv-actions">
            <button type="button" className="hv-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="hv-btn" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload'}</button>
          </div>
        </form>
      )}

      {/* Starter checklist */}
      <div className="hv-checklist">
        {HOME_DOC_CATEGORIES.filter(c => c !== 'Other').map(c => (
          <span key={c} className={`hv-chip${doneCategories.has(c) ? ' done' : ''}`}>
            {doneCategories.has(c) ? '✓ ' : ''}{c}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="hv-muted">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="hv-muted">No documents yet. Add your deed, insurance, warranties, and permits — they&apos;ll be here whenever you need them.</div>
      ) : (
        <div className="hv-doclist">
          {docs.map((d: HomeDoc) => (
            <div key={d.id} className="hv-docrow">
              <button className="hv-doc-main" onClick={() => openDoc(d)}>
                <span className="hv-doc-title">{d.title}</span>
                <span className="hv-doc-meta">{d.category || 'Document'} · {fmtDate(d.uploaded_at)}</span>
              </button>
              <label className="hv-conveys" title="Transfers to the next owner when you sell">
                <input type="checkbox" checked={d.conveys} onChange={() => toggle(d)} />
                <span>Conveys</span>
              </label>
              <button className="hv-doc-del" onClick={() => remove(d)} aria-label="Delete">×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
