'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { residentBalance, duesStatus, DUES_LABEL, fmtMoney } from '@/lib/dues'

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

  const monthlyDues = Number(community?.monthly_dues) || 0
  const interestRate = Number(community?.late_interest_rate) || 0
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
      const n = toInsert.length
      setPending(null)
      await load()
      setSuccessMsg(`Imported ${n} resident${n === 1 ? '' : 's'}.`)
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
          ? `${rows.length} household${rows.length === 1 ? '' : 's'} across ${groups.length} subdivision${groups.length === 1 ? '' : 's'}. `
          : 'Your community roster — grouped by subdivision. '}
        {monthlyDues > 0
          ? `Dues are ${fmtMoney(monthlyDues)}/mo per home and accrue automatically — set each household's opening balance below.`
          : 'Set monthly dues on the Community page to start dues tracking.'}
        {' '}Residents maintain their own name, phone, and email from their Settings — those edits sync to this roster.
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
          <form className="admin-form" onSubmit={add}>
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
              <button type="button" className="admin-secondary-btn"
                title="CSV columns: name, subdivision, address, email, phone"
                onClick={() => fileRef.current && fileRef.current.click()}>
                Import CSV
              </button>
              <input name="residents-csv" ref={fileRef} type="file" accept=".csv,text/csv"
                onChange={onPickFile} style={{ display: 'none' }} />
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

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
                  <ResidentRow key={r.id} r={r} monthlyDues={monthlyDues} interestRate={interestRate}
                    payments={paymentsByResident.get(r.id) || []}
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

function ResidentRow({ r, monthlyDues, interestRate, payments, onLocal, onCommit, onRemove }) {
  const balance = residentBalance(r, monthlyDues, payments, interestRate)
  const st = duesStatus(balance, monthlyDues)
  const contact = [r.address, r.email, r.phone].filter(Boolean).join('  ·  ')
  return (
    <div className="res-row">
      <div className="res-info">
        <div className="res-name">{r.full_name}</div>
        <div className="res-contact">{contact || 'No contact info'}</div>
      </div>
      <div className={`res-owes res-${st}`}>
        <span className="res-owes-amt">{fmtMoney(balance)}</span>
        <span className="res-owes-tag">{DUES_LABEL[st]}</span>
      </div>
      <label className="res-open" title="Opening balance — what this household owed when added">
        <span className="res-open-lbl">Opening</span>
        <span className="res-open-field">
          <span className="res-bal-pre">$</span>
          <input name={`opening-balance-${r.id}`} className="res-bal-input" type="number" placeholder="0"
            value={r.opening_balance ?? ''}
            onChange={e => onLocal(r.id, 'opening_balance', e.target.value)}
            onBlur={e => onCommit(r.id, { opening_balance: Number(e.target.value) || 0 })} />
        </span>
      </label>
      <button type="button" className="bc-del" onClick={() => onRemove(r.id)}
        aria-label="Remove resident">&times;</button>
    </div>
  )
}
