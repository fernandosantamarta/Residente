'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase, signOut } from '@/lib/supabase'
import { deleteCommunity } from '@/lib/signup'
import { DangerAction } from '@/components/DangerAction'
import { ExpensesLog } from './ExpensesLog'

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
  // ---- Florida late-payment config (FS 718.116(3) / 720.3085(3)) ----
  // Interest is now expressed ANNUALLY (the statute's basis). Leave blank to
  // charge no interest; the statutory cap is 18%/yr. Late fees are optional.
  { key: 'interest_apr', label: 'Late-payment interest (% per year)', type: 'number', placeholder: '18',
    note: 'Florida cap is 18%/year, simple interest. Leave blank to charge no interest.' },
  { key: 'late_fee_flat', label: 'Admin late fee — flat', type: 'number', placeholder: '25', prefix: '$',
    note: 'Per delinquent month. Statute caps the late fee at the greater of $25 or 5% of the installment.' },
  { key: 'late_fee_pct', label: 'Admin late fee — percent', type: 'number', placeholder: '5',
    note: 'Per delinquent month, % of the installment. The platform applies the greater of the two.' },
  { key: 'association_address', label: 'Association mailing address', type: 'text', placeholder: '123 Main St, Miramar, FL 33025',
    note: 'Used on liens, statutory notices, and estoppel certificates.' },
  { key: 'association_officer_name', label: 'Authorized officer', type: 'text', placeholder: 'Jane Doe, President',
    note: 'Signs liens and certificates.' },
]

export default function CommunitySettings() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [form, setForm] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | none | error | saving | saved
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Auto-dismiss the green confirmation banner after 4s, matching the Rules page.
  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

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
        // FL compliance config — annual APR replaces the legacy monthly rate.
        // null = charge nothing (the platform never invents interest/fees).
        interest_apr: numOrNull(form.interest_apr),
        late_fee_flat: numOrNull(form.late_fee_flat),
        late_fee_pct: numOrNull(form.late_fee_pct),
        association_address: (form.association_address || '').trim() || null,
        association_officer_name: (form.association_officer_name || '').trim() || null,
      }
      const { error } = await withTimeout(
        supabase.from('communities').update(patch).eq('id', communityId)
      )
      if (error) throw error
      setStatus('ready'); setSuccessMsg('Community settings saved.')
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

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

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
                    name={f.key}
                    type={f.type} className="admin-input"
                    value={form[f.key] ?? ''} placeholder={f.placeholder}
                    onChange={e => setField(f.key, e.target.value)}
                  />
                </div>
                {f.note && (
                  <span className="admin-field-hint" style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                    {f.note}
                  </span>
                )}
              </label>
            ))}
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn"
                disabled={status === 'saving'}>
                {status === 'saving' ? 'Saving…' : 'Save changes'}
              </button>
              {status === 'error' && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <BudgetCategories communityId={communityId} onSaved={setSuccessMsg} />

          <ExpensesLog communityId={communityId} />

          <div style={{ marginTop: 34, borderTop: '1px solid #f0d9c8', paddingTop: 18 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800, color: '#b5481f' }}>Danger zone</h2>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              flexWrap: 'wrap', marginTop: 10, padding: '14px 18px',
              border: '1px solid #e7b9ad', background: '#fdf3ef', borderRadius: 12,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong style={{ fontSize: 14.5 }}>Delete this community</strong>
                <span style={{ fontSize: 13, color: '#6b5544' }}>
                  Permanently deletes {form.name || 'the community'} and all its data, cancels the subscription, and removes every member. This can&apos;t be undone.{' '}
                  Need help instead? <a href="/admin/support" style={{ color: '#E5601F', fontWeight: 700 }}>Contact Residente</a>.
                </span>
              </div>
              <DangerAction
                confirmWord="DELETE"
                confirmLabel="Delete community"
                title="Delete community"
                body={<>This permanently deletes <strong>{form.name || 'this community'}</strong> — every resident, document, payment, meeting, and setting — and cancels the subscription. All members lose access. This can&apos;t be undone.</>}
                onConfirm={async () => {
                  const r = await deleteCommunity()
                  if (r?.error) return r
                  try { await signOut() } catch { /* ignore */ }
                  if (typeof window !== 'undefined') window.location.assign('/')
                  return { ok: true }
                }}
                trigger={(open) => (
                  <button type="button" onClick={open}
                    style={{ flexShrink: 0, padding: '10px 18px', borderRadius: 999, border: '1px solid #c5341a', background: '#fff', color: '#c5341a', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
                    Delete community
                  </button>
                )}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Budget categories editor — clean-replace save (delete all + insert current).
function BudgetCategories({ communityId, onSaved }) {
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
          // Domain C compliance columns — preserved through this clean-replace
          // save so editing the budget never silently resets a category's
          // reserve / fiscal-year / adoption classification.
          is_reserve: r.is_reserve ?? false,
          status: r.status ?? 'adopted',
          fiscal_year: r.fiscal_year ?? null,
          adopted_meeting_id: r.adopted_meeting_id ?? null,
        }))
      if (toInsert.length) {
        let ins = await withTimeout(supabase.from('budget_categories').insert(toInsert))
        // If supabase/financials.sql hasn't been run yet those columns don't
        // exist — fall back to the base columns so the editor still works.
        if (ins.error && /column|schema cache|fiscal_year|is_reserve/i.test(ins.error.message || '')) {
          const basic = toInsert.map(({ is_reserve, status, fiscal_year, adopted_meeting_id, ...rest }) => rest)
          ins = await withTimeout(supabase.from('budget_categories').insert(basic))
        }
        if (ins.error) throw ins.error
      }
      setStatus('ready'); onSaved?.('Budget categories saved.')
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
            <button type="button" className="admin-primary-btn" onClick={save}
              disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save categories'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
