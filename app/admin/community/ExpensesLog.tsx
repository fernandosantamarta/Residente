'use client'

import { useState, useEffect } from 'react'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useExpensesAdmin } from '@/hooks/useExpenses'
import { Dropdown } from '@/components/Dropdown'
import { downloadCsv, exportFilename } from '@/lib/exportCsv'

const fmtMoney = (n: number | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}
const todayISO = () => new Date().toISOString().slice(0, 10)

const EMPTY = { amount: '', spent_on: todayISO(), category_id: '', vendor: '', description: '' }

// Board logs dated community expenses here. They feed the resident Home
// "Financial Overview" chart, which builds a real month-by-month spend curve
// from this ledger. Mirrors the Budget categories editor's look + behavior.
export function ExpensesLog({ communityId }: { communityId: string | undefined }) {
  const { expenses, loading, addExpense, removeExpense } = useExpensesAdmin()
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!hasSupabase || !supabase || !communityId) return
      const { data } = await supabase.from('budget_categories')
        .select('id, name').eq('community_id', communityId).order('sort_order')
      if (!cancelled && data) setCats(data as any)
    }
    run()
    return () => { cancelled = true }
  }, [communityId])

  const setField = (k: keyof typeof EMPTY, v: string) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.amount === '' || Number(form.amount) <= 0) { setError('Enter an amount.'); return }
    setSaving(true); setError('')
    try {
      await addExpense({
        amount: Number(form.amount),
        spent_on: form.spent_on || todayISO(),
        category_id: form.category_id || null,
        vendor: form.vendor.trim() || null,
        description: form.description.trim() || null,
      })
      setForm({ ...EMPTY, spent_on: form.spent_on })
    } catch (err: any) {
      setError(err?.message || 'Could not log the expense')
    } finally { setSaving(false) }
  }

  const catName = (id: string | null) => cats.find(c => c.id === id)?.name || '—'
  const total = expenses.reduce((s, x) => s + x.amount, 0)

  // Download the expense ledger as CSV (shared lib/exportCsv helper).
  const exportExpenses = () => {
    const cols = [
      { label: 'Date', value: (x: typeof expenses[number]) => x.spent_on || '' },
      { label: 'Category', value: (x: typeof expenses[number]) => (x.category_id ? catName(x.category_id) : '') },
      { label: 'Vendor', value: (x: typeof expenses[number]) => x.vendor || '' },
      { label: 'Description', value: (x: typeof expenses[number]) => x.description || '' },
      { label: 'Amount', value: (x: typeof expenses[number]) => (Number(x.amount) || 0).toFixed(2) },
    ]
    downloadCsv(exportFilename('residente-expenses', todayISO()), expenses, cols)
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Expense ledger</h2>
          <div className="sub">
            Dated spending that powers the residents&rsquo; Financial Overview chart. {expenses.length} logged · {fmtMoney(total)} total.
          </div>
        </div>
        <button type="button" className="admin-btn-ghost" onClick={exportExpenses}
          disabled={expenses.length === 0} title="Download the expense ledger as CSV">
          Export CSV
        </button>
      </div>

      <form className="admin-form" onSubmit={add}>
        <div className="admin-2col">
          <label className="admin-field">
            <span className="admin-field-label">Amount</span>
            <div className="admin-input-wrap">
              <span className="admin-input-prefix">$</span>
              <input name="amount" className="admin-input" type="number" placeholder="1200"
                value={form.amount} onChange={e => setField('amount', e.target.value)} />
            </div>
          </label>
          <label className="admin-field">
            <span className="admin-field-label">Date</span>
            <input name="spent_on" className="admin-input" type="date"
              value={form.spent_on} onChange={e => setField('spent_on', e.target.value)} />
          </label>
        </div>
        <div className="admin-2col">
          <div className="admin-field">
            <span className="admin-field-label">Category (optional)</span>
            <Dropdown<string>
              value={form.category_id}
              onChange={v => setField('category_id', v)}
              ariaLabel="Category"
              placeholder={cats.length ? 'Pick a category…' : 'No categories yet'}
              searchable
              options={[{ value: '', label: '— No category —' }, ...cats.map(c => ({ value: c.id, label: c.name }))]}
            />
          </div>
          <label className="admin-field">
            <span className="admin-field-label">Vendor (optional)</span>
            <input name="vendor" className="admin-input" placeholder="Greenscape Landscaping"
              value={form.vendor} onChange={e => setField('vendor', e.target.value)} />
          </label>
        </div>
        <label className="admin-field">
          <span className="admin-field-label">Description (optional)</span>
          <input name="description" className="admin-input" placeholder="Quarterly landscaping invoice"
            value={form.description} onChange={e => setField('description', e.target.value)} />
        </label>
        <div className="admin-form-actions">
          <button type="submit" className="admin-primary-btn" disabled={saving}>
            {saving ? 'Logging…' : 'Log expense'}
          </button>
          {error && <span className="admin-err-inline">{error}</span>}
        </div>
      </form>

      {loading ? (
        <div className="admin-note">Loading…</div>
      ) : expenses.length === 0 ? (
        <div className="bc-empty">No expenses logged yet — add one above to start the spending curve.</div>
      ) : (
        <div className="bc" style={{ marginTop: 8 }}>
          <div className="bc-row bc-row-head">
            <span>Date</span><span>Category</span><span>Vendor / note</span><span>Amount</span><span />
          </div>
          {[...expenses].reverse().map(x => (
            <div className="bc-row" key={x.id} style={{ gridTemplateColumns: '110px 1fr 1.4fr 90px 32px' }}>
              <span>{fmtDate(x.spent_on)}</span>
              <span>{catName(x.category_id)}</span>
              <span>{x.vendor || x.description || '—'}</span>
              <span style={{ fontWeight: 700 }}>{fmtMoney(x.amount)}</span>
              <button type="button" className="bc-del" onClick={() => removeExpense(x.id)}
                aria-label="Remove expense">&times;</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
