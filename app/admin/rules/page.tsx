'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const EMPTY = { section: '', title: '', body: '', fine: '' }

// Admin → Rules. Board adds covenants and house rules; each one shows on
// every resident's Rules page, grouped by section.
export default function Rules() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')   // loading | ready | none | error
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.from('rules').select('*')
          .eq('community_id', communityId)
          .order('sort_order', { ascending: true })
      )
      if (error) throw error
      setRows(data || [])
      setStatus('ready')
    } catch (err) {
      const msg = err?.message || ''
      // Table missing → the setup SQL hasn't been run; show the friendly note.
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setStatus('none')
      } else {
        setError(msg || 'Could not load rules')
        setStatus('error')
      }
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Give the rule a title'); return }
    setSaving(true); setError('')
    try {
      const row = {
        community_id: communityId,
        section: form.section.trim() || null,
        title: form.title.trim(),
        body: form.body.trim() || null,
        fine: form.fine === '' ? null : Number(form.fine),
        sort_order: rows.length,
      }
      const { data, error } = await withTimeout(
        supabase.from('rules').insert(row).select().single()
      )
      if (error) throw error
      setRows(rs => [...rs, data])
      setForm(EMPTY)
    } catch (err) {
      setError(err?.message || 'Could not add the rule')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== id))   // optimistic
    try {
      const { error } = await withTimeout(supabase.from('rules').delete().eq('id', id))
      if (error) throw error
    } catch (err) {
      setRows(prev)   // roll back
      setError(err?.message || 'Could not remove that rule')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Rules</div>
      <h1 className="admin-h1">Community rules</h1>
      <p className="admin-dek">
        Covenants and house rules. Everything here shows on each resident's
        Rules page, grouped by section.
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked yet, or the rules table isn't set up. Run the
          rules &amp; documents setup SQL (see supabase/rules-and-documents.sql),
          then reload.
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
              <span className="admin-field-label">Section (optional)</span>
              <input className="admin-input" placeholder="Architectural, Pets, Parking…"
                value={form.section} onChange={e => setField('section', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Rule</span>
              <input className="admin-input" placeholder="Trash bins stored out of street view"
                value={form.title} onChange={e => setField('title', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Detail (optional)</span>
              <textarea className="admin-input admin-textarea" rows={3}
                placeholder="Plain-language explanation residents will read."
                value={form.body} onChange={e => setField('body', e.target.value)} />
            </label>
            <label className="admin-field" style={{ maxWidth: 200 }}>
              <span className="admin-field-label">Fine $ (optional)</span>
              <input className="admin-input" type="number" placeholder="50"
                value={form.fine} onChange={e => setField('fine', e.target.value)} />
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn" disabled={saving}>
                {saving ? 'Adding…' : 'Add rule'}
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <div className="bc-head" style={{ marginTop: 40, marginBottom: 14 }}>
            <h2 className="bc-title">Rule book</h2>
            <span className="bc-sub">
              {rows.length} {rows.length === 1 ? 'rule' : 'rules'} published.
            </span>
          </div>

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="bc-empty">No rules yet — add the first one above.</div>
          )}
          <div className="bd-list">
            {rows.map(r => (
              <div className="bd-row" key={r.id}>
                <div className="bd-main">
                  <div className="bd-title">{r.title}</div>
                  <div className="bd-meta">
                    {r.section && <><span>{r.section}</span><span className="bd-dot">·</span></>}
                    <span>{r.body
                      ? r.body.slice(0, 64) + (r.body.length > 64 ? '…' : '')
                      : 'No detail'}</span>
                  </div>
                </div>
                {r.fine != null && Number(r.fine) > 0 && (
                  <div className="bd-amount">{fmtMoney(r.fine)}</div>
                )}
                <button type="button" className="bc-del" onClick={() => remove(r.id)}
                  aria-label="Remove rule">&times;</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
