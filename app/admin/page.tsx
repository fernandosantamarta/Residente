'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { startSubscriptionCheckout, manageSubscription } from '@/lib/signup'
import { planForHomes, monthlyTotalLabel } from '@/lib/plan'

// Admin home — replaces the old redirect-to-/community. A real dashboard:
// quick stats + a "Get your community live" checklist whose items tick off
// from actual data presence, so a freshly-signed-up board sees exactly what's
// left to do. No new tables — everything is computed from counts.

const withTimeout = (p, ms = 10000) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("Can't reach the server")), ms))])

type Counts = { residents: number; board: number; documents: number; budgets: number }

export default function AdminHome() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [copied, setCopied] = useState(false)
  const [paying, setPaying] = useState(false)
  const [showSub, setShowSub] = useState(false)

  const activatePlan = async () => {
    setPaying(true)
    const url = await startSubscriptionCheckout()
    if (url) { window.location.assign(url); return }
    setPaying(false)
  }

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading')
    try {
      const countOf = (table: string, build?: (q: any) => any) => {
        let q = supabase!.from(table).select('id', { count: 'exact', head: true }).eq('community_id', communityId)
        return build ? build(q) : q
      }
      const [c, res, board, docs, bud] = await withTimeout(Promise.all([
        supabase!.from('communities').select('*').eq('id', communityId).single(),
        countOf('residents'),
        countOf('residents', q => q.not('board_position', 'is', null)),
        countOf('documents'),
        countOf('budget_categories'),
      ])) as any[]
      setCommunity(c.data)
      setCounts({
        residents: res.count || 0, board: board.count || 0,
        documents: docs.count || 0, budgets: bud.count || 0,
      })
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const copyCode = async () => {
    if (!community?.join_code) return
    try { await navigator.clipboard.writeText(community.join_code); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }

  if (status === 'loading') return <div className="admin-page"><div className="admin-note">Loading…</div></div>
  if (status === 'none') return (
    <div className="admin-page">
      <div className="admin-kicker">Overview</div>
      <h1 className="admin-h1">Welcome</h1>
      <div className="admin-note admin-note-warn">No community is linked to your account yet.</div>
    </div>
  )
  if (status === 'error') return (
    <div className="admin-page">
      <div className="admin-note admin-note-err">Couldn&apos;t load your dashboard.
        <button className="admin-btn-ghost" onClick={load}>Retry</button>
      </div>
    </div>
  )

  const dues = Number(community?.monthly_dues) || 0
  // Setup guide, in the order a manager should actually do it. Each hint names
  // the exact tab to open (matching the admin nav) plus the action to take, so
  // it reads as step-by-step instructions, not just a label.
  const items = [
    { label: 'Add your board members', done: (counts?.board || 0) >= 1, href: '/admin/voice',
      hint: 'Open Easy Voice → Board and add your President, Treasurer, and Secretary. They get admin access too.' },
    { label: 'Review your budget', done: (counts?.budgets || 0) > 0, href: '/admin/community',
      hint: 'Open the Community tab, edit the starter categories, and set this year’s amounts.' },
    { label: 'Set your monthly dues', done: dues > 0, href: '/admin/community',
      hint: 'In the Community tab, enter what each home pays per month — residents then see their balance.' },
    { label: 'Add your residents', done: (counts?.residents || 0) > 1, href: '/admin/residents',
      hint: 'Open Easy Track → Residents, then import your owner roster by CSV or add them one at a time.' },
    { label: 'Upload key documents', done: (counts?.documents || 0) >= 1, href: '/admin/documents',
      hint: 'Open Easy Documents and upload your bylaws, declaration, budget, insurance, and latest minutes.' },
  ]
  const doneCount = items.filter(i => i.done).length
  const pct = Math.round((doneCount / items.length) * 100)

  // Subscription state (see lib/plan.ts + supabase/community-billing.sql).
  const homes = community?.home_count ?? community?.unit_count ?? 0
  const sub = community?.subscription_status
  const plan = community?.plan
  const isPaidPlan = plan && plan !== 'free'
  const pastDue = sub === 'past_due'
  // Paid band that isn't active yet → show the Activate banner (covers pending,
  // legacy 'trial', and past_due). Free communities never see it.
  const needsActivation = Boolean(isPaidPlan && sub !== 'active')
  const subBadge =
    sub === 'free'     ? 'Free plan' :
    sub === 'active'   ? `${planForHomes(homes).label} plan` :
    pastDue            ? 'Payment past due' :
    isPaidPlan         ? 'Activation pending' : ''

  const stats = [
    { label: 'Units', value: community?.unit_count ?? '—' },
    { label: 'Monthly dues', value: dues ? `$${dues}` : '—' },
    { label: 'Residents', value: counts?.residents ?? 0 },
    { label: 'Board', value: counts?.board ?? 0 },
    { label: 'Documents', value: counts?.documents ?? 0 },
  ]

  return (
    <div className="admin-page">
      <div className="admin-kicker">Overview</div>
      <h1 className="admin-h1">{community?.name || 'Your community'}</h1>
      <p className="admin-dek">
        {community?.location ? `${community.location} · ` : ''}
        {community?.association_type === 'condo' ? 'Condominium association' : 'Homeowners association'}
        {subBadge ? ` · ${subBadge}` : ''}
      </p>

      {needsActivation && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', margin: '4px 0 20px', padding: '14px 18px',
          border: '1px solid #f3b27a', background: '#fff6ee', borderRadius: 12,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong style={{ fontSize: 14.5 }}>
              {pastDue
                ? 'Your subscription payment failed'
                : `Activate your ${planForHomes(homes).label} plan`}
            </strong>
            <span style={{ fontSize: 13, color: '#6b5544' }}>
              {monthlyTotalLabel(homes)} · {homes} homes.{' '}
              {pastDue
                ? 'Update your payment method to keep your community running.'
                : 'Your community is live — subscribe to keep it active.'}
            </span>
          </div>
          <button
            className="admin-primary-btn"
            onClick={pastDue ? () => setShowSub(true) : activatePlan}
            disabled={paying}
          >
            {paying ? 'Opening…' : pastDue ? 'Manage subscription' : 'Subscribe now'}
          </button>
        </div>
      )}

      {sub === 'active' && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', margin: '4px 0 20px', padding: '14px 18px',
          border: '1px solid #d8cfc4', background: '#faf7f2', borderRadius: 12,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong style={{ fontSize: 14.5 }}>{planForHomes(homes).label} plan · active</strong>
            <span style={{ fontSize: 13, color: '#6b5544' }}>
              {monthlyTotalLabel(homes)} · {homes} homes. Change your plan or cancel anytime.
            </span>
          </div>
          <button className="admin-secondary-btn" onClick={() => setShowSub(true)}>
            Manage subscription
          </button>
        </div>
      )}

      {showSub && (
        <SubscriptionDialog
          currentHomes={homes}
          onClose={() => setShowSub(false)}
          onChanged={() => { setShowSub(false); load() }}
        />
      )}

      <div className="admin-dash-stats">
        {stats.map(s => (
          <div key={s.label} className="admin-dash-stat">
            <div className="admin-dash-stat-val">{s.value}</div>
            <div className="admin-dash-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick "ease" shortcuts — the fastest paths to a live community. Each
          links to an existing flow; the checklist below tracks completion. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, margin: '0 0 20px' }}>
        {[
          { tag: 'No CSV needed', title: 'Add your residents', blurb: 'Import your owner roster or add households one at a time.', href: '/admin/residents' },
          { tag: 'Sets itself up', title: 'Upload your documents', blurb: 'Add your bylaws, declaration, budget, insurance, and minutes.', href: '/admin/documents' },
          { tag: 'No emails? No problem', title: 'Invite your owners', blurb: 'Bulk-invite from your roster, or share the join code below.', href: '/admin/voice/roster' },
        ].map(c => (
          <Link key={c.title} href={c.href} style={{
            display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none', color: 'inherit',
            border: '1px solid #e7d9c7', background: '#fffdfb', borderRadius: 14, padding: '16px 16px 15px',
          }}>
            <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#b5481f', background: 'rgba(229,96,31,0.12)', padding: '3px 9px', borderRadius: 999 }}>{c.tag}</span>
            <span style={{ fontSize: 15.5, fontWeight: 700 }}>{c.title}</span>
            <span style={{ fontSize: 12.5, color: '#6b5544', lineHeight: 1.45, flex: 1 }}>{c.blurb}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#EB5507' }}>Open &rarr;</span>
          </Link>
        ))}
      </div>

      <div className="admin-dash-card">
        <div className="admin-dash-card-head">
          <div>
            <h2 className="admin-dash-card-title">Set up your community</h2>
            <span className="admin-dash-card-sub">
              {doneCount === items.length
                ? 'All set — your community is live. 🎉'
                : `Follow these ${items.length} steps top to bottom. ${doneCount} of ${items.length} done.`}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {doneCount < items.length && (
              <Link href="/admin/setup" className="admin-primary-btn" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
                Guided setup &rarr;
              </Link>
            )}
            <div className="admin-dash-ring" style={{ ['--pct' as any]: `${pct}%` }}>{pct}%</div>
          </div>
        </div>
        <ul className="admin-check-list">
          {items.map((i, idx) => (
            <li key={i.label} className={`admin-check-item${i.done ? ' done' : ''}`}>
              <span className="admin-check-dot">{i.done ? '✓' : idx + 1}</span>
              <div className="admin-check-body">
                <span className="admin-check-label">{i.label}</span>
                <span className="admin-check-hint">{i.hint}</span>
              </div>
              <Link href={i.href} className="admin-check-go">{i.done ? 'Edit →' : 'Start →'}</Link>
            </li>
          ))}
        </ul>
        <p className="admin-dash-card-foot">
          Last step: share your join code below so owners can sign in to their homes.
        </p>
      </div>

      {community?.join_code && (
        <div className="admin-dash-card admin-dash-code">
          <div>
            <div className="admin-dash-card-sub">Resident join code</div>
            <div className="admin-dash-code-val">{community.join_code}</div>
            <div className="admin-dash-card-sub">Residents enter this at the Get started page to join.</div>
          </div>
          <button className="admin-secondary-btn" onClick={copyCode}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
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
                    // Home count drives the plan: ≤25 Free, 26–100 Pro, 101–500
                    // Premium, 500+ Enterprise. Clicking a box still overrides.
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
