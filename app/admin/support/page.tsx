'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePlatformThread, sendPlatformBoardMessage } from '@/hooks/usePlatform'

type Ticket = { id: string; subject: string; body: string | null; status: string; created_at: string }

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }

// One ticket's conversation with the Residente operators + a reply box. Replies
// post straight to platform_request_messages (RLS scopes it to this submitter);
// the operator's answers stream in live.
function BoardTicketThread({ requestId, authorId, authorName }: {
  requestId: string; authorId: string; authorName: string | null
}) {
  const { messages, loading, reload } = usePlatformThread(requestId)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => {
    if (!text.trim()) return
    setSending(true); setErr('')
    const e = await sendPlatformBoardMessage({ requestId, authorId, authorName, body: text.trim() })
    setSending(false)
    if (e) { setErr(e); return }
    setText(''); reload()
  }
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && messages.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading…</div>
        ) : messages.map(m => {
          const mine = m.authorRole === 'board'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '85%', background: mine ? 'var(--pink)' : 'var(--bg-card)', color: mine ? '#fff' : 'var(--text)',
                border: mine ? 'none' : '1px solid var(--border)', borderRadius: 12, padding: '9px 12px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {m.body}
                {m.attachmentUrl && (
                  <a href={m.attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 8 }}>
                    <img src={m.attachmentUrl} alt={m.attachmentName || 'attachment'} style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} />
                  </a>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{mine ? 'You' : (m.authorName || 'Residente')} · {fmtDate(m.createdAt)}</div>
            </div>
          )
        })}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply…" rows={2}
        className="admin-input admin-textarea" style={{ marginTop: 12, width: '100%' }} />
      {err && <div className="admin-err-inline" style={{ marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="admin-primary-btn" onClick={send} disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send reply'}</button>
      </div>
    </div>
  )
}

// Contact Residente — a board/admin reaches the platform operators (billing,
// setup, bugs). Writes to platform_requests; the founders triage in /platform.
export default function AdminSupport() {
  const { profile } = useAuth() || {}
  const [form, setForm] = useState({ subject: '', body: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) return
    const { data } = await supabase
      .from('platform_requests')
      .select('id, subject, body, status, created_at')
      .order('created_at', { ascending: false })
    setTickets((data ?? []) as Ticket[])
  }, [profile?.id])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.subject.trim()) { setError('Give your message a subject.'); return }
    if (!hasSupabase || !supabase || !profile?.id) { setError('Not signed in.'); return }
    setSaving(true); setError('')
    try {
      const { error: err } = await supabase.from('platform_requests').insert({
        from_profile_id: profile.id,
        from_community_id: profile.community_id ?? null,
        from_name: profile.full_name ?? null,
        from_email: profile.email ?? null,
        subject: form.subject.trim(),
        body: form.body.trim() || null,
      })
      if (err) throw err
      setForm({ subject: '', body: '' })
      setSuccessMsg('Sent to Residente. We’ll get back to you.')
      load()
    } catch (err: any) {
      setError(err?.message || 'Could not send your message')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Support</div>
      <h1 className="admin-h1">Contact Residente</h1>
      <p className="admin-dek">
        Reach the Residente team for billing, setup help, or to report a problem with the platform.
        (For resident maintenance issues, use Easy Voice → Contact instead.)
      </p>

      {successMsg && (
        <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{successMsg}</div>
      )}

      <div className="card">
        <div className="card-head"><div><h2>Send us a message</h2></div></div>
        <form className="admin-form" onSubmit={submit}>
          <label className="admin-field">
            <span className="admin-field-label">Subject</span>
            <input name="subject" className="admin-input" placeholder="e.g. How do I enable card payments?"
              value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          </label>
          <label className="admin-field">
            <span className="admin-field-label">Message (optional)</span>
            <textarea name="body" className="admin-input admin-textarea" rows={4}
              placeholder="Tell us what you need."
              value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
          </label>
          <div className="card-cta">
            <button type="submit" className="admin-primary-btn" disabled={saving}>
              {saving ? 'Sending…' : 'Send to Residente'}
            </button>
            {error && <span className="admin-err-inline">{error}</span>}
          </div>
        </form>
      </div>

      {tickets.length > 0 && (
        <div className="card">
          <div className="card-head"><div><h2>Your messages</h2></div></div>
          <div className="bm-list">
            {tickets.map(t => {
              const open = expandedId === t.id
              return (
                <div className="bm-row" key={t.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    onClick={() => setExpandedId(id => id === t.id ? null : t.id)}>
                    <div className="bm-row-main">
                      <div className="bm-row-name">{t.subject}</div>
                      <div className="bm-row-sub">{t.body || '—'} · {fmtDate(t.created_at)}</div>
                    </div>
                    <span className={`brd-pill ${t.status === 'resolved' ? 'brd-pill-on' : 'brd-pill-off'}`}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                    <span aria-hidden style={{ color: 'var(--text-dim)', fontSize: 12, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
                  </div>
                  {open && profile?.id && (
                    <BoardTicketThread requestId={t.id} authorId={profile.id} authorName={profile.full_name ?? null} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
