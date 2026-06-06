'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { startSubscriptionCheckout, manageSubscription } from '@/lib/signup'
import { planForHomes, monthlyTotalLabel } from '@/lib/plan'

// Plan & billing — the community's Residente subscription. Lifted out of the
// admin Overview onto its own tab so the dashboard stays focused on setup.
// Free communities (≤25 homes) see "nothing to pay"; paid bands activate or
// manage their Stripe subscription here.

export default function AdminBilling() {
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

  if (status === 'loading') return <div className="admin-page"><div className="admin-note">Loading…</div></div>
  if (status === 'none') return (
    <div className="admin-page">
      <div className="admin-kicker">Billing</div>
      <h1 className="admin-h1">Plan &amp; billing</h1>
      <div className="admin-note admin-note-warn">No community is linked to your account yet.</div>
    </div>
  )
  if (status === 'error') return (
    <div className="admin-page">
      <div className="admin-note admin-note-err">Couldn&apos;t load billing.
        <button className="admin-btn-ghost" onClick={load}>Retry</button>
      </div>
    </div>
  )

  const homes = community?.home_count ?? community?.unit_count ?? 0
  const sub = community?.subscription_status
  const plan = community?.plan
  const isPaidPlan = plan && plan !== 'free'
  const pastDue = sub === 'past_due'
  const needsActivation = Boolean(isPaidPlan && sub !== 'active')
  const band = planForHomes(homes)
  const free = band.perHomeCents === 0

  const statusLabel = sub === 'active' ? 'Active'
    : pastDue ? 'Payment failed'
    : isPaidPlan ? 'Not active yet'
    : free ? 'Free' : '—'

  return (
    <div className="admin-page">
      <div className="admin-kicker">Billing</div>
      <h1 className="admin-h1">Plan &amp; billing</h1>
      <p className="admin-dek">Your Residente subscription for {community?.name || 'this community'}.</p>

      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#8a7560' }}>Current plan</span>
          <span style={{ fontSize: 26, fontWeight: 800 }}>{band.label}{free ? ' · Free' : ''}</span>
          <span style={{ fontSize: 13.5, color: '#6b5544' }}>
            {free
              ? `${homes} homes — free forever`
              : `${monthlyTotalLabel(homes)} · ${homes} homes`}
            {' · '}<strong>{statusLabel}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {needsActivation && (
            <button className="admin-primary-btn" onClick={pastDue ? () => setShowSub(true) : activatePlan} disabled={paying}>
              {paying ? 'Opening…' : pastDue ? 'Manage subscription' : 'Subscribe now'}
            </button>
          )}
          {sub === 'active' && (
            <button className="admin-secondary-btn" onClick={() => setShowSub(true)}>Manage subscription</button>
          )}
          {!isPaidPlan && (
            <button className="admin-secondary-btn" onClick={() => setShowSub(true)}>Change plan</button>
          )}
        </div>
      </div>

      <p className="admin-dek" style={{ marginTop: 16 }}>
        {free
          ? 'Communities with 25 or fewer homes are free — there’s nothing to pay. Add homes anytime and you’ll move to a paid band automatically.'
          : 'Billed to the association monthly. Cancel anytime; you keep access until the end of the billing period.'}
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
const TIER_RATE: Record<string, number> = { free: 0, pro: 200, premium: 500, enterprise: 1000 }
type TierKey = 'free' | 'pro' | 'premium' | 'enterprise'
// Plan boxes for the picker — all four tiers, like the landing Pricing section.
// Selecting Free is a downgrade = cancel the paid subscription at period end.
const PLAN_CARDS: { key: TierKey; name: string; per: number; band: string; popular?: boolean }[] = [
  { key: 'free',       name: 'Free',       per: 0,    band: 'Up to 25 homes' },
  { key: 'pro',        name: 'Pro',        per: 200,  band: '26–100 homes', popular: true },
  { key: 'premium',    name: 'Premium',    per: 500,  band: '101–500 homes' },
  { key: 'enterprise', name: 'Enterprise', per: 1000, band: '500+ homes' },
]
// Optional add-ons (mirrors the landing Enterprise add-ons + the edge fn ADDONS).
const ADDONS: { key: string; name: string; cents: number; blurb: string }[] = [
  { key: 'api',        name: 'API access & webhooks',  cents: 4900, blurb: 'Build on your data; push events out.' },
  { key: 'sso',        name: 'SSO / SAML sign-in',      cents: 9900, blurb: 'Single sign-on for your board + staff.' },
  { key: 'accounting', name: 'Accounting integrations', cents: 4900, blurb: 'Sync dues + expenses to your books.' },
]

function SubscriptionDialog({ currentHomes, onClose, onChanged }: {
  currentHomes: number; onClose: () => void; onChanged: () => void
}) {
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
    setMsg(`Now on the ${r.label} plan — ${totalLabel}.`)
    setBusy(null); onChanged()
  }
  const doCancel = async () => {
    if (!window.confirm('Cancel your subscription? It stays active until the end of the current billing period, and you can resume anytime before then.')) return
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
          <h2 style={{ margin: 0, fontSize: 27, fontWeight: 800 }}>Manage subscription</h2>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 30, cursor: 'pointer', color: '#8a7560', lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: '24px 0', color: '#6b5544', fontSize: 15 }}>Loading…</div>
        ) : (
          <>
            {status && (
              <div style={{ fontSize: 15.5, color: '#4a3a2c', marginBottom: 20, lineHeight: 1.5 }}>
                Current: <strong>{planForHomes(currentHomes).label} plan</strong> · {monthlyTotalLabel(currentHomes)} · {currentHomes} homes
                {canceling && periodEnd && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ color: '#b5481f', fontWeight: 600 }}>Cancels on {periodEnd}.</span>
                    <button className="admin-secondary-btn" onClick={doResume} disabled={busy != null} style={{ padding: '7px 16px' }}>
                      {busy === 'resume' ? 'Resuming…' : 'Resume subscription'}
                    </button>
                  </div>
                )}
                {!canceling && periodEnd && (
                  <div style={{ marginTop: 4, color: '#8a7560' }}>Renews {periodEnd}.</div>
                )}
              </div>
            )}

            {/* Choose a plan — landing-style boxes */}
            <div style={{ borderTop: '1px solid #eee', paddingTop: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Choose your plan</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16, padding: '13px 16px', background: '#faf6f1', borderRadius: 13, border: `1px solid ${homesValid ? '#efe6da' : '#e0857a'}` }}>
                <label htmlFor="sub-homes" style={{ fontSize: 15, fontWeight: 800, color: '#2a1206', whiteSpace: 'nowrap' }}>Pick your homes</label>
                <input id="sub-homes" value={homes} inputMode="numeric" placeholder="e.g. 120"
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    setHomes(v)
                    const num = parseInt(v || '0', 10) || 0
                    if (num >= 1) setTier(planForHomes(num).plan as TierKey)
                  }}
                  style={{ width: 110, padding: '11px 14px', borderRadius: 10, border: `1px solid ${homesValid ? '#d8cfc4' : '#e0857a'}`, fontSize: 17, fontWeight: 700, color: '#2a1206' }} />
                <span style={{ flex: '1 1 200px', fontSize: 12.5, color: '#8a7560', lineHeight: 1.4 }}>
                  Stay on any plan and add homes anytime — billing is per home, so your monthly updates automatically.
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
                        <span style={{ position: 'absolute', top: -11, right: 12, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: sel ? '#E5601F' : '#fff', background: sel ? '#fff' : '#E5601F', padding: '3px 10px', borderRadius: 999, border: '2px solid #1a0d07' }}>Popular</span>
                      )}
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{p.name}</div>
                      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>
                        ${p.per / 100}{!free && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}> /home/mo</span>}
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
              <div style={{ marginTop: 22, fontWeight: 800, fontSize: 16 }}>Add-ons</div>
              <div style={{ fontSize: 12.5, color: '#8a7560', marginBottom: 12 }}>Optional, billed monthly on top of your plan.</div>
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
                  {canceling ? 'Already set to cancel' : busy === 'cancel' ? 'Canceling…' : 'Downgrade to Free — cancel at period end'}
                </button>
              ) : (
                <button className="admin-primary-btn" style={{ marginTop: 20, width: '100%', padding: '15px', fontSize: 16 }}
                  onClick={doChange} disabled={busy != null || !changed || !homesValid}>
                  {busy === 'change' ? 'Updating…'
                    : !homesValid ? 'Enter the number of homes'
                    : `${canceling ? 'Keep active on' : 'Switch to'} ${PLAN_CARDS.find(p => p.key === tier)?.name} — ${totalLabel}`}
                </button>
              )}
              <div style={{ marginTop: 10, fontSize: 12.5, color: '#8a7560', textAlign: 'center' }}>
                {tier === 'free'
                  ? 'Free communities (≤25 homes) pay nothing. Your plan stays active until the period ends.'
                  : 'Plan + add-on changes are prorated to today.'}
              </div>
            </div>

            {/* Explicit cancel (when not already on the Free/cancel path) */}
            {status?.has_subscription && !canceling && tier !== 'free' && (
              <div style={{ borderTop: '1px solid #eee', marginTop: 22, paddingTop: 18 }}>
                <button onClick={doCancel} disabled={busy != null}
                  style={{ width: '100%', padding: '13px', borderRadius: 999, border: '1px solid #e0b4a4', background: '#fff', color: '#b5481f', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                  {busy === 'cancel' ? 'Canceling…' : 'Cancel subscription'}
                </button>
                <div style={{ marginTop: 8, fontSize: 12, color: '#8a7560', textAlign: 'center' }}>
                  Stays active until the end of your billing period — you can resume before then.
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
