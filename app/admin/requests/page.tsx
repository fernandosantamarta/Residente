'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'
import { EasyVoiceTabs } from '../EasyVoiceTabs'
import { useRequestThread, sendThreadMessage, type ThreadMessage } from '@/lib/requestThread'

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

// Status chip + left-accent colors — mirrors the Architectural (ARC) worklist
// cards so the two Easy Voice queues read the same way.
function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}
const STATUS_COLOR: Record<string, string> = {
  new:         '#175CD3',
  in_progress: '#B54708',
  resolved:    '#067647',
}

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
  emailed_at: string | null
  origin: string | null   // 'resident' (they submitted) | 'board' (we reached out)
  closed_at: string | null
  replies_locked: boolean | null
  last_message_at: string | null
  last_message_role: string | null
}

type ResidentOption = { id: string; name: string; unit: string | null; email: string | null }

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

  // "Message a resident" composer — board-initiated outreach.
  const [residents, setResidents] = useState<ResidentOption[]>([])
  const [compose, setCompose] = useState({ residentId: '', subject: '', message: '', allowReplies: true })
  const [composeErr, setComposeErr] = useState('')
  const [sending, setSending] = useState(false)

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

  // Live refresh: a new resident reply (which stamps last_message_* on the
  // request) or a new submission should surface without a manual reload.
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const ch = supabase
      .channel(`admin-requests:${communityId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'resident_requests',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      supabase!.removeChannel(ch)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [communityId, load])

  // Community roster for the "Message a resident" picker.
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase!
          .from('profiles')
          .select('id, full_name, unit_number, email')
          .eq('community_id', communityId)
          .order('full_name', { ascending: true })
        if (cancelled) return
        setResidents((data || []).map((p: any) => ({
          id: p.id, name: p.full_name || 'Resident', unit: p.unit_number ?? null, email: p.email ?? null,
        })))
      } catch { /* leave empty */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  // Board-initiated message: create a tracked request row owned by the resident
  // (so it shows on their Contact page and in this queue), then email it. The
  // board's text lives in board_note so the resident sees it tagged "From the
  // board"; origin = 'board' marks who started the thread.
  const sendMessage = async () => {
    const target = residents.find(r => r.id === compose.residentId)
    if (!target) { setComposeErr('Pick a resident.'); return }
    if (!compose.subject.trim()) { setComposeErr('Add a subject.'); return }
    if (!compose.message.trim()) { setComposeErr('Write a message.'); return }
    setSending(true); setComposeErr('')
    try {
      const now = new Date().toISOString()
      const { data: inserted, error } = await withTimeout(
        supabase!.from('resident_requests').insert({
          community_id:   communityId,
          profile_id:     target.id,
          submitter_name: target.name,
          submitter_unit: target.unit,
          category:       'other',
          subject:        compose.subject.trim(),
          body:           null,
          status:         'in_progress',
          origin:         'board',
          board_note:     compose.message.trim(),
          board_note_at:  now,
          replies_locked: !compose.allowReplies,
        }).select('id').single()
      )
      if (error) throw error
      const newId = (inserted as any)?.id as string | undefined

      let emailed = false
      if (newId && target.email) {
        const { data, error: fnErr } = await supabase!.functions.invoke('request-reply-email', {
          body: { request_id: newId, note: compose.message.trim() },
        })
        if (!fnErr && (data as any)?.email_sent) emailed = true
      }

      setCompose({ residentId: '', subject: '', message: '', allowReplies: true })
      setSuccessMsg(
        emailed ? `Message sent and emailed to ${target.name}.`
          : target.email ? `Message saved for ${target.name}, but the email could not be sent.`
          : `Message saved for ${target.name} (no email on file to send to).`
      )
      await load()
    } catch (err: any) {
      setComposeErr(err?.message || 'Could not send the message.')
    } finally {
      setSending(false)
    }
  }

  const openAttachment = async (path: string) => {
    try {
      const { data } = await supabase!.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  const setRequestStatus = async (r: Request, next: Status) => {
    const prev = { status: r.status, closed_at: r.closed_at }
    // Resolving a request CLOSES the conversation (stamps closed_at, which the
    // resident's reply box keys off). Any other status reopens it.
    const closedAt = next === 'resolved' ? new Date().toISOString() : null
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, status: next, closed_at: closedAt } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ status: next, closed_at: closedAt }).eq('id', r.id)
      )
      if (error) throw error
      setSuccessMsg(next === 'resolved' ? `Conversation with ${r.submitter_name || 'the resident'} closed.` : `"${r.subject}" → ${STATUS_LABEL[next]}.`)
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...prev } : x))   // roll back
      setError(err?.message || 'Could not update that request')
    }
  }

  // Lock/unlock resident replies on a thread (a one-way message vs. a back-and-
  // forth). Enforced in RLS too — the UI just mirrors it.
  const setRepliesLocked = async (r: Request, locked: boolean) => {
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, replies_locked: locked } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ replies_locked: locked }).eq('id', r.id)
      )
      if (error) throw error
      setSuccessMsg(locked ? 'Replies turned off — the resident can read but not reply.' : 'Replies turned back on.')
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, replies_locked: !locked } : x))   // roll back
      setError(err?.message || 'Could not update that request')
    }
  }

  const newCount = rows.filter(r => r.status === 'new').length
  // A thread is "awaiting your reply" when the last message was the resident's
  // and it isn't closed — the board owes a response.
  const awaiting = (r: Request) => r.last_message_role === 'resident' && r.status !== 'resolved'
  const awaitingCount = rows.filter(awaiting).length
  const lastActivity = (r: Request) =>
    (r.last_message_at && r.last_message_at > r.created_at ? r.last_message_at : r.created_at)
  const filtered = rows
    .filter(r =>
      (filterCategory === 'all' || r.category === filterCategory) &&
      (filterStatus === 'all' || r.status === filterStatus)
    )
    // Threads awaiting a reply float to the top; otherwise newest activity first.
    .sort((a, b) => (awaiting(b) ? 1 : 0) - (awaiting(a) ? 1 : 0) || lastActivity(b).localeCompare(lastActivity(a)))
  const visible = paginate(filtered, page, REQ_PAGE_SIZE)

  return (
    <div className="admin-page cset">
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
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <h2>Message a resident</h2>
              <div className="sub">Start a conversation — it lands on their Contact page and emails them.</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0A2440', marginBottom: 5 }}>Resident</label>
                <Dropdown<string>
                  value={compose.residentId}
                  onChange={v => setCompose(c => ({ ...c, residentId: v }))}
                  ariaLabel="Resident"
                  options={[
                    { value: '', label: 'Select a resident…' },
                    ...residents.map(r => ({
                      value: r.id,
                      label: `${r.name}${r.unit ? ` · ${r.unit}` : ''}${r.email ? '' : ' (no email)'}`,
                    })),
                  ]}
                />
              </div>
              <div style={{ flex: '2 1 320px', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0A2440', marginBottom: 5 }}>Subject</label>
                <input
                  className="admin-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={compose.subject}
                  onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))}
                  placeholder="e.g. Reminder: gate code change Friday"
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0A2440', marginBottom: 5 }}>Message</label>
              <textarea
                className="admin-input admin-textarea"
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={compose.message}
                onChange={e => setCompose(c => ({ ...c, message: e.target.value }))}
                placeholder="Write your message to the resident…"
              />
            </div>
            {composeErr && <div className="admin-note admin-note-err">{composeErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'rgba(10,36,64,0.75)' }}>
                <input type="checkbox" checked={compose.allowReplies}
                  onChange={e => setCompose(c => ({ ...c, allowReplies: e.target.checked }))} />
                Allow the resident to reply
              </label>
              <button type="button" className="admin-primary-btn" onClick={sendMessage} disabled={sending}>
                {sending ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>
                Queue
                {awaitingCount > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#fff', background: '#E14909', borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle' }}>
                    {awaitingCount} awaiting reply
                  </span>
                )}
              </h2>
              <div className="sub">
                {rows.length} {rows.length === 1 ? 'request' : 'requests'}
                {newCount > 0 ? ` · ${newCount} new` : ''}.
              </div>
            </div>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visible.map(r => {
              const statusColor = STATUS_COLOR[r.status] || '#475467'
              return (
              <div key={r.id} style={{
                border: '1px solid rgba(0,0,0,0.08)',
                borderLeft: `4px solid ${statusColor}`,
                borderRadius: 12,
                padding: '14px 16px',
                background: '#fff',
              }}>
                {/* Header — subject + meta on the left, status chip + dropdown on the right. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{r.subject}</div>
                    <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>
                      {r.submitter_name || 'Resident'}
                      {r.submitter_unit ? ` · ${r.submitter_unit}` : ''}
                      {` · ${CAT_LABEL[r.category] || r.category}`}
                      {` · ${fmtDate(r.created_at)}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {awaiting(r) && <span style={chip('#E14909')}>Awaiting reply</span>}
                    {r.replies_locked && <span style={chip('#475467')}>Replies off</span>}
                    {r.origin === 'board' && <span style={chip('#7C3AED')}>Outbound</span>}
                    <span style={chip(statusColor)}>{STATUS_LABEL[r.status] || r.status}</span>
                    <div style={{ width: 150 }}>
                      <Dropdown<Status>
                        value={r.status as Status}
                        onChange={v => setRequestStatus(r, v)}
                        ariaLabel={`Status for ${r.subject}`}
                        options={STATUSES}
                      />
                    </div>
                  </div>
                </div>

                {/* Two-way thread + the board's reply box. */}
                <AdminThread
                  request={r}
                  profileId={profile?.id}
                  openAttachment={openAttachment}
                  onSent={msg => setSuccessMsg(msg)}
                  onSetStatus={setRequestStatus}
                  onSetLocked={setRepliesLocked}
                />
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
        </div>
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

const fmtMsgTime = (d: string) =>
  new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// The board side of a Contact thread: the full message log plus a reply box.
// A board reply posts a 'board' message and (by default) emails the resident.
function AdminThread({
  request, profileId, openAttachment, onSent, onSetStatus, onSetLocked,
}: {
  request: Request
  profileId?: string
  openAttachment: (path: string) => void
  onSent: (msg: string) => void
  onSetStatus: (r: Request, next: Status) => Promise<void>
  onSetLocked: (r: Request, locked: boolean) => Promise<void>
}) {
  const { messages, loading, reload } = useRequestThread(request.id)
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [emailIt, setEmailIt] = useState(true)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const closed = request.status === 'resolved'
  const locked = !!request.replies_locked

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending && (draft.trim() || file)) send() }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text && !file) return
    if (file && file.size > MAX_FILE) { setErr('Photo must be 10MB or smaller.'); return }
    setSending(true); setErr('')
    try {
      let attachmentPath: string | null = null
      let attachmentName: string | null = null
      if (file) {
        // Upload into the resident's own folder so their read policy covers it.
        const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${request.community_id}/${request.profile_id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase!.storage.from('request-attachments').upload(path, file)
        if ((up as any).error) throw (up as any).error
        attachmentPath = path
        attachmentName = file.name
      }
      await sendThreadMessage({
        requestId: request.id,
        communityId: request.community_id,
        body: text || '(photo)',
        authorRole: 'board',
        authorId: profileId ?? null,
        authorName: 'Board',
        attachmentPath,
        attachmentName,
      })
      let emailed = false
      if (emailIt && text) {
        const { data, error: fnErr } = await supabase!.functions.invoke('request-reply-email', {
          body: { request_id: request.id, note: text },
        })
        if (!fnErr && (data as any)?.email_sent) emailed = true
        else setErr((data as any)?.error || fnErr?.message || 'Reply posted, but the email could not be sent.')
      }
      setDraft(''); setFile(null)
      await reload()
      onSent(emailed
        ? `Reply sent and emailed to ${request.submitter_name || 'the resident'}.`
        : `Reply posted for ${request.submitter_name || 'the resident'}.`)
    } catch (e: any) {
      setErr(e?.message || 'Could not send the reply.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* Message log */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {loading && messages.length === 0 && <div style={{ fontSize: 12.5, color: 'rgba(10,36,64,0.5)' }}>Loading…</div>}
        {messages.map(m => {
          const board = m.authorRole === 'board'
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: board ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '78%',
                background: board ? 'rgba(225, 73, 9, 0.08)' : 'rgba(10, 36, 64, 0.05)',
                border: `1px solid ${board ? 'rgba(225, 73, 9, 0.18)' : 'rgba(10, 36, 64, 0.10)'}`,
                borderRadius: 12,
                padding: '8px 12px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: board ? '#E14909' : 'rgba(10,36,64,0.7)', marginBottom: 2 }}>
                  {board ? (m.authorName || 'Board') : (m.authorName || 'Resident')}
                  <span style={{ fontWeight: 400, opacity: 0.6 }}>{' · '}{fmtMsgTime(m.createdAt)}</span>
                </div>
                <div style={{ fontSize: 13, color: '#1F2233', whiteSpace: 'pre-wrap' }}>{m.body}</div>
                {m.attachmentPath && (
                  <button type="button" onClick={() => openAttachment(m.attachmentPath!)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E14909', font: 'inherit', fontSize: 12, padding: '4px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Clip />{m.attachmentName || 'View photo'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Closed → no reply box; the board can reopen. Open → reply + Close. */}
      {closed ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'rgba(6,118,71,0.06)', border: '1px solid rgba(6,118,71,0.2)', borderRadius: 10, padding: '10px 14px' }}>
          <span style={{ fontSize: 12.5, color: '#067647', fontWeight: 600 }}>
            ✓ Conversation closed{request.closed_at ? ` · ${fmtDate(request.closed_at)}` : ''} — the resident can’t reply; they’d start a new message.
          </span>
          <button type="button" className="admin-btn-ghost" onClick={() => onSetStatus(request, 'in_progress')}>
            Reopen
          </button>
        </div>
      ) : (
        <>
          <label htmlFor={`reply-${request.id}`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0A2440', marginBottom: 5 }}>
            Reply to resident{' '}
            <span style={{ fontWeight: 400, color: 'rgba(15,28,46,0.5)' }}>— shown on their Contact page</span>
          </label>
          <textarea
            id={`reply-${request.id}`}
            className="admin-input admin-textarea"
            rows={2}
            style={{ width: '100%', boxSizing: 'border-box' }}
            placeholder="Write a reply…  (Enter to send)"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {err && <div className="admin-note admin-note-err" style={{ marginTop: 8 }}>{err}</div>}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
            <button type="button" className="admin-secondary-btn" onClick={send} disabled={sending || (!draft.trim() && !file)}>
              {sending ? 'Sending…' : 'Send reply'}
            </button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#E14909' }}>
              <input type="file" accept="image/*" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
              <Clip />
              {file ? file.name : 'Attach a photo'}
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'rgba(10,36,64,0.75)' }}>
              <input type="checkbox" checked={emailIt} onChange={e => setEmailIt(e.target.checked)} />
              Email this reply to the resident
            </label>
            <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto' }}>
              <button type="button" className="admin-btn-ghost" onClick={() => onSetLocked(request, !locked)}>
                {locked ? 'Allow replies' : 'Turn off replies'}
              </button>
              <button type="button" className="admin-btn-ghost" onClick={() => onSetStatus(request, 'resolved')}>
                Close conversation
              </button>
            </span>
          </div>
          {locked && (
            <div style={{ fontSize: 12, color: 'rgba(10,36,64,0.6)', marginTop: 8 }}>
              Replies are off — the resident can read this thread but can’t reply. They’d start a new message.
            </div>
          )}
        </>
      )}
    </div>
  )
}
