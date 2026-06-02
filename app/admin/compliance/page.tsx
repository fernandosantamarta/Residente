'use client'

// Compliance dashboard (Monitor surface). Merges per-domain signal producers
// into one prioritised board worklist. Advisory only — nothing here blocks.
// Each compliance domain plugs in by exporting a `*Signals()` producer and
// adding it to `gatherSignals()` below.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { sortSignals, ATTORNEY_REVIEW_BANNER, type ComplianceSignal, type Severity } from '@/lib/compliance/rules-core'
import { communityDuesConfig } from '@/lib/dues'
import { foundationSignals } from '@/lib/compliance/signals'
import { estoppelSignals, type EstoppelRequestRow } from '@/lib/compliance/estoppel'
import {
  collectionsSignals, paymentPlanSignals, delinquencySignals, delinquentOwnersWithoutCase,
  type CollectionCaseRow, type PaymentPlanRow,
} from '@/lib/compliance/collections'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const SEVERITY_META: Record<Severity, { label: string; color: string; bg: string }> = {
  overdue: { label: 'Overdue', color: '#B42318', bg: 'rgba(180,35,24,0.08)' },
  soon:    { label: 'Due soon', color: '#B54708', bg: 'rgba(181,71,8,0.08)' },
  info:    { label: 'To do',   color: '#175CD3', bg: 'rgba(23,92,211,0.07)' },
}

// Resilient select: a table that hasn't had its migration run yet returns an
// error rather than throwing — treat that as "no rows" so the dashboard still
// renders the signals it can compute.
async function safeSelect(table: string, communityId: string): Promise<any[]> {
  try {
    const { data, error } = (await withTimeout(
      supabase.from(table).select('*').eq('community_id', communityId),
    )) as any
    if (error) return []
    return data || []
  } catch {
    return []
  }
}

function gatherSignals(
  community: any,
  estoppel: EstoppelRequestRow[],
  cases: CollectionCaseRow[],
  plans: PaymentPlanRow[],
  residents: any[],
  payByResident: Record<string, { amount: number }[]>,
): ComplianceSignal[] {
  const candidates = community ? delinquentOwnersWithoutCase({
    residents, paymentsByResident: payByResident, cases,
    monthlyDues: Number(community.monthly_dues) || 0,
    duesConfig: communityDuesConfig(community),
    minBalance: Number(community.collections_min_balance) || 0,
    minDays: Number(community.collections_min_days) || 0,
    dueDay: Number(community.assessment_due_day) || 1,
  }) : []
  return sortSignals([
    ...foundationSignals(community),
    ...estoppelSignals(estoppel),
    ...collectionsSignals(cases, community?.association_type),
    ...paymentPlanSignals(plans),
    ...delinquencySignals(candidates),
    // Future domains plug in here: structuralSignals(), financialSignals(), …
  ])
}

export default function CompliancePage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [estoppel, setEstoppel] = useState<EstoppelRequestRow[]>([])
  const [cases, setCases] = useState<CollectionCaseRow[]>([])
  const [plans, setPlans] = useState<PaymentPlanRow[]>([])
  const [residents, setResidents] = useState<any[]>([])
  const [payByResident, setPayByResident] = useState<Record<string, { amount: number }[]>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = (await withTimeout(
        supabase.from('communities').select('*').eq('id', communityId).single(),
      )) as any
      if (error) throw error
      setCommunity(data)
      setEstoppel(await safeSelect('ev_estoppel_requests', communityId))
      setCases(await safeSelect('ev_collection_cases', communityId))
      setPlans(await safeSelect('ev_payment_plans', communityId))
      setResidents(await safeSelect('residents', communityId))
      const pays = await safeSelect('payments', communityId)
      const map: Record<string, { amount: number }[]> = {}
      for (const p of pays) { (map[p.resident_id] ||= []).push({ amount: Number(p.amount) || 0 }) }
      setPayByResident(map)
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load compliance data'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const signals = useMemo(() => gatherSignals(community, estoppel, cases, plans, residents, payByResident), [community, estoppel, cases, plans, residents, payByResident])
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { overdue: 0, soon: 0, info: 0 }
    for (const s of signals) c[s.severity]++
    return c
  }, [signals])

  return (
    <div className="admin-page">
      <div className="admin-kicker">Florida compliance</div>
      <h1 className="admin-h1">Compliance dashboard</h1>
      <p className="admin-dek">
        What your association needs to attend to under Florida statutes (FS 718 / 720). These are
        advisory reminders — you decide how to act on them.
      </p>

      <div className="admin-note admin-note-warn" style={{ fontSize: 12.5 }}>
        {ATTORNEY_REVIEW_BANNER}
      </div>

      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked to your account yet. Run the setup SQL, then reload.
        </div>
      )}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div style={{ display: 'flex', gap: 12, margin: '16px 0 22px', flexWrap: 'wrap' }}>
            {(['overdue', 'soon', 'info'] as Severity[]).map(sev => (
              <div key={sev} style={{
                flex: '1 1 140px', padding: '14px 16px', borderRadius: 12,
                background: SEVERITY_META[sev].bg, border: `1px solid ${SEVERITY_META[sev].color}22`,
              }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: SEVERITY_META[sev].color, lineHeight: 1 }}>
                  {counts[sev]}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.8, marginTop: 4 }}>
                  {SEVERITY_META[sev].label}
                </div>
              </div>
            ))}
          </div>

          {signals.length === 0 ? (
            <div className="admin-note" style={{ textAlign: 'center', padding: '28px 16px' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
              Nothing flagged right now. As you add buildings, budgets, meetings, and records,
              this dashboard will track the statutory deadlines for you.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {signals.map(s => (
                <SignalCard key={s.id} signal={s} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SignalCard({ signal: s }: { signal: ComplianceSignal }) {
  const meta = SEVERITY_META[s.severity]
  const body = (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)',
      borderLeft: `4px solid ${meta.color}`, background: '#fff',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
            color: meta.color, background: meta.bg, padding: '2px 8px', borderRadius: 999,
          }}>{meta.label}</span>
          <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.6 }}>{s.domain}</span>
          {s.citation && <span style={{ fontSize: 11.5, opacity: 0.45, fontFamily: 'monospace' }}>{s.citation}</span>}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{s.title}</div>
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>{s.detail}</div>
      </div>
      {s.href && <span style={{ fontSize: 13, color: meta.color, fontWeight: 700, whiteSpace: 'nowrap' }}>Review →</span>}
    </div>
  )
  return s.href ? <Link href={s.href} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : body
}
