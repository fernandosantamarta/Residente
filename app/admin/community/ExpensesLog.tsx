'use client'

import { useState, useEffect } from 'react'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useExpensesAdmin } from '@/hooks/useExpenses'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'
import { downloadCsv, exportFilename } from '@/lib/exportCsv'
import { useT } from '@/lib/i18n'

const LEDGER_PAGE_SIZE = 10

const fmtMoney = (n: number | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}
const todayISO = () => new Date().toISOString().slice(0, 10)

const EMPTY = { amount: '', spent_on: todayISO(), category_id: '', vendor: '', description: '' }

// Shared grid for the logged-expenses table. minmax(0, …) lets the flexible
// columns shrink instead of pushing the Amount column past the card edge.
const LEDGER_COLS = '104px minmax(0,1fr) minmax(0,1.4fr) 88px 32px'

// Board logs dated community expenses here. They feed the resident Home
// "Financial Overview" chart, which builds a real month-by-month spend curve
// from this ledger. Mirrors the Budget categories editor's look + behavior.
export function ExpensesLog({ communityId }: { communityId: string | undefined }) {
  const t = useT()
  const { expenses, loading, addExpense, removeExpense } = useExpensesAdmin()
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

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
    if (form.amount === '' || Number(form.amount) <= 0) { setError(t('admin.communityExpensesLog.errorEnterAmount')); return }
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
      setError(err?.message || t('admin.communityExpensesLog.errorCouldNotLog'))
    } finally { setSaving(false) }
  }

  const catName = (id: string | null) => cats.find(c => c.id === id)?.name || '—'
  const total = expenses.reduce((s, x) => s + x.amount, 0)
  // Clamp the page so removing rows (or a smaller list) never strands us past the end.
  const pageCount = Math.max(1, Math.ceil(expenses.length / LEDGER_PAGE_SIZE))
  const pageClamped = Math.min(page, pageCount)

  // Download the expense ledger as CSV (shared lib/exportCsv helper).
  const exportExpenses = () => {
    const cols = [
      { label: t('admin.communityExpensesLog.colDate'), value: (x: typeof expenses[number]) => x.spent_on || '' },
      { label: t('admin.communityExpensesLog.colCategory'), value: (x: typeof expenses[number]) => (x.category_id ? catName(x.category_id) : '') },
      { label: t('admin.communityExpensesLog.colVendor'), value: (x: typeof expenses[number]) => x.vendor || '' },
      { label: t('admin.communityExpensesLog.colDescription'), value: (x: typeof expenses[number]) => x.description || '' },
      { label: t('admin.communityExpensesLog.colAmount'), value: (x: typeof expenses[number]) => (Number(x.amount) || 0).toFixed(2) },
    ]
    downloadCsv(exportFilename('residente-expenses', todayISO()), expenses, cols)
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{t('admin.communityExpensesLog.heading')}</h2>
          <div className="sub">
            {t('admin.communityExpensesLog.subHeading', { count: expenses.length, total: fmtMoney(total) })}
          </div>
        </div>
        <button type="button" className="admin-btn-ghost" onClick={exportExpenses}
          disabled={expenses.length === 0} title={t('admin.communityExpensesLog.exportCsvTitle')}>
          {t('admin.communityExpensesLog.exportCsv')}
        </button>
      </div>

      <form className="admin-form" onSubmit={add}>
        <div className="admin-2col">
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.communityExpensesLog.fieldAmount')}</span>
            <div className="admin-input-wrap">
              <span className="admin-input-prefix">$</span>
              <input name="amount" className="admin-input" type="number" placeholder="1200"
                value={form.amount} onChange={e => setField('amount', e.target.value)} />
            </div>
          </label>
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.communityExpensesLog.fieldDate')}</span>
            <input name="spent_on" className="admin-input" type="date"
              value={form.spent_on} onChange={e => setField('spent_on', e.target.value)} />
          </label>
        </div>
        <div className="admin-2col">
          <div className="admin-field">
            <span className="admin-field-label">{t('admin.communityExpensesLog.fieldCategoryOptional')}</span>
            <Dropdown<string>
              value={form.category_id}
              onChange={v => setField('category_id', v)}
              ariaLabel={t('admin.communityExpensesLog.fieldCategoryAria')}
              placeholder={cats.length ? t('admin.communityExpensesLog.categoryPickPlaceholder') : t('admin.communityExpensesLog.categoryNonePlaceholder')}
              searchable
              options={[{ value: '', label: t('admin.communityExpensesLog.categoryNoneOption') }, ...cats.map(c => ({ value: c.id, label: c.name }))]}
            />
          </div>
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.communityExpensesLog.fieldVendorOptional')}</span>
            <input name="vendor" className="admin-input" placeholder={t('admin.communityExpensesLog.vendorPlaceholder')}
              value={form.vendor} onChange={e => setField('vendor', e.target.value)} />
          </label>
        </div>
        <label className="admin-field">
          <span className="admin-field-label">{t('admin.communityExpensesLog.fieldDescriptionOptional')}</span>
          <input name="description" className="admin-input" placeholder={t('admin.communityExpensesLog.descriptionPlaceholder')}
            value={form.description} onChange={e => setField('description', e.target.value)} />
        </label>
        <div className="admin-form-actions" style={{ justifyContent: 'flex-end' }}>
          {error && <span className="admin-err-inline">{error}</span>}
          <button type="submit" className="admin-primary-btn" disabled={saving}>
            {saving ? t('admin.communityExpensesLog.btnLogging') : t('admin.communityExpensesLog.btnLogExpense')}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="admin-note">{t('admin.communityExpensesLog.loading')}</div>
      ) : expenses.length === 0 ? (
        <div className="bc-empty">{t('admin.communityExpensesLog.emptyState')}</div>
      ) : (
        <div style={{ marginTop: 22 }}>
          <div className="card-head" style={{ marginBottom: 6 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, letterSpacing: '-0.2px' }}>{t('admin.communityExpensesLog.loggedExpenses')}</h3>
              <div className="sub">{expenses.length === 1 ? t('admin.communityExpensesLog.entriesCountOne', { total: fmtMoney(total) }) : t('admin.communityExpensesLog.entriesCountMany', { count: expenses.length, total: fmtMoney(total) })}</div>
            </div>
          </div>
          <div className="bc exp-ledger" style={{ marginTop: 16 }}>
            <div className="bc-row bc-row-head" style={{ gridTemplateColumns: LEDGER_COLS }}>
              <span>{t('admin.communityExpensesLog.colDate')}</span><span>{t('admin.communityExpensesLog.colCategory')}</span><span>{t('admin.communityExpensesLog.colVendorNote')}</span>
              <span style={{ textAlign: 'right' }}>{t('admin.communityExpensesLog.colAmount')}</span><span />
            </div>
            {paginate([...expenses].reverse(), pageClamped, LEDGER_PAGE_SIZE).map(x => (
              <div className="bc-row" key={x.id} style={{ gridTemplateColumns: LEDGER_COLS }}>
                <span style={{ color: 'var(--text-dim)' }}>{fmtDate(x.spent_on)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{catName(x.category_id)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>{x.vendor || x.description || '—'}</span>
                <span className="exp-amount" style={{ fontWeight: 700, textAlign: 'right' }}>{fmtMoney(x.amount)}</span>
                <button type="button" className="bc-del" onClick={() => removeExpense(x.id)}
                  aria-label={t('admin.communityExpensesLog.removeExpenseAria')}>&times;</button>
              </div>
            ))}
          </div>
          <Pagination page={pageClamped} pageSize={LEDGER_PAGE_SIZE} total={expenses.length} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
