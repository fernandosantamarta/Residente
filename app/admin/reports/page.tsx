'use client'

// Reports & exports workspace. Pulls the community's payments (dues + fines),
// expense ledger, and roster from Supabase and lets the board download each as
// CSV over a date range — including QuickBooks-friendly variants (Date /
// Description / Amount) that import straight into QBO's bank feed.
//
// Read-only: every button is a client-side CSV download (lib/exportCsv), so
// there's nothing to mutate and no edge function to call.

import { useState, useEffect, useCallback, useMemo, useRef, Fragment, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { downloadCsv, exportFilename, type CsvColumn } from '@/lib/exportCsv'
import { parseRosterCsv } from '@/lib/signupImport'
import { residentBalance, communityDuesConfig, adminLateFees, fmtMoney } from '@/lib/dues'
import { Dropdown } from '@/components/Dropdown'
import { RecordPaymentForm } from '@/components/RecordPaymentForm'
import { Pager } from '@/components/Pager'
import { logAudit } from '@/lib/audit'
import { useT } from '@/lib/i18n'
import { useMonthlyCharges, type MonthlyChargeStatus, type MonthlyCharge } from '@/hooks/useMonthlyCharges'

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

// Monthly-assessment ledger display helpers (mirrors the old standalone charges
// page): a billing period like "June 2026" from its YYYY-MM-DD start, a short
// due date, and the pill tone per generated-charge status.
const periodLabel = (iso: string): string => {
  if (!iso) return '—'
  const [y, m] = iso.split('-').map(Number)
  if (!y || !m) return iso
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const dateLabel = (iso: string): string => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const ASSESSMENT_PILL: Record<MonthlyChargeStatus, string> = {
  'pending': 'due', 'paid-in-full': 'ok', 'partial': 'warn', 'reversed': 'warn',
}

type Expense = { id: string; amount: number; spent_on: string; category_id: string | null; vendor: string | null; description: string | null }
type Resident = { id: string; full_name: string | null; unit_number: string | null; address: string | null; opening_balance: number | null; created_at?: string | null; profile_id?: string | null; email?: string | null }

export default function ReportsPage() {
  const t = useT()
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

  // The auto-generated monthly-dues ledger (ev_monthly_charges) — the cron-minted
  // obligations, distinct from payments received. Read-only audit view; balances
  // stay formula-based in lib/dues.ts, so nothing here is summed into what's owed.
  const { charges: assessments, loading: assessmentsLoading, error: assessmentsError, reload: reloadAssessments } = useMonthlyCharges()
  const assessmentsTotal = useMemo(() => assessments.reduce((s, c) => s + (Number(c.amount) || 0), 0), [assessments])

  // Per-row state for the "Who's behind" actions: which row's record-payment
  // form is open, and the in-flight / result state of a payment reminder.
  const [openPayId, setOpenPayId] = useState<string | null>(null)
  const [remindBusyId, setRemindBusyId] = useState<string | null>(null)

  // Bulk opening-balance import (migration off a prior manager). Reuses the shared
  // roster CSV parser; matches each row to an existing resident by unit (then name)
  // and updates residents.opening_balance. Lives here in the money workspace — the
  // Residents roster page stays people-only.
  const balFileRef = useRef<HTMLInputElement>(null)
  const [pendingBal, setPendingBal] = useState<{ matched: { r: Resident; bal: number }[]; unmatched: string[] } | null>(null)
  const [importingBal, setImportingBal] = useState(false)
  const [remindMsg, setRemindMsg] = useState('')
  const [behindPage, setBehindPage] = useState(0)
  const [assessmentsPage, setAssessmentsPage] = useState(0)
  const BEHIND_SIZE = 12
  // Mobile shows fewer assessment rows per page (5) than desktop (12).
  const [isMobile, setIsMobile] = useState(false)
  // On mobile, tapping a table row opens a detail sheet — hover tooltips don't
  // exist on touch, so long addresses need a tap-to-see.
  const [rowDetail, setRowDetail] = useState<{ title: string; rows: { label: string; value: string }[] } | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 640px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

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
    () => [{ value: 'all', label: t('admin.reports.allCategories') }, ...cats.map(c => ({ value: c.id, label: c.name }))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cats, t],
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
          .select('id, full_name, unit_number, address, opening_balance, created_at, profile_id, email')
          .eq('community_id', communityId).order('full_name')),
        withTimeout(supabase!.from('budget_categories').select('id, name').eq('community_id', communityId)),
        withTimeout(supabase!.from('communities').select('*').eq('id', communityId).single()),
      ])) as any
      setPayments(pay || []); setExpenses(exp || []); setResidents(res || []); setCats(bc || []); setCommunity(com || null)
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.reports.errorLoadData')); setStatus('error')
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

  // The lawful late fee on file for one household — the same figure baked into
  // residentBalance, surfaced on its own so the reminder can itemise it.
  const lateFeeOf = useCallback(
    (r: Resident) => adminLateFees(r as any, monthlyDues, paymentsByResident.get(r.id) || [], duesCfg),
    [monthlyDues, paymentsByResident, duesCfg],
  )

  // Record an offline (check/cash/ACH) payment against a household, then refetch
  // payments so the balance + who's-behind list update immediately. Reuses the
  // same record_offline_payment RPC the old Residents page called.
  const recordPayment = async (resident: Resident, { amount, method, paidOn, memo }: { amount: number; method: string; paidOn: string; memo: string }) => {
    if (!communityId) return { error: t('admin.reports.errNoCommunity') }
    const client_key = (globalThis.crypto?.randomUUID?.() || `${resident.id}:${paidOn}:${amount}`)
    const { error } = await supabase!.rpc('record_offline_payment', {
      p_community: communityId, p_resident: resident.id, p_amount: amount,
      p_method: method, p_paid_on: paidOn || null, p_memo: memo || null, p_client_key: client_key,
    })
    if (error) return { error: error.message }
    const { data } = await supabase!.from('payments')
      .select('id, amount, paid_on, created_at, resident_id, charge_type, method')
      .eq('community_id', communityId).order('paid_on', { ascending: false })
    setPayments((data as Payment[]) || [])
    setOpenPayId(null)
    return {}
  }

  // Parse an uploaded opening-balances CSV and match each row to a resident by
  // unit (then name); stage the matched updates + any unmatched rows for confirm.
  const onPickBalanceFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseRosterCsv(String(reader.result || '')).filter(r => typeof r.opening_balance === 'number')
      const byUnit = new Map(residents.filter(r => r.unit_number).map(r => [r.unit_number!.trim().toLowerCase(), r]))
      const byName = new Map(residents.map(r => [(r.full_name || '').trim().toLowerCase(), r]))
      const matched: { r: Resident; bal: number }[] = []
      const unmatched: string[] = []
      for (const row of rows) {
        const hit = (row.unit_number && byUnit.get(row.unit_number.trim().toLowerCase()))
          || byName.get((row.full_name || '').trim().toLowerCase())
        if (hit) matched.push({ r: hit, bal: row.opening_balance as number })
        else unmatched.push(row.unit_number || row.full_name || '?')
      }
      if (!matched.length && !unmatched.length) { setError(t('admin.reports.balNoRows')); return }
      setError(''); setPendingBal({ matched, unmatched })
    }
    reader.readAsText(file)
  }

  // Commit the staged opening balances: one update per matched resident, then refetch.
  const applyBalanceImport = async () => {
    if (!pendingBal) return
    setImportingBal(true); setError('')
    try {
      for (const { r, bal } of pendingBal.matched) {
        const { error } = await supabase!.from('residents').update({ opening_balance: bal }).eq('id', r.id)
        if (error) throw error
      }
      setPendingBal(null)
      await load()
    } catch (err: any) {
      setError(err?.message || t('admin.reports.balImportFailed'))
    } finally { setImportingBal(false) }
  }

  // Notify-to-pay — the everyday tool. Sends a TARGETED notice (in-app + email +
  // push, via the existing ev_notices fan-out) to one owner, itemising what they
  // owe and the lawful late fee. Requires the owner to have an activated account
  // (a profile to deliver to); the button is disabled otherwise.
  const sendReminder = async (resident: Resident, bal: number) => {
    if (!communityId || !resident.profile_id) return
    setRemindBusyId(resident.id); setRemindMsg('')
    try {
      const fee = lateFeeOf(resident)
      const subject = t('admin.reports.reminderSubject')
      const body = fee > 0
        ? t('admin.reports.reminderBodyFee', { balance: fmtMoney(bal), fee: fmtMoney(fee) })
        : t('admin.reports.reminderBody', { balance: fmtMoney(bal) })
      const { error } = await withTimeout(supabase!.from('ev_notices').insert({
        community_id: communityId,
        target_profile_id: resident.profile_id,
        // Reuse the existing 'dues_due' kind — already labelled "Dues due" and
        // deep-linked to the resident's pay screen (lib/voice.ts noticeHref).
        kind: 'dues_due',
        channels: ['in_app', 'email'],
        subject, body,
      }))
      if (error) throw error
      logAudit({ community_id: communityId, event_type: 'payment.reminder_sent', target_type: 'resident', target_id: resident.id, metadata: { balance: bal, fee } })
      setRemindMsg(t('admin.reports.reminderSent', { name: resident.full_name || t('admin.reports.residentFallback') }))
    } catch (e: any) {
      setRemindMsg(e?.message || t('admin.reports.reminderError'))
    } finally { setRemindBusyId(null) }
  }

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
      { label: t('admin.reports.bracketCurrent'), pill: 'ok' as const, hit: (b: number) => b <= 0 },
      { label: t('admin.reports.bracketLt500'), pill: 'warn' as const, hit: (b: number) => b > 0 && b < 500 },
      { label: t('admin.reports.bracket500to2k'), pill: 'due' as const, hit: (b: number) => b >= 500 && b < 2000 },
      { label: t('admin.reports.bracket2kPlus'), pill: 'due' as const, hit: (b: number) => b >= 2000 },
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
  const exportAssessments = () => {
    const cols: CsvColumn<MonthlyCharge>[] = [
      { label: 'Period', value: c => periodLabel(c.billing_period_start) },
      { label: 'Due date', value: c => c.due_date || '' },
      { label: 'Resident', value: c => c.residentName || '' },
      { label: 'Unit', value: c => c.residentUnit || '' },
      { label: 'Amount', value: c => (Number(c.amount) || 0).toFixed(2) },
      { label: 'Status', value: c => t(`admin.charges.status.${c.status}`) },
    ]
    downloadCsv(exportFilename('residente-monthly-assessments', todayISO()), assessments, cols)
  }

  // The board-facing report list. Each row fronts the real CSV exporters above;
  // QuickBooks variants ride along as a secondary action where one exists.
  const REPORTS: {
    name: string; period: string; count: number
    actions: { label: string; onClick: () => void; dim?: boolean }[]
  }[] = [
    {
      name: t('admin.reports.reportPaymentLedger'), period: rangeLabel, count: paysInRange.length,
      actions: [
        { label: t('admin.reports.exportCsvBtn'), onClick: exportPayments },
        { label: t('admin.reports.quickbooksBtn'), onClick: exportPaymentsQbo, dim: true },
      ],
    },
    {
      name: t('admin.reports.reportExpenseLedger'), period: rangeLabel, count: expInRange.length,
      actions: [
        { label: t('admin.reports.exportCsvBtn'), onClick: exportExpenses },
        { label: t('admin.reports.quickbooksBtn'), onClick: exportExpensesQbo, dim: true },
      ],
    },
    {
      name: t('admin.reports.reportHouseholdRoster'), period: t('admin.reports.periodFullRoster'), count: residents.length,
      actions: [
        { label: t('admin.reports.exportCsvBtn'), onClick: exportRoster },
        { label: t('admin.reports.importBalancesBtn'), onClick: () => balFileRef.current?.click() },
      ],
    },
  ]

  return (
    <div className="admin-page crep">
      <div className="admin-kicker">{t('admin.reports.kicker')}</div>
      <h1 className="admin-h1">{t('admin.reports.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.reports.pageDek')}
      </p>

      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.reports.statusNone')}</div>}
      {status === 'loading' && <div className="admin-note">{t('admin.reports.statusLoading')}</div>}
      {status === 'error' && (
        <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.reports.retryBtn')}</button></div>
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
                  <label className="admin-field"><span className="admin-field-label">{t('admin.reports.labelFrom')}</span>
                    <input className="admin-input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
                  <label className="admin-field"><span className="admin-field-label">{t('admin.reports.labelTo')}</span>
                    <input className="admin-input" type="date" value={to} min={from} max={todayISO()} onChange={e => setTo(e.target.value)} /></label>
                </>
              )}
            </div>
            <button type="button" className="admin-primary-btn" onClick={exportPayments} disabled={paysInRange.length === 0}>
              {t('admin.reports.exportCsvBtn')}
            </button>
          </div>

          {/* Stat tiles. */}
          <div className="stats">
            {[
              { v: fmt$(collected), l: t('admin.reports.statCollected'), k: 'collected' },
              { v: fmt$(outstanding), l: t('admin.reports.statOutstanding'), k: 'outstanding', c: 'var(--due)' },
              { v: fmt$(spent), l: t('admin.reports.statExpenses'), k: 'expenses' },
              { v: fmt$(collected - spent), l: t('admin.reports.statNet'), k: 'net', c: 'var(--ok)' },
            ].map(s => (
              <div key={s.k} className="stat">
                <div className="v" style={s.c ? { color: s.c } : undefined}>{s.v}</div>
                <div className="l">{s.l}</div>
              </div>
            ))}
          </div>

          {/* Hidden picker + confirm bar for the opening-balance import, triggered
              from the Household Roster row's "Import balances" action below. */}
          <input ref={balFileRef} type="file" accept=".csv,text/csv" onChange={onPickBalanceFile} style={{ display: 'none' }} />
          {pendingBal && (
            <div className="res-import-bar">
              <span>
                {t('admin.reports.balPreview', { count: String(pendingBal.matched.length), total: fmt$(pendingBal.matched.reduce((s, m) => s + m.bal, 0)) })}
                {pendingBal.unmatched.length > 0 && (
                  <span className="muted" style={{ marginLeft: 8 }}>{t('admin.reports.balUnmatched', { count: String(pendingBal.unmatched.length) })}</span>
                )}
              </span>
              <button type="button" className="admin-primary-btn" disabled={importingBal || !pendingBal.matched.length} onClick={applyBalanceImport}>
                {importingBal ? t('admin.reports.balApplying') : t('admin.reports.balApply', { count: String(pendingBal.matched.length) })}
              </button>
              <button type="button" className="admin-btn-ghost" onClick={() => setPendingBal(null)}>{t('admin.reports.balCancel')}</button>
            </div>
          )}

          {/* Available reports — the mock's table, wired to the real exporters. */}
          <div className="card">
            <div className="card-head">
              <div><h2>{t('admin.reports.availableReportsTitle')}</h2><div className="sub">{t('admin.reports.availableReportsSub')}</div></div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('admin.reports.colReport')}</th>
                  <th className="period-col">{t('admin.reports.colPeriod')}</th>
                  <th>{t('admin.reports.colRows')}</th>
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

          {/* Collections snapshot — owners by balance, bucketed. */}
          <div className="card">
            <div className="card-head">
              <div><h2>{t('admin.reports.collectionsSnapshotTitle')}</h2><div className="sub">{t('admin.reports.collectionsSnapshotSub')}</div></div>
            </div>
            {residents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--text-dim)', fontSize: 13.5 }}>
                {t('admin.reports.noHouseholdsCollections')}
              </div>
            ) : brackets.map((b, i) => {
              const isLast = i === brackets.length - 1
              return (
                <div className="lrow" key={b.label}>
                  <span className={`pill ${b.pill}`} style={{ width: 86, textAlign: 'center', flexShrink: 0, boxSizing: 'border-box' }}>{b.label}</span>
                  <div className="body">
                    <div className="ttl">{b.count} {b.count === 1 ? t('admin.reports.ownerSingular') : t('admin.reports.ownerPlural')}</div>
                    <div className="meta">{b.owed > 0 ? `${fmt$(b.owed)} ${t('admin.reports.onFile')}` : t('admin.reports.zeroBalance')}</div>
                  </div>
                  {isLast && b.count > 0
                    ? <Link href="/admin/collections" className="go" style={{ textDecoration: 'none' }}>{t('admin.reports.collectionsLink')}</Link>
                    : <span className="pct">{b.pct}%</span>}
                </div>
              )
            })}
          </div>

          {/* Who's behind — the named past-due list, at the end of the page. */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.reports.behindTitle')}</h2>
                <div className="sub">{delinquents.length === 1 ? t('admin.reports.behindSubSingular', { count: delinquents.length }) : t('admin.reports.behindSubPlural', { count: delinquents.length })}</div>
              </div>
            </div>
            {remindMsg && <div className="admin-success" role="status" style={{ margin: '0 0 12px' }}>{remindMsg}</div>}
            {delinquents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--text-dim)', fontSize: 13.5 }}>
                {residents.length === 0
                  ? t('admin.reports.noHouseholdsRoster')
                  : t('admin.reports.everyoneCurrent')}
              </div>
            ) : (() => {
              const BEHIND_PAGE_SIZE = isMobile ? 5 : BEHIND_SIZE
              const pageCount = Math.ceil(delinquents.length / BEHIND_PAGE_SIZE)
              const page = Math.min(behindPage, Math.max(0, pageCount - 1))
              const paged = delinquents.slice(page * BEHIND_PAGE_SIZE, (page + 1) * BEHIND_PAGE_SIZE)
              return (
              <>
              <table className="tbl behind-tbl">
                <thead>
                  <tr><th>{t('admin.reports.colOwner')}</th><th className="period-col">{t('admin.reports.colUnit')}</th><th>{t('admin.reports.colBalanceOwed')}</th><th className="act"></th></tr>
                </thead>
                <tbody>
                  {paged.map(({ r, bal }) => {
                    const fee = lateFeeOf(r)
                    return (
                    <Fragment key={r.id}>
                    <tr className="behind-row" style={{ cursor: 'pointer' }}
                      onClick={() => setRowDetail({ title: r.full_name || t('admin.reports.residentFallback'), rows: [
                        { label: t('admin.reports.colOwner'), value: r.full_name || t('admin.reports.residentFallback') },
                        { label: t('admin.reports.colUnit'), value: r.unit_number || r.address || '—' },
                        { label: t('admin.reports.colBalanceOwed'), value: fmt$(bal) },
                      ] })}>
                      <td className="strong">{r.full_name || t('admin.reports.residentFallback')}</td>
                      <td className="muted period-col">
                    <span title={r.unit_number || r.address || ''}
                      style={{ display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                      {r.unit_number || r.address || '—'}
                    </span>
                  </td>
                      <td className="due">
                        {fmt$(bal)}
                        {fee > 0 && <span className="behind-fee">{t('admin.reports.inclLateFee', { fee: fmtMoney(fee) })}</span>}
                      </td>
                      <td className="act">
                        {/* Inner flex wrapper — NOT the <td> itself, so the cell
                            stays display:table-cell and the columns don't collapse. */}
                        <div className="behind-act">
                          {/* Notify = the everyday hero. Needs an activated owner to deliver to. */}
                          <button type="button" className="admin-primary-btn behind-notify"
                            disabled={remindBusyId === r.id || !r.profile_id}
                            title={!r.profile_id ? t('admin.reports.notifyNeedsAccount') : t('admin.reports.notifyTitle')}
                            onClick={(e) => { e.stopPropagation(); sendReminder(r, bal) }}>
                            {remindBusyId === r.id ? t('admin.reports.notifySending') : t('admin.reports.notifyBtn')}
                          </button>
                          <button type="button" className="go" onClick={(e) => { e.stopPropagation(); setOpenPayId(id => id === r.id ? null : r.id) }}>
                            {openPayId === r.id ? t('admin.reports.recordClose') : t('admin.reports.recordPaymentBtn')}
                          </button>
                          {/* Collect = last resort: escalate to a collections case. */}
                          <Link href={`/admin/collections?resident=${r.id}&from=reports`} className="go dim" style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>{t('admin.reports.collectLink')}</Link>
                        </div>
                      </td>
                    </tr>
                    {openPayId === r.id && (
                      <tr className="behind-payrow">
                        <td colSpan={4}>
                          <div className="behind-payform">
                            <span className="admin-field-label" style={{ display: 'block', marginBottom: 8 }}>
                              {t('admin.reports.recordPaymentLabel', { name: r.full_name || t('admin.reports.residentFallback') })}
                            </span>
                            <RecordPaymentForm onSubmit={v => recordPayment(r, v)} />
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )})}
                </tbody>
              </table>
              <Pager page={page} pageCount={pageCount} onPage={setBehindPage}
                right={(
                  <button type="button" className="admin-btn-sm pager-export" onClick={exportDelinquents}>
                    {t('admin.reports.exportCsvBtn')}
                  </button>
                )} />
              </>
              )
            })()}
          </div>

          {/* Monthly assessments — the auto-generated dues obligations ledger
              (the cron-minted assessments), distinct from the payments received
              above. Read-only audit view, sourced from useMonthlyCharges. */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.charges.pageTitle')}</h2>
                <div className="sub">{t('admin.reports.assessmentsSub')}</div>
                {assessments.length > 0 && (
                  <div className="sub" style={{ display: 'block', color: '#E14909', fontWeight: 700, marginTop: 3 }}>
                    {t('admin.charges.tableSub', { count: assessments.length, total: fmtMoney(assessmentsTotal) })}
                  </div>
                )}
              </div>
            </div>
            {assessmentsLoading ? (
              <div style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--text-dim)', fontSize: 13.5 }}>
                {t('admin.charges.loading')}
              </div>
            ) : assessmentsError ? (
              <div className="admin-note admin-note-err">
                {t('admin.charges.loadError')}
                <button type="button" className="admin-btn-ghost" onClick={reloadAssessments}>{t('admin.charges.retry')}</button>
              </div>
            ) : assessments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--text-dim)', fontSize: 13.5 }}>
                {t('admin.charges.empty')}
              </div>
            ) : (() => {
              const ASSESS_SIZE = isMobile ? 5 : BEHIND_SIZE
              const pageCount = Math.ceil(assessments.length / ASSESS_SIZE)
              const page = Math.min(assessmentsPage, Math.max(0, pageCount - 1))
              const paged = assessments.slice(page * ASSESS_SIZE, (page + 1) * ASSESS_SIZE)
              return (
              <>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t('admin.charges.colPeriod')}</th>
                    <th className="period-col">{t('admin.charges.colDue')}</th>
                    <th>{t('admin.charges.colResident')}</th>
                    <th>{t('admin.charges.colAmount')}</th>
                    <th>{t('admin.charges.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(c => (
                    <tr key={c.id} style={{ cursor: 'pointer' }}
                      onClick={() => setRowDetail({ title: c.residentName || t('admin.charges.unknownResident'), rows: [
                        { label: t('admin.charges.colPeriod'), value: periodLabel(c.billing_period_start) },
                        { label: t('admin.charges.colDue'), value: dateLabel(c.due_date) },
                        { label: t('admin.charges.colResident'), value: (c.residentName || t('admin.charges.unknownResident')) + (c.residentUnit ? ' · ' + c.residentUnit : '') },
                        { label: t('admin.charges.colAmount'), value: fmtMoney(c.amount) },
                        { label: t('admin.charges.colStatus'), value: t(`admin.charges.status.${c.status}`) },
                      ] })}>
                      <td className="strong">{periodLabel(c.billing_period_start)}</td>
                      <td className="muted period-col">{dateLabel(c.due_date)}</td>
                      <td>
                        <span title={`${c.residentName || ''}${c.residentUnit ? ' · ' + c.residentUnit : ''}`.trim()}
                          style={{ display: 'inline-block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                          {c.residentName || t('admin.charges.unknownResident')}
                          {c.residentUnit ? <span className="muted"> · {c.residentUnit}</span> : null}
                        </span>
                      </td>
                      <td className="strong">{fmtMoney(c.amount)}</td>
                      <td><span className={`pill ${ASSESSMENT_PILL[c.status] || 'due'}`}>{t(`admin.charges.status.${c.status}`)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={page} pageCount={pageCount} onPage={setAssessmentsPage}
                right={(
                  <button type="button" className="admin-btn-sm pager-export" onClick={exportAssessments}>
                    {t('admin.reports.exportCsvBtn')}
                  </button>
                )} />
              </>
              )
            })()}
          </div>

          <p className="note">
            {t('admin.reports.quickbooksNote')}
          </p>
        </>
      )}

      {rowDetail && (
        <div onClick={() => setRowDetail(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,30,0.45)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', width: '100%', maxWidth: 480, borderRadius: isMobile ? '16px 16px 0 0' : 16, padding: '18px 20px 28px', boxShadow: isMobile ? '0 -8px 40px rgba(0,0,0,0.18)' : '0 12px 48px rgba(0,0,0,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#0A2440' }}>{rowDetail.title}</div>
              <button type="button" onClick={() => setRowDetail(null)} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 20, lineHeight: 1, color: '#6b6f7d', cursor: 'pointer', padding: 4 }}>✕</button>
            </div>
            {rowDetail.rows.map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '10px 0', borderTop: i ? '1px solid rgba(10,36,64,0.07)' : 'none' }}>
                <span style={{ color: '#6b6f7d', fontSize: 13, flexShrink: 0 }}>{row.label}</span>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: '#0A2440', textAlign: 'right', wordBreak: 'break-word' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
