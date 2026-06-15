'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'

// The "Submit a request" form — category cards + subject + description +
// attachment + submit. Shared by the Contact page (inline) and the Home quick
// actions (in a popup, via RequestFormDialog). Single source of truth so the
// submit/upload logic lives in one place.

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

export type Category = 'maintenance' | 'appeal' | 'account' | 'records' | 'rule_proposal' | 'other'
export const CATS: { value: Category; label: string }[] = [
  { value: 'maintenance',   label: 'Maintenance issue' },
  { value: 'appeal',        label: 'Violation appeal' },
  { value: 'account',       label: 'Account question' },
  { value: 'records',       label: 'Records inspection' }, // FS 718.111(12)(c) / 720.303(5)
  { value: 'rule_proposal', label: 'Propose a rule' },
  { value: 'other',         label: 'Other' },
]
export const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))

// i18n key per category — used to render translated category labels while the
// CATS array keeps the stable English values for data + icons.
const CAT_LABEL_KEY: Record<string, string> = {
  maintenance: 'board.catMaintenance',
  appeal:      'board.catAppeal',
  account:     'board.catAccount',
  other:       'board.catOther',
}

// Translated category label; falls back to the English CAT_LABEL (then the raw
// value) for categories without a dedicated i18n key (e.g. 'records').
export function useCatLabel() {
  const t = useT()
  return (value: string) => (CAT_LABEL_KEY[value] ? t(CAT_LABEL_KEY[value]) : (CAT_LABEL[value] ?? value))
}

const MAX_BODY = 500
const MAX_FILE = 10 * 1024 * 1024  // 10MB
const EMPTY = { category: 'maintenance' as Category, subject: '', body: '' }

export function RequestForm({
  initialCategory = 'maintenance', onSubmitted, focusMessage = false,
}: {
  initialCategory?: Category
  onSubmitted?: (row: any) => void
  focusMessage?: boolean
}) {
  const t = useT()
  const catLabel = useCatLabel()
  const { profile } = useAuth() || {}
  const [form, setForm] = useState({ ...EMPTY, category: initialCategory })
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const clearFile = () => { setFile(null); if (fileRef.current) fileRef.current.value = '' }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  // Deep-linked from "Suggest a rule change" (Documents) / Home quick actions:
  // after the #contact hash scroll settles, bring the form into view at the
  // Subject field and focus it so the resident lands ready to start writing.
  useEffect(() => {
    if (!focusMessage) return
    const id = setTimeout(() => {
      const el = document.getElementById('con-subject') as HTMLInputElement | null
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    }, 350)
    return () => clearTimeout(id)
  }, [focusMessage])

  const setField = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.subject.trim()) { setError(t('board.errSubjectRequired')); return }
    // Demo / preview (no session) — confirm so the flow reads end to end.
    if (!supabase || !profile?.id || !profile?.community_id) {
      setOk(t('board.requestSubmitted'))
      setForm({ ...EMPTY, category: form.category }); clearFile()
      return
    }
    if (file && file.size > MAX_FILE) { setError(t('board.errFileTooLarge')); return }
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
      setForm({ ...EMPTY, category: form.category }); clearFile()
      setOk(t('board.requestSubmitted'))
    } catch (err: any) {
      setError(err?.message || t('board.errCouldNotSend'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="con-field">
        <span className="con-label">{t('board.categoryLabel')}</span>
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
              <span className="con-cat-label">{catLabel(c.value)}</span>
              <span className="con-cat-radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="con-field">
        <label className="con-label" htmlFor="con-subject">{t('board.subjectLabel')}</label>
        <input id="con-subject" name="subject" className="con-input"
          value={form.subject} onChange={e => setField('subject', e.target.value)}
          placeholder={t('board.subjectPlaceholder')} />
      </div>

      <div className="con-field">
        <label className="con-label" htmlFor="con-body">{t('board.descriptionLabel')}</label>
        <textarea id="con-body" name="body" className="con-input con-textarea" rows={4}
          maxLength={MAX_BODY}
          value={form.body} onChange={e => setField('body', e.target.value)}
          placeholder={t('board.descriptionPlaceholder')} />
        <div className="con-count">{t('board.charCount', { count: form.body.length, max: MAX_BODY })}</div>
      </div>

      <div className="con-attach">
        <label className="con-attach-row">
          <input ref={fileRef} type="file" name="attachment" hidden
            accept="image/*,application/pdf"
            onChange={e => setFile(e.target.files?.[0] || null)} />
          <span className="con-attach-ic"><IconClip /></span>
          <span className="con-attach-text">
            <span className="con-attach-title">{file ? file.name : t('board.attachFile')}</span>
            <span className="con-attach-sub">{t('board.attachSub')}</span>
          </span>
          {file && (
            <button type="button" className="con-attach-del"
              aria-label={t('board.removeFile')}
              onClick={e => { e.preventDefault(); e.stopPropagation(); clearFile() }}>
              ×
            </button>
          )}
        </label>
      </div>

      <button type="submit" className="con-submit" disabled={saving}>
        {saving ? t('board.submitting') : t('board.submitRequestBtn')}
      </button>
      {error && <div className="con-error">{error}</div>}
      {ok && <div className="con-ok">✓ {ok}</div>}
    </form>
  )
}

// Popup wrapper — the request form inside the shared ven-rd modal shell. No
// footer; the form's own "Submit request" button is the action.
export function RequestFormDialog({
  title, initialCategory = 'maintenance', onClose,
}: {
  title?: string
  initialCategory?: Category
  onClose: () => void
}) {
  const t = useT()
  const heading = title ?? t('board.submitRequest')
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
            <h2 className="ven-rd-title">{heading}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label={t('board.close')} onClick={onClose}>×</button>
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
    case 'records':     return <Svg><><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" /><path d="M14 3v6h6" /><circle cx="17" cy="17" r="3" /><path d="m21 21-1.5-1.5" /></></Svg>
    case 'rule_proposal': return <Svg><><path d="M14 13l-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" /><path d="M9.5 6.5l8 8" /><path d="M14 4l6 6" /><path d="M11 7l6 6" /><line x1="16" y1="20" x2="22" y2="20" /></></Svg>
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
