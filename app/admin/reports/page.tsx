'use client'

// Reports & exports workspace. Pulls the community's payments (dues + fines),
// expense ledger, and roster from Supabase and lets the board download each as
// CSV over a date range — including QuickBooks-friendly variants (Date /
// Description / Amount) that import straight into QBO's bank feed.
//
// Read-only: every button is a client-side CSV download (lib/exportCsv), so
// there's nothing to mutate and no edge function to call.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { downloadCsv, exportFilename, type CsvColumn } from '@/lib/exportCsv'
import { residentBalance, communityDuesConfig } from '@/lib/dues'
import { Dropdown } from '@/components/Dropdown'

// Period presets behind the "Year to date" dropdown. Each maps to a from/to
// range; "custom" reveals the raw date inputs so any window is still reachable.
type PeriodKey = 'ytd' | 'mtd' | 'last-month' | '30d' | '90d' | '12mo' | 'all' | 'custom'
const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'ytd', label: 'Year to date' },
  { value: 'mtd', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12mo', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

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
type Resident = { id: string; full_name: string | null; unit_number: string | null; address: string | null; opening_balance: number | null; created_at?: string | null }

export default function ReportsPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id

  const [payments, setPayments] = useState<Payment[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [residents, setResidents] = useState<Resident[]>([])
  const [community, setCommunity] = useState<any>(null)
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')

  const [from, setFrom] = useState(yearStartISO())
  const [to, setTo] = useState(todayISO())
  const [period, setPeriod] = useState<PeriodKey>('ytd')
  const [category, setCategory] = useState<string>('all')

  // Picking a preset rewrites the from/to range the rest of the page reads;
  // "custom" leaves the current range alone and surfaces the date inputs.
  const onPeriod = (key: PeriodKey) => {
    setPeriod(key)
    if (key === 'custom') return
    const now = new Date()
    const y = now.getUTCFullYear(), m = now.getUTCMonth()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const daysAgo = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d) }
    let f = yearStartISO(); let t = todayISO()
    if (key === 'mtd') f = `${y}-${String(m + 1).padStart(2, '0')}-01`
    else if (key === 'last-month') { f = iso(new Date(Date.UTC(y, m - 1, 1))); t = iso(new Date(Date.UTC(y, m, 0))) }
    else if (key === '30d') f = daysAgo(30)
    else if (key === '90d') f = daysAgo(90)
    else if (key === '12mo') f = daysAgo(365)
    else if (key === 'all') f = '2000-01-01'
    setFrom(f); setTo(t)
  }

  const categoryOptions = useMemo(
    () => [{ value: 'all', label: 'All categories' }, ...cats.map(c => ({ value: c.id, label: c.name }))],
    [cats],
  )

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [{ data: pay }, { data: exp }, { data: res }, { data: bc }, { data: com }] = (await Promise.all([
        withTimeout(supabase!.from('payments')
          .select('id, amount, paid_on, created_at, resident_id, charge_type, method')
          .eq('community_id', communityId).order('paid_on', { ascending: false })),
        withTimeout(supabase!.from('ev_expenses')
          .select('id, amount, spent_on, category_id, vendor, description')
          .eq('community_id', communityId).order('spent_on', { ascending: false })),
        withTimeout(supabase!.from('residents')
          .select('id, full_name, unit_number, address, opening_balance, created_at')
          .eq('community_id', communityId).order('full_name')),
        withTimeout(supabase!.from('budget_categories').select('id, name').eq('community_id', communityId)),
        withTimeout(supabase!.from('communities').select('*').eq('id', communityId).single()),
      ])) as any
      setPayments(pay || []); setExpenses(exp || []); setResidents(res || []); setCats(bc || []); setCommunity(com || null)
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

  // Live balance per household = opening balance + accrued monthly dues − payments
  // (same calc the Residents page shows), so "who's behind" is accurate, not just
  // the static opening balance.
  const monthlyDues = Number(community?.monthly_dues) || 0
  const duesCfg = useMemo(() => communityDuesConfig(community), [community])
  const paymentsByResident = useMemo(() => {
    const m = new Map<string, Payment[]>()
    for (const p of payments) {
      if (!p.resident_id) continue
      if (!m.has(p.resident_id)) m.set(p.resident_id, [])
      m.get(p.resident_id)!.push(p)
    }
    return m
  }, [payments])
  const balanceOf = useCallback(
    (r: Resident) => residentBalance(r as any, monthlyDues, paymentsByResident.get(r.id) || [], duesCfg),
    [monthlyDues, paymentsByResident, duesCfg],
  )
  // Owners who owe money, most-behind first.
  const delinquents = useMemo(
    () => residents.map(r => ({ r, bal: balanceOf(r) })).filter(x => x.bal > 0).sort((a, b) => b.bal - a.bal),
    [residents, balanceOf],
  )

  const paysInRange = useMemo(() => payments.filter(p => inRange(payDate(p), from, to)), [payments, from, to])
  const expInRange = useMemo(
    () => expenses.filter(x => inRange(x.spent_on, from, to) && (category === 'all' || x.category_id === category)),
    [expenses, from, to, category],
  )

  const collected = useMemo(() => paysInRange.reduce((s, p) => s + (Number(p.amount) || 0), 0), [paysInRange])
  const spent = useMemo(() => expInRange.reduce((s, x) => s + (Number(x.amount) || 0), 0), [expInRange])

  // Outstanding = the total still owed across the roster, from each household's
  // recorded balance on file (opening_balance). Credits (negative) don't reduce
  // the figure — only positive balances count toward what's owed.
  const outstanding = useMemo(
    () => residents.reduce((s, r) => s + Math.max(0, balanceOf(r)), 0),
    [residents, balanceOf],
  )

  // Collections snapshot — owners bucketed by their live balance. We have no
  // aging dates here, so the brackets are by amount (not days late); the real
  // aging workflow lives in Compliance → Collections.
  const brackets = useMemo(() => {
    const defs = [
      { label: 'Current', pill: 'ok' as const, hit: (b: number) => b <= 0 },
      { label: '< $500', pill: 'warn' as const, hit: (b: number) => b > 0 && b < 500 },
      { label: '$500–$2k', pill: 'due' as const, hit: (b: number) => b >= 500 && b < 2000 },
      { label: '$2k+', pill: 'due' as const, hit: (b: number) => b >= 2000 },
    ]
    const rows = defs.map(d => ({ ...d, count: 0, owed: 0 }))
    for (const r of residents) {
      const b = balanceOf(r)
      const row = rows.find(x => x.hit(b))
      if (row) { row.count++; row.owed += Math.max(0, b) }
    }
    const total = residents.length || 1
    return rows.map(r => ({ ...r, pct: Math.round((r.count / total) * 100) }))
  }, [residents, balanceOf])

  const rangeLabel = `${from} → ${to}`

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
  const exportDelinquents = () => {
    const cols: CsvColumn<{ r: Resident; bal: number }>[] = [
      { label: 'Name', value: x => x.r.full_name || '' },
      { label: 'Unit', value: x => x.r.unit_number || '' },
      { label: 'Address', value: x => x.r.address || '' },
      { label: 'Balance owed', value: x => x.bal.toFixed(2) },
    ]
    downloadCsv(exportFilename('residente-past-due', todayISO()), delinquents, cols)
  }

  // The board-facing report list. Each row fronts the real CSV exporters above;
  // QuickBooks variants ride along as a secondary action where one exists.
  const REPORTS: {
    name: string; period: string; count: number
    actions: { label: string; onClick: () => void; dim?: boolean }[]
  }[] = [
    {
      name: 'Payment ledger (dues & fines)', period: rangeLabel, count: paysInRange.length,
      actions: [
        { label: 'Export CSV', onClick: exportPayments },
        { label: 'QuickBooks', onClick: exportPaymentsQbo, dim: true },
      ],
    },
    {
      name: 'Expense ledger', period: rangeLabel, count: expInRange.length,
      actions: [
        { label: 'Export CSV', onClick: exportExpenses },
        { label: 'QuickBooks', onClick: exportExpensesQbo, dim: true },
      ],
    },
    {
      name: 'Household roster', period: 'Full roster', count: residents.length,
      actions: [{ label: 'Export CSV', onClick: exportRoster }],
    },
  ]

  return (
    <div className="admin-page crep">
      <div className="admin-kicker">Reporting</div>
      <h1 className="admin-h1">Reports</h1>
      <p className="admin-dek">
        Financial <span className="amp">&</span> operational reports for your board
        and owners. Filter the period, then view or export.
      </p>

      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet.</div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>
      )}

      {status === 'ready' && (
        <>
          {/* Toolbar — period + category pickers on the left (mock parity), the
              headline export on the right. "Custom range" reveals raw dates. */}
          <div className="toolbar">
            <div className="toolbar-filters">
              <Dropdown value={period} onChange={onPeriod} options={PERIODS} ariaLabel="Period" />
              <Dropdown value={category} onChange={setCategory} options={categoryOptions} ariaLabel="Expense category" />
              {period === 'custom' && (
                <>
                  <label className="admin-field"><span className="admin-field-label">From</span>
                    <input className="admin-input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
                  <label className="admin-field"><span className="admin-field-label">To</span>
                    <input className="admin-input" type="date" value={to} min={from} max={todayISO()} onChange={e => setTo(e.target.value)} /></label>
                </>
              )}
            </div>
            <button type="button" className="admin-primary-btn" onClick={exportPayments} disabled={paysInRange.length === 0}>
              Export CSV
            </button>
          </div>

          {/* Stat tiles. */}
          <div className="stats">
            {[
              { v: fmt$(collected), l: 'Collected' },
              { v: fmt$(outstanding), l: 'Outstanding', c: 'var(--due)' },
              { v: fmt$(spent), l: 'Expenses' },
              { v: fmt$(collected - spent), l: 'Net', c: 'var(--ok)' },
            ].map(s => (
              <div key={s.l} className="stat">
                <div className="v" style={s.c ? { color: s.c } : undefined}>{s.v}</div>
                <div className="l">{s.l}</div>
              </div>
            ))}
          </div>

          {/* Available reports — the mock's table, wired to the real exporters. */}
          <div className="card">
            <div className="card-head">
              <div><h2>Available reports</h2><div className="sub">Export to CSV or a QuickBooks-ready file</div></div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Report</th>
                  <th className="period-col">Period</th>
                  <th>Rows</th>
                  <th className="act"></th>
                </tr>
              </thead>
              <tbody>
                {REPORTS.map(r => (
                  <tr key={r.name}>
                    <td className="strong">{r.name}</td>
                    <td className="muted period-col">{r.period}</td>
                    <td className="muted">{r.count}</td>
                    <td className="act">
                      {r.actions.map(a => (
                        <button key={a.label} type="button" className={`go${a.dim ? ' dim' : ''}`}
                          onClick={a.onClick} disabled={r.count === 0}>
                          {a.label}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Who's behind — the named past-due list (the snapshot below is the
              bucketed summary of the same balances). */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Who&rsquo;s behind on payments</h2>
                <div className="sub">{delinquents.length} {delinquents.length === 1 ? 'household owes' : 'households owe'} a balance · most behind first</div>
              </div>
              <button type="button" className="admin-secondary-btn" onClick={exportDelinquents} disabled={delinquents.length === 0}>
                Export CSV
              </button>
            </div>
            {delinquents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--text-dim)', fontSize: 13.5 }}>
                {residents.length === 0
                  ? 'No households in the roster yet.'
                  : 'Everyone is current — no outstanding balances. 🎉'}
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr><th>Owner</th><th className="period-col">Unit</th><th>Balance owed</th><th className="act"></th></tr>
                </thead>
                <tbody>
                  {delinquents.map(({ r, bal }) => (
                    <tr key={r.id}>
                      <td className="strong">{r.full_name || 'Resident'}</td>
                      <td className="muted period-col">{r.unit_number || r.address || '—'}</td>
                      <td className="due">{fmt$(bal)}</td>
                      <td className="act">
                        <Link href="/admin/compliance" className="go" style={{ textDecoration: 'none' }}>Collect →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Collections snapshot — owners by balance, bucketed. */}
          <div className="card">
            <div className="card-head">
              <div><h2>Collections snapshot</h2><div className="sub">Owners by balance, bucketed by amount</div></div>
            </div>
            {residents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--text-dim)', fontSize: 13.5 }}>
                No households in the roster yet. Import or add residents to see collections at a glance.
              </div>
            ) : brackets.map((b, i) => {
              const isLast = i === brackets.length - 1
              return (
                <div className="lrow" key={b.label}>
                  <span className={`pill ${b.pill}`}>{b.label}</span>
                  <div className="body">
                    <div className="ttl">{b.count} {b.count === 1 ? 'owner' : 'owners'}</div>
                    <div className="meta">{b.owed > 0 ? `${fmt$(b.owed)} on file` : '$0 balance'}</div>
                  </div>
                  {isLast && b.count > 0
                    ? <Link href="/admin/compliance" className="go" style={{ textDecoration: 'none' }}>Collections &rarr;</Link>
                    : <span className="pct">{b.pct}%</span>}
                </div>
              )
            })}
          </div>

          <p className="note">
            QuickBooks files use the Date / Description / Amount bank-import format
            (expenses as negative amounts). Figures come straight from your ledgers —
            review before filing.
          </p>
        </>
      )}
    </div>
  )
}
