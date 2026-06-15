'use client'

// Public, login-free CPA package view (behind a share token).
//
// An outside accountant opens /cpa/<token>; this page fetches the aggregate
// bundle from /api/cpa-share (which validates the token + audits the open) and
// renders it read-only, print-styled. No auth, no PII — aggregate trial balance +
// financial position only. English (the viewer is an external CPA with no app
// locale). See app/api/cpa-share/route.ts + supabase/cpa-share.sql.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
const totTd: React.CSSProperties = { ...td, fontWeight: 800, borderTop: '2px solid #111' }
const totTdR: React.CSSProperties = { ...totTd, textAlign: 'right' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
const h3: React.CSSProperties = { fontSize: 14.5, marginTop: 18, marginBottom: 4 }

export default function CpaSharePage() {
  const params = useParams()
  const token = String((params as any)?.token || '')
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/cpa-share?token=${encodeURIComponent(token)}`)
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) { setError(body?.error || 'This link is not valid.'); setStatus('error'); return }
        setData(body); setStatus('ready')
      } catch {
        if (!cancelled) { setError('Could not load this package.'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (status === 'loading') return <div style={{ padding: 40, fontFamily: 'Georgia, serif' }}>Loading…</div>
  if (status === 'error') return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111' }}>
      <h1 style={{ fontSize: 18 }}>CPA package unavailable</h1>
      <p style={{ color: '#B42318' }}>{error}</p>
      <p style={{ fontSize: 13, color: '#555' }}>Ask the association to send you a fresh link.</p>
    </div>
  )

  const tbTotals = (data.trial_balance || []).reduce(
    (a: any, r: any) => ({ debit: a.debit + (Number(r.debit) || 0), credit: a.credit + (Number(r.credit) || 0) }),
    { debit: 0, credit: 0 },
  )

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`@media print { .no-print { display: none !important } body { margin: 0 } }`}</style>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}>Print / Save as PDF</button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{data.community_name}</div>
      </div>
      <h1 style={{ fontSize: 19, marginBottom: 4 }}>CPA Handoff Package</h1>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 8 }}>
        {data.fiscal_year ? `Fiscal year ${data.fiscal_year} · ` : ''}Accrual basis, by fund · aggregate figures (no owner detail)
      </div>

      <h3 style={h3}>Trial balance (by fund)</h3>
      <table style={tbl}><thead><tr>
        <th style={th}>Account</th><th style={th}>Fund</th><th style={thR}>Debit</th><th style={thR}>Credit</th>
      </tr></thead><tbody>
        {(data.trial_balance || []).map((r: any, i: number) => (
          <tr key={i}><td style={td}>{r.code} · {r.name}</td><td style={td}>{r.fund}</td><td style={tdR}>{fmt$(r.debit)}</td><td style={tdR}>{fmt$(r.credit)}</td></tr>
        ))}
        {(data.trial_balance || []).length === 0 && <tr><td style={td} colSpan={4}>No ledger entries.</td></tr>}
        <tr><td style={totTd}>Total</td><td style={totTd}></td><td style={totTdR}>{fmt$(tbTotals.debit)}</td><td style={totTdR}>{fmt$(tbTotals.credit)}</td></tr>
      </tbody></table>

      <h3 style={h3}>Financial position summary</h3>
      <table style={tbl}><tbody>
        <tr><td style={td}>Operating fund assets</td><td style={tdR}>{fmt$(data.position?.operatingAssets)}</td></tr>
        <tr><td style={td}>Reserve fund assets</td><td style={tdR}>{fmt$(data.position?.reserveAssets)}</td></tr>
        <tr><td style={td}>Revenue (accrual)</td><td style={tdR}>{fmt$(data.position?.revenue)}</td></tr>
        <tr><td style={td}>Expenses (accrual)</td><td style={tdR}>{fmt$(data.position?.expense)}</td></tr>
        <tr><td style={totTd}>Net surplus / (deficit)</td><td style={{ ...totTdR, color: (data.position?.net || 0) < 0 ? '#B42318' : '#067647' }}>{fmt$(data.position?.net)}</td></tr>
      </tbody></table>

      <p style={{ fontSize: 12, color: '#555', marginTop: 16 }}>
        Shared read-only by the association from Residente. Aggregate figures by fund; no owner names or units.
        This link is time-limited and may be revoked by the association.
      </p>
    </div>
  )
}
