'use client'

// Owner statement — print-ready HTML (Save as PDF). A real, owner-verifiable
// monthly statement assembled from the resident's OWN ledger (lib/statements,
// which reconciles to the Pay-screen Current Balance). No demo data: if there's
// no roster match or the period isn't found, we say so rather than invent.
//
// Opened in a new tab from the Pay screen's statement dialog ("Download PDF").
// The resident hits Print / ⌘P → Save as PDF. Mirrors the print pattern used by
// the estoppel certificate and CPA share pages (client render + window.print).

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useMyResident } from '@/hooks/useMyResident'
import { findStatement } from '@/lib/statements'
import { fmtMoney } from '@/lib/dues'
import { useT } from '@/lib/i18n'

const fmtMonth = (periodStart: string) =>
  new Date(`${periodStart}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const fmtToday = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function OwnerStatementPrint() {
  const t = useT()
  const params = useParams()
  const period = (params?.period as string) || ''
  const { resident, community, duesCfg, monthlyDues, payments, loading } = useMyResident() as any

  const stmt = useMemo(
    () => (resident ? findStatement(resident, monthlyDues || 0, payments || [], period, { cfg: duesCfg }) : null),
    [resident, monthlyDues, payments, period, duesCfg],
  )

  if (loading) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>{t('pay.statementLoading')}</div>
  if (!resident || !stmt) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui', color: '#8a1c1c' }}>
        {t('pay.statementNotFound')}
      </div>
    )
  }

  const monthLabel = fmtMonth(stmt.periodStart)
  const communityName = community?.name || t('pay.statementYourCommunity')
  const unit = resident.unit_number || resident.unit_label || resident.address || ''

  const rows: { label: string; value: number; credit?: boolean; strong?: boolean }[] = [
    { label: t('pay.statementOpeningBalance'), value: stmt.openingBalance },
    { label: t('pay.statementDuesAssessed'), value: stmt.dues },
    ...(stmt.interestFees ? [{ label: t('pay.statementInterestFees'), value: stmt.interestFees }] : []),
    { label: t('pay.statementPaymentsReceived'), value: -stmt.paid, credit: stmt.paid > 0 },
    { label: t('pay.statementClosingBalance'), value: stmt.closingBalance, strong: true },
  ]

  return (
    <div className="stmt-page">
      <style>{`
        :root { color-scheme: light; }
        body { margin: 0; background: #f3f2ee; }
        .stmt-page { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #21201d; }
        .stmt-bar { max-width: 720px; margin: 0 auto; padding: 16px 24px; display: flex; gap: 10px; justify-content: flex-end; }
        .stmt-print-btn { appearance: none; border: 1px solid #21201d; background: #21201d; color: #fff; font: inherit; font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 9px; cursor: pointer; }
        .stmt-back { appearance: none; border: 1px solid #d6d3cc; background: #fff; color: #21201d; font: inherit; font-size: 14px; padding: 9px 16px; border-radius: 9px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
        .stmt-doc { max-width: 720px; margin: 0 auto 48px; background: #fff; border: 1px solid #e7e4dd; border-radius: 14px; padding: 44px 48px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
        .stmt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #21201d; padding-bottom: 18px; margin-bottom: 24px; }
        .stmt-comm { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
        .stmt-kind { font-size: 12.5px; color: #6b675f; margin-top: 3px; text-transform: uppercase; letter-spacing: .08em; }
        .stmt-title { text-align: right; }
        .stmt-title-h { font-size: 15px; font-weight: 700; }
        .stmt-title-sub { font-size: 12.5px; color: #6b675f; margin-top: 3px; }
        .stmt-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 13.5px; margin-bottom: 28px; }
        .stmt-meta div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px dotted #e2dfd8; padding-bottom: 6px; }
        .stmt-meta .k { color: #6b675f; }
        .stmt-meta .v { font-weight: 600; text-align: right; }
        table.stmt-tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
        table.stmt-tbl th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: #6b675f; border-bottom: 1px solid #d6d3cc; padding: 0 0 8px; }
        table.stmt-tbl th.amt, table.stmt-tbl td.amt { text-align: right; }
        table.stmt-tbl td { padding: 11px 0; border-bottom: 1px solid #efece5; }
        table.stmt-tbl tr.total td { border-top: 2px solid #21201d; border-bottom: none; font-weight: 700; font-size: 15.5px; padding-top: 13px; }
        .credit { color: #137a4b; }
        .stmt-foot { margin-top: 26px; font-size: 11.5px; color: #837f76; line-height: 1.5; border-top: 1px solid #efece5; padding-top: 16px; }
        @media print {
          body { background: #fff; }
          .stmt-bar { display: none; }
          .stmt-doc { border: none; box-shadow: none; border-radius: 0; margin: 0; max-width: none; padding: 0; }
        }
      `}</style>

      <div className="stmt-bar">
        <a className="stmt-back" href="/app/track#statements">{t('pay.statementBack')}</a>
        <button type="button" className="stmt-print-btn" onClick={() => window.print()}>
          {t('pay.statementPrintSave')}
        </button>
      </div>

      <div className="stmt-doc">
        <div className="stmt-head">
          <div>
            <div className="stmt-comm">{communityName}</div>
            <div className="stmt-kind">{t('pay.statementOwnerStatement')}</div>
          </div>
          <div className="stmt-title">
            <div className="stmt-title-h">{monthLabel}</div>
            <div className="stmt-title-sub">{t('pay.statementGeneratedOn', { date: fmtToday() })}</div>
          </div>
        </div>

        <div className="stmt-meta">
          <div><span className="k">{t('pay.statementAccountHolder')}</span><span className="v">{resident.full_name || '—'}</span></div>
          {unit ? <div><span className="k">{t('pay.statementUnit')}</span><span className="v">{unit}</span></div> : null}
          <div><span className="k">{t('pay.statementPeriod')}</span><span className="v">{monthLabel}</span></div>
          <div><span className="k">{t('pay.statementClosingBalance')}</span><span className="v">{fmtMoney(stmt.closingBalance)}</span></div>
        </div>

        <table className="stmt-tbl">
          <thead>
            <tr><th>{t('pay.charge')}</th><th className="amt">{t('pay.colAmount')}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.strong ? 'total' : ''}>
                <td>{r.label}</td>
                <td className={`amt${r.credit ? ' credit' : ''}`}>
                  {r.value < 0 ? `-${fmtMoney(Math.abs(r.value))}` : fmtMoney(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="stmt-foot">{t('pay.statementReconcileNote')}</p>
      </div>
    </div>
  )
}
