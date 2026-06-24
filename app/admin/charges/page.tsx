'use client'

// Monthly assessments ledger — the read-only audit view of the dues charges the
// charge-monthly-dues cron mints on the 1st of each month (one per active
// household, at the community's monthly_dues). This is documentation of WHEN each
// month's assessment was raised; the amount a household actually owes still comes
// from the formula in lib/dues.ts, so nothing here is a second balance source.

import { useMemo } from 'react'
import { useMonthlyCharges, type MonthlyChargeStatus } from '@/hooks/useMonthlyCharges'
import { fmtMoney } from '@/lib/dues'
import { useT } from '@/lib/i18n'

// Render a billing period like "June 2026" from its YYYY-MM-DD start (UTC).
const periodLabel = (iso: string): string => {
  if (!iso) return '—'
  const [y, m] = iso.split('-').map(Number)
  if (!y || !m) return iso
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

const dateLabel = (iso: string): string => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

// Pill tone per status, reusing the page-scoped pill variants (ok/due/warn).
const STATUS_PILL: Record<MonthlyChargeStatus, string> = {
  'pending': 'due',
  'paid-in-full': 'ok',
  'partial': 'warn',
  'reversed': 'warn',
}

export default function AdminCharges() {
  const t = useT()
  const { charges, loading, error, reload } = useMonthlyCharges()

  const statusLabel = (s: MonthlyChargeStatus): string => t(`admin.charges.status.${s}`)

  const total = useMemo(
    () => charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
    [charges],
  )

  return (
    <div className="admin-page cmcharge">
      <div className="admin-kicker">{t('admin.charges.kicker')}</div>
      <h1 className="admin-h1">{t('admin.charges.pageTitle')}</h1>
      <p className="admin-dek">{t('admin.charges.pageDek')}</p>
      <div className="admin-note">{t('admin.charges.auditNote')}</div>

      {loading ? (
        <div className="admin-note" style={{ marginTop: 16 }}>{t('admin.charges.loading')}</div>
      ) : error ? (
        <div className="admin-note admin-note-err" style={{ marginTop: 16 }}>
          {t('admin.charges.loadError')}
          <button className="admin-btn-ghost" onClick={reload}>{t('admin.charges.retry')}</button>
        </div>
      ) : charges.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ textAlign: 'center', padding: '26px 16px', color: 'var(--text-dim)', fontSize: 14 }}>
            {t('admin.charges.empty')}
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div>
              <h2>{t('admin.charges.tableTitle')}</h2>
              <div className="sub">{t('admin.charges.tableSub', { count: charges.length, total: fmtMoney(total) })}</div>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('admin.charges.colPeriod')}</th>
                <th>{t('admin.charges.colDue')}</th>
                <th>{t('admin.charges.colResident')}</th>
                <th>{t('admin.charges.colAmount')}</th>
                <th>{t('admin.charges.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td className="strong">{periodLabel(c.billing_period_start)}</td>
                  <td className="muted">{dateLabel(c.due_date)}</td>
                  <td>
                    {c.residentName || t('admin.charges.unknownResident')}
                    {c.residentUnit ? <span className="muted"> · {c.residentUnit}</span> : null}
                  </td>
                  <td className="strong">{fmtMoney(c.amount)}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[c.status] || 'due'}`}>{statusLabel(c.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
