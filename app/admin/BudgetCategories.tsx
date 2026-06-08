'use client'

// Budget categories editor — clean-replace save (delete all + insert current).
// Shared between the Budget page (its home) and anywhere else that needs to edit
// the operating budget. Self-contained: loads its own rows by communityId and
// calls onSaved after a successful save (the parent can refresh dependent views).

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("Can't reach the server")), ms))])

const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v))

// Minimal CSV parse for the budget-categories import. Columns: name, budget,
// spent — with or without a header row (header auto-detected if col 2 isn't a number).
function parseCsv(text: string) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line: string) => line.split(',').map(c => c.trim())
  const first = cells(lines[0])
  const start = (first.length >= 2 && isNaN(Number(first[1]))) ? 1 : 0
  const out: any[] = []
  for (let i = start; i < lines.length; i++) {
    const c = cells(lines[i])
    if (!c[0]) continue
    out.push({ name: c[0], budget: c[1] || '', spent: c[2] || '' })
  }
  return out
}

export function BudgetCategories({ communityId, onSaved }: { communityId: string; onSaved?: (msg: string) => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [status, setStatus] = useState('loading') // loading | ready | error | saving | saved
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false) // read-table by default; flip to edit on Edit →

  const load = useCallback(async () => {
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.from('budget_categories').select('*')
          .eq('community_id', communityId).order('sort_order')
      ) as any
      if (error) throw error
      setRows((data || []).map((r: any) => ({ ...r })))
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load categories'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setCell = (i: number, key: string, val: any) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { name: '', budget: '', spent: '' }])
  const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i))

  const fileRef = useRef<HTMLInputElement>(null)
  const onImport = (e: any) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // let the same file be re-imported
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsv(reader.result as string)
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
      ) as any
      if (del.error) throw del.error
      const toInsert = rows
        .filter(r => (r.name || '').trim())
        .map((r, idx) => ({
          community_id: communityId,
          name: r.name.trim(),
          budget: numOrNull(r.budget) || 0,
          spent: numOrNull(r.spent) || 0,
          sort_order: idx + 1,
          // Domain C compliance columns — preserved through this clean-replace
          // save so editing the budget never silently resets a category's
          // reserve / fiscal-year / adoption classification.
          is_reserve: r.is_reserve ?? false,
          status: r.status ?? 'adopted',
          fiscal_year: r.fiscal_year ?? null,
          adopted_meeting_id: r.adopted_meeting_id ?? null,
        }))
      if (toInsert.length) {
        let ins = await withTimeout(supabase.from('budget_categories').insert(toInsert)) as any
        // If supabase/financials.sql hasn't been run yet those columns don't
        // exist — fall back to the base columns so the editor still works.
        if (ins.error && /column|schema cache|fiscal_year|is_reserve/i.test(ins.error.message || '')) {
          const basic = toInsert.map(({ is_reserve, status, fiscal_year, adopted_meeting_id, ...rest }) => rest)
          ins = await withTimeout(supabase.from('budget_categories').insert(basic)) as any
        }
        if (ins.error) throw ins.error
      }
      setStatus('ready'); setEditing(false); onSaved?.('Budget categories saved.')
    } catch (err: any) {
      setError(err?.message || 'Save failed'); setStatus('error')
    }
  }

  const cancel = () => { setEditing(false); setError(''); load() }
  const startAdd = () => { setEditing(true); addRow() }

  // Read-table figures.
  const money = (n: any) => '$' + (Number(n) || 0).toLocaleString('en-US')
  const totalBudget = rows.reduce((s, r) => s + (Number(r.budget) || 0), 0)
  const pctOf = (r: any) => totalBudget > 0
    ? Math.round(((Number(r.budget) || 0) / totalBudget) * 100) + '%'
    : '—'

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Budget categories</h2>
          <div className="sub">This year&rsquo;s operating budget — feeds the Home cards &amp; rings.</div>
        </div>
        {!editing && status !== 'loading' && status !== 'error' && (
          <button type="button" className="admin-btn-ghost" onClick={startAdd}>+ Add category</button>
        )}
      </div>

      {status === 'loading' && <div className="admin-note">Loading categories…</div>}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {/* Read mode — the mock's clean table, no boxes. */}
      {status !== 'loading' && status !== 'error' && !editing && (
        rows.length === 0 ? (
          <div className="bc-empty">No categories yet — use “+ Add category” to start your budget.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Category</th><th>Annual amount</th><th>% of budget</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || `row-${i}`}>
                  <td className="strong">{r.name}</td>
                  <td>{money(r.budget)}</td>
                  <td className="muted">{pctOf(r)}</td>
                  <td className="go-cell"><button type="button" className="go" onClick={() => setEditing(true)}>Edit &rarr;</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Edit mode — borderless inline editor. */}
      {status !== 'loading' && status !== 'error' && editing && (
        <div className="bc">
          <div className="bc-row bc-row-head">
            <span>Category</span><span>Budget&nbsp;$</span><span>Spent&nbsp;$</span><span />
          </div>
          {rows.length === 0 && (
            <div className="bc-empty">No categories yet — add your first one below.</div>
          )}
          {rows.map((r, i) => (
            <div className="bc-row" key={r.id || `new-${i}`}>
              <input name={`cat-name-${i}`} className="admin-input" placeholder="Landscape"
                value={r.name ?? ''} onChange={e => setCell(i, 'name', e.target.value)} />
              <input name={`cat-budget-${i}`} className="admin-input" type="number" placeholder="0"
                value={r.budget ?? ''} onChange={e => setCell(i, 'budget', e.target.value)} />
              <input name={`cat-spent-${i}`} className="admin-input" type="number" placeholder="0"
                value={r.spent ?? ''} onChange={e => setCell(i, 'spent', e.target.value)} />
              <button type="button" className="bc-del" onClick={() => removeRow(i)}
                aria-label="Remove category">&times;</button>
            </div>
          ))}
          <div className="bc-actions">
            <button type="button" className="admin-btn-ghost" onClick={addRow}>+ Add category</button>
            <button type="button" className="admin-secondary-btn"
              title="CSV columns: name, budget, spent"
              onClick={() => fileRef.current && fileRef.current.click()}>
              Import CSV
            </button>
            <input name="categories-csv" ref={fileRef} type="file" accept=".csv,text/csv"
              onChange={onImport} style={{ display: 'none' }} />
            <button type="button" className="admin-btn-ghost" onClick={cancel}>Cancel</button>
            <button type="button" className="admin-primary-btn" onClick={save}
              disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save categories'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
