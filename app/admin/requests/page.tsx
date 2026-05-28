'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'
import { EasyVoiceTabs } from '../EasyVoiceTabs'

const REQ_PAGE_SIZE = 10

const withTimeout = <T,>(p: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

type Category = 'maintenance' | 'appeal' | 'account' | 'other'
type Status = 'new' | 'in_progress' | 'resolved'

const CATS: { value: Category; label: string }[] = [
  { value: 'maintenance', label: 'Maintenance issue' },
  { value: 'appeal',      label: 'Violation appeal' },
  { value: 'account',     label: 'Account question' },
  { value: 'other',       label: 'Other' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))

const STATUSES: { value: Status; label: string }[] = [
  { value: 'new',         label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved',    label: 'Resolved' },
]
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map(s => [s.value, s.label]))

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

type Request = {
  id: string
  profile_id: string
  community_id: string
  submitter_name: string | null
  submitter_unit: string | null
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

// Admin → Requests. The board's triage queue for everything residents submit
// from /app/contact — maintenance issues, appeals, questions. Set the status
// to move each one New → In progress → Resolved.
export default function RequestsAdmin() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<Request[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [filterCategory, setFilterCategory] = useState<'all' | Category>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | Status>('all')
  const [page, setPage] = useState(1)
  // Per-request note drafts (keyed by id), the photo each note is sending, and
  // which one is mid-save.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [noteFiles, setNoteFiles] = useState<Record<string, File | null>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)

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
        supabase!.from('resident_requests').select('*')
          .eq('community_id', communityId)
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      setRows((data as Request[]) || [])
      setStatus('ready')
    } catch (err: any) {
      const msg = err?.message || ''
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setStatus('none')
      } else {
        setError(msg || 'Could not load requests')
        setStatus('error')
      }
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const openAttachment = async (path: string) => {
    try {
      const { data } = await supabase!.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  const setRequestStatus = async (r: Request, next: Status) => {
    const prevStatus = r.status
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, status: next } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ status: next }).eq('id', r.id)
      )
      if (error) throw error
      setSuccessMsg(`"${r.subject}" → ${STATUS_LABEL[next]}.`)
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, status: prevStatus } : x))   // roll back
      setError(err?.message || 'Could not update that request')
    }
  }

  // The note the resident sees on their Contact page — text plus an optional
  // photo. Clearing the text (with no photo) removes the note.
  const saveNote = async (r: Request) => {
    const text = (noteDrafts[r.id] ?? r.board_note ?? '').trim()
    const file = noteFiles[r.id] || null
    if (file && file.size > MAX_FILE) { setError('Photo must be 10MB or smaller.'); return }
    setSavingNote(r.id)
    try {
      const patch: Record<string, any> = { board_note: text || null }
      // Upload into the resident's own folder so their existing read policy
      // covers it: <community_id>/<resident_profile_id>/<uuid>.<ext>.
      if (file) {
        const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${r.community_id}/${r.profile_id}/${crypto.randomUUID()}.${ext}`
        const up = await withTimeout(
          supabase!.storage.from('request-attachments').upload(path, file), 30000
        )
        if ((up as any).error) throw (up as any).error
        patch.board_note_attachment_path = path
        patch.board_note_attachment_name = file.name
      }
      // Stamp the time whenever there's anything to show (note text or a photo).
      const hasContent = Boolean(text) || Boolean(file) || Boolean(r.board_note_attachment_path)
      patch.board_note_at = hasContent ? new Date().toISOString() : null
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update(patch).eq('id', r.id)
      )
      if (error) throw error
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...patch } : x))
      setNoteDrafts(d => { const n = { ...d }; delete n[r.id]; return n })
      setNoteFiles(f => { const n = { ...f }; delete n[r.id]; return n })
      setSuccessMsg(
        text || file ? `Note saved on "${r.subject}".` : `Note cleared on "${r.subject}".`
      )
    } catch (err: any) {
      setError(err?.message || 'Could not save that note')
    } finally {
      setSavingNote(null)
    }
  }

  const newCount = rows.filter(r => r.status === 'new').length
  const filtered = rows.filter(r =>
    (filterCategory === 'all' || r.category === filterCategory) &&
    (filterStatus === 'all' || r.status === filterStatus)
  )
  const visible = paginate(filtered, page, REQ_PAGE_SIZE)

  return (
    <div className="admin-page">
      <EasyVoiceTabs active="contact" />
      <div className="admin-kicker">Contact</div>
      <h1 className="admin-h1">Contact requests</h1>
      <p className="admin-dek">
        Everything residents submit from their Contact tab — maintenance issues,
        appeals, and questions. Set each one&rsquo;s status to keep residents in the loop.
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked yet, or the requests table isn&rsquo;t set up. Run the
          resident requests setup SQL (see supabase/resident-requests.sql), then reload.
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
          <div className="bc-head" style={{ marginTop: 8, marginBottom: 14 }}>
            <h2 className="bc-title">Queue</h2>
            <span className="bc-sub">
              {rows.length} {rows.length === 1 ? 'request' : 'requests'}
              {newCount > 0 ? ` · ${newCount} new` : ''}.
            </span>
          </div>

          <div className="admin-sched-filters" style={{ marginTop: 4, marginBottom: 12 }}>
            <div className="admin-sched-filter">
              <label>Category</label>
              <Dropdown<'all' | Category>
                value={filterCategory}
                onChange={v => { setFilterCategory(v); setPage(1) }}
                ariaLabel="Filter requests by category"
                options={[
                  { value: 'all', label: `All (${rows.length})` },
                  ...CATS.map(c => ({ value: c.value, label: `${c.label} (${rows.filter(r => r.category === c.value).length})` })),
                ]}
              />
            </div>
            <div className="admin-sched-filter">
              <label>Status</label>
              <Dropdown<'all' | Status>
                value={filterStatus}
                onChange={v => { setFilterStatus(v); setPage(1) }}
                ariaLabel="Filter requests by status"
                options={[
                  { value: 'all', label: 'All statuses' },
                  ...STATUSES.map(s => ({ value: s.value, label: `${s.label} (${rows.filter(r => r.status === s.value).length})` })),
                ]}
              />
            </div>
          </div>

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="bc-empty">No requests yet — they&rsquo;ll appear here as residents submit them.</div>
          )}
          {status === 'ready' && rows.length > 0 && filtered.length === 0 && (
            <div className="bc-empty">No requests match these filters.</div>
          )}

          <div className="bd-list" style={{ maxWidth: 860 }}>
            {visible.map(r => {
              const draft = noteDrafts[r.id] ?? r.board_note ?? ''
              const file = noteFiles[r.id] || null
              const dirty = draft !== (r.board_note ?? '') || Boolean(file)
              return (
              <div className="bd-row" key={r.id} style={{ padding: 16, gap: 14, alignItems: 'stretch' }}>
                {/* Request info — grouped in a faded-orange card for structure. */}
                <div style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(225, 73, 9, 0.07)',
                  border: '1px solid rgba(225, 73, 9, 0.16)',
                  borderRadius: 14, padding: '13px 16px',
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bd-title">{r.subject}</div>
                    <div className="bd-meta">
                      <span>{r.submitter_name || 'Resident'}</span>
                      {r.submitter_unit && <><span className="bd-dot">·</span><span>{r.submitter_unit}</span></>}
                      <span className="bd-dot">·</span>
                      <span>{CAT_LABEL[r.category] || r.category}</span>
                      <span className="bd-dot">·</span>
                      <span>{fmtDate(r.created_at)}</span>
                    </div>
                    {r.body && <div className="bd-meta" style={{ marginTop: 6 }}>{r.body}</div>}
                    {r.attachment_path && (
                      <button type="button" onClick={() => openAttachment(r.attachment_path!)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E14909', font: 'inherit', fontSize: 13, padding: '6px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Clip />
                        {r.attachment_name || 'View attachment'}
                      </button>
                    )}
                  </div>
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <Dropdown<Status>
                      value={r.status as Status}
                      onChange={v => setRequestStatus(r, v)}
                      ariaLabel={`Status for ${r.subject}`}
                      options={STATUSES}
                    />
                  </div>
                </div>

                {/* Board's reply — note text + optional photo, both seen by the resident. */}
                <div style={{ width: '100%', boxSizing: 'border-box', textAlign: 'left' }}>
                  <label htmlFor={`note-${r.id}`}
                    style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0A2440', marginBottom: 5 }}>
                    Note to resident{' '}
                    <span style={{ fontWeight: 400, color: 'rgba(15,28,46,0.5)' }}>— shown on their Contact page</span>
                  </label>
                  <textarea
                    id={`note-${r.id}`}
                    className="admin-input admin-textarea"
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    placeholder="e.g. Reviewed and checked — fixing by Friday."
                    value={draft}
                    onChange={e => setNoteDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
                    <button
                      type="button"
                      className="admin-secondary-btn"
                      onClick={() => saveNote(r)}
                      disabled={savingNote === r.id || !dirty}
                    >
                      {savingNote === r.id ? 'Saving…' : 'Save note'}
                    </button>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#E14909' }}>
                      <input type="file" accept="image/*" hidden
                        onChange={e => setNoteFiles(f => ({ ...f, [r.id]: e.target.files?.[0] || null }))} />
                      <Clip />
                      {file ? file.name : (r.board_note_attachment_name ? 'Replace photo' : 'Attach a photo')}
                    </label>
                    {!file && r.board_note_attachment_path && (
                      <button type="button" onClick={() => openAttachment(r.board_note_attachment_path!)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(15,28,46,0.6)', font: 'inherit', fontSize: 12, textDecoration: 'underline' }}>
                        View sent photo
                      </button>
                    )}
                    {r.board_note_at && !dirty && (
                      <span style={{ fontSize: 12, color: 'rgba(15,28,46,0.5)' }}>Sent {fmtDate(r.board_note_at)}</span>
                    )}
                  </div>
                </div>
              </div>
              )
            })}
          </div>
          <Pagination
            page={page}
            pageSize={REQ_PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}

function Clip() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" />
    </svg>
  )
}
