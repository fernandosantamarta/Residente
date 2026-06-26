'use client'

// 1099-NEC worksheet — the year-end vendor-payment summary a board hands to its
// CPA. NOT a fileable IRS form: it totals each vendor's PAID disbursements for a
// tax year (from the dual-control AP spine in supabase/disbursements.sql), joins
// the W-9 status from vendor_payout_methods, and flags vendors at/over the $600
// 1099-NEC threshold that are missing a W-9. Print-ready (Save as PDF) using the
// app's client-print convention. Advisory only — the CPA decides who is filed
// (corporations are generally exempt; this can't know entity type).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { Dropdown } from '@/components/Dropdown'
import { useT } from '@/lib/i18n'

const REPORT_THRESHOLD = 600 // 1099-NEC reporting floor (US dollars)
const fmtMoney = (n: number) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Bill = { id: string; vendor_id: string | null; payee_name: string | null }
type Disb = { id: string; bill_id: string; amount: number; status: string; paid_on: string | null }
type Payout = { vendor_id: string; w9_on_file: boolean; w9_tin_last4: string | null; remit_to_name: string | null; remit_to_address: string | null }

type VendorRow = {
  key: string
  vendorId: string | null
  name: string
  total: number
  count: number
  w9: boolean
  tin4: string | null
  remitName: string | null
  remitAddr: string | null
  reportable: boolean
  missingW9: boolean
}

export default function Vendor1099WorksheetPage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const { canAny, loading: permLoading } = usePermissions()
  const canView = canAny(['financials.view'])

  const [community, setCommunity] = useState<any>(null)
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [disbs, setDisbs] = useState<Disb[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [year, setYear] = useState<number>(() => new Date().getFullYear())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !supabase || !communityId) { setStatus('none'); return }
      setStatus('loading'); setError('')
      try {
        const [c, v, p, b, d] = await Promise.all([
          supabase.from('communities').select('name').eq('id', communityId).single(),
          supabase.from('vendors').select('id, name').eq('community_id', communityId),
          supabase.from('vendor_payout_methods').select('vendor_id, w9_on_file, w9_tin_last4, remit_to_name, remit_to_address').eq('community_id', communityId),
          supabase.from('vendor_bills').select('id, vendor_id, payee_name').eq('community_id', communityId),
          supabase.from('disbursements').select('id, bill_id, amount, status, paid_on').eq('community_id', communityId).eq('status', 'paid'),
        ])
        if (cancelled) return
        if (d.error) throw d.error
        setCommunity(c.data || null)
        setVendors((v.data as any) || [])
        setPayouts((p.data as any) || [])
        setBills((b.data as any) || [])
        setDisbs((d.data as any) || [])
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || t('admin.p1099.errLoad')); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId])

  // Years that actually have paid activity (+ the current year), newest first.
  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()])
    for (const d of disbs) { const y = d.paid_on ? Number(d.paid_on.slice(0, 4)) : NaN; if (Number.isFinite(y)) set.add(y) }
    return Array.from(set).sort((a, b) => b - a)
  }, [disbs])

  const rows = useMemo<VendorRow[]>(() => {
    const billMap = new Map(bills.map(b => [b.id, b]))
    const vendorName = new Map(vendors.map(v => [v.id, v.name]))
    const payoutMap = new Map(payouts.map(p => [p.vendor_id, p]))
    const acc = new Map<string, VendorRow>()
    for (const d of disbs) {
      if (!d.paid_on || Number(d.paid_on.slice(0, 4)) !== year) continue
      const bill = billMap.get(d.bill_id)
      const vendorId = bill?.vendor_id || null
      const payee = bill?.payee_name || null
      const key = vendorId ? `v:${vendorId}` : `p:${(payee || 'unknown').toLowerCase()}`
      const name = vendorId ? (vendorName.get(vendorId) || t('admin.p1099.unknownVendor')) : (payee || t('admin.p1099.unknownVendor'))
      const po = vendorId ? payoutMap.get(vendorId) : undefined
      const existing = acc.get(key)
      if (existing) {
        existing.total += Number(d.amount || 0); existing.count += 1
      } else {
        acc.set(key, {
          key, vendorId, name,
          total: Number(d.amount || 0), count: 1,
          w9: !!po?.w9_on_file, tin4: po?.w9_tin_last4 || null,
          remitName: po?.remit_to_name || null, remitAddr: po?.remit_to_address || null,
          reportable: false, missingW9: false,
        })
      }
    }
    const list = Array.from(acc.values())
    for (const r of list) { r.reportable = r.total >= REPORT_THRESHOLD; r.missingW9 = r.reportable && !r.w9 }
    return list.sort((a, b) => b.total - a.total)
  }, [disbs, bills, vendors, payouts, year, t])

  const summary = useMemo(() => {
    const reportable = rows.filter(r => r.reportable)
    return {
      vendorsPaid: rows.length,
      reportableCount: reportable.length,
      reportableTotal: reportable.reduce((s, r) => s + r.total, 0),
      missingW9: reportable.filter(r => r.missingW9).length,
    }
  }, [rows])

  if (!permLoading && !canView) {
    return (
      <div className="admin-page cset">
        <h1 className="admin-h1">{t('admin.p1099.pageTitle')}</h1>
        <div className="admin-note admin-note-warn">{t('admin.payables.noAccess')}</div>
      </div>
    )
  }

  return (
    <div className="wk-page">
      <style>{`
        .wk-page { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d1c1a; }
        .wk-bar { max-width: 880px; margin: 0 auto; padding: 4px 8px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .wk-bar .spacer { flex: 1; }
        .wk-print { border: 1px solid #1d1c1a; background: #1d1c1a; color: #fff; font: inherit; font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 9px; cursor: pointer; }
        .wk-yearwrap { min-width: 130px; }
        .wk-doc { max-width: 880px; margin: 0 auto 48px; background: #fff; border: 1px solid #e7e4dd; border-radius: 12px; padding: 40px 44px; }
        .wk-cover { border-bottom: 2px solid #1d1c1a; padding-bottom: 18px; margin-bottom: 22px; }
        .wk-comm { font-size: 21px; font-weight: 700; }
        .wk-kind { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #6b675f; margin-top: 6px; }
        .wk-year { font-size: 15px; font-weight: 600; margin-top: 8px; }
        .wk-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 22px; }
        .wk-stat { border: 1px solid #ece9e2; border-radius: 10px; padding: 11px 13px; }
        .wk-stat .l { font-size: 10.5px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: #837f76; }
        .wk-stat .v { font-size: 21px; font-weight: 800; margin-top: 3px; }
        table.wk-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.wk-tbl th { text-align: left; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: #6b675f; border-bottom: 1.5px solid #1d1c1a; padding: 0 8px 7px; }
        table.wk-tbl th.num, table.wk-tbl td.num { text-align: right; }
        table.wk-tbl td { padding: 9px 8px; border-bottom: 1px solid #efece5; vertical-align: top; }
        .wk-vname { font-weight: 600; }
        .wk-sub { font-size: 11.5px; color: #837f76; margin-top: 2px; }
        .wk-tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
        .wk-tag.yes { background: rgba(6,118,71,0.12); color: #067647; }
        .wk-tag.no { background: rgba(0,0,0,0.06); color: #837f76; }
        .wk-tag.w9ok { background: rgba(6,118,71,0.12); color: #067647; }
        .wk-tag.w9miss { background: rgba(180,35,24,0.12); color: #B42318; }
        .wk-empty { font-size: 13px; color: #98908a; padding: 22px 0; }
        .wk-note { font-size: 11.5px; color: #837f76; line-height: 1.6; margin-top: 22px; border-top: 1px solid #efece5; padding-top: 14px; }
        .wk-flag { color: #B42318; font-weight: 600; }
        @media print {
          .admin-top, .admin-nav, .admin-nav-measure { display: none !important; }
          .admin-main { padding: 0 !important; }
          body { background: #fff; }
          .wk-bar { display: none; }
          .wk-doc { border: none; border-radius: 0; margin: 0; max-width: none; padding: 0; }
          table.wk-tbl { font-size: 11.5px; }
          tr { break-inside: avoid; }
        }
      `}</style>

      <div className="wk-bar">
        <Link href="/admin/payables" className="admin-btn-ghost admin-btn-sm">← {t('admin.p1099.back')}</Link>
        <div className="spacer" />
        <div className="wk-yearwrap">
          <Dropdown<string>
            value={String(year)}
            onChange={v => setYear(Number(v))}
            ariaLabel={t('admin.p1099.yearLabel')}
            options={years.map(y => ({ value: String(y), label: String(y) }))}
          />
        </div>
        <button type="button" className="wk-print" onClick={() => window.print()}>{t('admin.p1099.printSave')}</button>
      </div>

      <div className="wk-doc">
        <div className="wk-cover">
          <div className="wk-comm">{community?.name || t('admin.payables.payeeUnknown')}</div>
          <div className="wk-kind">{t('admin.p1099.docKind')}</div>
          <div className="wk-year">{t('admin.p1099.taxYear', { year: String(year) })}</div>
        </div>

        {status === 'loading' && <div className="wk-empty">{t('admin.payables.loading')}</div>}
        {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.payables.noCommunity')}</div>}
        {status === 'error' && <div className="admin-note admin-note-err">{error}</div>}

        {status === 'ready' && (
          <>
            <div className="wk-stats">
              <div className="wk-stat"><div className="l">{t('admin.p1099.statVendors')}</div><div className="v">{summary.vendorsPaid}</div></div>
              <div className="wk-stat"><div className="l">{t('admin.p1099.statReportable')}</div><div className="v">{summary.reportableCount}</div></div>
              <div className="wk-stat"><div className="l">{t('admin.p1099.statReportableTotal')}</div><div className="v">{fmtMoney(summary.reportableTotal)}</div></div>
              <div className="wk-stat"><div className="l">{t('admin.p1099.statMissingW9')}</div><div className="v" style={{ color: summary.missingW9 > 0 ? '#B42318' : 'inherit' }}>{summary.missingW9}</div></div>
            </div>

            {rows.length === 0 ? (
              <div className="wk-empty">{t('admin.p1099.empty', { year: String(year) })}</div>
            ) : (
              <table className="wk-tbl">
                <thead>
                  <tr>
                    <th>{t('admin.p1099.colVendor')}</th>
                    <th>{t('admin.p1099.colW9')}</th>
                    <th className="num">{t('admin.p1099.colPayments')}</th>
                    <th className="num">{t('admin.p1099.colTotal')}</th>
                    <th>{t('admin.p1099.col1099')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key}>
                      <td>
                        <div className="wk-vname">{r.remitName || r.name}</div>
                        <div className="wk-sub">
                          {r.vendorId
                            ? (r.remitAddr || t('admin.p1099.vendorOnFile'))
                            : <span className="wk-flag">{t('admin.p1099.noVendorRecord')}</span>}
                        </div>
                      </td>
                      <td>
                        {r.w9
                          ? <span className="wk-tag w9ok">{r.tin4 ? t('admin.p1099.w9Tin', { tin: r.tin4 }) : t('admin.p1099.w9OnFile')}</span>
                          : <span className={`wk-tag ${r.reportable ? 'w9miss' : 'no'}`}>{t('admin.p1099.w9Missing')}</span>}
                      </td>
                      <td className="num">{r.count}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmtMoney(r.total)}</td>
                      <td>
                        {r.reportable
                          ? <span className="wk-tag yes">{t('admin.p1099.tagLikely')}</span>
                          : <span className="wk-tag no">{t('admin.p1099.tagBelow')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="wk-note">{t('admin.p1099.footNote', { threshold: fmtMoney(REPORT_THRESHOLD) })}</p>
          </>
        )}
      </div>
    </div>
  )
}
