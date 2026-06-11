'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { EasyVoiceTabs } from '../EasyVoiceTabs'
import { useRequestThread, sendThreadMessage, type ThreadMessage } from '@/lib/requestThread'

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
// Color per category — shared by the mailbox list and the conversation header.
const CAT_COLOR: Record<string, string> = {
  maintenance: '#175CD3',   // blue
  appeal:      '#B54708',   // amber
  account:     '#7C3AED',   // purple
  other:       '#475467',   // slate
}
const catColor = (c: string) => CAT_COLOR[c] || '#475467'
// Small squared category tag.
function catTag(c: string): React.CSSProperties {
  const col = catColor(c)
  return { fontSize: 10.5, fontWeight: 700, color: col, background: col + '1A', padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' }
}

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
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap' }
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
  // Mailbox: which folder (Received from residents / Sent by the board), the
  // selected conversation, and whether the compose pane is open.
  const [tab, setTab] = useState<'received' | 'sent'>('received')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<'all' | Category>('all')

  // "Message a resident" composer — board-initiated outreach.
  const [residents, setResidents] = useState<ResidentOption[]>([])
  const [compose, setCompose] = useState({ residentId: '', subject: '', message: '', allowReplies: true })
  const [composeFile, setComposeFile] = useState<File | null>(null)
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
  // (so it shows on their Contact page and in this queue), seed the first board
  // message (optionally with a photo), then email it. origin = 'board' marks who
  // started the thread. board_note stays null — the message lives in the thread,
  // so the seed trigger doesn't also create a duplicate text-only message.
  const sendMessage = async () => {
    const target = residents.find(r => r.id === compose.residentId)
    if (!target) { setComposeErr('Pick a resident.'); return }
    if (!compose.subject.trim()) { setComposeErr('Add a subject.'); return }
    if (!compose.message.trim()) { setComposeErr('Write a message.'); return }
    if (composeFile && composeFile.size > MAX_FILE) { setComposeErr('Photo must be 10MB or smaller.'); return }
    setSending(true); setComposeErr('')
    try {
      // Upload first (into the resident's folder so their read policy covers it)
      // — if it fails we haven't created an orphaned request.
      let attachmentPath: string | null = null
      let attachmentName: string | null = null
      if (composeFile) {
        const ext = composeFile.name.includes('.') ? composeFile.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${communityId}/${target.id}/${crypto.randomUUID()}.${ext}`
        const up = await withTimeout(supabase!.storage.from('request-attachments').upload(path, composeFile), 30000)
        if ((up as any).error) throw (up as any).error
        attachmentPath = path
        attachmentName = composeFile.name
      }

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
          board_note:     null,
          replies_locked: !compose.allowReplies,
        }).select('id').single()
      )
      if (error) throw error
      const newId = (inserted as any)?.id as string | undefined
      if (!newId) throw new Error('Could not create the message')

      // Seed the opening board message (carries the photo, if any).
      await sendThreadMessage({
        requestId: newId,
        communityId: communityId!,
        body: compose.message.trim(),
        authorRole: 'board',
        authorId: profile?.id ?? null,
        authorName: 'Board',
        attachmentPath,
        attachmentName,
      })

      let emailed = false
      if (target.email) {
        const { data, error: fnErr } = await supabase!.functions.invoke('request-reply-email', {
          body: { request_id: newId, note: compose.message.trim() },
        })
        if (!fnErr && (data as any)?.email_sent) emailed = true
      }

      setCompose({ residentId: '', subject: '', message: '', allowReplies: true })
      setComposeFile(null)
      setComposing(false)
      setTab('sent')
      setSelectedId(newId)
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

  // A thread is "awaiting your reply" when the last message was the resident's
  // and it isn't closed — the board owes a response.
  const awaiting = (r: Request) => r.last_message_role === 'resident' && r.status !== 'resolved'
  const lastActivity = (r: Request) =>
    (r.last_message_at && r.last_message_at > r.created_at ? r.last_message_at : r.created_at)
  const byActivity = (a: Request, b: Request) => lastActivity(b).localeCompare(lastActivity(a))

  // Two folders: Received (resident-initiated) and Sent (board-initiated).
  const received = rows.filter(r => r.origin !== 'board')
    .sort((a, b) => (awaiting(b) ? 1 : 0) - (awaiting(a) ? 1 : 0) || byActivity(a, b))
  const sent = rows.filter(r => r.origin === 'board').sort(byActivity)
  const awaitingCount = received.filter(awaiting).length
  const activeList = tab === 'received' ? received : sent
  // Search + category filter narrow the visible list.
  const q = search.trim().toLowerCase()
  const shownList = activeList.filter(r => {
    if (catFilter !== 'all' && r.category !== catFilter) return false
    if (q && !`${r.submitter_name || ''} ${r.subject || ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const selected = rows.find(r => r.id === selectedId) || null

  // Keep a valid selection: when the folder/list changes, fall back to the first
  // conversation in view (and never point at a row from the other folder).
  useEffect(() => {
    if (composing) return
    if (!activeList.some(r => r.id === selectedId)) {
      setSelectedId(activeList[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rows.length, composing])

  return (
    <div className="admin-page cset">
      <EasyVoiceTabs active="contact" />
      <div className="admin-kicker">Contact</div>
      <h1 className="admin-h1">Messages</h1>
      <p className="admin-dek">
        Two-way messages with residents. <strong>Received</strong> holds what residents
        sent you; <strong>Sent</strong> holds the messages you started.
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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Folder tabs + compose */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div className="seg-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'received'}
                className={`seg-tab${tab === 'received' ? ' active' : ''}`}
                onClick={() => { setTab('received'); setComposing(false) }}>
                Received{awaitingCount > 0 ? ` · ${awaitingCount}` : ''}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'sent'}
                className={`seg-tab${tab === 'sent' ? ' active' : ''}`}
                onClick={() => { setTab('sent'); setComposing(false) }}>
                Sent
              </button>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 180 }}>
                <Dropdown<'all' | Category>
                  value={catFilter}
                  onChange={setCatFilter}
                  ariaLabel="Filter by category"
                  options={[{ value: 'all', label: 'All categories' }, ...CATS.map(c => ({ value: c.value, label: c.label }))]}
                />
              </div>
              <button type="button" className="admin-primary-btn"
                onClick={() => { setComposing(true); setSelectedId(null) }}>
                New message
              </button>
            </span>
          </div>

          {/* Two-pane: mailbox list | conversation */}
          <div className="msg-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 320px) 1fr', minHeight: 460 }}>
            {/* LEFT — mailbox list */}
            <div style={{ borderRight: '1px solid var(--border)', maxHeight: 640, overflowY: 'auto' }}>
              {/* Search */}
              <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)', padding: 8 }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: 'absolute', left: 9, pointerEvents: 'none' }}>
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search name or subject…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px 7px 28px', fontSize: 12.5, font: 'inherit', color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, outline: 'none' }}
                  />
                </div>
              </div>
              {status === 'loading' && <div className="admin-note" style={{ margin: 12 }}>Loading…</div>}
              {status === 'ready' && activeList.length === 0 && (
                <div style={{ padding: '24px 16px', color: 'var(--text-dim)', fontSize: 13 }}>
                  {tab === 'received' ? 'No messages from residents yet.' : 'You haven’t sent any messages yet.'}
                </div>
              )}
              {status === 'ready' && activeList.length > 0 && shownList.length === 0 && (
                <div style={{ padding: '20px 16px', color: 'var(--text-dim)', fontSize: 13 }}>No matches for “{search}”.</div>
              )}
              {shownList.map(r => {
                const sel = selected?.id === r.id
                const need = awaiting(r)
                return (
                  <button key={r.id} type="button"
                    onClick={() => { setSelectedId(r.id); setComposing(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', borderRadius: 0, borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${sel ? '#E14909' : 'transparent'}`, background: sel ? 'rgba(225,73,9,0.06)' : 'transparent', padding: '10px 14px', font: 'inherit' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.submitter_name || 'Resident'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtDate(lastActivity(r))}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{r.subject}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, minHeight: 16, flexWrap: 'wrap' }}>
                      <span style={catTag(r.category)}>{CAT_LABEL[r.category] || r.category}</span>
                      {need && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#E14909' }}>
                          <span style={{ width: 6, height: 6, borderRadius: 1, background: '#E14909' }} />Awaiting reply
                        </span>
                      )}
                      {!need && r.status === 'resolved' && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Resolved</span>}
                      {r.replies_locked && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>· Replies off</span>}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* RIGHT — composer / conversation / empty */}
            <div style={{ padding: 16, minWidth: 0 }}>
              {composing ? (
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>New message</h2>
                  <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 14px' }}>Start a conversation — it lands on their Contact page and emails them.</p>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>Resident</label>
                      <Dropdown<string>
                        value={compose.residentId}
                        onChange={v => setCompose(c => ({ ...c, residentId: v }))}
                        ariaLabel="Resident"
                        options={[
                          { value: '', label: 'Select a resident…' },
                          ...residents.map(r => ({ value: r.id, label: `${r.name}${r.unit ? ` · ${r.unit}` : ''}${r.email ? '' : ' (no email)'}` })),
                        ]}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>Subject</label>
                      <input className="admin-input" style={{ width: '100%', boxSizing: 'border-box' }}
                        value={compose.subject} onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))}
                        placeholder="e.g. Reminder: gate code change Friday" />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>Message</label>
                      <textarea className="admin-input admin-textarea" rows={4} style={{ width: '100%', boxSizing: 'border-box' }}
                        value={compose.message} onChange={e => setCompose(c => ({ ...c, message: e.target.value }))}
                        placeholder="Write your message to the resident…" />
                    </div>
                    {composeErr && <div className="admin-note admin-note-err">{composeErr}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#E14909' }}>
                          <input type="file" accept="image/*" hidden onChange={e => setComposeFile(e.target.files?.[0] || null)} />
                          <Clip />
                          {composeFile ? composeFile.name : 'Attach a photo'}
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-dim)' }}>
                          <input type="checkbox" checked={compose.allowReplies} onChange={e => setCompose(c => ({ ...c, allowReplies: e.target.checked }))} />
                          Allow the resident to reply
                        </label>
                      </span>
                      <span style={{ display: 'inline-flex', gap: 8 }}>
                        <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" onClick={() => { setComposing(false); setComposeFile(null) }}>Cancel</button>
                        <button type="button" className="admin-primary-btn" onClick={sendMessage} disabled={sending}>
                          {sending ? 'Sending…' : 'Send message'}
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              ) : selected ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{selected.subject}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>
                        {selected.submitter_name || 'Resident'}{selected.submitter_unit ? ` · ${selected.submitter_unit}` : ''} · {fmtDate(selected.created_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={chip(catColor(selected.category))}>{CAT_LABEL[selected.category] || selected.category}</span>
                      {selected.replies_locked && <span style={chip('#475467')}>Replies off</span>}
                      {selected.origin === 'board' && <span style={chip('#7C3AED')}>Outbound</span>}
                      <span style={chip(STATUS_COLOR[selected.status] || '#475467')}>{STATUS_LABEL[selected.status] || selected.status}</span>
                    </div>
                  </div>
                  <AdminThread
                    request={selected}
                    profileId={profile?.id}
                    openAttachment={openAttachment}
                    onSent={msg => setSuccessMsg(msg)}
                    onSetStatus={setRequestStatus}
                    onSetLocked={setRepliesLocked}
                  />
                </>
              ) : (
                <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 360, color: 'var(--text-dim)', fontSize: 13, textAlign: 'center' }}>
                  <div>
                    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="var(--border-hover)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10 }}>
                      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
                    </svg>
                    <div>Select a message to read it,<br />or hit <strong>New message</strong>.</div>
                  </div>
                </div>
              )}
            </div>
          </div>
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

  const messageLog = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      {loading && messages.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Loading…</div>}
      {messages.map(m => {
        const board = m.authorRole === 'board'
        return (
          <div key={m.id} style={{ display: 'flex', justifyContent: board ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '78%',
              background: board ? 'rgba(225, 73, 9, 0.07)' : 'rgba(42, 18, 6, 0.04)',
              border: `1px solid ${board ? 'rgba(225, 73, 9, 0.18)' : 'var(--border)'}`,
              borderRadius: 5,
              padding: '8px 12px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: board ? '#E14909' : 'var(--text-dim)', marginBottom: 2 }}>
                {board ? (m.authorName || 'Board') : (m.authorName || 'Resident')}
                <span style={{ fontWeight: 400, opacity: 0.6 }}>{' · '}{fmtMsgTime(m.createdAt)}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{m.body}</div>
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
  )

  return (
    <div style={{ marginTop: 12 }}>
      {messageLog}
      {closed ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'rgba(42,18,6,0.03)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px' }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#1F7A4D' }}>Resolved</span>
              {request.closed_at ? ` · ${fmtDate(request.closed_at)}` : ''} — the resident can’t reply.
            </span>
          </span>
          <button type="button" onClick={() => onSetStatus(request, 'in_progress')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E14909', font: 'inherit', fontSize: 12, fontWeight: 700, padding: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>
            Reopen
          </button>
        </div>
      ) : (
        <>
          <label htmlFor={`reply-${request.id}`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>
            Reply to resident{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>— shown on their Contact page</span>
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
          {/* Row 1 — reply actions (Send reply pinned right) */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#E14909' }}>
              <input type="file" accept="image/*" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
              <Clip />
              {file ? file.name : 'Attach a photo'}
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={emailIt} onChange={e => setEmailIt(e.target.checked)} />
              Email resident
            </label>
            <button type="button" className="admin-secondary-btn" style={{ marginLeft: 'auto' }} onClick={send} disabled={sending || (!draft.trim() && !file)}>
              {sending ? 'Sending…' : 'Send reply'}
            </button>
          </div>
          {/* Row 2 — status (left) + conversation management (right) */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>Status</span>
              <div style={{ width: 140 }}>
                <Dropdown<Status>
                  value={request.status as Status}
                  onChange={v => onSetStatus(request, v)}
                  ariaLabel="Conversation status"
                  options={STATUSES}
                />
              </div>
            </span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
              <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0 }} onClick={() => onSetLocked(request, !locked)}>
                {locked ? 'Allow replies' : 'Turn off replies'}
              </button>
              <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0 }} onClick={() => onSetStatus(request, 'resolved')}>
                Close conversation
              </button>
            </span>
          </div>
          {locked && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
              Replies are off — the resident can read this thread but can’t reply. They’d start a new message.
            </div>
          )}
        </>
      )}
    </div>
  )
}
