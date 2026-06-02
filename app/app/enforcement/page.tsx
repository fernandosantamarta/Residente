'use client'

// Easy Voice — Violations & fines (resident self-service, read-only). A self-
// contained route (NOT yet wired into the rail / Easy Voice tabs — see the
// one-line wire-up note at the bottom) so it doesn't collide with in-progress
// Easy Voice front-end work. Residents see their OWN violations/fines, any
// hearing on them, and any voting/use-rights suspension — backed by the
// ev_violations "residents read own", ev_violation_hearings "owner reads own",
// and ev_suspensions "owner reads own" RLS. Read-only: the board acts; this is
// transparency. FS 718.303 / 720.305.
//
// Reuses the shared grid-free con-* containers (con-wrap/con-card) + theme-color
// inline rows; copy is local English (no i18n keys).

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import {
  STAGE_LABELS, SUSPENSION_RIGHTS_LABELS, SUSPENSION_BASIS_LABELS,
  fineAccrued, HEARING_NOTICE_DAYS,
  type ViolationRow, type HearingRow, type SuspensionRow,
  type EnforcementStage, type SuspensionRights, type SuspensionBasis,
} from '@/lib/compliance/enforcement'

const withTimeout = (p: any, ms = 10000): Promise<any> =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const STAGE_COLOR: Record<string, string> = {
  none: '#475467', proposed: '#175CD3', notice_sent: '#B54708', hearing_set: '#B54708',
  upheld: '#067647', rejected: '#98A2B3', levied: '#B42318',
}
const SUSP_COLOR: Record<string, string> = { proposed: '#175CD3', active: '#B42318', lifted: '#067647' }

export default function ResidentEnforcementPage() {
  const { profile } = useAuth() || {}
  const [violations, setViolations] = useState<ViolationRow[]>([])
  const [hearings, setHearings] = useState<HearingRow[]>([])
  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data: v } = (await withTimeout(
        supabase.from('ev_violations').select('*').eq('profile_id', profile.id).order('opened_at', { ascending: false }),
      )) as any
      // RLS scopes hearings to the resident's own violations; no profile column to filter on.
      const { data: h } = (await withTimeout(supabase.from('ev_violation_hearings').select('*'))) as any
      const { data: s } = (await withTimeout(
        supabase.from('ev_suspensions').select('*').eq('profile_id', profile.id).order('created_at', { ascending: false }),
      )) as any
      setViolations((v as ViolationRow[]) || [])
      setHearings((h as HearingRow[]) || [])
      setSuspensions((s as SuspensionRow[]) || [])
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [profile?.id])
  useEffect(() => { load() }, [load])

  const hearingFor = (vid: string) =>
    hearings.filter(h => String(h.violation_id) === vid)
      .sort((a, b) => (b.notice_sent_at || '').localeCompare(a.notice_sent_at || ''))[0]

  const activeSusp = suspensions.filter(s => String(s.status ?? 'proposed') !== 'lifted')
  const pastSusp = suspensions.filter(s => String(s.status ?? '') === 'lifted')

  return (
    <section className="con-wrap ev-section">
      <Link href="/app/documents#violations" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#0A2440', textDecoration: 'none', marginBottom: 14 }}>
        &larr; Back to My Violations
      </Link>
      <div className="voice-page-head">
        <h1 className="voice-page-title">Violations &amp; fines</h1>
        <p className="voice-page-sub">
          Any rule violations, fines, or suspensions on your account. Fines and use-rights suspensions are
          decided by the board, and you have the right to at least {HEARING_NOTICE_DAYS.value} days&apos; notice and a
          hearing before an independent committee before one is imposed.
        </p>
      </div>

      {/* Violations & fines */}
      <section className="con-card" style={{ marginBottom: 18 }}>
        <h2 className="con-card-title">Your violations &amp; fines</h2>
        {loading && <div className="con-empty">Loading…</div>}
        {!loading && violations.length === 0 && (
          <div className="con-empty">You have no violations or fines on record. 🎉</div>
        )}
        {!loading && violations.map(v => {
          const isFine = v.kind === 'fine'
          const closed = String(v.status ?? 'open') === 'closed' || !!v.resolution
          const stage = String(v.enforcement_stage ?? 'none') as EnforcementStage
          const color = closed ? '#067647' : isFine ? (STAGE_COLOR[stage] || '#B54708') : '#B54708'
          const amount = isFine ? fineAccrued(v).capped : 0
          const h = hearingFor(v.id)
          const pillText = closed
            ? (v.resolution === 'waived' ? 'Waived' : v.resolution === 'dismissed' ? 'Dismissed' : 'Resolved')
            : isFine ? STAGE_LABELS[stage] : 'Warning'
          return (
            <div key={v.id} style={ROW_WRAP}>
              <div style={ROW_STATIC}>
                <div style={{ minWidth: 0 }}>
                  <div style={ROW_TITLE}>{v.rule_title || (isFine ? 'Fine' : 'Rule reminder')}</div>
                  <div style={ROW_META}>
                    {fmtDate(v.opened_at)}
                    {isFine && amount > 0 ? ` · ${fmt$(amount)}${v.fine_continuing ? '/accrued' : ''}` : ''}
                  </div>
                  {isFine && !closed && h && (
                    <div style={{ ...ROW_META, color: '#B54708' }}>
                      {h.scheduled_at
                        ? `Hearing scheduled ${fmtDate(h.scheduled_at)}`
                        : h.notice_sent_at ? `${HEARING_NOTICE_DAYS.value}-day hearing notice sent ${fmtDate(h.notice_sent_at)}` : ''}
                      {h.decision && h.decision !== 'pending' ? ` · committee ${h.decision === 'upheld' ? 'upheld' : h.decision}` : ''}
                    </div>
                  )}
                  {isFine && !closed && (
                    <div style={{ ...ROW_META, color: 'rgba(15,28,46,0.5)' }}>
                      You may attend the hearing, be heard, and present evidence before the committee.
                    </div>
                  )}
                </div>
                <span style={pill(color)}>{pillText}</span>
              </div>
            </div>
          )
        })}
      </section>

      {/* Suspensions */}
      <section className="con-card">
        <h2 className="con-card-title">Voting &amp; use-rights suspensions</h2>
        {loading && <div className="con-empty">Loading…</div>}
        {!loading && activeSusp.length === 0 && pastSusp.length === 0 && (
          <div className="con-empty">No suspensions on your account.</div>
        )}
        {!loading && [...activeSusp, ...pastSusp].map(s => {
          const st = String(s.status ?? 'proposed')
          const color = SUSP_COLOR[st] || '#475467'
          const rights = SUSPENSION_RIGHTS_LABELS[(s.rights ?? 'voting') as SuspensionRights]
          const basis = SUSPENSION_BASIS_LABELS[(s.basis ?? 'delinquency_90') as SuspensionBasis]
          return (
            <div key={s.id} style={ROW_WRAP}>
              <div style={ROW_STATIC}>
                <div style={{ minWidth: 0 }}>
                  <div style={ROW_TITLE}>{rights}</div>
                  <div style={ROW_META}>
                    {basis}
                    {s.started_at ? ` · since ${fmtDate(s.started_at)}` : ''}
                    {s.ended_at ? ` · lifted ${fmtDate(s.ended_at)}` : ''}
                    {s.amount_owed ? ` · ${fmt$(s.amount_owed)} owed` : ''}
                  </div>
                </div>
                <span style={pill(color)}>{st === 'lifted' ? 'Lifted' : st === 'active' ? 'Active' : 'Proposed'}</span>
              </div>
            </div>
          )
        })}
        {!loading && activeSusp.some(s => String(s.basis) === 'delinquency_90') && (
          <p style={{ fontSize: 12.5, color: 'rgba(15,28,46,0.6)', marginTop: 12 }}>
            A suspension for being more than 90 days past due remains in effect until the balance is paid in full.
          </p>
        )}
      </section>
    </section>
  )
}

function pill(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }
}
const ROW_WRAP: React.CSSProperties = { borderBottom: '1px solid rgba(15,28,46,0.07)' }
const ROW_STATIC: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: '12px 2px' }
const ROW_TITLE: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: '#0A2440' }
const ROW_META: React.CSSProperties = { fontSize: 12.5, color: 'rgba(15,28,46,0.6)', marginTop: 2 }

// ── Wire-up when your Easy Voice front-end work settles ──
// Left rail (app/app/layout.tsx NAV): { href: '/app/enforcement', label: 'Violations', icon: … }
// or surface as an Easy Voice hub tab. Reachable directly at /app/enforcement until then.
