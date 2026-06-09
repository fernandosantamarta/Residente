'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

type Ticket = { id: string; subject: string; body: string | null; status: string; created_at: string }

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }

// Contact Residente — a board/admin reaches the platform operators (billing,
// setup, bugs). Writes to platform_requests; the founders triage in /platform.
export default function AdminSupport() {
  const { profile } = useAuth() || {}
  const [form, setForm] = useState({ subject: '', body: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>([])

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
            {tickets.map(t => (
              <div className="bm-row" key={t.id}>
                <div className="bm-row-main">
                  <div className="bm-row-name">{t.subject}</div>
                  <div className="bm-row-sub">{t.body || '—'} · {fmtDate(t.created_at)}</div>
                </div>
                <span className={`brd-pill ${t.status === 'resolved' ? 'brd-pill-on' : 'brd-pill-off'}`}>
                  {STATUS_LABEL[t.status] || t.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
