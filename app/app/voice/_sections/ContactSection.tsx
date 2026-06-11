'use client'

import React, { Fragment, ReactNode, useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { RequestForm, useCatLabel, IconClip, type Category } from './RequestForm'
import { useRequestThread, sendThreadMessage } from '@/lib/requestThread'
import { useT } from '@/lib/i18n'

const withTimeout = <T,>(p: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

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
  origin: string | null
  replies_locked: boolean | null
}

// Contact the board — submit a maintenance issue / appeal / question; the
// board triages it at /admin/requests. Two-column layout: request form +
// the resident's submission history. A section of the Easy Voice hub.
export function ContactSection() {
  const t = useT()
  const catLabel = useCatLabel()
  const statusLabel = (s: string) =>
    s === 'new' ? t('board.statusNew')
    : s === 'in_progress' ? t('board.statusInProgress')
    : s === 'resolved' ? t('board.statusResolvedReq')
    : s
  const { profile } = useAuth() || {}
  // Quick actions on Home link here with ?cat= so the right category is already
  // selected when the resident arrives.
  const sp = useSearchParams()
  const initialCat = (['maintenance', 'appeal', 'account', 'rule_proposal', 'other'] as const)
    .includes((sp?.get('cat') || '') as Category) ? (sp!.get('cat') as Category) : 'maintenance'
  const [rows, setRows] = useState<Request[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  // Unread tracking: latest board-message time per thread vs. the last time this
  // resident opened it (kept per-device in localStorage).
  const [lastBoardAt, setLastBoardAt] = useState<Record<string, string>>({})
  const [readAt, setReadAt] = useState<Record<string, string>>({})
  const READ_KEY = 'contact_thread_read'

  useEffect(() => {
    if (typeof window === 'undefined') return
    try { setReadAt(JSON.parse(window.localStorage.getItem(READ_KEY) || '{}')) } catch { /* ignore */ }
  }, [])

  const markRead = useCallback((requestId: string) => {
    setReadAt(prev => {
      const next = { ...prev, [requestId]: lastBoardAt[requestId] || new Date().toISOString() }
      if (typeof window !== 'undefined') {
        try { window.localStorage.setItem(READ_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      }
      return next
    })
  }, [lastBoardAt])

  const isUnread = useCallback((r: Request) => {
    const board = lastBoardAt[r.id]
    if (!board) return false
    const seen = readAt[r.id]
    return !seen || seen < board
  }, [lastBoardAt, readAt])

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
      const list = (data as Request[]) || []
      setRows(list)
      // Latest board-message time per thread, for the unread dots.
      if (list.length) {
        const { data: msgs } = await supabase
          .from('request_messages')
          .select('request_id, created_at')
          .eq('author_role', 'board')
          .in('request_id', list.map(r => r.id))
          .order('created_at', { ascending: false })
        const map: Record<string, string> = {}
        for (const m of (msgs || []) as any[]) {
          if (!map[m.request_id]) map[m.request_id] = m.created_at   // first = latest (desc)
        }
        setLastBoardAt(map)
      } else {
        setLastBoardAt({})
      }
    } catch { /* leave empty */ } finally {
      setLoading(false)
    }
  }, [profile?.id])
  useEffect(() => { load() }, [load])

  // Keep the list fresh: a board-initiated message or a thread the board just
  // closed should appear without a manual reload. Realtime covers the live case;
  // a refetch on tab focus is the reliable fallback (no publication needed).
  useEffect(() => {
    if (!hasSupabase || !supabase || !profile?.id) return
    const ch = supabase
      .channel(`my-requests:${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'resident_requests',
        filter: `profile_id=eq.${profile.id}`,
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
  }, [profile?.id, load])

  const openAttachment = async (path: string) => {
    if (!supabase) return
    try {
      const { data } = await supabase.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  // Sort by latest activity (newest board reply or the submit date) so threads
  // with a fresh board message jump to the top; count the unread ones.
  const lastActivity = (r: Request) => {
    const b = lastBoardAt[r.id]
    return b && b > r.created_at ? b : r.created_at
  }
  const sortedRows = [...rows].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
  const unreadCount = rows.filter(isUnread).length

  return (
    <section id="contact" className="con-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">{t('board.contactTitle')}</h2>
        <p className="voice-page-sub">{t('board.contactSub')}</p>
      </div>

      <div className="con-grid">
        {/* LEFT — submit a request */}
        <section className="con-card con-form-card">
          <h2 className="con-card-title">{t('board.submitRequest')}</h2>
          <RequestForm initialCategory={initialCat} focusMessage={!!sp?.get('cat')} onSubmitted={row => setRows(rs => [row as Request, ...rs])} />
        </section>

        {/* RIGHT — submission history */}
        <section className="con-card con-list-card">
          <h2 className="con-card-title">
            {t('board.pastSubmissions')}
            {unreadCount > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#fff', background: '#E14909', borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle' }}>
                {unreadCount} new
              </span>
            )}
          </h2>
          <div className="con-table">
            <div className="con-thead">
              <span>{t('board.colId')}</span><span>{t('board.colSubject')}</span><span>{t('board.colCategory')}</span>
              <span>{t('board.colStatus')}</span><span>{t('board.colSubmitted')}</span><span></span>
            </div>
            {loading && <div className="con-empty">{t('board.loading')}</div>}
            {!loading && rows.length === 0 && (
              <div className="con-empty">{t('board.noRequests')}</div>
            )}
            {!loading && (showAll ? sortedRows : sortedRows.slice(0, 5)).map(r => {
              const open = expandedId === r.id
              const unread = isUnread(r)
              const toggle = () => { if (!open) markRead(r.id); setExpandedId(open ? null : r.id) }
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
                  <span className="con-cat-cell">{catLabel(r.category)}</span>
                  <span><span className={`con-badge con-badge-${r.status}`}>{statusLabel(r.status)}</span></span>
                  <span className="con-date">{fmtDate(r.created_at)}</span>
                  <span className="con-chev">
                    {unread && !open && <span className="con-reply-dot" title={t('board.boardReplied')} />}
                    <svg className={`con-chev-ic${open ? ' open' : ''}`} viewBox="0 0 24 24" width="16" height="16"
                      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </div>
                {open && (
                  <div className="con-detail">
                    <ConThread requestId={r.id} closed={r.status === 'resolved'} locked={!!r.replies_locked} openAttachment={openAttachment} />
                  </div>
                )}
              </Fragment>
              )
            })}
          </div>
          {!loading && rows.length > 5 && (
            <button type="button" className="con-viewall" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show less' : `${t('board.viewAllSubmissions')} (${rows.length})`}
            </button>
          )}
        </section>
      </div>

      {/* Emergency banner */}
      <section className="con-emerg">
        <span className="con-emerg-ic"><IconPhone /></span>
        <div className="con-emerg-body">
          <div className="con-emerg-title">{t('board.emergTitle')}</div>
          <div className="con-emerg-sub">
            {t('board.emergSub')}{' '}
            <a href="tel:3055554567">(305) 555-4567</a>.
          </div>
        </div>
      </section>
    </section>
  )
}

// Two-way thread shown when a resident expands one of their requests: the full
// message log + a box to reply back to the board.
function ConThread({ requestId, closed, locked, openAttachment }: {
  requestId: string; closed: boolean; locked: boolean; openAttachment: (path: string) => void
}) {
  const t = useT()
  const { profile } = useAuth() || {}
  const { messages, loading, reload } = useRequestThread(requestId)
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const MAX_FILE = 10 * 1024 * 1024
  const noReply = closed || locked

  // No reply box → nudge them to the new-message form.
  const startNewMessage = () => {
    if (typeof document === 'undefined') return
    const form = document.querySelector('.con-form-card') as HTMLElement | null
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const field = form?.querySelector('input, textarea, select') as HTMLElement | null
    field?.focus()
  }

  const fmtMsgTime = (d: string) =>
    new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const send = async () => {
    const text = draft.trim()
    if ((!text && !file) || !profile?.id || !profile?.community_id) return
    if (file && file.size > MAX_FILE) { setErr('Photo must be 10MB or smaller.'); return }
    setSending(true); setErr('')
    try {
      let attachmentPath: string | null = null
      let attachmentName: string | null = null
      if (file) {
        const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${profile.community_id}/${profile.id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase!.storage.from('request-attachments').upload(path, file)
        if ((up as any).error) throw (up as any).error
        attachmentPath = path
        attachmentName = file.name
      }
      await sendThreadMessage({
        requestId,
        communityId: profile.community_id,
        body: text || '(photo)',
        authorRole: 'resident',
        authorId: profile.id,
        authorName: profile.full_name ?? 'You',
        attachmentPath,
        attachmentName,
      })
      // Notify the board by email (best-effort — never blocks the reply).
      try {
        await supabase!.functions.invoke('request-reply-notify-board', {
          body: { request_id: requestId, preview: text },
        })
      } catch { /* ignore */ }
      setDraft(''); setFile(null)
      await reload()
    } catch (e: any) {
      setErr(e?.message || 'Could not send your message.')
    } finally {
      setSending(false)
    }
  }

  // Enter sends; Shift+Enter makes a newline.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending && (draft.trim() || file)) send() }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {loading && messages.length === 0 && <div className="con-empty">{t('board.loading')}</div>}
        {messages.map(m => {
          const me = m.authorRole === 'resident'
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '80%',
                background: me ? 'rgba(225, 73, 9, 0.08)' : 'rgba(10, 36, 64, 0.05)',
                border: `1px solid ${me ? 'rgba(225, 73, 9, 0.18)' : 'rgba(10, 36, 64, 0.10)'}`,
                borderRadius: 12,
                padding: '8px 12px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: me ? '#E14909' : 'rgba(10,36,64,0.7)', marginBottom: 2 }}>
                  {me ? (m.authorName || 'You') : (m.authorName || t('board.boardTag'))}
                  <span style={{ fontWeight: 400, opacity: 0.6 }}>{' · '}{fmtMsgTime(m.createdAt)}</span>
                </div>
                <div style={{ fontSize: 13, color: '#1F2233', whiteSpace: 'pre-wrap' }}>{m.body}</div>
                {m.attachmentPath && (
                  <button type="button" className="con-note-photo" style={{ marginLeft: 0 }}
                    onClick={() => openAttachment(m.attachmentPath!)}>
                    <IconClip /> {m.attachmentName || t('board.viewPhoto')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {noReply ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'rgba(10,36,64,0.04)', border: '1px solid rgba(10,36,64,0.12)', borderRadius: 10, padding: '10px 14px' }}>
          <span style={{ fontSize: 12.5, color: 'rgba(10,36,64,0.7)', fontWeight: 600 }}>
            {closed
              ? 'This conversation was closed by the board. Start a new message if you need anything else.'
              : 'The board turned off replies on this message. Start a new message if you need anything.'}
          </span>
          <button type="button" className="con-viewall" style={{ margin: 0 }} onClick={startNewMessage}>
            Start a new message
          </button>
        </div>
      ) : (
        <>
          <textarea
            rows={2}
            className="con-reply-input"
            style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(10,36,64,0.18)', padding: '8px 10px', font: 'inherit', fontSize: 13, resize: 'vertical' }}
            placeholder="Write a reply…  (Enter to send)"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {err && <div style={{ color: '#B42318', fontSize: 12, marginTop: 6 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: '#E14909' }}>
              <input type="file" accept="image/*" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
              <IconClip /> {file ? file.name : 'Attach a photo'}
            </label>
            <button type="button" className="con-viewall" style={{ margin: 0 }} onClick={send} disabled={sending || (!draft.trim() && !file)}>
              {sending ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// -- icons ----------------------------------------------------------

function IconPhone() { return <Svg><><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z" /></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
