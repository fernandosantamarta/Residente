'use client'

import { Fragment, ReactNode, useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { RequestForm, CAT_LABEL, IconClip, type Category } from './RequestForm'

const withTimeout = <T,>(p: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const STATUS_LABEL: Record<string, string> = {
  new: 'New', in_progress: 'In progress', resolved: 'Resolved',
}

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

// Contact the board — submit a maintenance issue / appeal / question; the
// board triages it at /admin/requests. Two-column layout: request form +
// the resident's submission history. A section of the Easy Voice hub.
export function ContactSection() {
  const { profile } = useAuth() || {}
  // Quick actions on Home link here with ?cat= so the right category is already
  // selected when the resident arrives.
  const sp = useSearchParams()
  const initialCat = (['maintenance', 'appeal', 'account', 'other'] as const)
    .includes((sp?.get('cat') || '') as Category) ? (sp!.get('cat') as Category) : 'maintenance'
  const [rows, setRows] = useState<Request[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  const openAttachment = async (path: string) => {
    if (!supabase) return
    try {
      const { data } = await supabase.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  return (
    <section id="contact" className="con-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">Contact the board</h2>
        <p className="voice-page-sub">Submit a maintenance issue, appeal, or question — and track the board's reply.</p>
      </div>

      <div className="con-grid">
        {/* LEFT — submit a request */}
        <section className="con-card con-form-card">
          <h2 className="con-card-title">Submit a request</h2>
          <RequestForm initialCategory={initialCat} onSubmitted={row => setRows(rs => [row as Request, ...rs])} />
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
    </section>
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
