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

// Sort by subdivision, then address (numeric-aware), then name.
const sortRows = (rs) => [...rs].sort((a, b) => {
  const s = String(a.subdivision || '~').localeCompare(String(b.subdivision || '~'))
  if (s !== 0) return s
  const ad = String(a.address || '').localeCompare(
    String(b.address || ''), undefined, { numeric: true })
  return ad !== 0 ? ad : String(a.full_name || '').localeCompare(String(b.full_name || ''))
})

// Editable import spreadsheet — one row per household, four columns matching the
// header. Always keeps a trailing blank row so there's somewhere to type next.
const GRID_COLS = ['name', 'unit', 'email', 'phone']
const blankGridRow = () => ({ name: '', unit: '', email: '', phone: '' })
const gridRowHasData = (r) => !!(r.name || r.unit || r.email || r.phone)

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
  const [pending, setPending] = useState(null) // parsed CSV / pasted rows awaiting confirm
  const [importing, setImporting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [query, setQuery] = useState('')
  const [subFilter, setSubFilter] = useState('all')
  const [grid, setGrid] = useState(() => [blankGridRow(), blankGridRow(), blankGridRow()])
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

  // Keep a trailing blank row so the spreadsheet always has room to type/paste.
  const withTrailingRow = (rows) => {
    const last = rows[rows.length - 1]
    if (!last || gridRowHasData(last)) rows.push(blankGridRow())
    return rows
  }

  const setCell = (ri, key, val) => setGrid(g => {
    const next = g.map(r => ({ ...r }))
    next[ri][key] = val
    return withTrailingRow(next)
  })

  // Paste a block (from Excel / Sheets) straight into the grid, spreading the
  // tab/newline-delimited cells from the focused cell down and to the right.
  const onPasteCell = (e, ri, ci) => {
    const text = e.clipboardData.getData('text')
    if (!text || !/[\t\n]/.test(text)) return   // single value — let it paste normally
    e.preventDefault()
    const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')
    setGrid(g => {
      const next = g.map(r => ({ ...r }))
      lines.forEach((line, li) => {
        const cells = line.split('\t')
        const tr = ri + li
        while (next.length <= tr) next.push(blankGridRow())
        cells.forEach((cell, cj) => {
          const col = GRID_COLS[ci + cj]
          if (col) next[tr][col] = cell.trim()
        })
      })
      return withTrailingRow(next)
    })
  }

  // "Paste & import" — turn the filled grid rows into the same confirm flow the
  // CSV upload uses (the green "Import all N" bar). Owner (name) is required.
  const importGrid = () => {
    const parsed = grid.filter(r => r.name.trim()).map(r => ({
      full_name: r.name.trim(), unit_number: r.unit.trim(),
      email: r.email.trim(), phone: r.phone.trim(), address: '', subdivision: '',
    }))
    if (parsed.length) { setPending(parsed); setError('') }
    else setError('Type or paste at least one row — Owner is required.')
  }
  const gridHasData = grid.some(gridRowHasData)

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
      setGrid([blankGridRow(), blankGridRow(), blankGridRow()])
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

          {/* Import your roster — one editable spreadsheet. Type into the cells,
              paste a block straight from Excel / Google Sheets, or upload a CSV. */}
          <div className="card import-card">
            <div className="card-head">
              <div>
                <h2>Import your roster</h2>
                <div className="sub">Type it in, paste straight from Excel or Google Sheets, or upload a file — we map the columns for you.</div>
              </div>
              <span className="pill dim">No CSV needed</span>
            </div>
            <div className="import-sheet">
              <div className="import-sheet-row import-sheet-head">
                <span>Owner</span><span>Unit</span><span>Email</span><span>Phone</span>
              </div>
              <div>
                {grid.map((row, ri) => (
                  <div className="import-sheet-row" key={ri}>
                    {GRID_COLS.map((key, ci) => (
                      <input key={key} className="import-cell" value={row[key]}
                        placeholder={ri === 0 ? ['Jane Doe', '4B', 'jane@email.com', '305-555-0142'][ci] : ''}
                        aria-label={`${['Owner', 'Unit', 'Email', 'Phone'][ci]} row ${ri + 1}`}
                        onChange={e => setCell(ri, key, e.target.value)}
                        onPaste={e => onPasteCell(e, ri, ci)} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="row-actions">
              <button type="button" className="admin-primary-btn" onClick={importGrid} disabled={!gridHasData}>
                Paste &amp; import
              </button>
              <button type="button" className="admin-secondary-btn"
                title="CSV columns: name, subdivision, address, email, phone"
                onClick={() => fileRef.current && fileRef.current.click()}>
                Upload CSV instead
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
            <input name="residents-csv" ref={fileRef} type="file" accept=".csv,text/csv"
              onChange={onPickFile} style={{ display: 'none' }} />
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

          {/* Search / filter / export toolbar over the roster table. */}
          {status === 'ready' && rows.length > 0 && (
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
              <button type="button" className="admin-secondary-btn"
                title="Download all households as CSV"
                onClick={exportRoster} disabled={rows.length === 0}>
                Export CSV
              </button>
            </div>
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
