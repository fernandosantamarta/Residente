import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../../App'
import { supabase, hasSupabase } from '../../lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const DUES = [
  { value: 'paid', label: 'Paid' },
  { value: 'due',  label: 'Due' },
  { value: 'late', label: 'Late' },
]

// CSV parse for the roster import. Columns: name, subdivision, address, email, phone.
// A header row is auto-detected and skipped.
function parseResidentsCsv(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line) => line.split(',').map(c => c.trim())
  const first = cells(lines[0]).map(c => c.toLowerCase())
  const hasHeader = first.some(c =>
    ['name', 'full name', 'subdivision', 'address', 'email', 'phone', 'unit'].includes(c))
  const out = []
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = cells(lines[i])
    if (!c[0]) continue
    out.push({
      full_name: c[0], subdivision: c[1] || '', address: c[2] || '',
      email: c[3] || '', phone: c[4] || '',
    })
  }
  return out
}

// Sort by subdivision, then address (numeric-aware), then name.
const sortRows = (rs) => [...rs].sort((a, b) => {
  const s = String(a.subdivision || '~').localeCompare(String(b.subdivision || '~'))
  if (s !== 0) return s
  const ad = String(a.address || '').localeCompare(
    String(b.address || ''), undefined, { numeric: true })
  return ad !== 0 ? ad : String(a.full_name || '').localeCompare(String(b.full_name || ''))
})

const EMPTY = { full_name: '', subdivision: '', address: '', email: '', phone: '' }

// Residents page — the community roster, grouped by subdivision, with each
// household's dues status + balance editable inline.
export default function Residents() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [communityName, setCommunityName] = useState('')
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
      const [resR, comR] = await Promise.all([
        withTimeout(supabase.from('residents').select('*').eq('community_id', communityId)),
        withTimeout(supabase.from('communities').select('name').eq('id', communityId).single()),
      ])
      if (resR.error) throw resR.error
      setRows(sortRows(resR.data || []))
      setCommunityName(comR.data?.name || '')
      setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load residents'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // Residents grouped by subdivision, subdivisions sorted alphabetically.
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const k = (r.subdivision || '').trim() || 'No subdivision'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Enter the resident name'); return }
    setSaving(true); setError('')
    try {
      const row = {
        community_id: communityId,
        full_name: form.full_name.trim(),
        subdivision: form.subdivision.trim() || null,
        address: form.address.trim() || null,
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
    } finally { setSaving(false) }
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

  // Instant local edit while typing — no DB write yet.
  const editLocal = (id, key, val) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, [key]: val } : r)))

  // Commit one or more fields to the DB (dues status change, balance on blur).
  const commit = async (id, patch) => {
    try {
      const { error } = await withTimeout(
        supabase.from('residents').update(patch).eq('id', id)
      )
      if (error) throw error
      setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))
    } catch (err) {
      setError(err?.message || 'Could not save that change')
      load() // re-sync from the DB
    }
  }

  const onPickFile = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
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
        subdivision: p.subdivision || null,
        address: p.address || null,
        email: p.email || null,
        phone: p.phone || null,
      }))
      const { error } = await withTimeout(supabase.from('residents').insert(toInsert))
      if (error) throw error
      setPending(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Import failed')
    } finally { setImporting(false) }
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Residents</div>
      <h1 className="admin-h1">{communityName || 'Resident roster'}</h1>
      <p className="admin-dek">
        {status === 'ready'
          ? `${rows.length} household${rows.length === 1 ? '' : 's'} across ${groups.length} subdivision${groups.length === 1 ? '' : 's'} — add one below or import a CSV.`
          : 'Your community roster — grouped by subdivision, with dues status per household.'}
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
            <div className="admin-2col">
              <label className="admin-field">
                <span className="admin-field-label">Subdivision</span>
                <input className="admin-input" placeholder="Lakeside"
                  value={form.subdivision} onChange={e => setField('subdivision', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Address / unit</span>
                <input className="admin-input" placeholder="1247 Oak Street"
                  value={form.address} onChange={e => setField('address', e.target.value)} />
              </label>
            </div>
            <div className="admin-2col">
              <label className="admin-field">
                <span className="admin-field-label">Email</span>
                <input className="admin-input" type="email" placeholder="jane@email.com"
                  value={form.email} onChange={e => setField('email', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Phone</span>
                <input className="admin-input" placeholder="(555) 123-4567"
                  value={form.phone} onChange={e => setField('phone', e.target.value)} />
              </label>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn" disabled={saving}>
                {saving ? 'Adding…' : 'Add resident'}
              </button>
              <button type="button" className="admin-btn-ghost"
                title="CSV columns: name, subdivision, address, email, phone"
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

          <div className="res-roster">
            {status === 'loading' && <div className="admin-note">Loading…</div>}
            {status === 'ready' && rows.length === 0 && (
              <div className="bc-empty" style={{ marginTop: 32 }}>
                No residents yet — add one above or import a CSV.
              </div>
            )}
            {groups.map(([sub, list]) => (
              <div className="res-group" key={sub}>
                <div className="res-group-head">
                  {sub}<span className="res-group-n">{list.length}</span>
                </div>
                {list.map(r => (
                  <ResidentRow key={r.id} r={r}
                    onLocal={editLocal} onCommit={commit} onRemove={remove} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ResidentRow({ r, onLocal, onCommit, onRemove }) {
  const dues = r.dues_status || 'paid'
  const contact = [r.address, r.email, r.phone].filter(Boolean).join('  ·  ')
  return (
    <div className="res-row">
      <div className="res-info">
        <div className="res-name">{r.full_name}</div>
        <div className="res-contact">{contact || 'No contact info'}</div>
      </div>
      <div className="res-dues">
        <select className={`res-status res-${dues}`} value={dues}
          onChange={e => onCommit(r.id, { dues_status: e.target.value })}>
          {DUES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <div className="res-bal">
          <span className="res-bal-pre">$</span>
          <input className="res-bal-input" type="number" placeholder="0"
            value={r.balance ?? ''}
            onChange={e => onLocal(r.id, 'balance', e.target.value)}
            onBlur={e => onCommit(r.id, { balance: Number(e.target.value) || 0 })} />
        </div>
      </div>
      <button type="button" className="bc-del" onClick={() => onRemove(r.id)}
        aria-label="Remove resident">&times;</button>
    </div>
  )
}
