'use client'

// Estoppel certificate — print-ready HTML (Save as PDF). Assembles the
// statutory content categories of FS 718.116(8) / 720.30851 from the request +
// community profile. The financial block draws on the current dues model; the
// per-installment payoff itemisation is finalised once the collections ledger
// (compliance domain F) lands — fields the board must confirm are clearly
// marked. ⚠ Certificate language requires attorney review before issuance.

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'
import { fmtMoney } from '@/lib/dues'
import { ymd } from '@/lib/compliance/rules-core'
import { estoppelFee, ESTOPPEL_CPI_NEXT_ADJUST } from '@/lib/compliance/estoppel'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export default function EstoppelCertificate() {
  const params = useParams()
  const id = params?.id as string
  const [req, setReq] = useState<any>(null)
  const [community, setCommunity] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No request'); return }
      try {
        const { data: r, error: rErr } = (await withTimeout(
          supabase.from('ev_estoppel_requests').select('*').eq('id', id).single(),
        )) as any
        if (rErr) throw rErr
        const { data: c } = (await withTimeout(
          supabase.from('communities').select('*').eq('id', r.community_id).single(),
        )) as any
        if (cancelled) return
        setReq(r); setCommunity(c || null); setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (status === 'loading') return <div style={{ padding: 40 }}>Loading…</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const isCondo = community?.association_type !== 'hoa'
  const cite = isCondo ? 'FS 718.116(8)' : 'FS 720.30851'
  const fee = req.fee_waived ? 0 : (req.fee_total ?? estoppelFee({ expedited: !!req.expedited, delinquent: !!req.delinquent }).total)
  const monthly = Number(community?.monthly_dues) || 0
  const issued = ymd(new Date())

  const Row = ({ label, value }: { label: string; value: any }) => (
    <tr>
      <td style={{ padding: '7px 10px', fontWeight: 600, width: '42%', verticalAlign: 'top', borderBottom: '1px solid #eee' }}>{label}</td>
      <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee' }}>{value ?? '—'}</td>
    </tr>
  )

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111' }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 520 }}>
          ⚠ Draft — attorney review required before issuance. Confirm the financial figures and all amounts owed before delivering.
        </div>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}>
          Print / Save as PDF
        </button>
      </div>

      <h1 style={{ fontSize: 22, textAlign: 'center', marginBottom: 2 }}>Estoppel Certificate</h1>
      <div style={{ textAlign: 'center', fontSize: 12.5, color: '#555', marginBottom: 18 }}>
        Issued under {cite} · {community?.name || 'Association'}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          <Row label="Date of issuance" value={issued} />
          <Row label="Association" value={community?.name} />
          <Row label="Association address" value={community?.association_address || <em style={{ color: '#B54708' }}>set in Community settings</em>} />
          <Row label="Unit / parcel" value={req.unit_label} />
          <Row label="Owner of record" value={req.unit_label} />
          <Row label="Parking / garage space(s)" value={<em style={{ color: '#888' }}>confirm</em>} />
          <Row label="Requested by" value={`${req.requestor_name || '—'}${req.requestor_type ? ` (${String(req.requestor_type).replace(/_/g, ' ')})` : ''}`} />
          <Row label="Certificate fee" value={req.fee_waived ? `${fmtMoney(0)} (waived — late delivery)` : fmtMoney(fee)} />
          <Row label="Effective through" value={req.effective_until || <em style={{ color: '#888' }}>set on delivery</em>} />
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 22, marginBottom: 6 }}>Assessment information</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          <Row label="Regular periodic assessment" value={`${fmtMoney(monthly)} / month`} />
          <Row label="Paid through date" value={<em style={{ color: '#888' }}>confirm from ledger</em>} />
          <Row label="Next assessment due (date / amount)" value={<em style={{ color: '#888' }}>confirm</em>} />
          <Row label="Delinquent assessments owed" value={req.delinquent ? <em style={{ color: '#B54708' }}>itemise from ledger</em> : fmtMoney(0)} />
          <Row label="Interest / late fees owed" value={<em style={{ color: '#888' }}>itemise from ledger</em>} />
          <Row label="Special assessments" value={<em style={{ color: '#888' }}>None / confirm</em>} />
          <Row label="Capital contribution / transfer fee" value={<em style={{ color: '#888' }}>None / confirm</em>} />
          <Row label="Open violations" value={<em style={{ color: '#888' }}>None / confirm</em>} />
          <Row label="Transfer approval / right of first refusal" value={<em style={{ color: '#888' }}>confirm</em>} />
          {req.delinquent && <Row label="Collection attorney contact" value={<em style={{ color: '#B54708' }}>provide if delinquent</em>} />}
        </tbody>
      </table>

      <p style={{ fontSize: 12, color: '#555', marginTop: 18, lineHeight: 1.5 }}>
        This certificate is valid for 30 days from the date of delivery if hand-delivered or sent electronically, or
        35 days if sent by mail ({cite}). The association is bound by the figures stated for that period. The maximum
        statutory fee is subject to DBPR cost-of-living adjustment (next adjustment {ESTOPPEL_CPI_NEXT_ADJUST}).
      </p>

      <div style={{ marginTop: 36, fontSize: 14 }}>
        <div style={{ borderTop: '1px solid #111', width: 280, paddingTop: 6 }}>
          {community?.association_officer_name || 'Authorized officer / agent'}
        </div>
      </div>
    </div>
  )
}
