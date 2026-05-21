import { useState } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import { supabase } from '../lib/supabase'

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
// by category. Opening a file mints a short-lived signed URL from Storage.
export default function Documents() {
  const { documents, loading } = useDocuments()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const list = documents || []

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

  // Group by category, newest-first within each.
  const categories = []
  const byCategory = {}
  list.forEach(d => {
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

      {!loading && categories.map(c => (
        <div className="docs-section" key={c}>
          <div className="docs-section-title">{c}</div>
          <div className="docs-list">
            {byCategory[c].map(d => (
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
    </div>
  )
}
