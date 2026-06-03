'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { startSubscriptionCheckout } from '@/lib/signup'
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
  const items = [
    { label: 'Review your budget', done: (counts?.budgets || 0) > 0, href: '/admin/community', hint: 'Edit the starter categories and set amounts.' },
    { label: 'Set your monthly dues', done: dues > 0, href: '/admin/community', hint: 'So residents see what they owe.' },
    { label: 'Add your residents', done: (counts?.residents || 0) > 1, href: '/admin/residents', hint: 'Import your roster (CSV) or add owners.' },
    { label: 'Add board members', done: (counts?.board || 0) >= 1, href: '/admin/voice', hint: 'Assign President, Treasurer, and the rest.' },
    { label: 'Upload key documents', done: (counts?.documents || 0) >= 1, href: '/admin/documents', hint: 'Bylaws, budget, insurance, latest minutes.' },
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
          <button className="admin-primary-btn" onClick={activatePlan} disabled={paying}>
            {paying ? 'Opening…' : pastDue ? 'Update payment' : 'Subscribe now'}
          </button>
        </div>
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
            <h2 className="admin-dash-card-title">Get your community live</h2>
            <span className="admin-dash-card-sub">{doneCount} of {items.length} done</span>
          </div>
          <div className="admin-dash-ring" style={{ ['--pct' as any]: `${pct}%` }}>{pct}%</div>
        </div>
        <ul className="admin-check-list">
          {items.map(i => (
            <li key={i.label} className={`admin-check-item${i.done ? ' done' : ''}`}>
              <span className="admin-check-dot">{i.done ? '✓' : ''}</span>
              <div className="admin-check-body">
                <span className="admin-check-label">{i.label}</span>
                <span className="admin-check-hint">{i.hint}</span>
              </div>
              {!i.done && <Link href={i.href} className="admin-check-go">Do it →</Link>}
            </li>
          ))}
        </ul>
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
