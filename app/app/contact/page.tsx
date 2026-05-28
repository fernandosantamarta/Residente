'use client'

import { Fragment, ReactNode, useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = <T,>(p: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

type Category = 'maintenance' | 'appeal' | 'account' | 'other'
const CATS: { value: Category; label: string }[] = [
  { value: 'maintenance', label: 'Maintenance issue' },
  { value: 'appeal',      label: 'Violation appeal' },
  { value: 'account',     label: 'Account question' },
  { value: 'other',       label: 'Other' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))
const STATUS_LABEL: Record<string, string> = {
  new: 'New', in_progress: 'In progress', resolved: 'Resolved',
}
const MAX_BODY = 500

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// Short, stable display id from the row uuid: "#A3F-9C2".
const shortId = (id: string) => {
  const s = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
  return `#${s.slice(0, 3)}-${s.slice(3, 6)}`
}

type Request = {
  id: string
  category: string
  subject: string
  body: string | null
  status: string
  created_at: string
  attachment_path: string | null
  attachment_name: string | null
  board_note: string | null
  board_note_at: string | null
  board_note_attachment_path: string | null
  board_note_attachment_name: string | null
}

const MAX_FILE = 10 * 1024 * 1024  // 10MB

const EMPTY = { category: 'maintenance' as Category, subject: '', body: '' }

// Resident → Contact. Submit a maintenance issue / appeal / question; the
// board triages it at /admin/requests. Two-column layout matching the
// approved mockup: request form + the resident's submission history.
export default function Contact() {
  const { profile } = useAuth() || {}
  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Request[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    if (!ok) return
    const id = setTimeout(() => setOk(''), 5000)
    return () => clearTimeout(id)
  }, [ok])

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data, error } = await withTimeout(
        supabase.from('resident_requests').select('*')
          .eq('profile_id', profile.id)
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      setRows((data as Request[]) || [])
    } catch { /* leave empty */ } finally {
      setLoading(false)
    }
  }, [profile?.id])
  useEffect(() => { load() }, [load])

  const setField = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }))

  const openAttachment = async (path: string) => {
    if (!supabase) return
    try {
      const { data } = await supabase.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.subject.trim()) { setError('Give your request a subject'); return }
    if (!supabase || !profile?.id || !profile?.community_id) {
      setError('Sign in to submit a request.'); return
    }
    if (file && file.size > MAX_FILE) { setError('Attachment must be 10MB or smaller.'); return }
    setSaving(true); setError('')
    let uploadedPath: string | null = null
    try {
      // Upload the attachment first (if any) so the row carries its path.
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
      // Only reference the attachment columns when there's actually a file, so
      // text-only submits keep working even before the attachments migration runs.
      if (attachment_path) {
        row.attachment_path = attachment_path
        row.attachment_name = attachment_name
      }
      const { data, error } = await withTimeout(
        supabase.from('resident_requests').insert(row).select().single()
      )
      if (error) {
        // Don't leave an orphaned file if the row insert failed.
        if (uploadedPath) supabase.storage.from('request-attachments').remove([uploadedPath])
        throw error
      }
      setRows(rs => [data as Request, ...rs])
      setForm(EMPTY)
      setFile(null)
      setOk('Request submitted — the board will follow up. Track it on the right.')
    } catch (err: any) {
      setError(err?.message || 'Could not send your request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="con-wrap">
      <div className="con-grid">
        {/* LEFT — submit a request */}
        <section className="con-card con-form-card">
          <h2 className="con-card-title">Submit a request</h2>
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
        </section>

        {/* RIGHT — submission history */}
        <section className="con-card con-list-card">
          <h2 className="con-card-title">Your past submissions</h2>
          <div className="con-table">
            <div className="con-thead">
              <span>ID</span><span>Subject</span><span>Category</span>
              <span>Status</span><span>Submitted</span><span></span>
            </div>
            {loading && <div className="con-empty">Loading…</div>}
            {!loading && rows.length === 0 && (
              <div className="con-empty">No requests yet — submit one on the left and track it here.</div>
            )}
            {!loading && rows.map(r => {
              const open = expandedId === r.id
              const hasReply = Boolean(r.board_note || r.board_note_attachment_path)
              const toggle = () => setExpandedId(open ? null : r.id)
              return (
              <Fragment key={r.id}>
                <div
                  className={`con-trow con-trow-click${open ? ' open' : ''}`}
                  role="button" tabIndex={0} aria-expanded={open}
                  onClick={toggle}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
                >
                  <span className="con-id">{shortId(r.id)}</span>
                  <span className="con-subj" title={r.subject}>{r.subject}</span>
                  <span className="con-cat-cell">{CAT_LABEL[r.category] || r.category}</span>
                  <span><span className={`con-badge con-badge-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></span>
                  <span className="con-date">{fmtDate(r.created_at)}</span>
                  <span className="con-chev">
                    {hasReply && !open && <span className="con-reply-dot" title="The board replied" />}
                    <svg className={`con-chev-ic${open ? ' open' : ''}`} viewBox="0 0 24 24" width="16" height="16"
                      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </div>
                {open && (
                  <div className="con-detail">
                    <div className="con-detail-row">
                      <span className="con-detail-label">Description</span>
                      <span className="con-detail-val">{r.body || <em>No description provided.</em>}</span>
                    </div>
                    {r.attachment_path && (
                      <div className="con-detail-row">
                        <span className="con-detail-label">Your attachment</span>
                        <button type="button" className="con-note-photo" style={{ marginLeft: 0 }}
                          onClick={() => openAttachment(r.attachment_path!)}>
                          <IconClip /> {r.attachment_name || 'View attachment'}
                        </button>
                      </div>
                    )}
                    {hasReply && (
                      <div className="con-note" style={{ margin: '2px 0 0' }}>
                        <span className="con-note-tag">Board</span>
                        <span className="con-note-body">
                          {r.board_note}
                          {r.board_note_attachment_path && (
                            <button type="button" className="con-note-photo"
                              onClick={() => openAttachment(r.board_note_attachment_path!)}>
                              <IconClip /> {r.board_note_attachment_name || 'View photo'}
                            </button>
                          )}
                        </span>
                        {r.board_note_at && <span className="con-note-date">{fmtDate(r.board_note_at)}</span>}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
              )
            })}
          </div>
          {!loading && rows.length > 0 && (
            <button type="button" className="con-viewall">View all submissions</button>
          )}
        </section>
      </div>

      {/* Emergency banner */}
      <section className="con-emerg">
        <span className="con-emerg-ic"><IconPhone /></span>
        <div className="con-emerg-body">
          <div className="con-emerg-title">Need immediate assistance?</div>
          <div className="con-emerg-sub">
            For emergencies, please contact our management office directly at{' '}
            <a href="tel:3055554567">(305) 555-4567</a>.
          </div>
        </div>
      </section>
    </div>
  )
}

// -- icons ----------------------------------------------------------

function catIcon(c: Category): ReactNode {
  switch (c) {
    case 'maintenance': return <Svg><><path d="M14 6 19 1l4 4-5 5z" /><path d="m17 4-9 9-4 4 1 1 4-4 9-9" /></></Svg>
    case 'appeal':      return <Svg><><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z" /></></Svg>
    case 'account':     return <Svg><><path d="M12 2v20M17 6.5A4 4 0 0 0 13 4h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5" /></></Svg>
    case 'other':       return <Svg><><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></></Svg>
  }
}
function IconClip() { return <Svg><><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" /></></Svg> }
function IconPhone() { return <Svg><><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z" /></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
