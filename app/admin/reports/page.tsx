'use client'

// Reports & exports workspace. Pulls the community's payments (dues + fines),
// expense ledger, and roster from Supabase and lets the board download each as
// CSV over a date range — including QuickBooks-friendly variants (Date /
// Description / Amount) that import straight into QBO's bank feed.
//
// Read-only: every button is a client-side CSV download (lib/exportCsv), so
// there's nothing to mutate and no edge function to call.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { downloadCsv, exportFilename, type CsvColumn } from '@/lib/exportCsv'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const todayISO = () => new Date().toISOString().slice(0, 10)
const yearStartISO = () => `${new Date().getUTCFullYear()}-01-01`

// A payment's effective date: the recorded paid_on, else the row's created_at.
const payDate = (p: any) => (p.paid_on || (p.created_at ? String(p.created_at).slice(0, 10) : '')) as string
const inRange = (iso: string, from: string, to: string) => !!iso && iso >= from && iso <= to

type Payment = { id: string; amount: number; paid_on: string | null; created_at: string | null; resident_id: string | null; charge_type: string | null; method: string | null }

// payments.charge_type is null for an ordinary dues payment; otherwise one of
// the collections charge kinds. Render a friendly label for exports.
const CHARGE_LABEL: Record<string, string> = {
  assessment: 'Assessment', interest: 'Interest', late_fee: 'Late fee', cost: 'Cost', fine: 'Fine', other: 'Other',
}
const chargeLabel = (t: string | null) => (t ? (CHARGE_LABEL[t] || t) : 'Dues')
type Expense = { id: string; amount: number; spent_on: string; category_id: string | null; vendor: string | null; description: string | null }
type Resident = { id: string; full_name: string | null; unit_number: string | null; address: string | null; opening_balance: number | null }

export default function ReportsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id

  const [payments, setPayments] = useState<Payment[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [residents, setResidents] = useState<Resident[]>([])
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')

  const [from, setFrom] = useState(yearStartISO())
  const [to, setTo] = useState(todayISO())

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [{ data: pay }, { data: exp }, { data: res }, { data: bc }] = (await Promise.all([
        withTimeout(supabase!.from('payments')
          .select('id, amount, paid_on, created_at, resident_id, charge_type, method')
          .eq('community_id', communityId).order('paid_on', { ascending: false })),
        withTimeout(supabase!.from('ev_expenses')
          .select('id, amount, spent_on, category_id, vendor, description')
          .eq('community_id', communityId).order('spent_on', { ascending: false })),
        withTimeout(supabase!.from('residents')
          .select('id, full_name, unit_number, address, opening_balance')
          .eq('community_id', communityId).order('full_name')),
        withTimeout(supabase!.from('budget_categories').select('id, name').eq('community_id', communityId)),
      ])) as any
      setPayments(pay || []); setExpenses(exp || []); setResidents(res || []); setCats(bc || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load report data'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const catName = useCallback((id: string | null) => cats.find(c => c.id === id)?.name || '', [cats])
  // Resident lookup for payment rows — joined client-side (PostgREST has no
  // detectable FK embed from payments → residents).
  const residentById = useMemo(() => {
    const m: Record<string, Resident> = {}
    for (const r of residents) m[r.id] = r
    return m
  }, [residents])

  const paysInRange = useMemo(() => payments.filter(p => inRange(payDate(p), from, to)), [payments, from, to])
  const expInRange = useMemo(() => expenses.filter(x => inRange(x.spent_on, from, to)), [expenses, from, to])

  const collected = useMemo(() => paysInRange.reduce((s, p) => s + (Number(p.amount) || 0), 0), [paysInRange])
  const spent = useMemo(() => expInRange.reduce((s, x) => s + (Number(x.amount) || 0), 0), [expInRange])

  // ---- exports ----
  const exportPayments = () => {
    const cols: CsvColumn<Payment>[] = [
      { label: 'Date', value: p => payDate(p) },
      { label: 'Resident', value: p => residentById[p.resident_id || '']?.full_name || '' },
      { label: 'Unit', value: p => residentById[p.resident_id || '']?.unit_number || '' },
      { label: 'Type', value: p => chargeLabel(p.charge_type) },
      { label: 'Amount', value: p => (Number(p.amount) || 0).toFixed(2) },
      { label: 'Method', value: p => p.method || '' },
    ]
    downloadCsv(exportFilename('residente-payments', todayISO()), paysInRange, cols)
  }
  const exportPaymentsQbo = () => {
    // QuickBooks Online 3-column bank-import format: Date, Description, Amount.
    const cols: CsvColumn<Payment>[] = [
      { label: 'Date', value: p => payDate(p) },
      { label: 'Description', value: p => {
        const r = residentById[p.resident_id || '']
        return `${chargeLabel(p.charge_type)} — ${r?.full_name || 'Resident'}${r?.unit_number ? ` (Unit ${r.unit_number})` : ''}`
      } },
      { label: 'Amount', value: p => (Number(p.amount) || 0).toFixed(2) },
    ]
    downloadCsv(exportFilename('residente-payments-quickbooks', todayISO()), paysInRange, cols)
  }
  const exportExpenses = () => {
    const cols: CsvColumn<Expense>[] = [
      { label: 'Date', value: x => x.spent_on || '' },
      { label: 'Category', value: x => catName(x.category_id) },
      { label: 'Vendor', value: x => x.vendor || '' },
      { label: 'Description', value: x => x.description || '' },
      { label: 'Amount', value: x => (Number(x.amount) || 0).toFixed(2) },
    ]
    downloadCsv(exportFilename('residente-expenses', todayISO()), expInRange, cols)
  }
  const exportExpensesQbo = () => {
    // Expenses import as negative amounts so QBO books them as money out.
    const cols: CsvColumn<Expense>[] = [
      { label: 'Date', value: x => x.spent_on || '' },
      { label: 'Description', value: x => x.vendor || x.description || 'Expense' },
      { label: 'Amount', value: x => (-(Number(x.amount) || 0)).toFixed(2) },
      { label: 'Account', value: x => catName(x.category_id) },
    ]
    downloadCsv(exportFilename('residente-expenses-quickbooks', todayISO()), expInRange, cols)
  }
  const exportRoster = () => {
    const cols: CsvColumn<Resident>[] = [
      { label: 'Name', value: r => r.full_name || '' },
      { label: 'Unit', value: r => r.unit_number || '' },
      { label: 'Address', value: r => r.address || '' },
      { label: 'Opening balance', value: r => r.opening_balance != null ? Number(r.opening_balance).toFixed(2) : '' },
    ]
    downloadCsv(exportFilename('residente-roster', todayISO()), residents, cols)
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Reporting</div>
      <h1 className="admin-h1">Reports <span className="amp">&</span> exports</h1>
      <p className="admin-dek">
        Download your community&rsquo;s dues, fines, expenses, and roster as CSV —
        ready for a spreadsheet or to import into QuickBooks. Payments and expenses
        respect the date range below; the roster exports in full.
      </p>

      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet.</div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>
      )}

      {status === 'ready' && (
        <>
          {/* Date range */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '8px 0 18px' }}>
            <label className="admin-field"><span className="admin-field-label">From</span>
              <input className="admin-input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">To</span>
              <input className="admin-input" type="date" value={to} min={from} max={todayISO()} onChange={e => setTo(e.target.value)} /></label>
          </div>

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
            {[
              { l: 'Collected', v: fmt$(collected), n: `${paysInRange.length} payments` },
              { l: 'Spent', v: fmt$(spent), n: `${expInRange.length} expenses` },
              { l: 'Net', v: fmt$(collected - spent), n: 'collected − spent' },
              { l: 'Households', v: String(residents.length), n: 'in roster' },
            ].map(s => (
              <div key={s.l} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
                <div style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6, fontWeight: 600 }}>{s.l}</div>
                <div style={{ fontSize: 24, fontWeight: 700, margin: '2px 0' }}>{s.v}</div>
                <div style={{ fontSize: 12.5, opacity: 0.65 }}>{s.n}</div>
              </div>
            ))}
          </div>

          {/* Export cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ExportCard
              title="Payments ledger"
              sub={`${paysInRange.length} dues & fines payments in range · ${fmt$(collected)}`}
              disabled={paysInRange.length === 0}
              actions={[
                { label: 'Export CSV', onClick: exportPayments, primary: true },
                { label: 'QuickBooks CSV', onClick: exportPaymentsQbo },
              ]}
            />
            <ExportCard
              title="Expense ledger"
              sub={`${expInRange.length} expenses in range · ${fmt$(spent)}`}
              disabled={expInRange.length === 0}
              actions={[
                { label: 'Export CSV', onClick: exportExpenses, primary: true },
                { label: 'QuickBooks CSV', onClick: exportExpensesQbo },
              ]}
            />
            <ExportCard
              title="Household roster"
              sub={`${residents.length} households · name, unit, address, opening balance`}
              disabled={residents.length === 0}
              actions={[{ label: 'Export CSV', onClick: exportRoster, primary: true }]}
            />
          </div>

          <p className="admin-note" style={{ marginTop: 18, fontSize: 12.5 }}>
            QuickBooks files use the Date / Description / Amount bank-import format
            (expenses as negative amounts). Figures come straight from your ledgers —
            review before filing.
          </p>
        </>
      )}
    </div>
  )
}

function ExportCard({
  title, sub, actions, disabled,
}: {
  title: string
  sub: string
  disabled?: boolean
  actions: { label: string; onClick: () => void; primary?: boolean }[]
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '16px 18px', background: '#fff' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15.5 }}>{title}</div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {actions.map(a => (
          <button
            key={a.label}
            type="button"
            className={a.primary ? 'admin-primary-btn' : 'admin-btn-ghost'}
            onClick={a.onClick}
            disabled={disabled}
            style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
