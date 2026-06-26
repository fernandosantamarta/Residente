'use client'

import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase } from '@/lib/supabase'
import { useCommunityData } from '@/hooks/useCommunityData'
import { useT } from '@/lib/i18n'
import { Dropdown } from '@/components/Dropdown'
import { DetailDialog } from './DetailDialog'

// Resident-facing emergency card. Replaces the old hardcoded "(305) 555-00xx"
// list with the real published line (communities.emergency_phone, set by the
// board in Admin → Community) plus a "Report an emergency" action that pages the
// on-call board member instantly — via the emergency_report RPC, which lands as
// an in-app bell + push + email (supabase/emergency-dispatch.sql). Lives in the
// Easy Track Vendors section; shared by the desktop + mobile twins.

const CATEGORIES = ['water', 'fire', 'electrical', 'security', 'structural', 'medical', 'other'] as const
type Category = typeof CATEGORIES[number]

export function EmergencyReport() {
  const t = useT()
  const { profile } = useAuth() || {}
  const { community } = useCommunityData()
  const emergencyPhone = (community?.emergency_phone || '').trim()
  const telHref = emergencyPhone ? `tel:${emergencyPhone.replace(/[^\d+]/g, '')}` : ''
  const [open, setOpen] = useState(false)

  return (
    <section className="ven-card ven-emerg">
      <h3 className="ven-tile-title">{t('emergency.cardTitle')}</h3>
      <p className="ven-emerg-note">{t('emergency.call911')}</p>

      {emergencyPhone ? (
        <a href={telHref} className="ven-emerg-row">
          <span className="ven-emerg-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>
            </svg>
          </span>
          <span className="ven-emerg-body">
            <span className="ven-emerg-label">{t('emergency.callLine')}</span>
            <span className="ven-emerg-phone">{emergencyPhone}</span>
          </span>
        </a>
      ) : (
        <p className="ven-emerg-desc">{t('emergency.noLine')}</p>
      )}

      <button type="button" className="ven-cta-primary" style={{ width: '100%', marginTop: 12 }}
        onClick={() => setOpen(true)} disabled={!profile?.community_id}>
        {t('emergency.reportBtn')}
      </button>
      <p className="ven-emerg-desc" style={{ marginTop: 6 }}>{t('emergency.reportDesc')}</p>

      {open && <ReportDialog onClose={() => setOpen(false)} />}
    </section>
  )
}

function ReportDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [category, setCategory] = useState<Category>('other')
  const [severity, setSeverity] = useState<'urgent' | 'critical'>('urgent')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (!description.trim()) { setErr(t('emergency.errorDesc')); return }
    if (!supabase) { setErr(t('emergency.error')); return }
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.rpc('emergency_report', {
        p_category: category,
        p_severity: severity,
        p_description: description.trim(),
        p_location: location.trim() || null,
      })
      if (error) throw error
      setDone(true)
    } catch {
      setErr(t('emergency.error')); setBusy(false)
    }
  }

  return (
    <DetailDialog
      eyebrow={t('emergency.cardTitle')}
      title={done ? t('emergency.sentTitle') : t('emergency.reportTitle')}
      onClose={onClose}
      footer={done ? undefined : (
        <button type="button" className="ven-cta-primary" disabled={busy} onClick={submit}>
          {busy ? t('emergency.sending') : t('emergency.send')}
        </button>
      )}
    >
      {done ? (
        <p className="rd-report-blurb">{t('emergency.sent')}</p>
      ) : (
        <div className="ven-rd-body" style={{ padding: 0 }}>
          <p className="rd-report-blurb" style={{ marginTop: 0 }}>{t('emergency.reportHint')}</p>

          <label className="ven-rd-field">
            <span className="ven-rd-field-label">{t('emergency.field.category')}</span>
            <Dropdown<string>
              value={category}
              onChange={v => setCategory(v as Category)}
              ariaLabel={t('emergency.field.category')}
              options={CATEGORIES.map(c => ({ value: c, label: t(`emergency.cat.${c}`) }))}
            />
          </label>

          <label className="ven-rd-field">
            <span className="ven-rd-field-label">{t('emergency.field.severity')}</span>
            <Dropdown<string>
              value={severity}
              onChange={v => setSeverity(v === 'critical' ? 'critical' : 'urgent')}
              ariaLabel={t('emergency.field.severity')}
              options={[
                { value: 'urgent', label: t('emergency.sevUrgent') },
                { value: 'critical', label: t('emergency.sevCritical') },
              ]}
            />
          </label>

          <label className="ven-rd-field">
            <span className="ven-rd-field-label">{t('emergency.field.location')} <span className="ven-rd-optional">{t('vendors.optional')}</span></span>
            <input
              className="ven-rd-input"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder={t('emergency.locationPlaceholder')}
            />
          </label>

          <label className="ven-rd-field">
            <span className="ven-rd-field-label">{t('emergency.field.description')}</span>
            <textarea
              className="ven-rd-textarea"
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('emergency.descPlaceholder')}
            />
          </label>

          {err && <p className="rd-detail-foot-note" style={{ color: '#c0392b' }}>{err}</p>}
        </div>
      )}
    </DetailDialog>
  )
}
