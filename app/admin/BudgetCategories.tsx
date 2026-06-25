'use client'

// Budget categories editor — clean-replace save (delete all + insert current).
// Shared between the Budget page (its home) and anywhere else that needs to edit
// the operating budget. Self-contained: loads its own rows by communityId and
// calls onSaved after a successful save (the parent can refresh dependent views).

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { extractBudgetFromFile } from '@/lib/signupImport'
import { useT } from '@/lib/i18n'

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
  const t = useT()
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
      setError(err?.message || t('admin.budgetCategories.errorLoadFailed')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setCell = (i: number, key: string, val: any) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { name: '', budget: '', spent: '' }])
  const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i))

  const fileRef = useRef<HTMLInputElement>(null)
  // One upload: a CSV is parsed in-browser; a PDF/photo of a budget is read by AI
  // (extract-doc). Either way the rows land in this same editable table to review
  // before Save. AI failure shows inline (doesn't collapse the editor).
  const [aiBusy, setAiBusy] = useState(false)
  const onImport = (e: any) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // let the same file be re-imported
    if (!file) return
    setError('')
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel'
    if (isCsv) {
      const reader = new FileReader()
      reader.onload = () => {
        const parsed = parseCsv(reader.result as string)
        if (parsed.length) { setRows(parsed); setStatus('ready'); setError('') }
        else { setError(t('admin.budgetCategories.errorNoCsvRows')); setStatus('error') }
      }
      reader.onerror = () => { setError(t('admin.budgetCategories.errorFileRead')); setStatus('error') }
      reader.readAsText(file)
      return
    }
    setAiBusy(true)
    extractBudgetFromFile(file)
      .then(cats => {
        if (cats && cats.length) { setRows(cats); setStatus('ready'); setError('') }
        else setError(t('admin.budgetCategories.aiUnavailable'))
      })
      .catch(() => setError(t('admin.budgetCategories.aiUnavailable')))
      .finally(() => setAiBusy(false))
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
      setStatus('ready'); setEditing(false); onSaved?.(t('admin.budgetCategories.savedMessage'))
    } catch (err: any) {
      setError(err?.message || t('admin.budgetCategories.errorSaveFailed')); setStatus('error')
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
          <h2>{t('admin.budgetCategories.heading')}</h2>
          <div className="sub">{t('admin.budgetCategories.subHeading')}</div>
        </div>
      </div>

      {status === 'loading' && <div className="admin-note">{t('admin.budgetCategories.loading')}</div>}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.budgetCategories.retry')}</button>
        </div>
      )}

      {/* Read mode — the mock's clean table, no boxes. */}
      {status !== 'loading' && status !== 'error' && !editing && (
        <>
          {rows.length === 0 ? (
            <div className="bc-empty">{t('admin.budgetCategories.emptyRead')}</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>{t('admin.budgetCategories.colCategory')}</th><th>{t('admin.budgetCategories.colAnnualAmount')}</th><th>{t('admin.budgetCategories.colPctOfBudget')}</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id || `row-${i}`}>
                    <td className="strong">{r.name}</td>
                    <td>{money(r.budget)}</td>
                    <td className="muted">{pctOf(r)}</td>
                    <td className="go-cell"><button type="button" className="go" onClick={() => setEditing(true)}>{t('admin.budgetCategories.editBtn')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Add lives at the END of the list, not the top. */}
          <button type="button" className="admin-btn-ghost bc-add-end" onClick={startAdd}>
            {t('admin.budgetCategories.addCategory')}
          </button>
        </>
      )}

      {/* Edit mode — borderless inline editor. */}
      {status !== 'loading' && status !== 'error' && editing && (
        <div className="bc">
          <div className="bc-row bc-row-head">
            <span>{t('admin.budgetCategories.colCategory')}</span><span>{t('admin.budgetCategories.editColBudget')}</span><span>{t('admin.budgetCategories.editColSpent')}</span><span />
          </div>
          {rows.length === 0 && (
            <div className="bc-empty">{t('admin.budgetCategories.emptyEdit')}</div>
          )}
          {rows.map((r, i) => (
            <div className="bc-row" key={r.id || `new-${i}`}>
              <label className="bc-field bc-field-name">
                <span className="bc-field-label">{t('admin.budgetCategories.colCategory')}</span>
                <input name={`cat-name-${i}`} className="admin-input" placeholder={t('admin.budgetCategories.placeholderName')}
                  value={r.name ?? ''} onChange={e => setCell(i, 'name', e.target.value)} />
              </label>
              <label className="bc-field">
                <span className="bc-field-label">{t('admin.budgetCategories.editColBudget')}</span>
                <input name={`cat-budget-${i}`} className="admin-input" type="number" placeholder="0"
                  value={r.budget ?? ''} onChange={e => setCell(i, 'budget', e.target.value)} />
              </label>
              <label className="bc-field">
                <span className="bc-field-label">{t('admin.budgetCategories.editColSpent')}</span>
                <input name={`cat-spent-${i}`} className="admin-input" type="number" placeholder="0"
                  value={r.spent ?? ''} onChange={e => setCell(i, 'spent', e.target.value)} />
              </label>
              <button type="button" className="bc-del" onClick={() => removeRow(i)}
                aria-label={t('admin.budgetCategories.removeCategory')}>&times;</button>
            </div>
          ))}
          <div className="bc-actions">
            <button type="button" className="admin-btn-ghost" onClick={addRow}>{t('admin.budgetCategories.addCategory')}</button>
            <button type="button" className="admin-secondary-btn"
              title={t('admin.budgetCategories.uploadFileTitle')}
              disabled={aiBusy}
              onClick={() => fileRef.current && fileRef.current.click()}>
              {aiBusy ? t('admin.budgetCategories.aiReading') : t('admin.budgetCategories.uploadFile')}
            </button>
            <input name="categories-csv" ref={fileRef} type="file"
              accept=".csv,text/csv,.pdf,application/pdf,image/png,image/jpeg,image/webp"
              onChange={onImport} style={{ display: 'none' }} />
            <button type="button" className="admin-btn-ghost" onClick={cancel}>{t('admin.budgetCategories.cancel')}</button>
            {error && <span style={{ color: '#B42318', fontSize: 12.5, alignSelf: 'center' }}>{error}</span>}
            <button type="button" className="admin-primary-btn" onClick={save}
              disabled={status === 'saving'}>
              {status === 'saving' ? t('admin.budgetCategories.saving') : t('admin.budgetCategories.saveCategories')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
