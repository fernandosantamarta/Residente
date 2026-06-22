'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { planForHomes, monthlyTotalLabel } from '@/lib/plan'
import { trialState } from '@/lib/trial'
import { useT } from '@/lib/i18n'

// One-time dark "welcome" modal shown the first time a board member opens the
// admin — a friendly overview of their plan (highlighting the 3-month free
// trial) and what the platform includes. Dismissed forever per community via
// localStorage. Styled in admin.css (.awl-*).
const SEEN_KEY = 'residente_admin_welcome_v1'

export function AdminWelcome() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [row, setRow] = useState<any>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    let seen = true
    try { seen = !!localStorage.getItem(`${SEEN_KEY}:${communityId}`) } catch { /* private mode */ }
    if (seen) return
    let cancelled = false
    supabase
      .from('communities')
      .select('name, home_count, unit_count, plan, subscription_status, created_at')
      .eq('id', communityId).single()
      .then(({ data }) => { if (!cancelled) { setRow(data); setOpen(true) } })
    return () => { cancelled = true }
  }, [communityId])

  const close = () => {
    setOpen(false)
    try { localStorage.setItem(`${SEEN_KEY}:${communityId}`, '1') } catch { /* ignore */ }
  }

  if (!open || !row) return null

  const homes = row.home_count ?? row.unit_count ?? 0
  const band = planForHomes(homes)
  const trial = trialState(row)
  const onTrial = trial.phase === 'trial'
  const trialDate = trial.endsAt
    ? trial.endsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  const feats = [
    t('admin.welcome.feat1'),
    t('admin.welcome.feat2'),
    t('admin.welcome.feat3'),
    t('admin.welcome.feat4'),
  ]

  return (
    <div className="awl-overlay" onClick={close}>
      <div className="awl-modal" onClick={(e) => e.stopPropagation()}>
        <button className="awl-close" onClick={close} aria-label={t('admin.welcome.close')}>×</button>

        <h2 className="awl-title">{t('admin.welcome.title')}</h2>
        <p className="awl-sub">{t('admin.welcome.sub', { name: row.name || t('admin.welcome.yourCommunity') })}</p>

        <div className="awl-plan awl-plan-featured">
          {onTrial && <span className="awl-plan-badge">{t('admin.welcome.badge')}</span>}
          <div className="awl-plan-row">
            <div>
              <div className="awl-plan-name">{band.label}</div>
              <div className="awl-plan-meta">
                {onTrial && trialDate ? t('admin.welcome.freeUntil', { date: trialDate }) : band.band}
              </div>
            </div>
            <div className="awl-plan-price">{monthlyTotalLabel(homes)}</div>
          </div>
        </div>

        <div className="awl-feats-title">{t('admin.welcome.featsTitle')}</div>
        <ul className="awl-feats">
          {feats.map((f) => (
            <li key={f}>
              <span className="awl-feat-ic" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" opacity="0.35" /><polyline points="8 12.5 11 15.5 16 9" />
                </svg>
              </span>
              {f}
            </li>
          ))}
        </ul>

        <button className="awl-cta" onClick={close}>{t('admin.welcome.cta')}</button>
        <div className="awl-foot">{t('admin.welcome.foot')}</div>
      </div>
    </div>
  )
}
