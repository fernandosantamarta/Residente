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
          <div className="admin-dash-ring" style={{ ['--pct' as any]: `${pct}%` }}>{pct}%</div>
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
const PLAN_CARDS: { key: TierKey; name: string; per: number; band: string; popular?: boolean }[] = [
  { key: 'free',       name: 'Free',       per: 0,    band: 'Up to 25 homes' },
  { key: 'pro',        name: 'Pro',        per: 200,  band: '26–100 homes', popular: true },
  { key: 'premium',    name: 'Premium',    per: 500,  band: '101–500 homes' },
  { key: 'enterprise', name: 'Enterprise', per: 1000, band: '500+ homes' },
]

function SubscriptionDialog({ currentHomes, onClose, onChanged }: {
  currentHomes: number; onClose: () => void; onChanged: () => void
}) {
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [homes, setHomes] = useState(String(currentHomes || ''))
  const [tier, setTier] = useState<TierKey>(planForHomes(currentHomes).plan as TierKey)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const s = await manageSubscription('status')
      if (s?.error) setErr(s.error)
      else { setStatus(s); if (s?.plan && TIER_RATE[s.plan] !== undefined) setTier(s.plan as TierKey) }
      setLoading(false)
    })()
  }, [])

  const n = Math.max(0, parseInt(homes || '0', 10) || 0)
  const perHome = TIER_RATE[tier]
  const isFree = tier === 'free'
  const previewMonthly = isFree ? 'Free' : `$${((perHome * n) / 100).toLocaleString('en-US')}/mo`
  const currentPlan = (status?.plan as string) || planForHomes(currentHomes).plan
  const changed = tier !== currentPlan || n !== currentHomes
  const periodEnd = status?.current_period_end
    ? new Date(status.current_period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null
  const canceling = !!status?.cancel_at_period_end

  const doChange = async () => {
    setBusy('change'); setErr(null); setMsg(null)
    const r = await manageSubscription('change_plan', { home_count: n, plan: tier })
    if (r?.error) { setErr(r.error); setBusy(null); return }
    setMsg(`Now on the ${r.label} plan — ${previewMonthly}.`)
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
      <div onClick={(e) => e.stopPropagation()} style={{
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
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>Choose your plan</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#6b5544' }}>
                  Homes
                  <input value={homes} inputMode="numeric"
                    onChange={(e) => setHomes(e.target.value.replace(/[^0-9]/g, ''))}
                    style={{ width: 90, padding: '9px 12px', borderRadius: 10, border: '1px solid #d8cfc4', fontSize: 15 }} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {PLAN_CARDS.map((p) => {
                  const sel = tier === p.key
                  const monthly = p.per === 0 ? 'Free' : `$${((p.per * n) / 100).toLocaleString('en-US')}/mo`
                  return (
                    <button key={p.key} type="button" onClick={() => setTier(p.key)} style={{
                      textAlign: 'left', cursor: 'pointer', position: 'relative',
                      borderRadius: 16, padding: '16px 16px 15px',
                      border: sel ? '2px solid #E5601F' : '2px solid #ece4da',
                      background: sel ? '#fff7f1' : '#fff',
                      boxShadow: sel ? '0 6px 18px rgba(229,96,31,0.16)' : 'none',
                      transition: 'border-color .12s, background .12s',
                    }}>
                      {p.popular && (
                        <span style={{ position: 'absolute', top: -10, right: 12, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#fff', background: '#E5601F', padding: '3px 9px', borderRadius: 999 }}>Popular</span>
                      )}
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#2a1206' }}>{p.name}</div>
                      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: sel ? '#E5601F' : '#2a1206', lineHeight: 1 }}>
                        {p.per === 0 ? '$0' : `$${p.per / 100}`}
                        {p.per > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#8a7560' }}> /home/mo</span>}
                      </div>
                      <div style={{ marginTop: 7, fontSize: 12.5, color: '#8a7560' }}>{p.band}</div>
                      <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid #f0e8df', fontSize: 13, fontWeight: 700, color: '#4a3a2c' }}>
                        {monthly}
                      </div>
                    </button>
                  )
                })}
              </div>

              {isFree ? (
                <button onClick={doCancel} disabled={busy != null || canceling}
                  style={{ marginTop: 18, width: '100%', padding: '14px', borderRadius: 999, border: '1px solid #e0b4a4', background: '#fff', color: '#b5481f', fontWeight: 800, fontSize: 15.5, cursor: canceling ? 'default' : 'pointer', opacity: canceling ? 0.5 : 1 }}>
                  {canceling ? 'Already set to cancel' : busy === 'cancel' ? 'Canceling…' : 'Cancel — drop to Free at period end'}
                </button>
              ) : (
                <button className="admin-primary-btn" style={{ marginTop: 18, width: '100%', padding: '14px', fontSize: 15.5 }}
                  onClick={doChange} disabled={busy != null || !changed}>
                  {busy === 'change' ? 'Updating…' : canceling ? `Keep active on ${PLAN_CARDS.find(p => p.key === tier)?.name} — ${previewMonthly}` : `Switch to ${PLAN_CARDS.find(p => p.key === tier)?.name} — ${previewMonthly}`}
                </button>
              )}
              <div style={{ marginTop: 10, fontSize: 12.5, color: '#8a7560', textAlign: 'center' }}>
                Plan changes are prorated. Cancellations take effect at the end of your billing period.
              </div>
            </div>

            {err && <div style={{ marginTop: 16, padding: '11px 13px', borderRadius: 10, background: '#fdecec', color: '#a32020', fontSize: 14 }}>{err}</div>}
            {msg && <div style={{ marginTop: 16, padding: '11px 13px', borderRadius: 10, background: '#eaf7ec', color: '#1d7a33', fontSize: 14 }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  )
}
