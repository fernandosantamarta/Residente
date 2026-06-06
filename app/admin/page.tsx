'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { planForHomes } from '@/lib/plan'

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

  // Hint under the progress ring — the next step still to do.
  const nextStep = items.find(i => !i.done)?.label

  return (
    <div className="admin-page">
      <div className="admin-kicker">Get started</div>
      <h1 className="admin-h1">Let&rsquo;s get <span style={{ color: '#E14909' }}>{community?.name || 'your community'}</span> live.</h1>
      <p className="admin-dek">Three quick moves and your neighbors are in. Each step ticks off on its own as you go.</p>

      {needsActivation && (
        <Link href="/admin/billing" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', margin: '4px 0 20px', padding: '14px 18px', textDecoration: 'none',
          border: '1px solid #f3b27a', background: '#fff6ee', borderRadius: 12, color: 'inherit',
        }}>
          <span style={{ fontSize: 13.5, color: '#6b5544' }}>
            <strong style={{ color: '#2a1206' }}>
              {pastDue ? 'Your subscription payment failed.' : `Activate your ${planForHomes(homes).label} plan.`}
            </strong>{' '}
            {pastDue ? 'Update it in Billing to keep your community running.' : 'Subscribe in Billing to keep it active.'}
          </span>
          <span className="admin-primary-btn" style={{ whiteSpace: 'nowrap' }}>
            {pastDue ? 'Go to Billing →' : 'Subscribe →'}
          </span>
        </Link>
      )}

      {/* Progress + guided setup — the mock hero row. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '6px 0 26px', flexWrap: 'wrap' }}>
        <div className="admin-dash-ring" style={{ ['--pct' as any]: `${pct}%` }}>{pct}%</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{doneCount} of {items.length} steps done</div>
          <div style={{ fontSize: 13.5, color: '#6b5544', marginTop: 2 }}>
            {doneCount === items.length ? 'All set — your community is live. 🎉' : `Next: ${nextStep || 'finish setup'}.`}
          </div>
        </div>
        {doneCount < items.length && (
          <Link href="/admin/setup" className="admin-primary-btn" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Start guided setup &rarr;
          </Link>
        )}
      </div>

      {/* The 3 "ease" cards — mock layout: pill, title, blurb, full-width button. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, margin: '0 0 22px' }}>
        {[
          { tag: 'No CSV needed', title: 'Paste your roster', blurb: 'Copy owners straight from Excel — we match the columns.', href: '/admin/residents', cta: 'Paste & import', primary: true },
          { tag: 'Sets itself up', title: 'Upload your docs', blurb: 'Drop your CC&Rs — we pre-fill rules, fines & reserves.', href: '/admin/documents', cta: 'Choose file', primary: false },
          { tag: 'No emails? No problem', title: 'Print join poster', blurb: 'A lobby flyer with a QR code. Residents scan to join.', href: '/admin/voice/roster', cta: 'Download poster', primary: false },
        ].map(c => (
          <div key={c.title} style={{ display: 'flex', flexDirection: 'column', gap: 9, border: '1px solid #efe1d2', background: '#fff', borderRadius: 18, padding: '20px 18px 18px', boxShadow: '0 1px 2px rgba(42,18,6,0.05)' }}>
            <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#b5481f', background: 'rgba(229,96,31,0.12)', padding: '3px 9px', borderRadius: 999 }}>{c.tag}</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{c.title}</span>
            <span style={{ fontSize: 13, color: '#6b5544', lineHeight: 1.45, flex: 1 }}>{c.blurb}</span>
            <Link href={c.href} className={c.primary ? 'admin-primary-btn' : undefined}
              style={c.primary
                ? { textDecoration: 'none', textAlign: 'center' }
                : { textDecoration: 'none', textAlign: 'center', padding: '10px 16px', borderRadius: 999, border: '1px solid #d8c3ad', color: '#2A1206', fontWeight: 700, fontSize: 13.5 }}>
              {c.cta}
            </Link>
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

      {/* Persistent entry to the subscription tab (the bar no longer carries it). */}
      <p className="admin-dek" style={{ marginTop: 18 }}>
        Manage your plan, payment, and invoices on the{' '}
        <Link href="/admin/billing" style={{ color: '#E14909', fontWeight: 700 }}>Plan &amp; billing</Link> page.
      </p>
    </div>
  )
}
