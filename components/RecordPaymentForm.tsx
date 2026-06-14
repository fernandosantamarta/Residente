'use client'

// Shared "Record an offline payment" form (check / cash / money order / bill-pay).
// Presentational + self-contained: the parent supplies onSubmit, which posts to
// the record_offline_payment RPC (community + resident come from the parent's
// context). DUES payments only — fines are collected via the violation's
// 'manual-paid' path, not here. See supabase/offline-payments.sql.

import { useState } from 'react'
import { fmtMoney } from '@/lib/dues'
import { Dropdown } from '@/components/Dropdown'

export type RecordPaymentValues = {
  amount: number
  method: string
  paidOn: string
  memo: string
}

// Offline + ACH methods, matching the payments_method_check enum (card is a
// Stripe-side tag, so it's not offered here).
const METHODS: Array<{ value: string; label: string }> = [
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'money_order', label: 'Money order' },
  { value: 'ach', label: 'Bank transfer (ACH)' },
  { value: 'bill_pay', label: 'Bank bill-pay' },
  { value: 'other', label: 'Other' },
]

// today in the browser's local date as YYYY-MM-DD, for the date input default.
const todayISO = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function RecordPaymentForm({ onSubmit }: {
  onSubmit: (v: RecordPaymentValues) => Promise<{ error?: string } | void>
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [paidOn, setPaidOn] = useState(todayISO())
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  const submit = async () => {
    const amt = Math.round((Number(amount) || 0) * 100) / 100
    if (amt <= 0) { setOk(false); setMsg('Enter a positive amount'); return }
    setBusy(true); setMsg('')
    const res = await onSubmit({ amount: amt, method, paidOn, memo: memo.trim() })
    setBusy(false)
    if (res && res.error) { setOk(false); setMsg(res.error); return }
    setOk(true); setMsg(`Recorded ${fmtMoney(amt)} ✓`)
    setAmount(''); setMemo('')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label className="admin-field" style={{ flex: '0 0 120px' }}>
          <span className="admin-field-label">Amount ($)</span>
          <input className="admin-input" type="number" min="0" step="0.01" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <div className="admin-field" style={{ flex: '0 0 175px' }}>
          <span className="admin-field-label">Method</span>
          <Dropdown<string>
            value={method}
            onChange={v => setMethod(v)}
            ariaLabel="Method"
            options={METHODS.map(m => ({ value: m.value, label: m.label }))}
          />
        </div>
        <label className="admin-field" style={{ flex: '0 0 160px' }}>
          <span className="admin-field-label">Date received</span>
          <input className="admin-input" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
        </label>
      </div>
      <label className="admin-field" style={{ marginTop: 8 }}>
        <span className="admin-field-label">Memo (check #, note) — optional</span>
        <input className="admin-input" placeholder="e.g. Check #1042" value={memo} onChange={e => setMemo(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
        <button type="button" className="admin-btn-sm" disabled={busy} onClick={submit}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
        {msg && (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: ok ? '#1a7f37' : '#b42318' }}>{msg}</span>
        )}
      </div>
    </div>
  )
}
