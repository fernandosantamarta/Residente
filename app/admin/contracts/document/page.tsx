'use client'

// Procurement documents — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders each artifact: a procurement summary (contracts vs the bid
// threshold), a competitive-bid solicitation log, and the condo management-
// agreement required-terms checklist (FS 718.3025). Every artifact is a DRAFT/aid
// and the language requires attorney review.

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  BID_THRESHOLD_PCT, BID_THRESHOLD_BASIS, CONDO_MGMT_REQUIRED_TERMS, BID_PROFESSIONAL_EXCEPTIONS,
  HOA_MANAGER_BID_TERM_MAX_YEARS,
  totalAnnualBudgetInclReserves, bidThreshold,
  type ContractRow, type BudgetRow,
} from '@/lib/compliance/contracts'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

type DocType = 'summary' | 'bid_log' | 'mgmt_checklist'

const TITLES: Record<DocType, string> = {
  summary:        'Procurement & Contracts Summary',
  bid_log:        'Competitive-Bid Solicitation Log',
  mgmt_checklist: 'Management-Agreement Required-Terms Checklist',
}

const KIND_LABEL: Record<string, string> = { products: 'Products / equipment', services: 'Services', management: 'Management / maintenance' }

export default function ContractsDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.contractsDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const search = useSearchParams()
  const type = (search?.get('type') || 'summary') as DocType

  const [community, setCommunity] = useState<any>(null)
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [budgets, setBudgets] = useState<BudgetRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError('No community'); return }
      try {
        const { data: comm, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        const { data: k } = (await withTimeout(supabase.from('ev_contracts').select('*').eq('community_id', communityId).order('created_at', { ascending: false }))) as any
        const { data: b } = (await withTimeout(supabase.from('budget_categories').select('budget, fiscal_year, is_reserve').eq('community_id', communityId))) as any
        if (cancelled) return
        setCommunity(comm || null)
        setContracts(k || [])
        setBudgets(b || [])
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.contractsDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const regime = community?.association_type === 'hoa' ? 'hoa' : 'condo'
  const isCondo = regime !== 'hoa'
  const pct = BID_THRESHOLD_PCT.value[regime]
  const budgetInfo = totalAnnualBudgetInclReserves(community, budgets)
  const threshold = bidThreshold(regime, budgetInfo.total)
  const bidCite = isCondo ? 'FS 718.3026' : 'FS 720.3055'

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: '#FEF3F2', color: '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          {t('admin.contractsDocument.draftWarning')}
        </div>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}>{t('admin.contractsDocument.printButton')}</button>
      </div>

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || t('admin.contractsDocument.associationFallback')}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>{t('admin.contractsDocument.setAssociationAddress')}</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 8 }}>{TITLES[type]}</h1>

      {/* ---------- Procurement summary ---------- */}
      {type === 'summary' && (
        <Body>
          <p>This summary reflects the contracts on file for {community?.name || 'the association'} as of {today}. It is an internal management aid.</p>
          <h3 style={h3}>Competitive-bid threshold</h3>
          <p>
            {budgetInfo.basis === 'none'
              ? <><Em>No budget recorded</Em> — the {pct}% threshold cannot be computed.</>
              : <>Total annual budget {budgetInfo.basis === 'budget' ? '(including reserves)' : '(estimated from annual revenue)'}: <strong>{fmt$(budgetInfo.total)}</strong>. The {pct}% competitive-bid threshold is <strong>{fmt$(threshold)}</strong> ({bidCite}). A contract exceeding this requires competitive bids unless a statutory exception applies.</>}
          </p>
          <h3 style={h3}>Contracts</h3>
          {contracts.length === 0 ? <p><Em>No contracts recorded.</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>Vendor</th><th style={thR}>Amount</th><th style={th}>Type</th><th style={th}>Over {pct}%?</th><th style={th}>Bids</th><th style={th}>Written</th>
            </tr></thead><tbody>
              {contracts.map(c => {
                const amount = Number(c.amount) || 0
                const over = threshold > 0 && amount > threshold
                const exc = !!c.exception_basis && c.exception_basis !== 'none'
                return (
                  <tr key={c.id}>
                    <td style={td}>{c.vendor || c.description || c.id.slice(0, 8)}</td>
                    <td style={tdR}>{amount ? fmt$(amount) : <Em>—</Em>}</td>
                    <td style={td}>{KIND_LABEL[String(c.contract_kind)] || String(c.contract_kind)}</td>
                    <td style={td}>{threshold > 0 ? (over ? (exc ? 'Yes (exception)' : 'Yes') : 'No') : <Em>n/a</Em>}</td>
                    <td style={td}>{c.bids_obtained ? 'Yes' : (over && !exc ? <Em>no</Em> : '—')}</td>
                    <td style={td}>{c.written_contract ? 'Yes' : ((c.contract_kind === 'services' || c.contract_kind === 'management' || (Number(c.term_months) || 0) > 12) ? <Em>no</Em> : '—')}</td>
                  </tr>
                )
              })}
            </tbody></table>
          )}
          <p style={cite}>Sources: {bidCite} (competitive bids; in writing); FS 718.3025 (condo management-agreement terms). Director conflicts of interest are governed separately by FS 718.3027 / 720.3033. Values require attorney confirmation.</p>
        </Body>
      )}

      {/* ---------- Competitive-bid solicitation log ---------- */}
      {type === 'bid_log' && (
        <Body>
          <p>Use this log to document the competitive bids solicited for a contract that exceeds the {pct}% threshold ({budgetInfo.basis !== 'none' ? `~${fmt$(threshold)}` : 'threshold pending a recorded budget'}), as required by {bidCite}. The association is not required to accept the lowest bid, but should retain the bids it obtained.</p>
          <h3 style={h3}>Contract</h3>
          <table style={tbl}><tbody>
            <Trow label="Vendor / description" value={<Em>fill in</Em>} />
            <Trow label="Scope" value={<Em>fill in</Em>} />
            <Trow label="Estimated amount" value={<Em>fill in</Em>} />
          </tbody></table>
          <h3 style={h3}>Bids obtained (retain copies)</h3>
          <table style={tbl}><thead><tr>
            <th style={th}>#</th><th style={th}>Bidder</th><th style={thR}>Amount</th><th style={th}>Date received</th><th style={th}>Notes</th>
          </tr></thead><tbody>
            {[1, 2, 3].map(n => (
              <tr key={n}><td style={td}>{n}</td><td style={td}>&nbsp;</td><td style={tdR}>&nbsp;</td><td style={td}>&nbsp;</td><td style={td}>&nbsp;</td></tr>
            ))}
          </tbody></table>
          <h3 style={h3}>If competitive bids were NOT obtained</h3>
          <p>Record the statutory exception relied upon: emergency; the only source within the county; professional services or employees ({BID_PROFESSIONAL_EXCEPTIONS.value[regime].join(', ')}){isCondo ? '; or a two-thirds opt-out by an association of 10 or fewer units' : '; a local-government franchise; a renewal of a previously bid contract that the board may cancel on 30 days’ notice; a contract executed before October 1, 2004; or a governing-document bidding procedure that is not less stringent than the statute'}.</p>
          {!isCondo && <p style={{ fontSize: 12.5 }}>Note: an HOA manager contract awarded by competitive bid may be made for up to {HOA_MANAGER_BID_TERM_MAX_YEARS.value} years ({HOA_MANAGER_BID_TERM_MAX_YEARS.citation}).</p>}
          <p style={cite}>Prepared under {bidCite}. Confirm the threshold basis (the total annual budget including reserves) and the available exceptions with the association&apos;s attorney.</p>
        </Body>
      )}

      {/* ---------- Condo management-agreement required-terms checklist ---------- */}
      {type === 'mgmt_checklist' && (
        <Body>
          {!isCondo && (
            <div style={{ fontSize: 13, background: '#FFFAEB', color: '#B54708', padding: '10px 12px', borderRadius: 8, marginBottom: 14 }}>
              The 718.3025 required-terms list is a condominium rule; this community is recorded as an HOA. An HOA management/service contract&apos;s fairness and cancellation standards are governed by FS 720.309 and the manager&apos;s duties by Ch. 468 (468.4334), not by a 718.3025-style checklist.
            </div>
          )}
          <p>Before signing or renewing a written operation/maintenance/management agreement, confirm it contains each item below. Under FS 718.3025(1), a condominium management agreement is <strong>not valid or enforceable</strong> unless it contains these terms, and any service or obligation not stated on the face of the contract is unenforceable.</p>
          <table style={tbl}><thead><tr>
            <th style={{ ...th, width: 36 }}>✓</th><th style={th}>Required term (FS 718.3025(1))</th>
          </tr></thead><tbody>
            {CONDO_MGMT_REQUIRED_TERMS.value.map((t, i) => (
              <tr key={i}><td style={{ ...td, textAlign: 'center' }}>☐</td><td style={td}>{t}</td></tr>
            ))}
          </tbody></table>
          <p style={cite}>Provided under FS 718.3025. The exact required terms and the consequences of omission must be confirmed with the association&apos;s attorney before relying on this checklist.</p>
        </Body>
      )}
    </div>
  )
}

function Body({ children }: { children: any }) {
  return <div style={{ fontSize: 14 }}>{children}</div>
}

function Trow({ label, value }: { label: any; value: any }) {
  return <tr><td style={{ ...td, fontWeight: 600, width: '46%' }}>{label}</td><td style={td}>{value ?? '—'}</td></tr>
}

const h3: React.CSSProperties = { fontSize: 14.5, marginTop: 18, marginBottom: 4 }
const cite: React.CSSProperties = { fontSize: 12, color: '#555', marginTop: 14 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
