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

function SubscriptionDialog({ currentHomes, onClose, onChanged }: {
  currentHomes: number; onClose: () => void; onChanged: () => void
}) {
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [homes, setHomes] = useState(String(currentHomes || ''))
  const [tier, setTier] = useState<'auto' | 'pro' | 'premium' | 'enterprise'>('auto')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const s = await manageSubscription('status')
      if (s?.error) setErr(s.error); else setStatus(s)
      setLoading(false)
    })()
  }, [])

  const n = Math.max(0, parseInt(homes || '0', 10) || 0)
  const band = planForHomes(n)
  const effPlan = tier === 'auto' ? band.plan : tier
  const perHome = tier === 'auto' ? band.perHomeCents : TIER_RATE[tier]
  const isFree = perHome === 0
  const previewMonthly = isFree ? 'Free' : `$${((perHome * n) / 100).toLocaleString('en-US')}/mo`
  const planLabel = effPlan.charAt(0).toUpperCase() + effPlan.slice(1)
  const unchanged = n === currentHomes && tier === 'auto'
  const periodEnd = status?.current_period_end
    ? new Date(status.current_period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null
  const canceling = !!status?.cancel_at_period_end

  const doChange = async () => {
    setBusy('change'); setErr(null); setMsg(null)
    const payload: { home_count: number; plan?: string } = { home_count: n }
    if (tier !== 'auto') payload.plan = tier
    const r = await manageSubscription('change_plan', payload)
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
      display: 'grid', placeItems: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 460, background: '#fff', borderRadius: 16,
        padding: '22px 24px', boxShadow: '0 24px 60px rgba(40,15,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Manage subscription</h2>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#8a7560', lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: '20px 0', color: '#6b5544', fontSize: 14 }}>Loading…</div>
        ) : (
          <>
            {status && (
              <div style={{ fontSize: 13.5, color: '#4a3a2c', marginBottom: 16, lineHeight: 1.5 }}>
                Current: <strong>{planForHomes(currentHomes).label} plan</strong> · {monthlyTotalLabel(currentHomes)} · {currentHomes} homes
                {canceling && periodEnd && (
                  <div style={{ marginTop: 6, color: '#b5481f', fontWeight: 600 }}>
                    Cancels on {periodEnd}. You can resume before then.
                  </div>
                )}
                {!canceling && periodEnd && (
                  <div style={{ marginTop: 4, color: '#8a7560' }}>Renews {periodEnd}.</div>
                )}
              </div>
            )}

            {/* Change plan */}
            <div style={{ borderTop: '1px solid #eee', paddingTop: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Change plan</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: '#6b5544' }}>
                  Number of homes
                  <input value={homes} inputMode="numeric"
                    onChange={(e) => setHomes(e.target.value.replace(/[^0-9]/g, ''))}
                    style={{ padding: '9px 11px', borderRadius: 9, border: '1px solid #d8cfc4', fontSize: 14 }} />
                </label>
                <label style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: '#6b5544' }}>
                  Tier
                  <select value={tier} onChange={(e) => setTier(e.target.value as any)}
                    style={{ padding: '9px 11px', borderRadius: 9, border: '1px solid #d8cfc4', fontSize: 14, background: '#fff' }}>
                    <option value="auto">Auto (by size)</option>
                    <option value="pro">Pro ($2/home)</option>
                    <option value="premium">Premium ($5/home)</option>
                    <option value="enterprise">Enterprise ($10/home)</option>
                  </select>
                </label>
              </div>
              <div style={{ marginTop: 10, fontSize: 13.5 }}>
                New: <strong>{planLabel} plan</strong> · <strong>{previewMonthly}</strong>
                {!isFree && <span style={{ color: '#8a7560' }}> · prorated to today</span>}
              </div>
              {isFree && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: '#b5481f' }}>
                  That size is Free — to stop paying, use Cancel below instead.
                </div>
              )}
              <button className="admin-primary-btn" style={{ marginTop: 12, width: '100%' }}
                onClick={doChange} disabled={busy != null || isFree || unchanged}>
                {busy === 'change' ? 'Updating…' : 'Update plan'}
              </button>
            </div>

            {/* Cancel / resume */}
            <div style={{ borderTop: '1px solid #eee', marginTop: 16, paddingTop: 14 }}>
              {canceling ? (
                <button className="admin-primary-btn" style={{ width: '100%' }}
                  onClick={doResume} disabled={busy != null}>
                  {busy === 'resume' ? 'Resuming…' : 'Resume subscription'}
                </button>
              ) : (
                <button onClick={doCancel} disabled={busy != null}
                  style={{ width: '100%', padding: '11px', borderRadius: 999, border: '1px solid #e0b4a4', background: '#fff', color: '#b5481f', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  {busy === 'cancel' ? 'Canceling…' : 'Cancel subscription'}
                </button>
              )}
              <div style={{ marginTop: 8, fontSize: 12, color: '#8a7560', textAlign: 'center' }}>
                Cancellations take effect at the end of your billing period.
              </div>
            </div>

            {err && <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#fdecec', color: '#a32020', fontSize: 13 }}>{err}</div>}
            {msg && <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#eaf7ec', color: '#1d7a33', fontSize: 13 }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  )
}
