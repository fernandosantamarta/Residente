'use client'

// Legal-hold card — shared by the desktop + mobile Pay sections. Lets an owner
// report a legal protection (bankruptcy / SCRA / qualifying offer) on their open
// collection case, or respond when the board asks them to confirm one. The board
// verifies before the hold goes active. Renders nothing for owners with no open
// case and no hold. Mirrors PaymentPlanCard.

import { useState } from 'react'
import { useMyLegalHold, LEGAL_HOLD_REASONS } from '@/lib/legal-holds'
import { useT } from '@/lib/i18n'
import { DetailDialog } from './DetailDialog'

export function LegalHoldCard() {
  const t = useT()
  const { openCase, hold, loading, reportHold, respondToRequest, withdrawHold } = useMyLegalHold()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('bankruptcy')
  const [note, setNote] = useState('')

  if (loading) return null
  const status = hold?.status ?? null
  // Show when there's an open case, a board request awaiting the owner, or a live hold.
  if (!openCase && !status) return null

  const reasonLabel = (r?: string | null) =>
    r === 'bankruptcy' ? t('pay.holdReasonBankruptcy')
      : r === 'scra' ? t('pay.holdReasonScra')
      : r === 'qualifying_offer' ? t('pay.holdReasonQualifying')
      : t('pay.holdReasonOther')

  const boardAsked = status === 'pending_resident'
  const canReport = !!openCase && (!status || status === 'released' || status === 'denied')

  const submit = async () => {
    setBusy(true); setError(null)
    let err: string | null = null
    if (boardAsked && hold) err = await respondToRequest(hold.id, { reason, note })
    else if (openCase) err = await reportHold({ caseId: openCase.id, reason, note })
    setBusy(false)
    if (err) setError(err); else setDialogOpen(false)
  }

  const onWithdraw = async () => {
    if (!hold) return
    setBusy(true); setError(null)
    const err = await withdrawHold(hold.id)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <section className="pay-card pay-plan-card" id="legal-hold">
      <div className="pay-plan-head">
        <span className="pay-plan-eyebrow">{t('pay.holdTitle')}</span>
      </div>
      {error && <div className="pay-err">{error}</div>}

      {status === 'active' && (
        <div className="pay-plan-body">
          <span className="pay-pill pay-pill-pending">{t('pay.holdActivePill')}</span>
          <div className="pay-plan-state">{t('pay.holdActiveTitle', { reason: reasonLabel(hold?.reason) })}</div>
          <p className="pay-plan-intro">{t('pay.holdActiveBody')}</p>
        </div>
      )}

      {status === 'requested' && (
        <div className="pay-plan-body">
          <span className="pay-pill pay-pill-pending">{t('pay.statusPending')}</span>
          <div className="pay-plan-state">{t('pay.holdPendingTitle')}</div>
          <div className="pay-plan-terms">{reasonLabel(hold?.reason)}{hold?.note ? ` · ${hold.note}` : ''}</div>
          <button type="button" className="pay-cta-secondary" disabled={busy} onClick={onWithdraw}>
            {t('pay.holdWithdraw')}
          </button>
        </div>
      )}

      {boardAsked && (
        <div className="pay-plan-body">
          <div className="pay-plan-state">{t('pay.holdBoardAskedTitle')}</div>
          <p className="pay-plan-intro">{t('pay.holdBoardAskedBody')}</p>
          <button type="button" className="pay-cta-primary" onClick={() => { setReason(hold?.reason || 'bankruptcy'); setNote(''); setDialogOpen(true) }}>
            {t('pay.holdProvideDetails')}
          </button>
        </div>
      )}

      {canReport && (
        <div className="pay-plan-body">
          <p className="pay-plan-intro">{t('pay.holdReportIntro')}</p>
          <button type="button" className="pay-cta-secondary" onClick={() => { setReason('bankruptcy'); setNote(''); setDialogOpen(true) }}>
            {t('pay.holdReport')}
          </button>
        </div>
      )}

      {dialogOpen && (
        <DetailDialog
          eyebrow={t('pay.holdTitle')}
          title={boardAsked ? t('pay.holdProvideDetails') : t('pay.holdReport')}
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <button type="button" className="pay-cta-secondary" onClick={() => setDialogOpen(false)}>{t('pay.cancel')}</button>
              <button type="button" className="pay-cta-primary" disabled={busy} onClick={submit}>
                {busy ? t('pay.planSubmitting') : t('pay.planSubmit')}
              </button>
            </>
          }
        >
          <p className="pay-plan-intro">{t('pay.holdDialogIntro')}</p>
          <label className="pay-plan-field">
            <span>{t('pay.holdReasonLabel')}</span>
            <select value={reason} onChange={e => setReason(e.target.value)}>
              {LEGAL_HOLD_REASONS.map(r => <option key={r} value={r}>{reasonLabel(r)}</option>)}
            </select>
          </label>
          <label className="pay-plan-field">
            <span>{t('pay.holdNoteLabel')}</span>
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={t('pay.holdNotePlaceholder')} />
          </label>
          <p className="pay-plan-intro" style={{ fontSize: 12, opacity: 0.7 }}>{t('pay.holdVerifyNote')}</p>
          {error && <div className="pay-err">{error}</div>}
        </DetailDialog>
      )}
    </section>
  )
}
