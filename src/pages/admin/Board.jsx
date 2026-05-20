import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../App'
import { supabase, hasSupabase } from '../../lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const STATUSES = [
  { value: 'approved',   label: 'Approved' },
  { value: 'pending',    label: 'Pending' },
  { value: 'paid',       label: 'Paid' },
  { value: 'discussion', label: 'Discussion' },
]
const statusLabel = (s) => (STATUSES.find(x => x.value === s) || STATUSES[3]).label
const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtDate = (d) => {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' })
}

const EMPTY = { title: '', vendor: '', amount: '', status: 'approved', decided_on: '' }

// Board page — log vendor approvals, payments and motions. Each row surfaces
// on every resident's Home under "This Week on the Board".
export default function Board() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.from('board_decisions').select('*')
          .eq('community_id', communityId).order('decided_on', { ascending: false })
      )
      if (error) throw error
      setRows(data || []); setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load decisions'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Give the decision a title'); return }
    setSaving(true); setError('')
    try {
      const row = {
        community_id: communityId,
        title: form.title.trim(),
        vendor: form.vendor.trim() || null,
        amount: form.amount === '' ? null : Number(form.amount),
        status: form.status,
        decided_on: form.decided_on || new Date().toISOString().slice(0, 10),
      }
      const { data, error } = await withTimeout(
        supabase.from('board_decisions').insert(row).select().single()
      )
      if (error) throw error
      setRows(rs => [data, ...rs])
      setForm(EMPTY)
    } catch (err) {
      setError(err?.message || 'Could not add the decision')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== id)) // optimistic
    try {
      const { error } = await withTimeout(
        supabase.from('board_decisions').delete().eq('id', id)
      )
      if (error) throw error
    } catch (err) {
      setRows(prev) // roll back
      setError(err?.message || 'Could not remove that decision')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Board</div>
      <h1 className="admin-h1">Board &amp; decisions</h1>
      <p className="admin-dek">
        Vendor approvals, payments and motions. Every decision here shows on
        each resident's Home under &ldquo;This Week on the Board.&rdquo;
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked to your account yet. Run the one-time setup SQL, then reload.
        </div>
      )}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          <form className="admin-form" onSubmit={add}>
            <label className="admin-field">
              <span className="admin-field-label">What was decided</span>
              <input className="admin-input" placeholder="Approved landscaping contract"
                value={form.title} onChange={e => setField('title', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Vendor / who (optional)</span>
              <input className="admin-input" placeholder="Oak Ridge Nursery"
                value={form.vendor} onChange={e => setField('vendor', e.target.value)} />
            </label>
            <div className="bd-form-row">
              <label className="admin-field">
                <span className="admin-field-label">Amount $ (optional)</span>
                <input className="admin-input" type="number" placeholder="5200"
                  value={form.amount} onChange={e => setField('amount', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Status</span>
                <select className="admin-input" value={form.status}
                  onChange={e => setField('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Date</span>
                <input className="admin-input" type="date"
                  value={form.decided_on} onChange={e => setField('decided_on', e.target.value)} />
              </label>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn" disabled={saving}>
                {saving ? 'Adding…' : 'Add decision'}
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <div className="bd-list">
            <div className="bc-head" style={{ marginTop: 40, marginBottom: 14 }}>
              <h2 className="bc-title">Decision feed</h2>
              <span className="bc-sub">Most recent first — the newest five appear on Home.</span>
            </div>

            {status === 'loading' && <div className="admin-note">Loading…</div>}
            {status === 'ready' && rows.length === 0 && (
              <div className="bc-empty">No decisions logged yet — add the first one above.</div>
            )}
            {rows.map(r => (
              <div className="bd-row" key={r.id}>
                <div className="bd-main">
                  <div className="bd-title">{r.title}</div>
                  <div className="bd-meta">
                    {r.vendor && <><span>{r.vendor}</span><span className="bd-dot">·</span></>}
                    <span>{fmtDate(r.decided_on)}</span>
                  </div>
                </div>
                {r.amount != null && <div className="bd-amount">{fmtMoney(r.amount)}</div>}
                <span className={`bd-status bd-${r.status}`}>{statusLabel(r.status)}</span>
                <button type="button" className="bc-del" onClick={() => remove(r.id)}
                  aria-label="Remove decision">&times;</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
