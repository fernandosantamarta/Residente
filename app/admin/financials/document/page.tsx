'use client'

// Financial artifacts — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders: the annual financial report + officer affidavit of
// compliance, the proposed-budget package, and the reserve-funding worksheet.
// Every artifact is a DRAFT/aid; the language requires attorney/CPA review.

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  requiredAuditTier, estimateAnnualRevenue, AUDIT_TIER_LABEL,
} from '@/lib/compliance/financials'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

type DocType = 'afr' | 'budget' | 'reserve_worksheet'
const TITLES: Record<DocType, string> = {
  afr: 'Annual Financial Report',
  budget: 'Proposed Budget Package',
  reserve_worksheet: 'Reserve Funding Worksheet',
}

export default function FinancialDocumentPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const search = useSearchParams()
  const type = (search?.get('type') || 'afr') as DocType

  const [community, setCommunity] = useState<any>(null)
  const [budgets, setBudgets] = useState<any[]>([])
  const [reserves, setReserves] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError('No community'); return }
      try {
        const { data: c, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        const { data: b } = (await withTimeout(supabase.from('budget_categories').select('*').eq('community_id', communityId).order('sort_order'))) as any
        const { data: r } = (await withTimeout(supabase.from('ev_reserve_components').select('*').eq('community_id', communityId).order('created_at'))) as any
        if (cancelled) return
        setCommunity(c || null); setBudgets(b || []); setReserves(r || []); setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>Loading…</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const isHoa = community?.association_type === 'hoa'
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const operating = budgets.filter((b: any) => !b.is_reserve)
  const reserveLines = budgets.filter((b: any) => b.is_reserve)
  const revenue = estimateAnnualRevenue(community, budgets as any)
  const totalBudget = budgets.reduce((s: number, b: any) => s + (Number(b.budget) || 0), 0)
  const totalSpent = budgets.reduce((s: number, b: any) => s + (Number(b.spent) || 0), 0)
  const required = requiredAuditTier(revenue, (isHoa ? 'hoa' : 'condo') as any, Number(community?.parcel_count) || 0)
  const units = Number(community?.unit_count) || Number(community?.parcel_count) || 0

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          ⚠ DRAFT — an aid, not an official filing or accounting opinion. Figures are drawn from the
          budget you entered; have the report prepared/reviewed by your CPA and confirmed by counsel
          before relying on it or delivering it to members.
        </div>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}>Print / Save as PDF</button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>set the association address in Community settings</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 8 }}>{TITLES[type]}</h1>

      {/* ---------- Annual financial report + affidavit ---------- */}
      {type === 'afr' && (
        <Body>
          <p>Summary of the association's revenues, expenditures, and reserves. The required level of financial reporting at ~{fmt$(revenue)} annual revenue is <strong>{AUDIT_TIER_LABEL[required]}</strong>.</p>
          <table style={tbl}><thead><tr><th style={th}>Category</th><th style={thR}>Budget</th><th style={thR}>Actual</th></tr></thead><tbody>
            {operating.map((b: any) => (
              <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td><td style={tdR}>{fmt$(b.spent)}</td></tr>
            ))}
            {operating.length === 0 && <tr><td style={td} colSpan={3}><Em>No budget categories on file.</Em></td></tr>}
            <tr><td style={{ ...td, fontWeight: 800, borderTop: '2px solid #111' }}>Total</td><td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{fmt$(totalBudget)}</td><td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{fmt$(totalSpent)}</td></tr>
          </tbody></table>
          {reserveLines.length > 0 && (
            <>
              <h3 style={h3}>Reserves</h3>
              <table style={tbl}><tbody>
                {reserveLines.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td></tr>)}
              </tbody></table>
            </>
          )}
          <h3 style={h3}>Officer affidavit of compliance</h3>
          <p style={{ fontSize: 13 }}>STATE OF FLORIDA, COUNTY OF ______________. The undersigned officer of {community?.name || 'the association'} certifies that this annual financial report was prepared consistent with {isHoa ? 'section 720.303(7)' : 'section 718.111(13)'}, Florida Statutes, was completed within 90 days after the fiscal year-end, and {isHoa ? 'will be provided to members as required' : 'will be delivered to or made available to unit owners within 21 days after written request, but not later than the statutory deadline'}.</p>
          <Sign name={community?.association_officer_name} assoc={community?.name} />
        </Body>
      )}

      {/* ---------- Proposed budget package ---------- */}
      {type === 'budget' && (
        <Body>
          <p>Proposed operating budget. The proposed budget must reach members at least <strong>14 days</strong> before the meeting at which it is considered.</p>
          <table style={tbl}><thead><tr><th style={th}>Category</th><th style={thR}>Proposed</th><th style={thR}>Per {isHoa ? 'parcel' : 'unit'}/yr</th></tr></thead><tbody>
            {operating.map((b: any) => (
              <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td><td style={tdR}>{units > 0 ? fmt$((Number(b.budget) || 0) / units) : <Em>—</Em>}</td></tr>
            ))}
            <tr><td style={{ ...td, fontWeight: 800, borderTop: '2px solid #111' }}>Operating total</td><td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{fmt$(operating.reduce((s: number, b: any) => s + (Number(b.budget) || 0), 0))}</td><td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{units > 0 ? fmt$(operating.reduce((s: number, b: any) => s + (Number(b.budget) || 0), 0) / units) : '—'}</td></tr>
          </tbody></table>
          {reserveLines.length > 0 && (
            <>
              <h3 style={h3}>Reserve contributions</h3>
              <table style={tbl}><tbody>
                {reserveLines.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td></tr>)}
              </tbody></table>
            </>
          )}
          <p style={cite}>Budget adoption + notice under {isHoa ? 'FS 720.303(2)' : 'FS 718.112(2)(e)'}. A reserve waiver, if any, requires a majority of ALL voting interests and is prohibited for SIRS structural components.</p>
        </Body>
      )}

      {/* ---------- Reserve funding worksheet ---------- */}
      {type === 'reserve_worksheet' && (
        <Body>
          <p>Reserve component funding status. Underfunded reserves increase the risk of a special assessment; SIRS structural components must be fully funded for budgets adopted on/after 2026-01-01 and may not be waived.</p>
          {reserves.length === 0 ? <p><Em>No reserve components recorded. Add them in the Financial workspace.</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>Component</th><th style={th}>SIRS</th><th style={thR}>Current</th><th style={thR}>Fully funded</th><th style={thR}>% funded</th>
            </tr></thead><tbody>
              {reserves.map((r: any) => {
                const ff = Number(r.fully_funded_balance) || 0
                const pct = ff > 0 ? Math.round((Number(r.current_balance) || 0) / ff * 100) : null
                return (
                  <tr key={r.id}>
                    <td style={td}>{r.name}</td>
                    <td style={tdC}>{r.is_sirs ? '✓' : ''}</td>
                    <td style={tdR}>{fmt$(r.current_balance)}</td>
                    <td style={tdR}>{fmt$(r.fully_funded_balance)}</td>
                    <td style={{ ...tdR, color: pct == null ? '#111' : pct < 50 ? '#B42318' : pct < 100 ? '#B54708' : '#067647', fontWeight: 600 }}>{pct == null ? '—' : pct + '%'}</td>
                  </tr>
                )
              })}
              <tr>
                <td style={{ ...td, fontWeight: 800, borderTop: '2px solid #111' }}>Total</td><td style={{ ...tdC, borderTop: '2px solid #111' }}></td>
                <td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{fmt$(reserves.reduce((s: number, r: any) => s + (Number(r.current_balance) || 0), 0))}</td>
                <td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{fmt$(reserves.reduce((s: number, r: any) => s + (Number(r.fully_funded_balance) || 0), 0))}</td>
                <td style={{ ...tdR, borderTop: '2px solid #111' }}></td>
              </tr>
            </tbody></table>
          )}
          <p style={cite}>Reserve funding under {isHoa ? 'FS 720.303(6)' : 'FS 718.112(2)(f)'}; SIRS under FS 718.112(2)(g). A reserve professional should prepare the controlling funding plan.</p>
        </Body>
      )}
    </div>
  )
}

function Body({ children }: { children: any }) { return <div style={{ fontSize: 14 }}>{children}</div> }
function Sign({ name, assoc }: { name?: string | null; assoc?: string | null }) {
  return (
    <div style={{ marginTop: 36, fontSize: 14 }}>
      <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>{name || 'Authorized officer'}</div>
      <div style={{ fontSize: 12, color: '#555' }}>{assoc || 'Association'}</div>
      <div style={{ fontSize: 12, color: '#555', marginTop: 10 }}>Sworn to and subscribed before me this ____ day of ____________, 20____.</div>
    </div>
  )
}
const h3: React.CSSProperties = { fontSize: 14.5, marginTop: 18, marginBottom: 4 }
const cite: React.CSSProperties = { fontSize: 12, color: '#555', marginTop: 14 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
const tdC: React.CSSProperties = { ...td, textAlign: 'center' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
