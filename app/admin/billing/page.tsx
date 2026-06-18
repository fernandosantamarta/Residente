'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { startSubscriptionCheckout, manageSubscription } from '@/lib/signup'
import { planForHomes, monthlyTotalLabel } from '@/lib/plan'
import { useT } from '@/lib/i18n'

// Plan & billing — the community's Residente subscription. Lifted out of the
// admin Overview onto its own tab so the dashboard stays focused on setup.
// Free communities (≤25 homes) see "nothing to pay"; paid bands activate or
// manage their Stripe subscription here.

export default function AdminBilling() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [paying, setPaying] = useState(false)
  const [showSub, setShowSub] = useState(false)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading')
    try {
      const { data, error } = await supabase!.from('communities').select('*').eq('id', communityId).single()
      if (error) throw error
      setCommunity(data); setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const activatePlan = async () => {
    setPaying(true)
    const url = await startSubscriptionCheckout()
    if (url) { window.location.assign(url); return }
    setPaying(false)
  }

  if (status === 'loading') return <div className="admin-page"><div className="admin-note">{t('admin.billing.loading')}</div></div>
  if (status === 'none') return (
    <div className="admin-page">
      <div className="admin-kicker">{t('admin.billing.kicker')}</div>
      <h1 className="admin-h1">{t('admin.billing.pageTitle')}</h1>
      <div className="admin-note admin-note-warn">{t('admin.billing.noCommunity')}</div>
    </div>
  )
  if (status === 'error') return (
    <div className="admin-page">
      <div className="admin-note admin-note-err">{t('admin.billing.loadError')}
        <button className="admin-btn-ghost" onClick={load}>{t('admin.billing.retry')}</button>
      </div>
    </div>
  )

  const homes = community?.home_count ?? community?.unit_count ?? 0
  const sub = community?.subscription_status
  const plan = community?.plan
  const isPaidPlan = Boolean(plan)   // every tier is paid now (Starter is the flat $25/mo tier)
  const pastDue = sub === 'past_due'
  const onTrial = sub === 'trial'
  // Show the "Subscribe / add payment" button whenever they aren't active yet —
  // including during the 3-month trial, so a board can add payment any time
  // before it ends (the checkout sets trial_end, so they still aren't charged
  // until day 90). The TrialBanner nudges; this is where they act.
  const needsActivation = Boolean(isPaidPlan && sub !== 'active')
  const band = planForHomes(homes)
  const free = false   // no free tier: new communities get 3 months free, then their plan

  const statusLabel = sub === 'active' ? t('admin.billing.statusActive')
    : pastDue ? t('admin.billing.statusPaymentFailed')
    : onTrial ? '3 months free'
    : isPaidPlan ? t('admin.billing.statusNotActiveYet')
    : free ? t('admin.billing.statusFree') : '—'

  return (
    <div className="admin-page">
      <div className="admin-kicker">{t('admin.billing.kicker')}</div>
      <h1 className="admin-h1">{t('admin.billing.pageTitle')}</h1>
      <p className="admin-dek">{t('admin.billing.pageDek', { name: community?.name || t('admin.billing.thisCommunity') })}</p>

      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#8a7560' }}>{t('admin.billing.currentPlan')}</span>
          <span style={{ fontSize: 26, fontWeight: 800 }}>{band.label}{free ? ' · ' + t('admin.billing.freeBadge') : ''}</span>
          <span style={{ fontSize: 13.5, color: '#6b5544' }}>
            {free
              ? t('admin.billing.homesFree', { homes })
              : t('admin.billing.homesPaid', { monthlyTotal: monthlyTotalLabel(homes), homes })}
            {' · '}<strong>{statusLabel}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {needsActivation && (
            <button className="admin-primary-btn" onClick={pastDue ? () => setShowSub(true) : activatePlan} disabled={paying}>
              {paying ? t('admin.billing.opening') : pastDue ? t('admin.billing.manageSubscription') : t('admin.billing.subscribeNow')}
            </button>
          )}
          {sub === 'active' && (
            <button className="admin-secondary-btn" onClick={() => setShowSub(true)}>{t('admin.billing.manageSubscription')}</button>
          )}
          {!isPaidPlan && (
            <button className="admin-secondary-btn" onClick={() => setShowSub(true)}>{t('admin.billing.changePlan')}</button>
          )}
        </div>
      </div>

      <p className="admin-dek" style={{ marginTop: 16 }}>
        {free
          ? t('admin.billing.freeExplainer')
          : t('admin.billing.paidExplainer')}
      </p>

      {showSub && (
        <SubscriptionDialog
          currentHomes={homes}
          onClose={() => setShowSub(false)}
          onChanged={() => { setShowSub(false); load() }}
        />
      )}
    </div>
  )
}

// In-app subscription management — cancel (at period end) / resume / change
// plan. Talks to the manage-subscription edge fn; no Stripe portal redirect.
const TIER_RATE: Record<string, number> = { free: 0, pro: 200, premium: 400, enterprise: 800 }
type TierKey = 'free' | 'pro' | 'premium' | 'enterprise'
// Plan boxes for the picker — all four tiers, like the landing Pricing section.
// Selecting Free is a downgrade = cancel the paid subscription at period end.
const PLAN_CARDS: { key: TierKey; name: string; per: number; band: string; popular?: boolean }[] = [
  { key: 'free',       name: 'Free',       per: 0,    band: 'Up to 25 homes' },
  { key: 'pro',        name: 'Pro',        per: 200,  band: '26–100 homes', popular: true },
  { key: 'premium',    name: 'Premium',    per: 400,  band: '101–500 homes' },
  { key: 'enterprise', name: 'Enterprise', per: 800,  band: '500+ homes' },
]
// Optional add-ons — ONLY the ones actually built (each is purchasable + billed).
// Keep in sync with ADDONS in supabase/functions/manage-subscription. API access &
// webhooks and SSO/SAML are not built yet, so they're intentionally NOT sold here
// (they show as "coming soon" on the landing page only).
const ADDONS: { key: string; name: string; cents: number; blurb: string }[] = [
  { key: 'accounting', name: 'Accounting & bank reconciliation', cents: 4900, blurb: 'In-app general ledger, automatic bank reconciliation & CPA-ready exports.' },
]

function SubscriptionDialog({ currentHomes, onClose, onChanged }: {
  currentHomes: number; onClose: () => void; onChanged: () => void
}) {
  const t = useT()
  const initialPlan = (planForHomes(currentHomes).plan !== 'free' ? planForHomes(currentHomes).plan : 'pro') as TierKey
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [homes, setHomes] = useState(String(currentHomes || ''))
  const [tier, setTier] = useState<TierKey>(initialPlan)
  const [addons, setAddons] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const s = await manageSubscription('status')
      if (s?.error) setErr(s.error)
      else {
        setStatus(s)
        if (s?.plan && TIER_RATE[s.plan] && s.plan !== 'free') setTier(s.plan as TierKey)
        if (Array.isArray(s?.addons)) setAddons(s.addons)
      }
      setLoading(false)
    })()
  }, [])

  const n = Math.max(0, parseInt(homes || '0', 10) || 0)
  const homesValid = n >= 1
  const perHome = TIER_RATE[tier]
  const addonCents = ADDONS.filter(a => addons.includes(a.key)).reduce((s, a) => s + a.cents, 0)
  const totalCents = perHome * n + addonCents
  const totalLabel = `$${(totalCents / 100).toLocaleString('en-US')}/mo`
  const currentPlan = (status?.plan as string) || initialPlan
  const currentAddons: string[] = status?.addons || []
  const sameAddons = addons.length === currentAddons.length && addons.every(a => currentAddons.includes(a))
  const changed = tier !== currentPlan || n !== currentHomes || !sameAddons
  const periodEnd = status?.current_period_end
    ? new Date(status.current_period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null
  const canceling = !!status?.cancel_at_period_end
  const toggleAddon = (key: string) => setAddons(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key])

  const doChange = async () => {
    if (!homesValid) return
    setBusy('change'); setErr(null); setMsg(null)
    const r = await manageSubscription('change_plan', { home_count: n, plan: tier, addons })
    if (r?.error) { setErr(r.error); setBusy(null); return }
    setMsg(t('admin.billing.planChanged', { planLabel: r.label, price: totalLabel }))
    setBusy(null); onChanged()
  }
  const doCancel = async () => {
    if (!window.confirm(t('admin.billing.confirmCancel'))) return
    setBusy('cancel'); setErr(null); setMsg(null)
    const r = await manageSubscription('cancel')
    if (r?.error) { setErr(r.error); setBusy(null); return }
    setStatus((s: any) => ({ ...s, cancel_at_period_end: true, current_period_end: r.current_period_end }))
    setBusy(null)
  }
  const doResume = async () => {
    setBusy('resume'); setErr(null); setMsg(null)
    const r = await manageSubscription('resume')
    if (r?.error) { setErr(r.error); setBusy(null); return }
    setStatus((s: any) => ({ ...s, cancel_at_period_end: false }))
    setBusy(null)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(20,10,4,0.45)',
      display: 'grid', placeItems: 'center', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="sub-modal-noscroll" style={{
        width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto',
        background: '#fff', borderRadius: 22,
        padding: '36px 44px', boxShadow: '0 24px 60px rgba(40,15,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 27, fontWeight: 800 }}>{t('admin.billing.manageSubscription')}</h2>
          <button onClick={onClose} aria-label={t('admin.billing.close')} style={{ border: 'none', background: 'none', fontSize: 30, cursor: 'pointer', color: '#8a7560', lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: '24px 0', color: '#6b5544', fontSize: 15 }}>{t('admin.billing.loading')}</div>
        ) : (
          <>
            {status && (
              <div style={{ fontSize: 15.5, color: '#4a3a2c', marginBottom: 20, lineHeight: 1.5 }}>
                {t('admin.billing.currentLabel')} <strong>{planForHomes(currentHomes).label} {t('admin.billing.planSuffix')}</strong> · {monthlyTotalLabel(currentHomes)} · {currentHomes} {t('admin.billing.homesSuffix')}
                {canceling && periodEnd && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ color: '#b5481f', fontWeight: 600 }}>{t('admin.billing.cancelsOn', { date: periodEnd })}</span>
                    <button className="admin-secondary-btn" onClick={doResume} disabled={busy != null} style={{ padding: '7px 16px' }}>
                      {busy === 'resume' ? t('admin.billing.resuming') : t('admin.billing.resumeSubscription')}
                    </button>
                  </div>
                )}
                {!canceling && periodEnd && (
                  <div style={{ marginTop: 4, color: '#8a7560' }}>{t('admin.billing.renewsOn', { date: periodEnd })}</div>
                )}
              </div>
            )}

            {/* Choose a plan — landing-style boxes */}
            <div style={{ borderTop: '1px solid #eee', paddingTop: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>{t('admin.billing.choosePlan')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16, padding: '13px 16px', background: '#faf6f1', borderRadius: 13, border: `1px solid ${homesValid ? '#efe6da' : '#e0857a'}` }}>
                <label htmlFor="sub-homes" style={{ fontSize: 15, fontWeight: 800, color: '#2a1206', whiteSpace: 'nowrap' }}>{t('admin.billing.pickHomes')}</label>
                <input id="sub-homes" value={homes} inputMode="numeric" placeholder={t('admin.billing.homesPlaceholder')}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    setHomes(v)
                    const num = parseInt(v || '0', 10) || 0
                    if (num >= 1) setTier(planForHomes(num).plan as TierKey)
                  }}
                  style={{ width: 110, padding: '11px 14px', borderRadius: 10, border: `1px solid ${homesValid ? '#d8cfc4' : '#e0857a'}`, fontSize: 17, fontWeight: 700, color: '#2a1206' }} />
                <span style={{ flex: '1 1 200px', fontSize: 12.5, color: '#8a7560', lineHeight: 1.4 }}>
                  {t('admin.billing.homesHint')}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                {PLAN_CARDS.map((p) => {
                  const sel = tier === p.key
                  const free = p.per === 0
                  const monthly = free ? 'Free' : (homesValid ? `$${((p.per * n) / 100).toLocaleString('en-US')}/mo` : '— /mo')
                  return (
                    <button key={p.key} type="button" onClick={() => setTier(p.key)} style={{
                      textAlign: 'left', cursor: 'pointer', position: 'relative',
                      borderRadius: 16, padding: '16px 16px 15px',
                      border: '2px solid ' + (sel ? '#E5601F' : '#ece4da'),
                      background: sel ? '#E5601F' : '#fff',
                      color: sel ? '#fff' : '#2a1206',
                      boxShadow: sel ? '0 8px 22px rgba(229,96,31,0.32)' : 'none',
                      transition: 'all .12s',
                    }}>
                      {p.popular && (
                        <span style={{ position: 'absolute', top: -11, right: 12, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: sel ? '#E5601F' : '#fff', background: sel ? '#fff' : '#E5601F', padding: '3px 10px', borderRadius: 999, border: '2px solid #1a0d07' }}>{t('admin.billing.popular')}</span>
                      )}
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{p.name}</div>
                      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>
                        ${p.per / 100}{!free && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}> {t('admin.billing.perHomeMo')}</span>}
                      </div>
                      <div style={{ marginTop: 7, fontSize: 12.5, opacity: sel ? 0.9 : 0.6 }}>{p.band}</div>
                      <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${sel ? 'rgba(255,255,255,0.3)' : '#f0e8df'}`, fontSize: 13, fontWeight: 700 }}>
                        {monthly}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Add-ons */}
              <div style={{ marginTop: 22, fontWeight: 800, fontSize: 16 }}>{t('admin.billing.addons')}</div>
              <div style={{ fontSize: 12.5, color: '#8a7560', marginBottom: 12 }}>{t('admin.billing.addonsNote')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ADDONS.map((a) => {
                  const on = addons.includes(a.key)
                  return (
                    <button key={a.key} type="button" onClick={() => toggleAddon(a.key)} style={{
                      display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', cursor: 'pointer',
                      padding: '13px 15px', borderRadius: 13,
                      border: '2px solid ' + (on ? '#E5601F' : '#ece4da'),
                      background: on ? '#fff7f1' : '#fff',
                    }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center',
                        border: '2px solid ' + (on ? '#E5601F' : '#cdbfae'), background: on ? '#E5601F' : '#fff', color: '#fff', fontSize: 13, fontWeight: 900 }}>
                        {on ? '✓' : ''}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#2a1206' }}>{a.name}</span>
                        <span style={{ display: 'block', fontSize: 12.5, color: '#8a7560' }}>{a.blurb}</span>
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 800, color: '#E5601F' }}>+${a.cents / 100}/mo</span>
                    </button>
                  )
                })}
              </div>

              {tier === 'free' ? (
                <button onClick={doCancel} disabled={busy != null || canceling}
                  style={{ marginTop: 20, width: '100%', padding: '15px', borderRadius: 999, border: '1px solid #e0b4a4', background: '#fff', color: '#b5481f', fontWeight: 800, fontSize: 16, cursor: canceling ? 'default' : 'pointer', opacity: canceling ? 0.5 : 1 }}>
                  {canceling ? t('admin.billing.alreadySetToCancel') : busy === 'cancel' ? t('admin.billing.canceling') : t('admin.billing.downgradeToFree')}
                </button>
              ) : (
                <button className="admin-primary-btn" style={{ marginTop: 20, width: '100%', padding: '15px', fontSize: 16 }}
                  onClick={doChange} disabled={busy != null || !changed || !homesValid}>
                  {busy === 'change' ? t('admin.billing.updating')
                    : !homesValid ? t('admin.billing.enterHomesCount')
                    : t(canceling ? 'admin.billing.keepActiveOn' : 'admin.billing.switchTo', { planName: PLAN_CARDS.find(p => p.key === tier)?.name ?? '', price: totalLabel })}
                </button>
              )}
              <div style={{ marginTop: 10, fontSize: 12.5, color: '#8a7560', textAlign: 'center' }}>
                {tier === 'free'
                  ? t('admin.billing.freeFootnote')
                  : t('admin.billing.paidFootnote')}
              </div>
            </div>

            {/* Explicit cancel (when not already on the Free/cancel path) */}
            {status?.has_subscription && !canceling && tier !== 'free' && (
              <div style={{ borderTop: '1px solid #eee', marginTop: 22, paddingTop: 18 }}>
                <button onClick={doCancel} disabled={busy != null}
                  style={{ width: '100%', padding: '13px', borderRadius: 999, border: '1px solid #e0b4a4', background: '#fff', color: '#b5481f', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                  {busy === 'cancel' ? t('admin.billing.canceling') : t('admin.billing.cancelSubscription')}
                </button>
                <div style={{ marginTop: 8, fontSize: 12, color: '#8a7560', textAlign: 'center' }}>
                  {t('admin.billing.cancelNote')}
                </div>
              </div>
            )}

            {err && <div style={{ marginTop: 16, padding: '11px 13px', borderRadius: 10, background: '#fdecec', color: '#a32020', fontSize: 14 }}>{err}</div>}
            {msg && <div style={{ marginTop: 16, padding: '11px 13px', borderRadius: 10, background: '#eaf7ec', color: '#1d7a33', fontSize: 14 }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  )
}
