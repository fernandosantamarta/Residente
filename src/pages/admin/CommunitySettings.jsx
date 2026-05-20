import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../App'
import { supabase, hasSupabase } from '../../lib/supabase'

// Hardening (carried from Genie): wrap network promises, never .catch on Supabase.
const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Can't reach the server")), ms)),
  ])

const FIELDS = [
  { key: 'name',          label: 'Community name', type: 'text',   placeholder: 'Sunset Lakes' },
  { key: 'location',      label: 'Location',       type: 'text',   placeholder: 'Miramar, FL' },
  { key: 'unit_count',    label: 'Homes / units',  type: 'number', placeholder: '166' },
  { key: 'fiscal_year',   label: 'Fiscal year',    type: 'number', placeholder: '2026' },
  { key: 'annual_budget', label: 'Annual budget',  type: 'number', placeholder: '62000', prefix: '$' },
]

const numOrNull = (v) => (v === '' || v == null ? null : Number(v))

export default function CommunitySettings() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [form, setForm] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | none | error | saving | saved
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.from('communities').select('*').eq('id', communityId).single()
      )
      if (error) throw error
      setForm(data)
      setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load the community')
      setStatus('error')
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const save = async (e) => {
    e.preventDefault()
    setStatus('saving'); setError('')
    try {
      const patch = {
        name: (form.name || '').trim() || 'My Community',
        location: (form.location || '').trim() || null,
        unit_count: numOrNull(form.unit_count),
        fiscal_year: numOrNull(form.fiscal_year),
        annual_budget: numOrNull(form.annual_budget),
      }
      const { error } = await withTimeout(
        supabase.from('communities').update(patch).eq('id', communityId)
      )
      if (error) throw error
      setStatus('saved')
      setTimeout(() => setStatus('ready'), 1600)
    } catch (err) {
      setError(err?.message || 'Save failed')
      setStatus('error')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Community</div>
      <h1 className="admin-h1">Community settings</h1>
      <p className="admin-dek">
        The community profile behind the app — the annual budget here feeds the Home dashboard.
      </p>

      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked to your account yet. Run the one-time setup SQL,
          then reload this page.
        </div>
      )}

      {status === 'error' && !form && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {form && (
        <form className="admin-form" onSubmit={save}>
          {FIELDS.map(f => (
            <label key={f.key} className="admin-field">
              <span className="admin-field-label">{f.label}</span>
              <div className="admin-input-wrap">
                {f.prefix && <span className="admin-input-prefix">{f.prefix}</span>}
                <input
                  type={f.type}
                  className="admin-input"
                  value={form[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={e => setField(f.key, e.target.value)}
                />
              </div>
            </label>
          ))}
          <div className="admin-form-actions">
            <button
              type="submit"
              className="admin-btn"
              disabled={status === 'saving' || status === 'saved'}
            >
              {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : 'Save changes'}
            </button>
            {status === 'error' && <span className="admin-err-inline">{error}</span>}
          </div>
        </form>
      )}
    </div>
  )
}
