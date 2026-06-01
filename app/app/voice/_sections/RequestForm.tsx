'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase } from '@/lib/supabase'

// The "Submit a request" form — category cards + subject + description +
// attachment + submit. Shared by the Contact page (inline) and the Home quick
// actions (in a popup, via RequestFormDialog). Single source of truth so the
// submit/upload logic lives in one place.

const withTimeout = <T,>(p: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

export type Category = 'maintenance' | 'appeal' | 'account' | 'other'
export const CATS: { value: Category; label: string }[] = [
  { value: 'maintenance', label: 'Maintenance issue' },
  { value: 'appeal',      label: 'Violation appeal' },
  { value: 'account',     label: 'Account question' },
  { value: 'other',       label: 'Other' },
]
export const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))

const MAX_BODY = 500
const MAX_FILE = 10 * 1024 * 1024  // 10MB
const EMPTY = { category: 'maintenance' as Category, subject: '', body: '' }

export function RequestForm({
  initialCategory = 'maintenance', onSubmitted,
}: {
  initialCategory?: Category
  onSubmitted?: (row: any) => void
}) {
  const { profile } = useAuth() || {}
  const [form, setForm] = useState({ ...EMPTY, category: initialCategory })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const setField = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.subject.trim()) { setError('Give your request a subject'); return }
    // Demo / preview (no session) — confirm so the flow reads end to end.
    if (!supabase || !profile?.id || !profile?.community_id) {
      setOk('Request submitted — the board will follow up.')
      setForm({ ...EMPTY, category: form.category }); setFile(null)
      return
    }
    if (file && file.size > MAX_FILE) { setError('Attachment must be 10MB or smaller.'); return }
    setSaving(true); setError('')
    let uploadedPath: string | null = null
    try {
      let attachment_path: string | null = null
      let attachment_name: string | null = null
      if (file) {
        const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${profile.community_id}/${profile.id}/${crypto.randomUUID()}.${ext}`
        const up = await withTimeout(supabase.storage.from('request-attachments').upload(path, file), 30000)
        if (up.error) throw up.error
        uploadedPath = path
        attachment_path = path
        attachment_name = file.name
      }
      const row: Record<string, any> = {
        community_id: profile.community_id,
        profile_id: profile.id,
        submitter_name: profile.full_name || profile.email || null,
        submitter_unit: profile.unit_number ? `Unit ${profile.unit_number}` : null,
        category: form.category,
        subject: form.subject.trim(),
        body: form.body.trim() || null,
        status: 'new',
      }
      if (attachment_path) {
        row.attachment_path = attachment_path
        row.attachment_name = attachment_name
      }
      const { data, error } = await withTimeout(
        supabase.from('resident_requests').insert(row).select().single()
      )
      if (error) {
        if (uploadedPath) supabase.storage.from('request-attachments').remove([uploadedPath])
        throw error
      }
      onSubmitted?.(data)
      setForm({ ...EMPTY, category: form.category }); setFile(null)
      setOk('Request submitted — the board will follow up.')
    } catch (err: any) {
      setError(err?.message || 'Could not send your request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="con-field">
        <span className="con-label">Category</span>
        <div className="con-cats">
          {CATS.map(c => (
            <button
              key={c.value}
              type="button"
              className={`con-cat${form.category === c.value ? ' on' : ''}`}
              onClick={() => setField('category', c.value)}
              aria-pressed={form.category === c.value}
            >
              <span className="con-cat-ic">{catIcon(c.value)}</span>
              <span className="con-cat-label">{c.label}</span>
              <span className="con-cat-radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="con-field">
        <label className="con-label" htmlFor="con-subject">Subject</label>
        <input id="con-subject" name="subject" className="con-input"
          value={form.subject} onChange={e => setField('subject', e.target.value)}
          placeholder="e.g. Broken gate at the east entrance" />
      </div>

      <div className="con-field">
        <label className="con-label" htmlFor="con-body">Description</label>
        <textarea id="con-body" name="body" className="con-input con-textarea" rows={4}
          maxLength={MAX_BODY}
          value={form.body} onChange={e => setField('body', e.target.value)}
          placeholder="What's going on, where, and since when?" />
        <div className="con-count">{form.body.length}/{MAX_BODY} characters</div>
      </div>

      <div className="con-attach">
        <label className="con-attach-row">
          <input type="file" name="attachment" hidden
            accept="image/*,application/pdf"
            onChange={e => setFile(e.target.files?.[0] || null)} />
          <span className="con-attach-ic"><IconClip /></span>
          <span>
            <span className="con-attach-title">{file ? file.name : 'Attach a file'}</span>
            <span className="con-attach-sub">Photo or PDF — JPG, PNG up to 10MB</span>
          </span>
        </label>
      </div>

      <button type="submit" className="con-submit" disabled={saving}>
        {saving ? 'Submitting…' : 'Submit request'}
      </button>
      {error && <div className="con-error">{error}</div>}
      {ok && <div className="con-ok">✓ {ok}</div>}
    </form>
  )
}

// Popup wrapper — the request form inside the shared ven-rd modal shell. No
// footer; the form's own "Submit request" button is the action.
export function RequestFormDialog({
  title = 'Submit a request', initialCategory = 'maintenance', onClose,
}: {
  title?: string
  initialCategory?: Category
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="ven-rd-backdrop" onClick={onClose}>
      <div className="ven-rd-card rd-detail" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <header className="ven-rd-head">
          <div>
            <div className="ven-rd-eyebrow">Easy Voice</div>
            <h2 className="ven-rd-title">{title}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="ven-rd-body">
          <RequestForm initialCategory={initialCategory} />
        </div>
      </div>
    </div>
  )
}

export function catIcon(c: Category): ReactNode {
  switch (c) {
    case 'maintenance': return <Svg><><path d="M14 6 19 1l4 4-5 5z" /><path d="m17 4-9 9-4 4 1 1 4-4 9-9" /></></Svg>
    case 'appeal':      return <Svg><><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z" /></></Svg>
    case 'account':     return <Svg><><path d="M12 2v20M17 6.5A4 4 0 0 0 13 4h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5" /></></Svg>
    case 'other':       return <Svg><><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></></Svg>
  }
}
export function IconClip() { return <Svg><><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" /></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
