'use client'

// Estoppel certificate — print-ready HTML (Save as PDF). Assembles the
// statutory content categories of FS 718.116(8) / 720.30851 from the request +
// community profile. The financial block draws the amounts-owed itemisation
// from the collections ledger (compliance domain F, casePayoff) when the
// request is linked to a resident; genuinely non-derivable fields (special
// assessments, violations, transfer approval) stay marked for board confirm.
// ⚠ Certificate language + figures require attorney review before issuance.

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'
import { fmtMoney, casePayoff, type PayoffResult } from '@/lib/dues'
import { ymd } from '@/lib/compliance/rules-core'
import { estoppelFee, ESTOPPEL_CPI_NEXT_ADJUST } from '@/lib/compliance/estoppel'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export default function EstoppelCertificate() {
  const t = useT()
  const params = useParams()
  const id = params?.id as string
  const [req, setReq] = useState<any>(null)
  const [community, setCommunity] = useState<any>(null)
  const [resident, setResident] = useState<any>(null)
  const [payoff, setPayoff] = useState<PayoffResult | null>(null)
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

        // Pull the statutory amounts-owed itemisation from the collections
        // ledger when the request is linked to a resident.
        let res: any = null
        let pays: any[] = []
        let extraCosts = 0
        if (r.resident_id) {
          const { data: rr } = (await withTimeout(
            supabase.from('residents').select('*').eq('id', r.resident_id).single(),
          )) as any
          res = rr || null
          const { data: p } = (await withTimeout(
            supabase.from('payments').select('amount, created_at').eq('resident_id', r.resident_id),
          )) as any
          pays = p || []
          // Recorded collection / attorney costs from an open case, if any.
          // Guarded so the cert still renders if the collections tables are absent.
          try {
            const { data: cs } = (await withTimeout(
              supabase.from('ev_collection_cases').select('cost_balance')
                .eq('resident_id', r.resident_id).order('opened_at', { ascending: false }).limit(1),
            )) as any
            extraCosts = Number(cs?.[0]?.cost_balance) || 0
          } catch { /* collections not provisioned — leave costs at 0 */ }
        }

        if (cancelled) return
        setReq(r); setCommunity(c || null); setResident(res)
        if (res) {
          try { setPayoff(casePayoff(res, c, pays, { extraCosts })) } catch { setPayoff(null) }
        }
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.estoppelDetailCertificate.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const isCondo = community?.association_type !== 'hoa'
  const cite = isCondo ? 'FS 718.116(8)' : 'FS 720.30851'
  const fee = req.fee_waived ? 0 : (req.fee_total ?? estoppelFee({ expedited: !!req.expedited, delinquent: !!req.delinquent }).total)
  const monthly = Number(community?.monthly_dues) || 0
  const issued = ymd(new Date())

  // Amounts owed, drawn from the collections ledger when the request is linked
  // to a resident. `remaining` is the unpaid balance by statutory bucket.
  const owed = payoff?.remaining ?? null
  const totalDue = payoff?.payoff ?? null
  // Paid-through = due date of the most recent installment whose principal the
  // applied payments fully cover (statutory application order: interest → fees →
  // costs → principal, so principal is paid last). Null when nothing is covered.
  const paidThrough = (() => {
    if (!payoff) return null
    let acc = 0
    let last: string | null = null
    for (const l of payoff.lines) {
      acc = Math.round((acc + l.principal) * 100) / 100
      if (acc <= payoff.applied.principal + 0.005) last = l.dueDate
      else break
    }
    return last
  })()
  const Em = ({ children }: { children: React.ReactNode }) => <em style={{ color: '#888' }}>{children}</em>
  const Confirm = () => <em style={{ color: '#B54708' }}>confirm from ledger</em>

  const Row = ({ label, value }: { label: string; value: any }) => (
    <tr>
      <td style={{ padding: '7px 10px', fontWeight: 600, width: '42%', verticalAlign: 'top', borderBottom: '1px solid #eee' }}>{label}</td>
      <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee' }}>{value ?? '—'}</td>
    </tr>
  )

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111' }}>
      <style>{`
        @media print { .no-print { display: none !important; } body { margin: 0 } }
        @media (max-width: 640px) {
          .rp-toolbar { flex-direction: column; align-items: stretch !important; }
          .rp-actions { margin-left: 0 !important; }
          .rp-actions button { flex: 1 1 0; }
        }
      `}</style>

      <div className="no-print rp-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540, lineHeight: 1.45 }}>
          {t('admin.estoppelDetailCertificate.draftWarning')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.estoppelDetailCertificate.printButton')}</button>
        </div>
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
          <Row label="Paid through date" value={paidThrough || <Confirm />} />
          <Row
            label="Next assessment due (date / amount)"
            value={monthly > 0 ? <span>{fmtMoney(monthly)} · <Em>date — confirm</Em></span> : <Confirm />}
          />
          <Row
            label="Delinquent assessments owed"
            value={owed ? fmtMoney(owed.principal) : (req.delinquent ? <Confirm /> : fmtMoney(0))}
          />
          <Row
            label="Interest owed"
            value={owed ? fmtMoney(owed.interest) : <Confirm />}
          />
          <Row
            label="Late fees owed"
            value={owed ? fmtMoney(owed.lateFee) : <Confirm />}
          />
          {owed && owed.cost > 0 && (
            <Row label="Collection / attorney costs owed" value={fmtMoney(owed.cost)} />
          )}
          <Row
            label={`Total amount due${payoff ? ` as of ${payoff.asOf}` : ''}`}
            value={totalDue != null
              ? <strong>{fmtMoney(totalDue)}</strong>
              : <Confirm />}
          />
          <Row label="Special assessments" value={<Em>None / confirm</Em>} />
          <Row label="Capital contribution / transfer fee" value={<Em>None / confirm</Em>} />
          <Row label="Open violations" value={<Em>None / confirm</Em>} />
          <Row label="Transfer approval / right of first refusal" value={<Em>confirm</Em>} />
          {(owed ? totalDue! > 0.005 : req.delinquent) && (
            <Row label="Collection attorney contact" value={<em style={{ color: '#B54708' }}>provide if delinquent</em>} />
          )}
        </tbody>
      </table>
      {payoff && (
        <p style={{ fontSize: 11.5, color: '#888', marginTop: 6, lineHeight: 1.5 }}>
          Amounts owed are itemised from the association&apos;s dues ledger as of {payoff.asOf} (simple
          interest accruing daily, payments applied interest → late fees → costs → principal). Confirm
          against your records and add any special assessments, fines, or transfer fees before delivery.
        </p>
      )}

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
