'use client'

// Special assessments — the board levies a one-off (or installment) charge on
// every affected unit and tracks collection. Each per-unit charge is its own
// Stripe charge that settles on its own row (ev_special_assessment_charges),
// never touching the dues ledger. See lib/specialAssessments + supabase/
// special-assessments.sql + create-special-assessment-checkout.
//
// ⚠ EDUCATIONAL, NOT LEGAL ADVICE. A special assessment must be properly
// noticed/voted per the declaration + statute; the board records that
// authorization here, and the platform requires it before a draft is levied.

import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { fmtMoney } from '@/lib/dues'
import { useSpecialAssessmentsAdmin, type SpecialAssessment } from '@/lib/specialAssessments'

const todayYmd = () => new Date().toISOString().slice(0, 10)

export default function AssessmentsPage() {
  const t = useT()
  const { assessments, charges, loading, error, createDraft, levy, cancel, markChargePaidOffline, rollup } = useSpecialAssessmentsAdmin()
  const [form, setForm] = useState({ title: '', description: '', per_unit_amount: '', installments: '1', effective_date: '', authorized_note: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: any) => {
    e.preventDefault()
    setErr(''); setMsg('')
    const amt = Number(form.per_unit_amount)
    if (!form.title.trim()) { setErr(t('admin.assessments.errTitle')); return }
    if (!Number.isFinite(amt) || amt <= 0) { setErr(t('admin.assessments.errAmount')); return }
    setSaving(true)
    try {
      await createDraft({
        title: form.title,
        description: form.description,
        per_unit_amount: amt,
        installments: Number(form.installments) || 1,
        effective_date: form.effective_date || null,
        authorized_note: form.authorized_note,
      })
      setForm({ title: '', description: '', per_unit_amount: '', installments: '1', effective_date: '', authorized_note: '' })
      setMsg(t('admin.assessments.draftCreated'))
    } catch (e: any) {
      setErr(e?.message || t('admin.assessments.errCreate'))
    } finally { setSaving(false) }
  }

  const onLevy = async (a: SpecialAssessment) => {
    setErr(''); setMsg('')
    if (!window.confirm(t('admin.assessments.confirmLevy', { title: a.title }))) return
    const e = await levy(a.id)
    if (e) setErr(e)
    else setMsg(t('admin.assessments.levied'))
  }

  const onCancel = async (a: SpecialAssessment) => {
    if (!window.confirm(t('admin.assessments.confirmCancel', { title: a.title }))) return
    const e = await cancel(a.id)
    if (e) setErr(e)
  }

  const statusPill = (s: string) => {
    const map: Record<string, { c: string; bg: string }> = {
      draft: { c: '#475467', bg: '#F2F4F7' }, active: { c: '#175CD3', bg: '#EFF8FF' },
      cancelled: { c: '#B42318', bg: '#FEF3F2' }, completed: { c: '#067647', bg: '#ECFDF3' },
    }
    const m = map[s] || map.draft
    return <span style={{ fontSize: 11, fontWeight: 700, color: m.c, background: m.bg, borderRadius: 999, padding: '2px 9px' }}>{t(`admin.assessments.status.${s}`)}</span>
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">{t('admin.assessments.kicker')}</div>
      <h1 className="admin-h1">{t('admin.assessments.pageTitle')}</h1>
      <p className="admin-dek">{t('admin.assessments.dek')}</p>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {(err || error) && <div className="admin-note admin-note-err">{err || error}</div>}

      {/* Create a draft */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><div><h2>{t('admin.assessments.newTitle')}</h2><div className="sub">{t('admin.assessments.newSub')}</div></div></div>
        <form className="admin-form" onSubmit={submit}>
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.assessments.fldTitle')}</span>
            <input className="admin-input" value={form.title} onChange={e => setF('title', e.target.value)} placeholder={t('admin.assessments.fldTitlePh')} />
          </label>
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.assessments.fldDesc')}</span>
            <input className="admin-input" value={form.description} onChange={e => setF('description', e.target.value)} placeholder={t('admin.assessments.fldDescPh')} />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="admin-field" style={{ flex: '1 1 160px' }}>
              <span className="admin-field-label">{t('admin.assessments.fldPerUnit')}</span>
              <input className="admin-input" type="number" min="0" step="1" value={form.per_unit_amount} onChange={e => setF('per_unit_amount', e.target.value)} placeholder="1500" />
            </label>
            <label className="admin-field" style={{ flex: '1 1 120px' }}>
              <span className="admin-field-label">{t('admin.assessments.fldInstallments')}</span>
              <input className="admin-input" type="number" min="1" max="60" step="1" value={form.installments} onChange={e => setF('installments', e.target.value)} />
            </label>
            <label className="admin-field" style={{ flex: '1 1 160px' }}>
              <span className="admin-field-label">{t('admin.assessments.fldEffective')}</span>
              <input className="admin-input" type="date" min={todayYmd()} value={form.effective_date} onChange={e => setF('effective_date', e.target.value)} />
            </label>
          </div>
          <label className="admin-field">
            <span className="admin-field-label">{t('admin.assessments.fldAuth')}</span>
            <input className="admin-input" value={form.authorized_note} onChange={e => setF('authorized_note', e.target.value)} placeholder={t('admin.assessments.fldAuthPh')} />
            <span style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{t('admin.assessments.fldAuthHint')}</span>
          </label>
          <button className="admin-primary-btn" disabled={saving} type="submit">
            {saving ? t('admin.assessments.creating') : t('admin.assessments.createBtn')}
          </button>
        </form>
      </div>

      {loading ? (
        <div className="admin-note">{t('admin.assessments.loading')}</div>
      ) : assessments.length === 0 ? (
        <div className="admin-note">{t('admin.assessments.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {assessments.map(a => {
            const r = rollup(a.id)
            const open = openId === a.id
            const myCharges = charges.filter(c => c.assessment_id === a.id)
            return (
              <div className="card" key={a.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{a.title}</strong>{statusPill(a.status)}
                    </div>
                    {a.description && <div style={{ fontSize: 13, opacity: 0.8, marginTop: 3 }}>{a.description}</div>}
                    <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 5 }}>
                      {t('admin.assessments.perUnitLine', { amount: fmtMoney(a.per_unit_amount) })}
                      {a.installments > 1 ? ` · ${t('admin.assessments.installmentsLine', { n: a.installments })}` : ''}
                      {a.effective_date ? ` · ${t('admin.assessments.effectiveLine', { date: a.effective_date })}` : ''}
                    </div>
                    {a.authorized_note && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 3 }}>{t('admin.assessments.authLine', { note: a.authorized_note })}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {a.status === 'active' && (
                      <div style={{ fontSize: 13 }}>
                        <div style={{ fontWeight: 700 }}>{t('admin.assessments.collectedOf', { collected: fmtMoney(r.collected), charged: fmtMoney(r.charged) })}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>{t('admin.assessments.unitsPaid', { paid: r.paidCount, total: r.total })}</div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {a.status === 'draft' && (
                    <>
                      <button type="button" className="admin-primary-btn" onClick={() => onLevy(a)}>{t('admin.assessments.levyBtn')}</button>
                      <button type="button" className="admin-btn-ghost" onClick={() => onCancel(a)}>{t('admin.assessments.cancelBtn')}</button>
                    </>
                  )}
                  {a.status === 'active' && (
                    <>
                      <button type="button" className="admin-btn-ghost" onClick={() => setOpenId(open ? null : a.id)}>
                        {open ? t('admin.assessments.hideCharges') : t('admin.assessments.viewCharges', { count: myCharges.length })}
                      </button>
                      <button type="button" className="admin-btn-ghost" onClick={() => onCancel(a)}>{t('admin.assessments.cancelBtn')}</button>
                    </>
                  )}
                </div>

                {open && a.status === 'active' && (
                  <div style={{ marginTop: 12, borderTop: '1px solid #EAECF0', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {myCharges.length === 0 ? (
                      <div style={{ fontSize: 13, opacity: 0.7 }}>{t('admin.assessments.noCharges')}</div>
                    ) : myCharges.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                        <span style={{ flex: '1 1 140px', opacity: 0.85 }}>
                          {a.installments > 1 ? t('admin.assessments.chargeInstallment', { n: c.installment_no }) : t('admin.assessments.chargeUnit')}
                          {c.due_date ? ` · ${c.due_date}` : ''}
                        </span>
                        <span style={{ fontWeight: 600 }}>{fmtMoney(c.amount)}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: c.status === 'paid' ? '#067647' : '#B54708' }}>
                          {t(`admin.assessments.chargeStatus.${c.status}`)}
                        </span>
                        {c.status === 'pending' && (
                          <button type="button" className="admin-btn-ghost" style={{ fontSize: 12, padding: '2px 8px' }}
                            onClick={async () => { const e = await markChargePaidOffline(c.id); if (e) setErr(e) }}>
                            {t('admin.assessments.markPaidOffline')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
