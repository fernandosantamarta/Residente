import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../App'
import { supabase, hasSupabase } from '../../lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// CSV parse for the roster import. Columns: name, unit, email, phone — a
// header row is auto-detected and skipped.
function parseResidentsCsv(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line) => line.split(',').map(c => c.trim())
  const first = cells(lines[0]).map(c => c.toLowerCase())
  const hasHeader = first.some(c => ['name', 'full name', 'unit', 'email', 'phone'].includes(c))
  const out = []
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = cells(lines[i])
    if (!c[0]) continue
    out.push({ full_name: c[0], unit_number: c[1] || '', email: c[2] || '', phone: c[3] || '' })
  }
  return out
}

// Sort by unit (numeric-aware), then name.
const sortRows = (rs) => [...rs].sort((a, b) => {
  const u = String(a.unit_number || '').localeCompare(
    String(b.unit_number || ''), undefined, { numeric: true })
  return u !== 0 ? u : String(a.full_name || '').localeCompare(String(b.full_name || ''))
})

const EMPTY = { full_name: '', unit_number: '', email: '', phone: '' }

// Residents page — the community roster. Add one at a time or import a CSV.
// (Sending account invites needs a service-role edge function — a follow-up.)
export default function Residents() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(null) // parsed CSV rows awaiting confirm
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.from('residents').select('*').eq('community_id', communityId)
      )
      if (error) throw error
      setRows(sortRows(data || [])); setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load residents'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Enter the resident name'); return }
    setSaving(true); setError('')
    try {
      const row = {
        community_id: communityId,
        full_name: form.full_name.trim(),
        unit_number: form.unit_number.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      }
      const { data, error } = await withTimeout(
        supabase.from('residents').insert(row).select().single()
      )
      if (error) throw error
      setRows(rs => sortRows([data, ...rs]))
      setForm(EMPTY)
    } catch (err) {
      setError(err?.message || 'Could not add the resident')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== id)) // optimistic
    try {
      const { error } = await withTimeout(supabase.from('residents').delete().eq('id', id))
      if (error) throw error
    } catch (err) {
      setRows(prev) // roll back
      setError(err?.message || 'Could not remove that resident')
    }
  }

  const onPickFile = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // let the same file be re-picked
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseResidentsCsv(reader.result)
      if (parsed.length) { setPending(parsed); setError('') }
      else setError('No resident rows found in that file')
    }
    reader.onerror = () => setError('Could not read that file')
    reader.readAsText(file)
  }

  const confirmImport = async () => {
    if (!pending) return
    setImporting(true); setError('')
    try {
      const toInsert = pending.map(p => ({
        community_id: communityId,
        full_name: p.full_name,
        unit_number: p.unit_number || null,
        email: p.email || null,
        phone: p.phone || null,
      }))
      const { error } = await withTimeout(supabase.from('residents').insert(toInsert))
      if (error) throw error
      setPending(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Residents</div>
      <h1 className="admin-h1">Resident roster</h1>
      <p className="admin-dek">
        Your community's households — add them one at a time, or import a whole
        spreadsheet at once (CSV columns: name, unit, email, phone).
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
              <span className="admin-field-label">Resident name</span>
              <input className="admin-input" placeholder="Jane Doe"
                value={form.full_name} onChange={e => setField('full_name', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Unit / address</span>
              <input className="admin-input" placeholder="412"
                value={form.unit_number} onChange={e => setField('unit_number', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Email (optional)</span>
              <input className="admin-input" type="email" placeholder="jane@email.com"
                value={form.email} onChange={e => setField('email', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Phone (optional)</span>
              <input className="admin-input" placeholder="(555) 123-4567"
                value={form.phone} onChange={e => setField('phone', e.target.value)} />
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn" disabled={saving}>
                {saving ? 'Adding…' : 'Add resident'}
              </button>
              <button type="button" className="admin-btn-ghost"
                title="CSV columns: name, unit, email, phone"
                onClick={() => fileRef.current && fileRef.current.click()}>
                Import CSV
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv"
                onChange={onPickFile} style={{ display: 'none' }} />
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          {pending && (
            <div className="res-import-bar">
              <span>
                Found <strong>{pending.length}</strong> resident{pending.length === 1 ? '' : 's'} in that file.
              </span>
              <button type="button" className="admin-btn" disabled={importing} onClick={confirmImport}>
                {importing ? 'Importing…' : `Import all ${pending.length}`}
              </button>
              <button type="button" className="admin-btn-ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}

          <div className="bd-list">
            <div className="bc-head" style={{ marginTop: 40, marginBottom: 14 }}>
              <h2 className="bc-title">
                Roster{status === 'ready' ? ` · ${rows.length}` : ''}
              </h2>
              <span className="bc-sub">Sorted by unit — remove a household with ×.</span>
            </div>

            {status === 'loading' && <div className="admin-note">Loading…</div>}
            {status === 'ready' && rows.length === 0 && (
              <div className="bc-empty">No residents yet — add one above or import a CSV.</div>
            )}
            {rows.map(r => (
              <div className="bd-row" key={r.id}>
                <div className="bd-main">
                  <div className="bd-title">
                    {r.unit_number && <span className="res-unit">{r.unit_number}</span>}
                    {r.full_name}
                  </div>
                  <div className="bd-meta">
                    {r.email && <span>{r.email}</span>}
                    {r.email && r.phone && <span className="bd-dot">·</span>}
                    {r.phone && <span>{r.phone}</span>}
                    {!r.email && !r.phone && <span>No contact info</span>}
                  </div>
                </div>
                <button type="button" className="bc-del" onClick={() => remove(r.id)}
                  aria-label="Remove resident">&times;</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
