import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../App'
import { supabase, hasSupabase } from '../../lib/supabase'

// Hardening (carried from Genie): wrap network promises, never .catch on Supabase.
const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Can't reach the server")), ms)),
  ])

const numOrNull = (v) => (v === '' || v == null ? null : Number(v))

// Minimal CSV parse for the budget-categories import. Columns: name, budget,
// spent — with or without a header row (header auto-detected if col 2 isn't a number).
function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line) => line.split(',').map(c => c.trim())
  const first = cells(lines[0])
  const start = (first.length >= 2 && isNaN(Number(first[1]))) ? 1 : 0
  const out = []
  for (let i = start; i < lines.length; i++) {
    const c = cells(lines[i])
    if (!c[0]) continue
    out.push({ name: c[0], budget: c[1] || '', spent: c[2] || '' })
  }
  return out
}

const FIELDS = [
  { key: 'name',          label: 'Community name', type: 'text',   placeholder: 'Sunset Lakes' },
  { key: 'location',      label: 'Location',       type: 'text',   placeholder: 'Miramar, FL' },
  { key: 'unit_count',    label: 'Homes / units',  type: 'number', placeholder: '166' },
  { key: 'fiscal_year',   label: 'Fiscal year',    type: 'number', placeholder: '2026' },
  { key: 'annual_budget', label: 'Annual budget',  type: 'number', placeholder: '62000', prefix: '$' },
  { key: 'monthly_dues',  label: 'Dues per unit / month', type: 'number', placeholder: '38', prefix: '$' },
]

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
      setForm(data); setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load the community'); setStatus('error')
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
        monthly_dues: numOrNull(form.monthly_dues),
      }
      const { error } = await withTimeout(
        supabase.from('communities').update(patch).eq('id', communityId)
      )
      if (error) throw error
      setStatus('saved'); setTimeout(() => setStatus('ready'), 1600)
    } catch (err) {
      setError(err?.message || 'Save failed'); setStatus('error')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Community</div>
      <h1 className="admin-h1">Community settings</h1>
      <p className="admin-dek">
        The community profile and budget behind the app — these numbers drive the Home dashboard.
      </p>

      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked to your account yet. Run the one-time setup SQL, then reload.
        </div>
      )}

      {status === 'error' && !form && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {form && (
        <>
          <form className="admin-form" onSubmit={save}>
            {FIELDS.map(f => (
              <label key={f.key} className="admin-field">
                <span className="admin-field-label">{f.label}</span>
                <div className="admin-input-wrap">
                  {f.prefix && <span className="admin-input-prefix">{f.prefix}</span>}
                  <input
                    type={f.type} className="admin-input"
                    value={form[f.key] ?? ''} placeholder={f.placeholder}
                    onChange={e => setField(f.key, e.target.value)}
                  />
                </div>
              </label>
            ))}
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn"
                disabled={status === 'saving' || status === 'saved'}>
                {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : 'Save changes'}
              </button>
              {status === 'error' && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <BudgetCategories communityId={communityId} />
        </>
      )}
    </div>
  )
}

// Budget categories editor — clean-replace save (delete all + insert current).
function BudgetCategories({ communityId }) {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error | saving | saved
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.from('budget_categories').select('*')
          .eq('community_id', communityId).order('sort_order')
      )
      if (error) throw error
      setRows((data || []).map(r => ({ ...r })))
      setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load categories'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setCell = (i, key, val) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { name: '', budget: '', spent: '' }])
  const removeRow = (i) => setRows(rs => rs.filter((_, idx) => idx !== i))

  const fileRef = useRef(null)
  const onImport = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // let the same file be re-imported
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsv(reader.result)
      if (parsed.length) { setRows(parsed); setStatus('ready'); setError('') }
      else { setError('No category rows found in that file'); setStatus('error') }
    }
    reader.onerror = () => { setError('Could not read that file'); setStatus('error') }
    reader.readAsText(file)
  }

  const save = async () => {
    setStatus('saving'); setError('')
    try {
      const del = await withTimeout(
        supabase.from('budget_categories').delete().eq('community_id', communityId)
      )
      if (del.error) throw del.error
      const toInsert = rows
        .filter(r => (r.name || '').trim())
        .map((r, idx) => ({
          community_id: communityId,
          name: r.name.trim(),
          budget: numOrNull(r.budget) || 0,
          spent: numOrNull(r.spent) || 0,
          sort_order: idx + 1,
        }))
      if (toInsert.length) {
        const ins = await withTimeout(supabase.from('budget_categories').insert(toInsert))
        if (ins.error) throw ins.error
      }
      setStatus('saved'); setTimeout(() => setStatus('ready'), 1500)
    } catch (err) {
      setError(err?.message || 'Save failed'); setStatus('error')
    }
  }

  return (
    <div className="bc">
      <div className="bc-head">
        <h2 className="bc-title">Budget categories</h2>
        <span className="bc-sub">Allocation and spend per category — feeds the Home cards &amp; rings.</span>
      </div>

      {status === 'loading' && <div className="admin-note">Loading categories…</div>}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {status !== 'loading' && status !== 'error' && (
        <>
          <div className="bc-row bc-row-head">
            <span>Category</span><span>Budget&nbsp;$</span><span>Spent&nbsp;$</span><span />
          </div>
          {rows.length === 0 && (
            <div className="bc-empty">No categories yet — add your first one below.</div>
          )}
          {rows.map((r, i) => (
            <div className="bc-row" key={r.id || `new-${i}`}>
              <input className="admin-input" placeholder="Landscape"
                value={r.name ?? ''} onChange={e => setCell(i, 'name', e.target.value)} />
              <input className="admin-input" type="number" placeholder="0"
                value={r.budget ?? ''} onChange={e => setCell(i, 'budget', e.target.value)} />
              <input className="admin-input" type="number" placeholder="0"
                value={r.spent ?? ''} onChange={e => setCell(i, 'spent', e.target.value)} />
              <button type="button" className="bc-del" onClick={() => removeRow(i)}
                aria-label="Remove category">&times;</button>
            </div>
          ))}
          <div className="bc-actions">
            <button type="button" className="admin-btn-ghost" onClick={addRow}>+ Add category</button>
            <button type="button" className="admin-btn-ghost"
              title="CSV columns: name, budget, spent"
              onClick={() => fileRef.current && fileRef.current.click()}>
              Import CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv"
              onChange={onImport} style={{ display: 'none' }} />
            <button type="button" className="admin-btn" onClick={save}
              disabled={status === 'saving' || status === 'saved'}>
              {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : 'Save categories'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
