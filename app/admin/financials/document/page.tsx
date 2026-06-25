'use client'

// Financial artifacts — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders:
//   • statement     — Statement of Cash Receipts & Expenditures, by fund (the
//                     statutory <$150k report; live, computed from recorded data)
//   • budget_actual — Budget vs Actual, by category and fund (live)
//   • afr           — Annual Financial Report + officer affidavit
//   • budget        — Proposed-budget package
//   • reserve_worksheet — Reserve-funding worksheet
// The "live" statements are computed from payments (cash in) and ev_expenses
// (cash out), scoped to the fiscal year. The afr/budget/reserve_worksheet remain
// DRAFT aids that require attorney/CPA review. Optional ?fy=<startYear> picks the
// fiscal year (default: the current one).

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { logAudit } from '@/lib/audit'
import { downloadCsv, exportFilename } from '@/lib/exportCsv'
import { ymd } from '@/lib/compliance/rules-core'
import {
  requiredAuditTier, estimateAnnualRevenue, AUDIT_TIER_LABEL,
} from '@/lib/compliance/financials'
import { currentFiscalYear, fiscalYearFor, inFiscalYear, fiscalYearEndInclusive } from '@/lib/fiscal'
import { glCurrentFyRevenue, balanceSheetByFund, revExpByFund, type TBRow } from '@/lib/gl/statements'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

type DocType = 'statement' | 'budget_actual' | 'balance_sheet' | 'rev_exp' | 'cpa_bundle' | 'afr' | 'budget' | 'reserve_worksheet'
const TITLES: Record<DocType, string> = {
  statement: 'Statement of Cash Receipts & Expenditures',
  budget_actual: 'Budget vs Actual',
  balance_sheet: 'Balance Sheet',
  rev_exp: 'Statement of Revenue & Expenses',
  cpa_bundle: 'CPA Handoff Package',
  afr: 'Annual Financial Report',
  budget: 'Proposed Budget Package',
  reserve_worksheet: 'Reserve Funding Worksheet',
}
const LIVE: Record<DocType, boolean> = {
  statement: true, budget_actual: true, balance_sheet: true, rev_exp: true, cpa_bundle: true, afr: true, budget: false, reserve_worksheet: false,
}
// The two GL-sourced reports are accrual (from the general ledger); the cash
// statement + budget-vs-actual are cash basis. Drives the banner wording.
const GL_SOURCED: Partial<Record<DocType, boolean>> = { balance_sheet: true, rev_exp: true, cpa_bundle: true }

export default function FinancialDocumentPage() {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.financialsDocument.loading')}</div>}>
      <DocInner />
    </Suspense>
  )
}

function DocInner() {
  const t = useT()
  const { profile } = useAuth() || {}
  const { can } = usePermissions()
  const canManage = can('financials.manage')
  const communityId = profile?.community_id
  const search = useSearchParams()
  const type = (search?.get('type') || 'statement') as DocType

  const [afrFilings, setAfrFilings] = useState<any[]>([])
  const [signName, setSignName] = useState('')
  const [signing, setSigning] = useState(false)
  const [signMsg, setSignMsg] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [cpaLinks, setCpaLinks] = useState<any[]>([])
  const [cpaBusy, setCpaBusy] = useState(false)
  const [cpaCopied, setCpaCopied] = useState('')
  const [community, setCommunity] = useState<any>(null)
  const [budgets, setBudgets] = useState<any[]>([])
  const [reserves, setReserves] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [duesSummary, setDuesSummary] = useState<any>(null)
  const [glTB, setGlTB] = useState<TBRow[]>([])      // cumulative trial balance → Balance Sheet
  const [glTBFy, setGlTBFy] = useState<TBRow[]>([])   // per-FY trial balance → Rev & Exp + live revenue
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !communityId) { setStatus('error'); setError('No community'); return }
      try {
        const { data: c, error: cErr } = (await withTimeout(supabase.from('communities').select('*').eq('id', communityId).single())) as any
        if (cErr) throw cErr
        // Budgets + reserves (needed by every type).
        const { data: b } = (await withTimeout(supabase.from('budget_categories').select('*').eq('community_id', communityId).order('sort_order'))) as any
        const { data: r } = (await withTimeout(supabase.from('ev_reserve_components').select('*').eq('community_id', communityId).order('created_at'))) as any
        // Actuals (cash out) + receipts (cash in) for the live statements. Best-effort:
        // a payments RLS denial just yields an empty list rather than failing the page.
        const { data: ex } = (await withTimeout(supabase.from('ev_expenses').select('amount,spent_on,category_id').eq('community_id', communityId))) as any
        const { data: pays } = (await withTimeout(supabase.from('payments').select('amount,paid_on,charge_type').eq('community_id', communityId))) as any
        let ds: any = null
        try {
          const { data: dsd } = (await withTimeout(supabase.rpc('community_dues_summary', { p_community: communityId }))) as any
          ds = Array.isArray(dsd) ? dsd[0] : dsd
        } catch { /* aggregate is a nicety; never block the report on it */ }
        // GL trial balance (Phase 3): cumulative for the Balance Sheet, per-FY for
        // Rev & Exp + live revenue. Best-effort — empty until the ledger is built.
        let tb: any[] = [], tbFy: any[] = []
        try {
          const { data: t } = (await withTimeout(supabase.from('gl_trial_balance').select('*').eq('community_id', communityId))) as any
          tb = t || []
        } catch { /* no ledger yet → GL reports show a build prompt */ }
        try {
          const { data: tf } = (await withTimeout(supabase.from('gl_trial_balance_fy').select('*').eq('community_id', communityId))) as any
          tbFy = tf || []
        } catch { /* no ledger yet */ }
        // Annual financial report filings (for the delivery affidavit). Best-effort.
        let afr: any[] = []
        try {
          const { data: af } = (await withTimeout(supabase.from('ev_financial_filings').select('*').eq('community_id', communityId).eq('filing_type', 'annual_financial_report'))) as any
          afr = af || []
        } catch { /* no filings yet */ }
        if (cancelled) return
        setCommunity(c || null); setBudgets(b || []); setReserves(r || [])
        setExpenses(ex || []); setPayments(pays || []); setDuesSummary(ds)
        setGlTB(tb); setGlTBFy(tbFy); setAfrFilings(afr)
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [communityId, type, reloadKey])

  // ---- delivery affidavit (condo; FS 718.111(13)) — the one human write path ----
  const signAffidavit = async (filingId: string) => {
    if (!filingId || !signName.trim()) return
    setSigning(true); setSignMsg('')
    try {
      const { error } = await supabase.rpc('sign_delivery_affidavit', { p_filing: filingId, p_signer_name: signName.trim() })
      if (error) throw error
      setSignName(''); setReloadKey(k => k + 1)
    } catch (err: any) {
      setSignMsg(err?.message || t('admin.financialsDocument.affidavitSignError'))
    } finally { setSigning(false) }
  }

  // ---- CPA share links (read-only, login-free; minted/revoked here) ----
  const loadCpaLinks = useCallback(async () => {
    if (!hasSupabase || !communityId || !canManage) return
    try {
      const { data } = await supabase.from('cpa_share_tokens').select('*')
        .eq('community_id', communityId).eq('revoked', false).order('created_at', { ascending: false })
      setCpaLinks(((data as any[]) || []).filter(t => new Date(t.expires_at).getTime() > Date.now()))
    } catch { /* table may not exist yet → no links shown */ }
  }, [communityId, canManage])
  useEffect(() => { if (type === 'cpa_bundle') loadCpaLinks() }, [type, loadCpaLinks])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.financialsDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const today = ymd(new Date())
  const isHoa = community?.association_type === 'hoa'
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>
  const operating = budgets.filter((b: any) => !b.is_reserve)
  const reserveLines = budgets.filter((b: any) => b.is_reserve)

  // ---- fiscal year (compute first; the GL revenue + reports are FY-scoped) ----
  const fyStartMonth = Number(community?.fiscal_year_start_month) || 1
  const fyParam = search?.get('fy')
  const fy = fyParam ? fiscalYearFor(fyStartMonth, Number(fyParam)) : currentFiscalYear(fyStartMonth)
  const fyEnd = fiscalYearEndInclusive(fy)

  // ---- GL-sourced statements (Phase 3) ----
  const hasLedger = glTB.length > 0
  const liveRevenue = glCurrentFyRevenue(glTBFy, fy.year)      // accrual revenue for the displayed FY
  const bsheet = balanceSheetByFund(glTB)                       // cumulative position, by fund
  const revexp = revExpByFund(glTBFy, fy.year)                  // accrual rev/exp, displayed FY
  const glArNet = hasLedger
    ? Math.round(glTB.filter((r: any) => r.code === '1100' && r.fund === 'operating')
        .reduce((s: number, r: any) => s + (Number(r.balance) || 0), 0) * 100) / 100
    : null

  // The annual-financial-report filing for the displayed FY (drives the affidavit).
  const afrFiling = afrFilings
    .filter((f: any) => Number(f.fiscal_year) === fy.year)
    .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null

  // CPA handoff: export the trial balance as CSV (the "mint" — audited). Aggregate
  // by account/fund — no resident names, so it carries no owner PII.
  const exportCpaCsv = () => {
    downloadCsv(
      exportFilename(`cpa-trial-balance-${String(community?.name || 'community').replace(/\s+/g, '-')}`, today),
      [...glTB].sort((a: any, b: any) => String(a.fund).localeCompare(String(b.fund)) || String(a.code).localeCompare(String(b.code))),
      [
        { label: 'Fund', value: (r: any) => r.fund },
        { label: 'Account', value: (r: any) => r.code },
        { label: 'Name', value: (r: any) => r.name },
        { label: 'Debit', value: (r: any) => r.debit },
        { label: 'Credit', value: (r: any) => r.credit },
        { label: 'Balance', value: (r: any) => r.balance },
      ],
    )
    if (communityId) logAudit({ community_id: communityId, event_type: 'financial.cpa_bundle_exported', target_type: 'financial_filing', metadata: { fiscal_year: fy.year } })
  }

  const createCpaLink = async () => {
    setCpaBusy(true)
    try {
      const { error } = await supabase.rpc('cpa_share_create', { p_fiscal_year: fy.year })
      if (error) throw error
      await loadCpaLinks()
    } catch { /* surfaced as no new link */ } finally { setCpaBusy(false) }
  }
  const revokeCpaLink = async (id: string) => {
    try { await supabase.rpc('cpa_share_revoke', { p_id: id }); await loadCpaLinks() } catch { /* ignore */ }
  }
  const copyCpaLink = (token: string) => {
    try {
      navigator.clipboard?.writeText(`${window.location.origin}/cpa/${token}`)
      setCpaCopied(token); setTimeout(() => setCpaCopied(''), 2000)
    } catch { /* clipboard unavailable */ }
  }

  // Live GL revenue drives the audit tier when a ledger exists (else budget estimate).
  const revenue = estimateAnnualRevenue(community, budgets as any, liveRevenue || undefined)
  const required = requiredAuditTier(revenue, (isHoa ? 'hoa' : 'condo') as any, Number(community?.parcel_count) || 0)
  const units = Number(community?.unit_count) || Number(community?.parcel_count) || 0

  const actualByCat = new Map<string, number>()
  let uncategorizedActual = 0
  for (const e of expenses) {
    if (!inFiscalYear(e.spent_on, fy)) continue
    const amt = Number(e.amount) || 0
    if (e.category_id) actualByCat.set(e.category_id, (actualByCat.get(e.category_id) || 0) + amt)
    else uncategorizedActual += amt
  }
  const catActual = (id: string) => actualByCat.get(id) || 0
  const sumBudget = (rows: any[]) => rows.reduce((s, b) => s + (Number(b.budget) || 0), 0)
  const sumActual = (rows: any[]) => rows.reduce((s, b) => s + catActual(b.id), 0)
  const operatingBudget = sumBudget(operating), operatingActual = sumActual(operating)
  const reserveBudget = sumBudget(reserveLines), reserveActual = sumActual(reserveLines)
  const totalDisbursements = operatingActual + reserveActual + uncategorizedActual

  // Cash receipts grouped by charge_type (assessments/dues, fines, other).
  const receipts = { assessments: 0, fines: 0, other: 0 }
  for (const p of payments) {
    if (!inFiscalYear(p.paid_on, fy)) continue
    const ct = p.charge_type
    const bucket = ct === 'fine' ? 'fines' : ct === 'other' ? 'other' : 'assessments'
    receipts[bucket] += Number(p.amount) || 0
  }
  const totalReceipts = receipts.assessments + receipts.fines + receipts.other
  const netChange = totalReceipts - totalDisbursements

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55 }}>
      <style>{`
        @media print { .no-print { display: none !important; } body { margin: 0 } }
        @media (max-width: 640px) {
          .rp-toolbar { flex-direction: column; align-items: stretch !important; }
          .rp-actions { margin-left: 0 !important; }
          .rp-actions button { flex: 1 1 0; }
        }
      `}</style>

      <div className="no-print rp-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: LIVE[type] ? '#ECFDF3' : '#FEF3F2', color: LIVE[type] ? '#067647' : '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          {LIVE[type]
            ? GL_SOURCED[type]
              ? t('admin.financialsDocument.bannerLiveGl', { fyLabel: fy.label })
              : t('admin.financialsDocument.bannerLiveCash', { fyLabel: fy.label })
            : t('admin.financialsDocument.bannerDraft')}
        </div>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, flex: '0 0 auto', marginLeft: 'auto' }}>
          <button onClick={() => history.back()} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.financialsDocument.printButton')}</button>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || t('admin.financialsDocument.associationFallback')}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>{t('admin.financialsDocument.setCommunityAddress')}</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>
      <h1 style={{ fontSize: 19, marginBottom: 4 }}>{TITLES[type]}</h1>
      {LIVE[type] && (
        <div style={{ fontSize: 12.5, color: '#555', marginBottom: 8 }}>
          {fy.label} · {fy.startISO} through {fyEnd}
          {isHoa ? ' · FS 720.303(7)' : ' · FS 718.111(13)'}
        </div>
      )}

      {/* ---------- Statement of cash receipts & expenditures (by fund) ---------- */}
      {type === 'statement' && (
        <Body>
          <h3 style={h3}>{t('admin.financialsDocument.cashReceiptsHeading')}</h3>
          <table style={tbl}><tbody>
            <tr><td style={td}>{t('admin.financialsDocument.assessmentsDues')}</td><td style={tdR}>{fmt$(receipts.assessments)}</td></tr>
            <tr><td style={td}>{t('admin.financialsDocument.fines')}</td><td style={tdR}>{fmt$(receipts.fines)}</td></tr>
            <tr><td style={td}>{t('admin.financialsDocument.other')}</td><td style={tdR}>{fmt$(receipts.other)}</td></tr>
            <tr><td style={totTd}>{t('admin.financialsDocument.totalReceipts')}</td><td style={totTdR}>{fmt$(totalReceipts)}</td></tr>
          </tbody></table>

          <h3 style={h3}>{t('admin.financialsDocument.cashDisburseOperating')}</h3>
          <table style={tbl}><tbody>
            {operating.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>)}
            {operating.length === 0 && <tr><td style={td} colSpan={2}><Em>{t('admin.financialsDocument.noOperatingCategories')}</Em></td></tr>}
            <tr><td style={totTd}>{t('admin.financialsDocument.operatingSubtotal')}</td><td style={totTdR}>{fmt$(operatingActual)}</td></tr>
          </tbody></table>

          {(reserveLines.length > 0 || reserveActual > 0) && (
            <>
              <h3 style={h3}>{t('admin.financialsDocument.cashDisburseReserve')}</h3>
              <table style={tbl}><tbody>
                {reserveLines.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>)}
                <tr><td style={totTd}>{t('admin.financialsDocument.reserveSubtotal')}</td><td style={totTdR}>{fmt$(reserveActual)}</td></tr>
              </tbody></table>
            </>
          )}

          <table style={{ ...tbl, marginTop: 14 }}><tbody>
            {uncategorizedActual > 0 && <tr><td style={td}>{t('admin.financialsDocument.uncategorizedDisbursements')}</td><td style={tdR}>{fmt$(uncategorizedActual)}</td></tr>}
            <tr><td style={totTd}>{t('admin.financialsDocument.totalDisbursements')}</td><td style={totTdR}>{fmt$(totalDisbursements)}</td></tr>
            <tr><td style={{ ...totTd, fontSize: 14 }}>{t('admin.financialsDocument.netChangeCash')}</td><td style={{ ...totTdR, fontSize: 14, color: netChange < 0 ? '#B42318' : '#067647' }}>{fmt$(netChange)}</td></tr>
          </tbody></table>

          {hasLedger ? (
            <p style={cite}>
              {t('admin.financialsDocument.accrualContextLedger', { today, arNet: fmt$(glArNet) })}
            </p>
          ) : duesSummary ? (
            <p style={cite}>
              {t('admin.financialsDocument.accrualContextDues', { collected: fmt$(duesSummary.collected), outstanding: fmt$(duesSummary.outstanding), rate: String(Number(duesSummary.rate) || 0) })}
            </p>
          ) : null}
          <p style={cite}>
            Cash basis — receipts when received, expenditures when paid; the statutory "report of cash
            receipts and expenditures" under {isHoa ? 'FS 720.303(7)' : 'FS 718.111(13)'}. Operating and
            reserve funds are shown separately (FS {isHoa ? '720.303(6)' : '718.111(14)'}). Income recorded
            outside dues/fines (e.g. amenity fees) and accrual statements arrive with the full ledger.
          </p>
        </Body>
      )}

      {/* ---------- Budget vs actual (by category + fund) ---------- */}
      {type === 'budget_actual' && (
        <Body>
          <p>{t('admin.financialsDocument.bvaIntro', { fyLabel: fy.label })}</p>
          <h3 style={h3}>{t('admin.financialsDocument.operatingFundHeading')}</h3>
          <BvaTable rows={operating} catActual={catActual} budgetTotal={operatingBudget} actualTotal={operatingActual} Em={Em} />
          {(reserveLines.length > 0 || reserveActual > 0) && (
            <>
              <h3 style={h3}>{t('admin.financialsDocument.reserveFundHeading')}</h3>
              <BvaTable rows={reserveLines} catActual={catActual} budgetTotal={reserveBudget} actualTotal={reserveActual} Em={Em} />
            </>
          )}
          {uncategorizedActual > 0 && (
            <p style={cite}>{t('admin.financialsDocument.uncategorizedSpending', { amount: fmt$(uncategorizedActual) })}</p>
          )}
          <p style={cite}>Actuals are recorded expenses dated within {fy.label}. Budget figures are what you entered per category; adopt the budget per {isHoa ? 'FS 720.303(6)' : 'FS 718.112(2)(f)'}.</p>
        </Body>
      )}

      {/* ---------- Balance sheet (by fund, from the GL) ---------- */}
      {type === 'balance_sheet' && (
        <Body>
          {!hasLedger ? (
            <p><Em>{t('admin.financialsDocument.noLedgerBalanceSheet')}</Em></p>
          ) : (
            <>
              <p>{t('admin.financialsDocument.balanceSheetIntro', { today, statute: isHoa ? 'FS 720.303(6)' : 'FS 718.111(14)' })}</p>
              {bsheet.funds.map((f: any) => (
                <div key={f.fund}>
                  <h3 style={h3}>{f.fund === 'operating' ? t('admin.financialsDocument.operatingFundHeading') : f.fund === 'reserve' ? t('admin.financialsDocument.reserveFundHeading') : f.fund}</h3>
                  <table style={tbl}><tbody>
                    <tr><td style={secTd} colSpan={2}>{t('admin.financialsDocument.assetsLabel')}</td></tr>
                    {f.assets.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.assets.length === 0 && <tr><td style={td} colSpan={2}><Em>{t('admin.financialsDocument.noneLabel')}</Em></td></tr>}
                    <tr><td style={totTd}>{t('admin.financialsDocument.totalAssetsLabel')}</td><td style={totTdR}>{fmt$(f.totalAssets)}</td></tr>
                    <tr><td style={secTd} colSpan={2}>{t('admin.financialsDocument.liabilitiesFundBalance')}</td></tr>
                    {f.liabilities.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.equity.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    <tr><td style={td}>{t('admin.financialsDocument.accumulatedSurplusDeficit')}</td><td style={tdR}>{fmt$(f.netIncome)}</td></tr>
                    <tr><td style={totTd}>{t('admin.financialsDocument.totalLiabilitiesFundBalance')}</td><td style={totTdR}>{fmt$(f.totalLiabilities + f.totalEquity)}</td></tr>
                  </tbody></table>
                </div>
              ))}
              <table style={{ ...tbl, marginTop: 14 }}><tbody>
                <tr><td style={{ ...totTd, fontSize: 14 }}>{t('admin.financialsDocument.totalAssetsAllFunds')}</td><td style={{ ...totTdR, fontSize: 14 }}>{fmt$(bsheet.totalAssets)}</td></tr>
                <tr><td style={totTd}>{t('admin.financialsDocument.totalLiabilitiesFundBalance')}</td><td style={totTdR}>{fmt$(bsheet.totalLiabilities + bsheet.totalEquity)}</td></tr>
              </tbody></table>
              <p style={cite}>
                {bsheet.balances
                  ? t('admin.financialsDocument.ledgerInBalance')
                  : t('admin.financialsDocument.ledgerOutOfBalance')}
                {' '}Cumulative since inception, accrual basis. Reserve inter-fund transfers post once the bank feed is connected.
              </p>
            </>
          )}
        </Body>
      )}

      {/* ---------- Statement of revenue & expenses (accrual, by fund) ---------- */}
      {type === 'rev_exp' && (
        <Body>
          {!hasLedger ? (
            <p><Em>{t('admin.financialsDocument.noLedgerRevExp')}</Em></p>
          ) : (
            <>
              <p>{t('admin.financialsDocument.revExpIntro', { fyLabel: fy.label, startISO: fy.startISO, fyEnd })}</p>
              {revexp.funds.length === 0 && <p><Em>{t('admin.financialsDocument.noRevenueEntries', { fyLabel: fy.label })}</Em></p>}
              {revexp.funds.map((f: any) => (
                <div key={f.fund}>
                  <h3 style={h3}>{f.fund === 'operating' ? t('admin.financialsDocument.operatingFundHeading') : f.fund === 'reserve' ? t('admin.financialsDocument.reserveFundHeading') : f.fund}</h3>
                  <table style={tbl}><tbody>
                    <tr><td style={secTd} colSpan={2}>{t('admin.financialsDocument.revenueLabel')}</td></tr>
                    {f.revenue.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.revenue.length === 0 && <tr><td style={td} colSpan={2}><Em>{t('admin.financialsDocument.noneLabel')}</Em></td></tr>}
                    <tr><td style={totTd}>{t('admin.financialsDocument.totalRevenueLabel')}</td><td style={totTdR}>{fmt$(f.totalRevenue)}</td></tr>
                    <tr><td style={secTd} colSpan={2}>{t('admin.financialsDocument.expensesLabel')}</td></tr>
                    {f.expense.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.expense.length === 0 && <tr><td style={td} colSpan={2}><Em>{t('admin.financialsDocument.noneLabel')}</Em></td></tr>}
                    <tr><td style={totTd}>{t('admin.financialsDocument.totalExpensesLabel')}</td><td style={totTdR}>{fmt$(f.totalExpense)}</td></tr>
                    <tr><td style={{ ...totTd, fontSize: 14 }}>{t('admin.financialsDocument.netSurplusDeficit')}</td><td style={{ ...totTdR, fontSize: 14, color: f.net < 0 ? '#B42318' : '#067647' }}>{fmt$(f.net)}</td></tr>
                  </tbody></table>
                </div>
              ))}
              {revexp.funds.length > 1 && (
                <table style={{ ...tbl, marginTop: 14 }}><tbody>
                  <tr><td style={totTd}>{t('admin.financialsDocument.totalRevenueAllFunds')}</td><td style={totTdR}>{fmt$(revexp.totalRevenue)}</td></tr>
                  <tr><td style={totTd}>{t('admin.financialsDocument.totalExpensesAllFunds')}</td><td style={totTdR}>{fmt$(revexp.totalExpense)}</td></tr>
                  <tr><td style={{ ...totTd, fontSize: 14 }}>{t('admin.financialsDocument.netSurplusDeficit')}</td><td style={{ ...totTdR, fontSize: 14, color: revexp.net < 0 ? '#B42318' : '#067647' }}>{fmt$(revexp.net)}</td></tr>
                </tbody></table>
              )}
              <p style={cite}>Accrual basis — revenue when earned (assessments accrued by installment), expenses when incurred — from the general ledger. {isHoa ? 'FS 720.303(7)' : 'FS 718.111(13)'}.</p>
            </>
          )}
        </Body>
      )}

      {/* ---------- Annual financial report + affidavit ---------- */}
      {type === 'afr' && (
        <Body>
          <p>Summary of the association's revenues, expenditures, and reserves. The required level of financial reporting at ~{fmt$(revenue)} annual revenue is <strong>{AUDIT_TIER_LABEL[required]}</strong>. Actuals shown are recorded expenses for {fy.label}.</p>
          <table style={tbl}><thead><tr><th style={th}>{t('admin.financialsDocument.colCategory')}</th><th style={thR}>{t('admin.financialsDocument.colBudget')}</th><th style={thR}>{t('admin.financialsDocument.colActual')}</th></tr></thead><tbody>
            {operating.map((b: any) => (
              <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>
            ))}
            {operating.length === 0 && <tr><td style={td} colSpan={3}><Em>{t('admin.financialsDocument.noBudgetCategories')}</Em></td></tr>}
            <tr><td style={totTd}>{t('admin.financialsDocument.totalLabel')}</td><td style={totTdR}>{fmt$(operatingBudget)}</td><td style={totTdR}>{fmt$(operatingActual)}</td></tr>
          </tbody></table>
          {reserveLines.length > 0 && (
            <>
              <h3 style={h3}>{t('admin.financialsDocument.reservesHeading')}</h3>
              <table style={tbl}><thead><tr><th style={th}>{t('admin.financialsDocument.colComponent')}</th><th style={thR}>{t('admin.financialsDocument.colBudget')}</th><th style={thR}>{t('admin.financialsDocument.colActual')}</th></tr></thead><tbody>
                {reserveLines.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>)}
                <tr><td style={totTd}>{t('admin.financialsDocument.totalLabel')}</td><td style={totTdR}>{fmt$(reserveBudget)}</td><td style={totTdR}>{fmt$(reserveActual)}</td></tr>
              </tbody></table>
            </>
          )}
          <h3 style={h3}>{t('admin.financialsDocument.officerAffidavitHeading')}</h3>
          <p style={{ fontSize: 13 }}>STATE OF FLORIDA, COUNTY OF ______________. The undersigned officer of {community?.name || 'the association'} certifies that this annual financial report was prepared consistent with {isHoa ? 'section 720.303(7)' : 'section 718.111(13)'}, Florida Statutes, was completed within 90 days after the fiscal year-end, and {isHoa ? 'will be provided to members as required' : 'will be delivered to or made available to unit owners within 21 days after written request, but not later than the statutory deadline'}.</p>

          {isHoa ? (
            // HOAs have no statutory delivery affidavit — keep the paper signature block.
            <Sign name={community?.association_officer_name} assoc={community?.name} />
          ) : afrFiling?.affidavit_signed_at ? (
            // Executed e-signature (write-once). This IS the delivery affidavit of record.
            <div style={{ marginTop: 28, fontSize: 13, border: '1px solid #067647', background: '#ECFDF3', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontWeight: 700, color: '#067647' }}>✓ {t('admin.financialsDocument.affidavitExecuted')}</div>
              <div style={{ marginTop: 6 }}>{t('admin.financialsDocument.affidavitSignedBy', { name: afrFiling.affidavit_signer_name || '—', date: String(afrFiling.affidavit_signed_at).slice(0, 10) })}</div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{community?.name} · FS 718.111(13)</div>
            </div>
          ) : (
            // Not yet signed — show the e-sign control (officers) or guidance.
            <div style={{ marginTop: 24 }}>
              {!afrFiling ? (
                <p style={{ ...cite }}>{t('admin.financialsDocument.affidavitNoFiling')}</p>
              ) : !afrFiling.completed_at ? (
                <p style={{ ...cite }}>{t('admin.financialsDocument.affidavitNotCompleted')}</p>
              ) : canManage ? (
                <div className="no-print" style={{ border: '1px solid #d4d4d4', borderRadius: 8, padding: '12px 14px', fontFamily: 'system-ui, sans-serif' }}>
                  <div style={{ fontSize: 12.5, color: '#555', marginBottom: 8 }}>{t('admin.financialsDocument.affidavitSignPrompt')}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input value={signName} onChange={e => setSignName(e.target.value)} placeholder={t('admin.financialsDocument.affidavitNamePlaceholder')}
                      style={{ flex: '1 1 220px', padding: '8px 10px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 14 }} />
                    <button onClick={() => signAffidavit(afrFiling.id)} disabled={signing || !signName.trim()}
                      style={{ background: '#111', color: '#fff', border: 0, borderRadius: 6, padding: '9px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: signing || !signName.trim() ? 0.6 : 1 }}>
                      {signing ? '…' : t('admin.financialsDocument.affidavitSignButton')}
                    </button>
                  </div>
                  {signMsg && <div style={{ color: '#B42318', fontSize: 12.5, marginTop: 8 }}>{signMsg}</div>}
                </div>
              ) : (
                <Sign name={community?.association_officer_name} assoc={community?.name} />
              )}
            </div>
          )}
        </Body>
      )}

      {/* ---------- CPA handoff package (read-only, for an outside accountant) ---------- */}
      {type === 'cpa_bundle' && (
        <Body>
          <p>{t('admin.financialsDocument.cpaIntro', { tier: AUDIT_TIER_LABEL[required] })}</p>
          {!hasLedger ? (
            <p style={cite}><Em>{t('admin.financialsDocument.cpaNoLedger')}</Em></p>
          ) : (
            <>
              <div className="no-print" style={{ margin: '10px 0' }}>
                <button onClick={exportCpaCsv} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}>
                  {t('admin.financialsDocument.cpaExportCsv')}
                </button>
              </div>
              <h3 style={h3}>{t('admin.financialsDocument.cpaTrialBalanceHeading')}</h3>
              <table style={tbl}><thead><tr>
                <th style={th}>{t('admin.financialsDocument.colAccount')}</th><th style={th}>{t('admin.financialsDocument.colFund')}</th><th style={thR}>{t('admin.financialsDocument.colDebit')}</th><th style={thR}>{t('admin.financialsDocument.colCredit')}</th>
              </tr></thead><tbody>
                {[...glTB].sort((a: any, b: any) => String(a.fund).localeCompare(String(b.fund)) || String(a.code).localeCompare(String(b.code))).map((r: any, i: number) => (
                  <tr key={i}><td style={td}>{r.code} · {r.name}</td><td style={td}>{r.fund}</td><td style={tdR}>{fmt$(r.debit)}</td><td style={tdR}>{fmt$(r.credit)}</td></tr>
                ))}
                <tr>
                  <td style={totTd}>{t('admin.financialsDocument.totalLabel')}</td><td style={totTd}></td>
                  <td style={totTdR}>{fmt$(glTB.reduce((s: number, r: any) => s + (Number(r.debit) || 0), 0))}</td>
                  <td style={totTdR}>{fmt$(glTB.reduce((s: number, r: any) => s + (Number(r.credit) || 0), 0))}</td>
                </tr>
              </tbody></table>

              <h3 style={h3}>{t('admin.financialsDocument.cpaPositionHeading')}</h3>
              <table style={tbl}><tbody>
                <tr><td style={td}>{t('admin.financialsDocument.cpaOperatingAssets')}</td><td style={tdR}>{fmt$(bsheet.funds.find((f: any) => f.fund === 'operating')?.totalAssets || 0)}</td></tr>
                <tr><td style={td}>{t('admin.financialsDocument.cpaReserveAssets')}</td><td style={tdR}>{fmt$(bsheet.funds.find((f: any) => f.fund === 'reserve')?.totalAssets || 0)}</td></tr>
                <tr><td style={td}>{t('admin.financialsDocument.cpaRevenueFy', { fy: fy.label })}</td><td style={tdR}>{fmt$(revexp.totalRevenue)}</td></tr>
                <tr><td style={td}>{t('admin.financialsDocument.cpaExpenseFy', { fy: fy.label })}</td><td style={tdR}>{fmt$(revexp.totalExpense)}</td></tr>
                <tr><td style={totTd}>{t('admin.financialsDocument.netSurplusDeficit')}</td><td style={{ ...totTdR, color: revexp.net < 0 ? '#B42318' : '#067647' }}>{fmt$(revexp.net)}</td></tr>
              </tbody></table>
              <p style={cite}>{t('admin.financialsDocument.cpaFootnote')}</p>

              {canManage && (
                <div className="no-print" style={{ marginTop: 22, padding: '14px 16px', border: '1px solid #d4d4d4', borderRadius: 8, fontFamily: 'system-ui, sans-serif' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t('admin.financialsDocument.cpaShareTitle')}</div>
                  <div style={{ fontSize: 12.5, color: '#555', margin: '4px 0 10px' }}>{t('admin.financialsDocument.cpaShareSub')}</div>
                  <button onClick={createCpaLink} disabled={cpaBusy} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: cpaBusy ? 0.6 : 1 }}>
                    {cpaBusy ? '…' : t('admin.financialsDocument.cpaShareCreate')}
                  </button>
                  {cpaLinks.length > 0 && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {cpaLinks.map((l: any) => {
                        const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/cpa/${l.token}`
                        return (
                          <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
                            <input readOnly value={url} onFocus={e => e.currentTarget.select()} style={{ flex: '1 1 280px', padding: '6px 8px', border: '1px solid #d4d4d4', borderRadius: 6, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
                            <button onClick={() => copyCpaLink(l.token)} style={{ background: '#fff', border: '1px solid #d4d4d4', borderRadius: 6, padding: '6px 12px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>{cpaCopied === l.token ? t('admin.financialsDocument.cpaShareCopied') : t('admin.financialsDocument.cpaShareCopy')}</button>
                            <button onClick={() => revokeCpaLink(l.id)} style={{ background: '#fff', border: '1px solid #d4d4d4', borderRadius: 6, padding: '6px 12px', fontWeight: 600, fontSize: 12.5, color: '#B42318', cursor: 'pointer' }}>{t('admin.financialsDocument.cpaShareRevoke')}</button>
                            <span style={{ color: '#555' }}>{t('admin.financialsDocument.cpaShareExpires', { date: String(l.expires_at).slice(0, 10) })}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Body>
      )}

      {/* ---------- Proposed budget package ---------- */}
      {type === 'budget' && (
        <Body>
          <p>Proposed operating budget. The proposed budget must reach members at least <strong>14 days</strong> before the meeting at which it is considered.</p>
          <table style={tbl}><thead><tr><th style={th}>{t('admin.financialsDocument.colCategory')}</th><th style={thR}>{t('admin.financialsDocument.colProposed')}</th><th style={thR}>{isHoa ? t('admin.financialsDocument.colPerParcel') : t('admin.financialsDocument.colPerUnit')}</th></tr></thead><tbody>
            {operating.map((b: any) => (
              <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td><td style={tdR}>{units > 0 ? fmt$((Number(b.budget) || 0) / units) : <Em>—</Em>}</td></tr>
            ))}
            <tr><td style={totTd}>{t('admin.financialsDocument.operatingTotal')}</td><td style={totTdR}>{fmt$(operatingBudget)}</td><td style={totTdR}>{units > 0 ? fmt$(operatingBudget / units) : '—'}</td></tr>
          </tbody></table>
          {reserveLines.length > 0 && (
            <>
              <h3 style={h3}>{t('admin.financialsDocument.reserveContributions')}</h3>
              <table style={tbl}><tbody>
                {reserveLines.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td></tr>)}
              </tbody></table>
            </>
          )}
          <p style={cite}>Budget adoption + notice under {isHoa ? 'FS 720.303(2)' : 'FS 718.112(2)(e)'}. A reserve waiver, if any, requires {isHoa ? 'a majority of the voting interests present at a meeting at which a quorum is present (FS 720.303(6)(f))' : 'a majority of ALL voting interests'}; for condos, SIRS structural component reserves may not be waived.</p>
        </Body>
      )}

      {/* ---------- Reserve funding worksheet ---------- */}
      {type === 'reserve_worksheet' && (
        <Body>
          <p>Reserve component funding status. Underfunded reserves increase the risk of a special assessment.{!isHoa ? ' SIRS structural components must be fully funded for budgets adopted on/after 2026-01-01 and may not be waived (FS 718.112(2)(g)2).' : ''}</p>
          {reserves.length === 0 ? <p><Em>{t('admin.financialsDocument.noReserveComponents')}</Em></p> : (
            <table style={tbl}><thead><tr>
              <th style={th}>{t('admin.financialsDocument.colComponent')}</th><th style={th}>{t('admin.financialsDocument.colSirs')}</th><th style={thR}>{t('admin.financialsDocument.colCurrent')}</th><th style={thR}>{t('admin.financialsDocument.colFullyFunded')}</th><th style={thR}>{t('admin.financialsDocument.colPctFunded')}</th>
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
                <td style={totTd}>{t('admin.financialsDocument.totalLabel')}</td><td style={{ ...tdC, borderTop: '2px solid #111' }}></td>
                <td style={totTdR}>{fmt$(reserves.reduce((s: number, r: any) => s + (Number(r.current_balance) || 0), 0))}</td>
                <td style={totTdR}>{fmt$(reserves.reduce((s: number, r: any) => s + (Number(r.fully_funded_balance) || 0), 0))}</td>
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

function BvaTable({ rows, catActual, budgetTotal, actualTotal, Em }:
  { rows: any[]; catActual: (id: string) => number; budgetTotal: number; actualTotal: number; Em: any }) {
  const t = useT()
  const pctUsed = (b: number, a: number) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—')
  return (
    <table style={tbl}><thead><tr>
      <th style={th}>{t('admin.financialsDocument.colCategory')}</th><th style={thR}>{t('admin.financialsDocument.colBudget')}</th><th style={thR}>{t('admin.financialsDocument.colActual')}</th><th style={thR}>{t('admin.financialsDocument.colVariance')}</th><th style={thR}>{t('admin.financialsDocument.colPctUsed')}</th>
    </tr></thead><tbody>
      {rows.map((b: any) => {
        const bud = Number(b.budget) || 0, act = catActual(b.id), v = bud - act
        return (
          <tr key={b.id}>
            <td style={td}>{b.name}</td>
            <td style={tdR}>{fmt$(bud)}</td>
            <td style={tdR}>{fmt$(act)}</td>
            <td style={{ ...tdR, color: v < 0 ? '#B42318' : '#111' }}>{fmt$(v)}</td>
            <td style={tdR}>{pctUsed(bud, act)}</td>
          </tr>
        )
      })}
      {rows.length === 0 && <tr><td style={td} colSpan={5}><Em>{t('admin.financialsDocument.noCategoriesOnFile')}</Em></td></tr>}
      <tr>
        <td style={totTd}>{t('admin.financialsDocument.totalLabel')}</td>
        <td style={totTdR}>{fmt$(budgetTotal)}</td>
        <td style={totTdR}>{fmt$(actualTotal)}</td>
        <td style={{ ...totTdR, color: budgetTotal - actualTotal < 0 ? '#B42318' : '#111' }}>{fmt$(budgetTotal - actualTotal)}</td>
        <td style={totTdR}>{budgetTotal > 0 ? Math.round((actualTotal / budgetTotal) * 100) + '%' : '—'}</td>
      </tr>
    </tbody></table>
  )
}

function Body({ children }: { children: any }) { return <div style={{ fontSize: 14 }}>{children}</div> }
function Sign({ name, assoc }: { name?: string | null; assoc?: string | null }) {
  const t = useT()
  return (
    <div style={{ marginTop: 36, fontSize: 14 }}>
      <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>{name || t('admin.financialsDocument.authorizedOfficer')}</div>
      <div style={{ fontSize: 12, color: '#555' }}>{assoc || t('admin.financialsDocument.associationFallback')}</div>
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
const secTd: React.CSSProperties = { ...td, fontWeight: 700, background: '#FAFAFA', fontSize: 12 }
const totTd: React.CSSProperties = { ...td, fontWeight: 800, borderTop: '2px solid #111' }
const totTdR: React.CSSProperties = { ...totTd, textAlign: 'right' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
