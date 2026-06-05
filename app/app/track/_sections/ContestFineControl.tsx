'use client'

// Shared "Contest this fine" control — used by the Pay fines band (desktop +
// mobile) and the My Violations strip. Shows a Contest button for an open,
// not-yet-disputed fine (opens a reason + evidence dialog), or a status pill
// once a dispute is on file. Statutory right to contest before a committee
// (HB 1021 FS 718.303 / HB 1203 FS 720.305).

import { useState } from 'react'
import { fileDispute, type Violation } from '@/lib/violations'
import { useT } from '@/lib/i18n'
import { DetailDialog } from './DetailDialog'

export function ContestFineControl({ violation, className }: { violation: Violation; className?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Already disputed → show the current status, no action.
  if (violation.dispute_status) {
    const label =
      violation.dispute_status === 'upheld' ? t('pay.disputeUpheld')
      : violation.dispute_status === 'dismissed' ? t('pay.disputeDismissed')
      : violation.dispute_status === 'reduced' ? t('pay.disputeReduced')
      : violation.dispute_status === 'under_review' ? t('pay.disputeUnderReview')
      : t('pay.disputeFiled')
    const cls = violation.dispute_status === 'dismissed' ? 'pay-pill-on'
      : violation.dispute_status === 'upheld' ? 'pay-pill-off'
      : 'pay-pill-pending'
    return <span className={`pay-pill ${cls}`}>{label}</span>
  }

  // Only fines can be contested; warnings can't.
  if (violation.kind !== 'fine') return null

  const submit = async () => {
    if (!reason.trim() || busy) return
    setBusy(true); setError(null)
    const err = await fileDispute(violation.id, reason.trim(), file)
    setBusy(false)
    if (err) setError(err)
    else { setOpen(false); setReason(''); setFile(null) }
  }

  return (
    <>
      <button type="button" className={className || 'pay-cta-secondary'} onClick={() => setOpen(true)}>
        {t('pay.contestFine')}
      </button>
      {open && (
        <DetailDialog
          eyebrow={violation.rule_title || t('pay.fineGeneric')}
          title={t('pay.contestTitle')}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="pay-cta-secondary" onClick={() => setOpen(false)}>{t('pay.cancel')}</button>
              <button type="button" className="pay-cta-primary" disabled={busy || !reason.trim()} onClick={submit}>
                {busy ? t('pay.contesting') : t('pay.contestSubmit')}
              </button>
            </>
          }
        >
          <p className="pay-plan-intro">{t('pay.contestIntro')}</p>
          <label className="pay-plan-field">
            <span>{t('pay.contestReason')}</span>
            <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          <label className="pay-plan-field">
            <span>{t('pay.contestEvidence')}</span>
            <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <div className="pay-err">{error || t('pay.contestError')}</div>}
        </DetailDialog>
      )}
    </>
  )
}
