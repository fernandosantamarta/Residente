'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePlatformThread, sendPlatformBoardMessage, uploadPlatformAttachment } from '@/hooks/usePlatform'

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
  const [photo, setPhoto] = useState<{ file: File; url: string; name: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setPhoto({ file: f, url: URL.createObjectURL(f), name: f.name })
    e.target.value = ''
  }
  const send = async () => {
    if (!text.trim() && !photo) return
    setSending(true); setErr('')
    try {
      let attachmentPath: string | null = null, attachmentName: string | null = null
      if (photo) {
        const up = await uploadPlatformAttachment(requestId, photo.file)
        if ('error' in up) { setErr(up.error); return }
        attachmentPath = up.path; attachmentName = up.name
      }
      const e = await sendPlatformBoardMessage({ requestId, authorId, authorName, body: text.trim() || '(image)', attachmentPath, attachmentName })
      if (e) { setErr(e); return }
      setText(''); setPhoto(null); reload()
    } finally { setSending(false) }
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
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply…  (Enter to send, Shift+Enter for a new line)" rows={2}
        className="admin-input admin-textarea" style={{ marginTop: 12, width: '100%' }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
      {photo && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={photo.url} alt="attachment" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{photo.name}</span>
          <button type="button" className="admin-btn-ghost" style={{ margin: 0 }} onClick={() => setPhoto(null)}>Remove</button>
        </div>
      )}
      {err && <div className="admin-err-inline" style={{ marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <label className="admin-btn-ghost" style={{ margin: 0, cursor: 'pointer' }}>
          📎 Add image
          <input type="file" accept="image/*" onChange={pickPhoto} style={{ display: 'none' }} />
        </label>
        <div style={{ flex: 1 }} />
        <button className="admin-primary-btn" onClick={send} disabled={sending || (!text.trim() && !photo)}>{sending ? 'Sending…' : 'Send reply'}</button>
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newPhoto, setNewPhoto] = useState<{ file: File; url: string; name: string } | null>(null)
  const pickNewPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setNewPhoto({ file: f, url: URL.createObjectURL(f), name: f.name })
    e.target.value = ''
  }

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

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!form.subject.trim()) { setError('Give your message a subject.'); return }
    if (!hasSupabase || !supabase || !profile?.id) { setError('Not signed in.'); return }
    setSaving(true); setError('')
    try {
      const { data, error: err } = await supabase.from('platform_requests').insert({
        from_profile_id: profile.id,
        from_community_id: profile.community_id ?? null,
        from_name: profile.full_name ?? null,
        from_email: profile.email ?? null,
        subject: form.subject.trim(),
        body: form.body.trim() || null,
      }).select('id').single()
      if (err) throw err
      const newId = data?.id as string | undefined
      // Attach the image as the first reply once the ticket (and its folder) exist.
      if (newId && newPhoto) {
        const up = await uploadPlatformAttachment(newId, newPhoto.file)
        if (!('error' in up)) {
          await sendPlatformBoardMessage({
            requestId: newId, authorId: profile.id, authorName: profile.full_name ?? null,
            body: form.body.trim() ? '(image)' : '📷 Image', attachmentPath: up.path, attachmentName: up.name,
          })
        }
      }
      setForm({ subject: '', body: '' }); setNewPhoto(null)
      setSuccessMsg('Sent to Residente. We’ll get back to you.')
      await load()
      if (newId) setSelectedId(newId)
    } catch (err: any) {
      setError(err?.message || 'Could not send your message')
    } finally {
      setSaving(false)
    }
  }

  // The conversation open in the mailbox's right pane — the picked one, else newest.
  const active = tickets.find(t => t.id === selectedId) || tickets[0] || null

  // Opening an in-progress ticket (Residente sent last) marks it read — clears it
  // from the "Contact Residente" notification badge in the admin header.
  useEffect(() => {
    if (!active || active.status !== 'in_progress' || typeof window === 'undefined') return
    try {
      const set = new Set<string>(JSON.parse(localStorage.getItem('cr_read_ids') || '[]'))
      if (!set.has(active.id)) {
        set.add(active.id)
        localStorage.setItem('cr_read_ids', JSON.stringify([...set]))
        window.dispatchEvent(new CustomEvent('cr-read-updated'))
      }
    } catch { /* ignore */ }
  }, [active?.id, active?.status])

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Support</div>
      <h1 className="admin-h1">Contact Residente</h1>
      <p className="admin-dek">
        Reach the Residente team for billing, setup help, or to report a problem with the platform.<br />
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>(For resident maintenance issues, use Easy Voice → Contact instead.)</span>
      </p>

      {successMsg && (
        <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{successMsg}</div>
      )}

      {/* New message composer (always available) */}
      <div className="card">
        <div className="card-head"><div><h2>New message</h2><div className="sub">Reach the Residente team — billing, setup, or a problem with the platform. We reply right here.</div></div></div>
        <form onSubmit={submit}>
          <div className="sup-composer">
            <input name="subject" className="sup-subject" placeholder="Subject — e.g. How do I enable card payments?"
              value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
            <textarea name="body" className="sup-body" rows={4} placeholder="Write your message…  (Enter to send, Shift+Enter for a new line)"
              value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
            {newPhoto && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px 12px' }}>
                <img src={newPhoto.url} alt="attachment" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                <span style={{ fontSize: 12.5, color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{newPhoto.name}</span>
                <button type="button" className="admin-btn-ghost" style={{ margin: 0 }} onClick={() => setNewPhoto(null)}>Remove</button>
              </div>
            )}
            <div className="sup-composer-bar">
              <label className="admin-btn-ghost" style={{ margin: 0, cursor: 'pointer' }}>
                📎 Add image
                <input type="file" accept="image/*" onChange={pickNewPhoto} style={{ display: 'none' }} />
              </label>
              {error && <span className="admin-err-inline" style={{ margin: 0 }}>{error}</span>}
              <div style={{ flex: 1 }} />
              <button type="submit" className="admin-primary-btn" disabled={saving || !form.subject.trim()}>
                {saving ? 'Sending…' : 'Send to Residente →'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Mailbox — conversations on the left, the thread on the right */}
      {tickets.length > 0 && (
        <div className="card">
          <div className="card-head"><div><h2>Your conversations</h2></div></div>
          <div className="sup-mail">
            <div className="sup-mail-list">
              {tickets.map(t => {
                const on = active?.id === t.id
                const dot = t.status === 'resolved' ? '#1B9E6B' : t.status === 'in_progress' ? '#3B72C4' : '#E14909'
                return (
                  <button type="button" key={t.id} className={`sup-mail-item${on ? ' active' : ''}`}
                    onClick={() => setSelectedId(t.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dot }} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>You → Residente · {fmtDate(t.created_at)}</div>
                  </button>
                )
              })}
            </div>

            <div className="sup-mail-read">
              {active ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{active.subject}</h2>
                      <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginTop: 2 }}>You → Residente Support · {fmtDate(active.created_at)}</div>
                    </div>
                    <span className={`brd-pill ${active.status === 'resolved' ? 'brd-pill-on' : 'brd-pill-off'}`}>
                      {STATUS_LABEL[active.status] || active.status}
                    </span>
                  </div>
                  {profile?.id && (
                    <BoardTicketThread requestId={active.id} authorId={profile.id} authorName={profile.full_name ?? null} />
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-dim)', fontSize: 13.5, padding: 20, textAlign: 'center' }}>Pick a conversation.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
