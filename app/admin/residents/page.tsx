'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { residentBalance, duesStatus, DUES_LABEL, fmtMoney, communityDuesConfig } from '@/lib/dues'
import { downloadCsv, exportFilename } from '@/lib/exportCsv'
import { Dropdown } from '@/components/Dropdown'
import { EasyTrackTabs } from '../EasyTrackTabs'

// Initials for a household avatar — first letters of the first two words.
const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

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

// Parse a roster pasted from Excel / Google Sheets. Those copy as TAB-separated
// rows (we fall back to commas). Columns map by header when present (owner/name,
// unit, email, phone, address, subdivision); otherwise the order is assumed to
// be Owner, Unit, Email, Phone — matching the import card's column guide.
function parsePastedRoster(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  const splitRow = (l) => (l.includes('\t') ? l.split('\t') : l.split(',')).map(c => c.trim())
  const first = splitRow(lines[0]).map(c => c.toLowerCase())
  const headerWords = ['owner', 'name', 'full name', 'unit', 'email', 'phone', 'address', 'subdivision']
  const hasHeader = first.some(c => headerWords.includes(c))
  let idx = { name: 0, unit: 1, email: 2, phone: 3, address: -1, subdivision: -1 }
  if (hasHeader) {
    idx = { name: -1, unit: -1, email: -1, phone: -1, address: -1, subdivision: -1 }
    first.forEach((c, i) => {
      if (idx.name < 0 && /owner|name/.test(c)) idx.name = i
      else if (idx.unit < 0 && /unit/.test(c)) idx.unit = i
      else if (idx.email < 0 && /email/.test(c)) idx.email = i
      else if (idx.phone < 0 && /phone/.test(c)) idx.phone = i
      else if (idx.address < 0 && /address/.test(c)) idx.address = i
      else if (idx.subdivision < 0 && /subdiv/.test(c)) idx.subdivision = i
    })
    if (idx.name < 0) idx.name = 0
  }
  const out = []
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = splitRow(lines[i])
    const get = (k) => (idx[k] >= 0 ? (c[idx[k]] || '') : '')
    const full_name = get('name')
    if (!full_name) continue
    out.push({
      full_name, unit_number: get('unit'), email: get('email'),
      phone: get('phone'), address: get('address'), subdivision: get('subdivision'),
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

const EMPTY = { full_name: '', subdivision: '', address: '', email: '', phone: '', unit_number: '' }

// Residents page — the community roster, grouped by subdivision. Each
// household's balance accrues monthly_dues automatically; the board sets the
// one-time opening balance and the Paid/Due/Late status is derived from it.
export default function Residents() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [payments, setPayments] = useState([])
  const [community, setCommunity] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(null) // parsed CSV rows awaiting confirm
  const [importing, setImporting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [query, setQuery] = useState('')
  const [subFilter, setSubFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const fileRef = useRef(null)

  // Auto-dismiss the green confirmation banner after 4 seconds.
  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [resR, comR, payR] = await Promise.all([
        withTimeout(supabase.from('residents').select('*').eq('community_id', communityId)),
        withTimeout(supabase.from('communities').select('*')
          .eq('id', communityId).single()),
        withTimeout(supabase.from('payments').select('*').eq('community_id', communityId)),
      ])
      if (resR.error) throw resR.error
      if (payR.error) throw payR.error
      setRows(sortRows(resR.data || []))
      setCommunity(comR.data || null)
      setPayments(payR.data || [])
      setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load residents'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // Download the roster as CSV (reuses the shared lib/exportCsv helper that
  // also powers /admin/reports).
  const exportRoster = () => {
    const cols = [
      { label: 'Name', value: r => r.full_name || '' },
      { label: 'Unit', value: r => r.unit_number || '' },
      { label: 'Subdivision', value: r => r.subdivision || '' },
      { label: 'Address', value: r => r.address || '' },
      { label: 'Email', value: r => r.email || '' },
      { label: 'Phone', value: r => r.phone || '' },
      { label: 'Opening balance', value: r => (r.opening_balance != null ? Number(r.opening_balance).toFixed(2) : '') },
    ]
    downloadCsv(exportFilename('residente-roster', new Date().toISOString().slice(0, 10)), rows, cols)
  }

  const monthlyDues = Number(community?.monthly_dues) || 0
  const duesCfg = communityDuesConfig(community)
  const communityName = community?.name || ''

  // Payments grouped by resident so each row computes its own balance.
  const paymentsByResident = useMemo(() => {
    const m = new Map()
    for (const p of payments) {
      if (!m.has(p.resident_id)) m.set(p.resident_id, [])
      m.get(p.resident_id).push(p)
    }
    return m
  }, [payments])

  // Stat tiles (mock parity). "Activated" = a resident with a linked account
  // (profile_id set); "Pending" = on the roster but no account yet. "Tenants" =
  // units flagged as rented or carrying tenant contact info.
  const stats = useMemo(() => {
    const activated = rows.filter(r => r.profile_id).length
    const tenants = rows.filter(r => r.is_rented || r.tenant_name).length
    return { owners: rows.length, tenants, activated, pending: rows.length - activated }
  }, [rows])

  // Subdivision filter options for the toolbar dropdown.
  const subOptions = useMemo(() => {
    const subs = [...new Set(rows.map(r => (r.subdivision || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
    return [{ value: 'all', label: 'All subdivisions' }, ...subs.map(s => ({ value: s, label: s }))]
  }, [rows])

  // Search + subdivision filter over the already-sorted roster (flat table).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (subFilter !== 'all' && (r.subdivision || '').trim() !== subFilter) return false
      if (!q) return true
      return [r.full_name, r.unit_number, r.address, r.email].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, query, subFilter])

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
        unit_number: form.unit_number.trim() || null,
      }
      const { data, error } = await withTimeout(
        supabase.from('residents').insert(row).select().single()
      )
      if (error) throw error
      setRows(rs => sortRows([data, ...rs]))
      setForm(EMPTY)
      setSuccessMsg(`Added ${row.full_name}.`)
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

  // Commit the opening balance to the DB (on blur).
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

  // "Paste & import" — parse the spreadsheet rows in the textarea into the same
  // confirm flow the CSV upload uses (the green "Import all N" bar).
  const importPaste = () => {
    const parsed = parsePastedRoster(pasteText)
    if (parsed.length) { setPending(parsed); setPasteText(''); setError('') }
    else setError('No rows found — paste at least one household (Owner, Unit, Email, Phone).')
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
        unit_number: p.unit_number || null,
      }))
      const { error } = await withTimeout(supabase.from('residents').insert(toInsert))
      if (error) throw error
      const n = toInsert.length
      setPending(null)
      await load()
      setSuccessMsg(`Imported ${n} resident${n === 1 ? '' : 's'}.`)
    } catch (err) {
      setError(err?.message || 'Import failed')
    } finally { setImporting(false) }
  }

  return (
    <div className="admin-page etrack">
      <EasyTrackTabs active="residents" />
      <div className="admin-kicker">Residents</div>
      <h1 className="admin-h1">{communityName ? `${communityName} roster` : 'Resident roster'}</h1>
      <p className="admin-dek">
        Every owner and tenant in your community. Add households one at a time or
        import a roster from a spreadsheet.
        {monthlyDues > 0
          ? ` Dues are ${fmtMoney(monthlyDues)}/mo per home and accrue automatically — open a household to set its opening balance.`
          : ' Set monthly dues on the Community page to start dues tracking.'}
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

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          {/* Stat tiles. */}
          <div className="stats">
            {[
              { v: String(stats.owners), l: 'Owners' },
              { v: String(stats.tenants), l: 'Tenants' },
              { v: String(stats.activated), l: 'Activated', c: 'var(--ok)' },
              { v: String(stats.pending), l: 'Pending', c: 'var(--warn)' },
            ].map(s => (
              <div key={s.l} className="stat">
                <div className="v" style={s.c ? { color: s.c } : undefined}>{s.v}</div>
                <div className="l">{s.l}</div>
              </div>
            ))}
          </div>

          {/* Import your roster — paste straight from Excel / Google Sheets. */}
          <div className="card import-card">
            <div className="card-head">
              <div>
                <h2>Import your roster</h2>
                <div className="sub">Paste straight from Excel or Google Sheets — we map the columns for you.</div>
              </div>
              <span className="pill dim">No CSV needed</span>
            </div>
            <div className="import-grid-head">
              <span>Owner</span><span>Unit</span><span>Email</span><span>Phone</span>
            </div>
            <textarea className="import-paste" value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={'Jane Doe\t4B\tjane@palmgrove.io\t305-555-0142\nLuis Ortega\t12\tluis@gmail.com\t786-555-0199'} />
            <div className="row-actions">
              <button type="button" className="admin-primary-btn" onClick={importPaste} disabled={!pasteText.trim()}>
                Paste &amp; import
              </button>
              <button type="button" className="admin-secondary-btn"
                title="CSV columns: name, subdivision, address, email, phone"
                onClick={() => fileRef.current && fileRef.current.click()}>
                Upload CSV instead
              </button>
            </div>
          </div>

          {/* Search / filter / add toolbar. */}
          <div className="toolbar">
            <div className="toolbar-left">
              <div className="search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search owners or units…" aria-label="Search roster" />
              </div>
              {subOptions.length > 1 && (
                <Dropdown value={subFilter} onChange={setSubFilter} options={subOptions} ariaLabel="Subdivision" />
              )}
            </div>
            <div className="admin-form-actions" style={{ marginTop: 0 }}>
              <button type="button" className="admin-secondary-btn"
                title="Download all households as CSV"
                onClick={exportRoster} disabled={rows.length === 0}>
                Export CSV
              </button>
              <button type="button" className="admin-primary-btn" onClick={() => setShowAdd(s => !s)}>
                {showAdd ? 'Close' : '+ Add household'}
              </button>
              <input name="residents-csv" ref={fileRef} type="file" accept=".csv,text/csv"
                onChange={onPickFile} style={{ display: 'none' }} />
            </div>
          </div>

          {pending && (
            <div className="res-import-bar">
              <span>
                Found <strong>{pending.length}</strong> resident{pending.length === 1 ? '' : 's'} in that file.
              </span>
              <button type="button" className="admin-primary-btn" disabled={importing} onClick={confirmImport}>
                {importing ? 'Importing…' : `Import all ${pending.length}`}
              </button>
              <button type="button" className="admin-btn-ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}

          {showAdd && (
            <form className="admin-form" onSubmit={add} style={{ marginBottom: 18 }}>
              <label className="admin-field">
                <span className="admin-field-label">Resident name</span>
                <input name="full_name" className="admin-input" placeholder="Jane Doe"
                  value={form.full_name} onChange={e => setField('full_name', e.target.value)} />
              </label>
              <div className="admin-2col">
                <label className="admin-field">
                  <span className="admin-field-label">Subdivision</span>
                  <input name="subdivision" className="admin-input" placeholder="Lakeside"
                    value={form.subdivision} onChange={e => setField('subdivision', e.target.value)} />
                </label>
                <label className="admin-field">
                  <span className="admin-field-label">Address / unit</span>
                  <input name="address" className="admin-input" placeholder="1247 Oak Street"
                    value={form.address} onChange={e => setField('address', e.target.value)} />
                </label>
              </div>
              <div className="admin-2col">
                <label className="admin-field">
                  <span className="admin-field-label">Email</span>
                  <input name="email" className="admin-input" type="email" placeholder="jane@email.com"
                    value={form.email} onChange={e => setField('email', e.target.value)} />
                </label>
                <label className="admin-field">
                  <span className="admin-field-label">Phone</span>
                  <input name="phone" className="admin-input" placeholder="(555) 123-4567"
                    value={form.phone} onChange={e => setField('phone', e.target.value)} />
                </label>
              </div>
              <div className="admin-2col">
                <label className="admin-field">
                  <span className="admin-field-label">Unit number</span>
                  <input name="unit_number" className="admin-input" placeholder="e.g. 11"
                    value={form.unit_number} onChange={e => setField('unit_number', e.target.value)} />
                </label>
                <div />
              </div>
              <div className="admin-form-actions">
                <button type="submit" className="admin-primary-btn" disabled={saving}>
                  {saving ? 'Adding…' : 'Add resident'}
                </button>
                {error && <span className="admin-err-inline">{error}</span>}
              </div>
            </form>
          )}

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="card"><div className="roster-empty">No households yet — add one or import a CSV to get started.</div></div>
          )}
          {status === 'ready' && rows.length > 0 && (
            <div className="card">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Owner</th><th>Unit</th><th className="contact-col">Contact</th>
                    <th>Balance</th><th>Status</th><th className="act"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6}><div className="roster-empty">No households match your search.</div></td></tr>
                  ) : filtered.map(r => (
                    <ResidentRow key={r.id} r={r} monthlyDues={monthlyDues} duesCfg={duesCfg}
                      payments={paymentsByResident.get(r.id) || []}
                      onLocal={editLocal} onCommit={commit} onRemove={remove} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// One roster row (mock table shape: avatar + name | unit | contact | balance |
// activation pill | Open). "Open" expands the full household editor in-place so
// every working field (address, subdivision, opening balance, mailing address,
// tenant) is still editable — nothing is read-only-only.
function ResidentRow({ r, monthlyDues, duesCfg, payments, onLocal, onCommit, onRemove }) {
  const [open, setOpen] = useState(false)
  const balance = residentBalance(r, monthlyDues, payments, duesCfg)
  const activated = !!r.profile_id
  const pill = activated ? { cls: 'ok', label: 'Activated' } : { cls: 'warn', label: 'Pending' }
  const contact = r.email || r.phone || '—'
  return (
    <>
      <tr className="tr">
        <td>
          <div className="owner-cell">
            <span className="av" aria-hidden="true">{initials(r.full_name)}</span>
            <span className="strong">
              {r.full_name}
              {r.subdivision ? <span className="muted" style={{ fontWeight: 400 }}> · {r.subdivision}</span> : null}
            </span>
          </div>
        </td>
        <td className="muted">{r.unit_number || r.address || '—'}</td>
        <td className="muted contact-col">{contact}</td>
        <td className={balance > 0 ? 'due' : 'muted'}>{fmtMoney(balance)}</td>
        <td><span className={`pill ${pill.cls}`}>{pill.label}</span></td>
        <td className="act">
          <button type="button" className="go" onClick={() => setOpen(o => !o)}>
            {open ? 'Close' : 'Open →'}
          </button>
        </td>
      </tr>

      {open && (
        <tr className="tr-edit">
          <td colSpan={6}>
            <div className="edit-grid">
              <label className="admin-field"><span className="admin-field-label">Address / unit</span>
                <input className="admin-input" placeholder="1247 Oak Street" value={r.address ?? ''}
                  onChange={e => onLocal(r.id, 'address', e.target.value)}
                  onBlur={e => onCommit(r.id, { address: e.target.value.trim() || null })} /></label>
              <label className="admin-field"><span className="admin-field-label">Subdivision</span>
                <input className="admin-input" placeholder="Lakeside" value={r.subdivision ?? ''}
                  onChange={e => onLocal(r.id, 'subdivision', e.target.value)}
                  onBlur={e => onCommit(r.id, { subdivision: e.target.value.trim() || null })} /></label>
              <label className="admin-field"
                title="Opening balance — what this household owed when added">
                <span className="admin-field-label">Opening balance ($)</span>
                <input className="admin-input" type="number" placeholder="0" value={r.opening_balance ?? ''}
                  onChange={e => onLocal(r.id, 'opening_balance', e.target.value)}
                  onBlur={e => onCommit(r.id, { opening_balance: Number(e.target.value) || 0 })} /></label>
            </div>

            <p className="edit-note">
              The mailing address of record is used for the statutory collection
              notices — set it only when it differs from the unit/parcel above (e.g.
              an absentee owner); the late-assessment and intent-to-lien notices then
              go to both.
            </p>
            <label className="admin-field">
              <span className="admin-field-label">Owner mailing address of record (only if different)</span>
              <input className="admin-input" defaultValue={r.last_known_address ?? ''}
                placeholder="e.g. PO Box 410, Naples FL 34102"
                onBlur={e => onCommit(r.id, { last_known_address: e.target.value.trim() || null })} />
            </label>
            <label className="edit-rented" style={{ margin: '12px 0' }}>
              <input type="checkbox" defaultChecked={!!r.is_rented}
                onChange={e => onCommit(r.id, { is_rented: e.target.checked })} />
              This unit is rented (enables the tenant rent-demand notice when the owner is delinquent)
            </label>
            <div className="edit-grid">
              <label className="admin-field"><span className="admin-field-label">Tenant name</span>
                <input className="admin-input" defaultValue={r.tenant_name ?? ''}
                  onBlur={e => onCommit(r.id, { tenant_name: e.target.value.trim() || null })} /></label>
              <label className="admin-field"><span className="admin-field-label">Tenant email</span>
                <input className="admin-input" type="email" defaultValue={r.tenant_email ?? ''}
                  onBlur={e => onCommit(r.id, { tenant_email: e.target.value.trim() || null })} /></label>
              <label className="admin-field"><span className="admin-field-label">Tenant phone</span>
                <input className="admin-input" defaultValue={r.tenant_phone ?? ''}
                  onBlur={e => onCommit(r.id, { tenant_phone: e.target.value.trim() || null })} /></label>
            </div>

            <div className="edit-foot">
              <span className="muted" style={{ fontSize: 12.5 }}>
                {activated ? 'Account activated' : 'No linked account yet'}
                {' · '}{DUES_LABEL[duesStatus(balance, monthlyDues)]}
              </span>
              <button type="button" className="admin-btn-sm admin-btn-warn" onClick={() => onRemove(r.id)}>
                Remove household
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
