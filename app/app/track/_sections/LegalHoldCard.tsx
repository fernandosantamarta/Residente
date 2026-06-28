'use client'

// Legal-hold card — shared by the desktop + mobile Pay sections. Lets an owner
// report a legal protection (bankruptcy / SCRA / qualifying offer) on their open
// collection case, or respond when the board asks them to confirm one. The board
// verifies before the hold goes active. Renders nothing for owners with no open
// case and no hold.
//
// Three render modes (mirrors PaymentPlanCard):
//   default   — its own full pay-card
//   embedded  — bare body, no card chrome
//   variant="row" — a single Quick Actions row that opens the flow in a popup.

import { useState } from 'react'
import { useMyLegalHold, LEGAL_HOLD_REASONS } from '@/lib/legal-holds'
import { useT } from '@/lib/i18n'
import { DetailDialog } from './DetailDialog'

export function LegalHoldCard({ embedded, variant }: { embedded?: boolean; variant?: 'row' } = {}) {
  const t = useT()
  const { openCase, hold, loading, reportHold, respondToRequest, withdrawHold } = useMyLegalHold()
  const [dialogOpen, setDialogOpen] = useState(false)   // form dialog (default/embedded mode)
  const [rowOpen, setRowOpen] = useState(false)         // detail popup (row mode)
  const [rowForm, setRowForm] = useState(false)         // form view inside the row popup
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

  const submit = async (onDone?: () => void) => {
    setBusy(true); setError(null)
    let err: string | null = null
    if (boardAsked && hold) err = await respondToRequest(hold.id, { reason, note })
    else if (openCase) err = await reportHold({ caseId: openCase.id, reason, note })
    setBusy(false)
    if (err) setError(err); else (onDone ?? (() => setDialogOpen(false)))()
  }

  const onWithdraw = async () => {
    if (!hold) return
    setBusy(true); setError(null)
    const err = await withdrawHold(hold.id)
    setBusy(false)
    if (err) setError(err)
  }

  const openForm = () => { setReason(hold?.reason || 'bankruptcy'); setNote('') }

  // The report / respond form — reused by the default dialog and the row popup.
  const formFields = (
    <>
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
    </>
  )

  // Current-state blocks — reused by the default body and the row popup info view.
  // onReport opens the form (different target per mode).
  const stateBlocks = (onReport: () => void) => (
    <>
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
          <button type="button" className="pay-cta-primary" onClick={() => { openForm(); onReport() }}>
            {t('pay.holdProvideDetails')}
          </button>
        </div>
      )}

      {canReport && (
        <div className="pay-plan-body">
          <p className="pay-plan-intro">{t('pay.holdReportIntro')}</p>
          <button type="button" className="pay-cta-secondary" onClick={() => { setReason('bankruptcy'); setNote(''); onReport() }}>
            {t('pay.holdReport')}
          </button>
        </div>
      )}
    </>
  )

  // -- ROW MODE: a Quick Actions row that opens the flow in a popup -------------
  if (variant === 'row') {
    const rowStatus = status === 'active' ? t('pay.holdRowActive')
      : status === 'requested' ? t('pay.holdRowPending')
      : boardAsked ? t('pay.holdRowBoardAsked')
      : t('pay.holdRowReport')
    return (
      <>
        <button type="button" className="pay-quick-row"
          onClick={() => { setError(null); setRowForm(false); setRowOpen(true) }}>
          <span className="pay-quick-icon"><ShieldIcon /></span>
          <span className="pay-quick-body">
            <span className="pay-quick-title">{t('pay.holdTitle')}</span>
            <span className="pay-quick-desc">{rowStatus}</span>
          </span>
          <svg className="pay-quick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        {rowOpen && (
          <DetailDialog
            eyebrow={t('pay.holdTitle')}
            title={rowForm ? (boardAsked ? t('pay.holdProvideDetails') : t('pay.holdReport')) : t('pay.holdTitle')}
            onClose={() => setRowOpen(false)}
            footer={rowForm ? (
              <>
                <button type="button" className="pay-cta-secondary" onClick={() => setRowForm(false)}>{t('pay.cancel')}</button>
                <button type="button" className="pay-cta-primary" disabled={busy}
                  onClick={() => submit(() => setRowOpen(false))}>
                  {busy ? t('pay.planSubmitting') : t('pay.planSubmit')}
                </button>
              </>
            ) : undefined}
          >
            {rowForm ? formFields : stateBlocks(() => setRowForm(true))}
          </DetailDialog>
        )}
      </>
    )
  }

  // -- DEFAULT / EMBEDDED MODE: full card body ---------------------------------
  return (
    <div className={embedded ? 'pay-embed' : 'pay-card pay-plan-card'} id={embedded ? undefined : 'legal-hold'}>
      <div className="pay-plan-head">
        <span className="pay-plan-eyebrow">{t('pay.holdTitle')}</span>
      </div>
      {error && <div className="pay-err">{error}</div>}

      {stateBlocks(() => { openForm(); setDialogOpen(true) })}

      {dialogOpen && (
        <DetailDialog
          eyebrow={t('pay.holdTitle')}
          title={boardAsked ? t('pay.holdProvideDetails') : t('pay.holdReport')}
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <button type="button" className="pay-cta-secondary" onClick={() => setDialogOpen(false)}>{t('pay.cancel')}</button>
              <button type="button" className="pay-cta-primary" disabled={busy} onClick={() => submit()}>
                {busy ? t('pay.planSubmitting') : t('pay.planSubmit')}
              </button>
            </>
          }
        >
          {formFields}
        </DetailDialog>
      )}
    </div>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
