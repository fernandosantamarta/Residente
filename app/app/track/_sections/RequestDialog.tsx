'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'

// Shared request modal for the Easy Track hub. Used by the Vendors and Reports
// Quick Actions to file a real request the board triages at /admin/requests.
// Writes to `resident_requests` (category 'other') when there's a session;
// in preview/demo mode (no auth) it just shows the success confirmation so the
// flow still reads end-to-end. Reuses the ven-rd-* modal styles (same look as
// the vendor rating dialog) so no new CSS is needed.
export function RequestDialog({
  title, eyebrow, defaultSubject, bodyPlaceholder, onClose,
}: {
  title: string
  eyebrow: string
  defaultSubject?: string
  bodyPlaceholder?: string
  onClose: () => void
}) {
  const t = useT()
  const { profile } = useAuth() || {}
  const [subject, setSubject] = useState(defaultSubject || '')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (!subject.trim()) { setError(t('dialogs.errSubjectRequired')); return }
    // Demo / preview mode — no session to attribute the request to. Show the
    // confirmation so the flow still demonstrates end-to-end.
    if (!supabase || !profile?.id || !profile?.community_id) {
      setDone(true)
      return
    }
    setSaving(true); setError('')
    try {
      const { error: insErr } = await supabase.from('resident_requests').insert({
        community_id: profile.community_id,
        profile_id: profile.id,
        submitter_name: profile.full_name || profile.email || null,
        submitter_unit: profile.unit_number ? `Unit ${profile.unit_number}` : null,
        category: 'other',
        subject: subject.trim(),
        body: body.trim() || null,
        status: 'new',
      })
      if (insErr) throw insErr
      setDone(true)
    } catch (err: any) {
      setError(err?.message || t('dialogs.errSubmitFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ven-rd-backdrop" onClick={onClose}>
      <div className="ven-rd-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <header className="ven-rd-head">
          <div>
            <div className="ven-rd-eyebrow">{eyebrow}</div>
            <h2 className="ven-rd-title">{title}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label={t('dialogs.close')} onClick={onClose}>×</button>
        </header>

        {done ? (
          <>
            <div className="ven-rd-body">
              <p className="ven-rd-note">
                {t('dialogs.requestSubmittedNote')}
              </p>
            </div>
            <footer className="ven-rd-foot">
              <div className="ven-rd-foot-right">
                <button type="button" className="ven-cta-primary" onClick={onClose}>{t('dialogs.done')}</button>
              </div>
            </footer>
          </>
        ) : (
          <>
            <div className="ven-rd-body">
              <label className="ven-rd-field">
                <span className="ven-rd-field-label">{t('dialogs.subjectLabel')}</span>
                <input
                  name="request-subject"
                  className="ven-rd-textarea"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder={t('dialogs.subjectPlaceholder')}
                />
              </label>
              <label className="ven-rd-field">
                <span className="ven-rd-field-label">
                  {t('dialogs.detailsLabel')} <span className="ven-rd-optional">{t('dialogs.optional')}</span>
                </span>
                <textarea
                  name="request-body"
                  className="ven-rd-textarea"
                  rows={4}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder={bodyPlaceholder || t('dialogs.detailsPlaceholder')}
                />
              </label>
              {error && <p className="ven-rd-note" style={{ color: '#b42318' }}>{error}</p>}
            </div>
            <footer className="ven-rd-foot">
              <div className="ven-rd-foot-right">
                <button type="button" className="ven-cta-secondary" onClick={onClose}>{t('dialogs.cancel')}</button>
                <button type="button" className="ven-cta-primary" onClick={submit} disabled={saving}>
                  {saving ? t('dialogs.submitting') : t('dialogs.submitRequest')}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
