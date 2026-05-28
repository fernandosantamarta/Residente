'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'

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

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

type Request = {
  id: string
  category: string
  subject: string
  body: string | null
  status: string
  created_at: string
}

const EMPTY = { category: 'maintenance' as Category, subject: '', body: '' }

// Resident → Contact the board. Submit a maintenance issue / appeal /
// question; the board triages it at /admin/requests. Themed to match the
// other resident tabs (set-* / Settings styling).
export default function Contact() {
  const { profile } = useAuth() || {}
  const [form, setForm] = useState(EMPTY)
  const [rows, setRows] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    if (!ok) return
    const id = setTimeout(() => setOk(''), 4000)
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.subject.trim()) { setError('Give your request a subject'); return }
    if (!supabase || !profile?.id || !profile?.community_id) {
      setError('Sign in to submit a request.'); return
    }
    setSaving(true); setError('')
    try {
      const row = {
        community_id: profile.community_id,
        profile_id: profile.id,
        submitter_name: profile.full_name || profile.email || null,
        submitter_unit: profile.unit_number ? `Unit ${profile.unit_number}` : null,
        category: form.category,
        subject: form.subject.trim(),
        body: form.body.trim() || null,
        status: 'new',
      }
      const { data, error } = await withTimeout(
        supabase.from('resident_requests').insert(row).select().single()
      )
      if (error) throw error
      setRows(rs => [data as Request, ...rs])
      setForm(EMPTY)
      setOk('Sent — the board will follow up. Track it below.')
    } catch (err: any) {
      setError(err?.message || 'Could not send your request')
    } finally {
      setSaving(false)
    }
  }

  const withdraw = async (r: Request) => {
    const prev = rows
    setRows(rs => rs.filter(x => x.id !== r.id))   // optimistic
    try {
      const { error } = await withTimeout(supabase!.from('resident_requests').delete().eq('id', r.id))
      if (error) throw error
    } catch (err: any) {
      setRows(prev)
      setError(err?.message || 'Could not withdraw that request')
    }
  }

  return (
    <div className="set-wrap">
      <section className="set-hero">
        <div className="set-hero-content">
          <h1 className="set-hero-title">Contact the board</h1>
          <div className="set-hero-sub">
            Report a maintenance issue, appeal a violation, or ask a question — and track the response.
          </div>
        </div>
      </section>

      <div className="set-grid">
        <div className="set-col">
          <section className="set-section">
            <h2 className="set-section-title">Submit a request</h2>
            <div className="set-section-rows">
              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px' }}>
                <label className="set-dialog-field">
                  <span className="set-dialog-field-label">Type</span>
                  <Dropdown<Category>
                    value={form.category}
                    onChange={v => setField('category', v)}
                    ariaLabel="Request type"
                    options={CATS}
                  />
                </label>
                <label className="set-dialog-field">
                  <span className="set-dialog-field-label">Subject</span>
                  <input name="subject" className="set-input" value={form.subject}
                    onChange={e => setField('subject', e.target.value)}
                    placeholder="e.g. Broken gate at the east entrance" />
                </label>
                <label className="set-dialog-field">
                  <span className="set-dialog-field-label">Details <span className="set-dialog-note-tight" style={{ opacity: 0.7 }}>(optional)</span></span>
                  <textarea name="body" className="set-input" rows={4} value={form.body}
                    onChange={e => setField('body', e.target.value)}
                    placeholder="What's going on, where, and since when?" />
                </label>
                <div className="set-list-add-actions">
                  <button type="submit" className="set-btn-primary" disabled={saving}>
                    {saving ? 'Sending…' : 'Submit request'}
                  </button>
                  {error && <span className="set-dialog-note set-dialog-note-tight" style={{ color: '#c0392b' }}>{error}</span>}
                </div>
                {ok && <span className="set-dialog-note set-dialog-note-tight">✓ {ok}</span>}
              </form>
            </div>
          </section>

          <section className="set-section">
            <h2 className="set-section-title">Your requests</h2>
            <div className="set-section-rows">
              <div className="set-list">
                {loading && <div className="set-list-empty">Loading…</div>}
                {!loading && rows.length === 0 && (
                  <div className="set-list-empty">No requests yet — submit one above.</div>
                )}
                {rows.map(r => (
                  <div className="set-list-row" key={r.id}>
                    <div className="set-list-row-body">
                      <strong>{r.subject}</strong>
                      <span>
                        {CAT_LABEL[r.category] || r.category} · {fmtDate(r.created_at)} · {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </div>
                    {r.status === 'new' && (
                      <button type="button" className="set-list-remove" aria-label="Withdraw request"
                        onClick={() => withdraw(r)}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="set-aside">
          <div className="set-tile">
            <div className="set-tile-title">How it works</div>
            <div className="set-prefs">
              <div className="set-pref-row"><span>1.</span><span>Submit your request</span></div>
              <div className="set-pref-row"><span>2.</span><span>The board sees it in their queue</span></div>
              <div className="set-pref-row"><span>3.</span><span>Status moves New → In progress → Resolved</span></div>
            </div>
          </div>
          <div className="set-tile">
            <div className="set-tile-title">Emergencies</div>
            <p className="set-dialog-note set-dialog-note-tight" style={{ margin: 0 }}>
              For anything urgent — water, gas, fire, security — call the 24/7 hotline instead of submitting here.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
