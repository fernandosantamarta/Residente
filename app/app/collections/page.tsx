'use client'

// Easy Track — Account standing (resident, read-only). A self-contained route
// (not yet wired into the rail / Easy Track tabs — see the note at the bottom)
// so it doesn't collide with in-progress front-end work. If the board has opened
// a collection case on the owner's account, they see its stage, the amount owed,
// any payment plan, and a plain-language explanation — via the ev_collection_cases
// / ev_payment_plans owner-read RLS. Read-only: the board works the statutory
// ladder; this is transparency. FS 718.116/.121 / 720.3085/.305.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { STAGE_LABELS, isOpenStage, type CollectionCaseRow, type CollectionStage } from '@/lib/compliance/collections'

const withTimeout = (p: any, ms = 10000): Promise<any> =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const STAGE_COLOR: Record<string, string> = {
  delinquent: '#B54708', notice_30: '#175CD3', intent_to_lien: '#B54708',
  lien_recorded: '#B42318', intent_to_foreclose: '#B42318', foreclosure: '#B42318',
  resolved: '#067647', cancelled: '#98A2B3',
}
// Plain-language, resident-facing explanation of each stage.
const STAGE_EXPLAIN: Record<string, string> = {
  delinquent: 'Your account is past due. Please bring it current to avoid further collection steps and costs.',
  notice_30: 'A notice of late assessment has been sent. Paying in full within the notice period avoids collection costs and attorney fees.',
  intent_to_lien: 'A notice of intent to record a claim of lien has been sent. Paying in full stops the lien from being recorded.',
  lien_recorded: 'A claim of lien has been recorded against your unit/parcel. Contact the association to resolve the balance.',
  intent_to_foreclose: 'A notice of intent to foreclose the lien has been sent. Please contact the association right away.',
  foreclosure: 'A foreclosure action has been filed. Please contact the association and consider legal advice.',
  resolved: 'Resolved — your account is current. Thank you.',
  cancelled: 'This case has been cancelled.',
}

export default function ResidentCollectionsPage() {
  const { profile } = useAuth() || {}
  const [cases, setCases] = useState<CollectionCaseRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data } = (await withTimeout(
        supabase.from('ev_collection_cases').select('*').eq('profile_id', profile.id).order('opened_at', { ascending: false }),
      )) as any
      setCases((data as CollectionCaseRow[]) || [])
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [profile?.id])
  useEffect(() => { load() }, [load])

  const open = cases.filter(c => isOpenStage(c.stage))
  const closed = cases.filter(c => !isOpenStage(c.stage))

  return (
    <section className="con-wrap ev-section">
      <div className="voice-page-head">
        <h1 className="voice-page-title">Account standing</h1>
        <p className="voice-page-sub">
          Where your account stands with the association. If a balance is past due, you&apos;ll see the
          current step and what it means. Questions? Use Easy Voice → Contact.
        </p>
      </div>

      <section className="con-card">
        <h2 className="con-card-title">Collections</h2>
        {loading && <div className="con-empty">Loading…</div>}
        {!loading && open.length === 0 && closed.length === 0 && (
          <div className="con-empty">Your account is in good standing — no collection cases.</div>
        )}
        {!loading && open.length === 0 && closed.length > 0 && (
          <div className="con-empty">Your account is current. No open collection cases.</div>
        )}
        {!loading && [...open, ...closed].map(c => {
          const stage = String(c.stage ?? 'delinquent') as CollectionStage
          const color = STAGE_COLOR[stage] || '#475467'
          const owed = c.total_balance ?? c.principal_balance
          const isOpen = isOpenStage(stage)
          return (
            <div key={c.id} style={ROW_WRAP}>
              <div style={ROW}>
                <div style={{ minWidth: 0 }}>
                  <div style={ROW_TITLE}>
                    {STAGE_LABELS[stage] || stage}
                    {owed != null && <span style={{ marginLeft: 8, color: '#0A2440' }}>· {fmt$(owed)} owed</span>}
                  </div>
                  <div style={ROW_META}>
                    Opened {fmtDate(c.opened_at)}
                    {c.on_payment_plan ? ' · on a payment plan' : ''}
                  </div>
                </div>
                <span style={pill(color)}>{isOpen ? 'Open' : STAGE_LABELS[stage] || 'Closed'}</span>
              </div>
              {isOpen && (
                <div style={{ padding: '0 2px 12px' }}>
                  <div style={{ fontSize: 13, color: '#0A2440', marginBottom: 10 }}>{STAGE_EXPLAIN[stage]}</div>
                  {(c.interest_balance != null || c.late_fee_balance != null || c.cost_balance != null) && (
                    <div style={{ fontSize: 12.5, color: 'rgba(15,28,46,0.62)', display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                      {c.principal_balance != null && <span>Assessments {fmt$(c.principal_balance)}</span>}
                      {c.interest_balance != null && <span>Interest {fmt$(c.interest_balance)}</span>}
                      {c.late_fee_balance != null && <span>Late fee {fmt$(c.late_fee_balance)}</span>}
                      {c.cost_balance != null && <span>Costs {fmt$(c.cost_balance)}</span>}
                    </div>
                  )}
                  <Link href="/app/track#pay" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#E14909', textDecoration: 'none' }}>
                    Make a payment &rarr;
                  </Link>
                </div>
              )}
            </div>
          )
        })}
      </section>
    </section>
  )
}

function pill(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }
}
const ROW_WRAP: React.CSSProperties = { borderBottom: '1px solid rgba(15,28,46,0.07)' }
const ROW: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: '12px 2px' }
const ROW_TITLE: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: '#0A2440' }
const ROW_META: React.CSSProperties = { fontSize: 12.5, color: 'rgba(15,28,46,0.6)', marginTop: 2 }

// ── Wire-up when ready ── Left rail or Easy Track tab: { href: '/app/collections', … }.
// Reachable directly at /app/collections until then.
