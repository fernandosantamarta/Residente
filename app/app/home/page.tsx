'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useAuth } from '@/app/providers'
import { useMyResident } from '@/hooks/useMyResident'
import {
  listHomeDocs, uploadHomeDoc, setConveys, deleteHomeDoc, homeDocUrl,
  HOME_DOC_CATEGORIES, type HomeDoc,
} from '@/lib/homeVault'
import './home.css'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function HomePage() {
  const t = useT()
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
      <div className="hv-kicker">{t('legacy.home.kicker')}</div>
      <h1 className="hv-h1">{resident?.unit_number ? t('legacy.home.unit', { number: resident.unit_number }) : t('legacy.home.myHome')}</h1>
      <p className="hv-dek">{t('legacy.home.dek')}</p>

      {err && <div className="hv-err">{err} <button className="hv-link" onClick={() => { setErr(null); reload() }}>{t('legacy.home.retry')}</button></div>}

      <DocsCard
        docs={docs} loading={docsLoading} doneCategories={doneCategories}
        resident={resident} profileId={profileId} onChange={reload} setErr={setErr}
      />
    </div>
  )
}

/* ----------------------------- documents ----------------------------- */

function DocsCard({ docs, loading, doneCategories, resident, profileId, onChange, setErr }: any) {
  const t = useT()
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
    } catch (e2) { setErr((e2 as Error).message || t('legacy.home.uploadFailed')) }
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
        <h2 className="hv-card-title">{t('legacy.home.docsTitle')}</h2>
        {!open && <button className="hv-btn" onClick={() => setOpen(true)}>{t('legacy.home.addDoc')}</button>}
      </div>

      {open && (
        <form className="hv-form" onSubmit={submit}>
          <label className="hv-field">
            <span className="hv-label">{t('legacy.home.fileLabel')}</span>
            <input className="hv-input" ref={fileRef} type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <div className="hv-form-row">
            <label className="hv-field">
              <span className="hv-label">{t('legacy.home.titleLabel')}</span>
              <input className="hv-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('legacy.home.titlePlaceholder')} />
            </label>
            <label className="hv-field">
              <span className="hv-label">{t('legacy.home.categoryLabel')}</span>
              <select className="hv-input" value={category} onChange={e => setCategory(e.target.value)}>
                {HOME_DOC_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="hv-actions">
            <button type="button" className="hv-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>{t('legacy.home.cancel')}</button>
            <button type="submit" className="hv-btn" disabled={busy || !file}>{busy ? t('legacy.home.uploading') : t('legacy.home.upload')}</button>
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
        <div className="hv-muted">{t('legacy.home.loading')}</div>
      ) : docs.length === 0 ? (
        <div className="hv-muted">{t('legacy.home.empty')}</div>
      ) : (
        <div className="hv-doclist">
          {docs.map((d: HomeDoc) => (
            <div key={d.id} className="hv-docrow">
              <button className="hv-doc-main" onClick={() => openDoc(d)}>
                <span className="hv-doc-title">{d.title}</span>
                <span className="hv-doc-meta">{d.category || t('legacy.home.documentFallback')} · {fmtDate(d.uploaded_at)}</span>
              </button>
              <label className="hv-conveys" title={t('legacy.home.conveysTitle')}>
                <input type="checkbox" checked={d.conveys} onChange={() => toggle(d)} />
                <span>{t('legacy.home.conveys')}</span>
              </label>
              <button className="hv-doc-del" onClick={() => remove(d)} aria-label={t('legacy.home.delete')}>×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
