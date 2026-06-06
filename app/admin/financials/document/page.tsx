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

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { ymd } from '@/lib/compliance/rules-core'
import {
  requiredAuditTier, estimateAnnualRevenue, AUDIT_TIER_LABEL,
} from '@/lib/compliance/financials'
import { currentFiscalYear, fiscalYearFor, inFiscalYear, fiscalYearEndInclusive } from '@/lib/fiscal'
import { glCurrentFyRevenue, balanceSheetByFund, revExpByFund, type TBRow } from '@/lib/gl/statements'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

type DocType = 'statement' | 'budget_actual' | 'balance_sheet' | 'rev_exp' | 'afr' | 'budget' | 'reserve_worksheet'
const TITLES: Record<DocType, string> = {
  statement: 'Statement of Cash Receipts & Expenditures',
  budget_actual: 'Budget vs Actual',
  balance_sheet: 'Balance Sheet',
  rev_exp: 'Statement of Revenue & Expenses',
  afr: 'Annual Financial Report',
  budget: 'Proposed Budget Package',
  reserve_worksheet: 'Reserve Funding Worksheet',
}
const LIVE: Record<DocType, boolean> = {
  statement: true, budget_actual: true, balance_sheet: true, rev_exp: true, afr: false, budget: false, reserve_worksheet: false,
}
// The two GL-sourced reports are accrual (from the general ledger); the cash
// statement + budget-vs-actual are cash basis. Drives the banner wording.
const GL_SOURCED: Partial<Record<DocType, boolean>> = { balance_sheet: true, rev_exp: true }

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
  const type = (search?.get('type') || 'statement') as DocType

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
        if (cancelled) return
        setCommunity(c || null); setBudgets(b || []); setReserves(r || [])
        setExpenses(ex || []); setPayments(pays || []); setDuesSummary(ds)
        setGlTB(tb); setGlTBFy(tbFy)
        setStatus('ready')
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
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0 } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginBottom: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 12, background: LIVE[type] ? '#ECFDF3' : '#FEF3F2', color: LIVE[type] ? '#067647' : '#B42318', padding: '8px 12px', borderRadius: 8, maxWidth: 540 }}>
          {LIVE[type]
            ? GL_SOURCED[type]
              ? <>Computed from your general ledger ({fy.label}, ACCRUAL basis) — a regenerable projection of your recorded activity. Above the statutory revenue tier, have your CPA prepare the required compiled/reviewed/audited statements.</>
              : <>Computed from your recorded payments (cash in) and expenses (cash out) for {fy.label}, on a CASH basis. Above the statutory revenue tier, have your CPA prepare the required compiled/reviewed/audited statements.</>
            : <>⚠ DRAFT — an aid, not an official filing or accounting opinion. Figures are drawn from the budget you entered; have the report prepared/reviewed by your CPA and confirmed by counsel before relying on it or delivering it to members.</>}
        </div>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', height: 'fit-content' }}>Print / Save as PDF</button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>set the association address in Community settings</Em>}</div>
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
          <h3 style={h3}>Cash receipts</h3>
          <table style={tbl}><tbody>
            <tr><td style={td}>Assessments &amp; dues</td><td style={tdR}>{fmt$(receipts.assessments)}</td></tr>
            <tr><td style={td}>Fines</td><td style={tdR}>{fmt$(receipts.fines)}</td></tr>
            <tr><td style={td}>Other</td><td style={tdR}>{fmt$(receipts.other)}</td></tr>
            <tr><td style={totTd}>Total receipts</td><td style={totTdR}>{fmt$(totalReceipts)}</td></tr>
          </tbody></table>

          <h3 style={h3}>Cash disbursements — operating fund</h3>
          <table style={tbl}><tbody>
            {operating.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>)}
            {operating.length === 0 && <tr><td style={td} colSpan={2}><Em>No operating categories on file.</Em></td></tr>}
            <tr><td style={totTd}>Operating subtotal</td><td style={totTdR}>{fmt$(operatingActual)}</td></tr>
          </tbody></table>

          {(reserveLines.length > 0 || reserveActual > 0) && (
            <>
              <h3 style={h3}>Cash disbursements — reserve fund</h3>
              <table style={tbl}><tbody>
                {reserveLines.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>)}
                <tr><td style={totTd}>Reserve subtotal</td><td style={totTdR}>{fmt$(reserveActual)}</td></tr>
              </tbody></table>
            </>
          )}

          <table style={{ ...tbl, marginTop: 14 }}><tbody>
            {uncategorizedActual > 0 && <tr><td style={td}>Uncategorized disbursements</td><td style={tdR}>{fmt$(uncategorizedActual)}</td></tr>}
            <tr><td style={totTd}>Total disbursements</td><td style={totTdR}>{fmt$(totalDisbursements)}</td></tr>
            <tr><td style={{ ...totTd, fontSize: 14 }}>Net change in cash</td><td style={{ ...totTdR, fontSize: 14, color: netChange < 0 ? '#B42318' : '#067647' }}>{fmt$(netChange)}</td></tr>
          </tbody></table>

          {hasLedger ? (
            <p style={cite}>
              Accrual context (from the general ledger, as of {today}): assessments receivable {fmt$(glArNet)} in
              the operating fund. See the Balance Sheet and Statement of Revenue &amp; Expenses for the full accrual picture.
            </p>
          ) : duesSummary ? (
            <p style={cite}>
              Accrual context (as of today, all years): assessments collected {fmt$(duesSummary.collected)},
              outstanding receivable {fmt$(duesSummary.outstanding)} ({Number(duesSummary.rate) || 0}% collected).
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
          <p>Adopted budget against actual recorded spending for {fy.label}. Variance is budget − actual (positive = under budget).</p>
          <h3 style={h3}>Operating fund</h3>
          <BvaTable rows={operating} catActual={catActual} budgetTotal={operatingBudget} actualTotal={operatingActual} Em={Em} />
          {(reserveLines.length > 0 || reserveActual > 0) && (
            <>
              <h3 style={h3}>Reserve fund</h3>
              <BvaTable rows={reserveLines} catActual={catActual} budgetTotal={reserveBudget} actualTotal={reserveActual} Em={Em} />
            </>
          )}
          {uncategorizedActual > 0 && (
            <p style={cite}>Plus {fmt$(uncategorizedActual)} of recorded spending not assigned to a budget category — categorize these in the Expenses log so they land in a fund above.</p>
          )}
          <p style={cite}>Actuals are recorded expenses dated within {fy.label}. Budget figures are what you entered per category; adopt the budget per {isHoa ? 'FS 720.303(6)' : 'FS 718.112(2)(f)'}.</p>
        </Body>
      )}

      {/* ---------- Balance sheet (by fund, from the GL) ---------- */}
      {type === 'balance_sheet' && (
        <Body>
          {!hasLedger ? (
            <p><Em>No general ledger has been built yet. Once the ledger is built (Accounting → rebuild), this Balance Sheet populates from your double-entry books.</Em></p>
          ) : (
            <>
              <p>Assets, liabilities and fund balance as of {today}, by fund — from your general ledger (accrual). Operating and reserve funds are shown separately (FS {isHoa ? '720.303(6)' : '718.111(14)'}).</p>
              {bsheet.funds.map((f: any) => (
                <div key={f.fund}>
                  <h3 style={h3}>{f.fund === 'operating' ? 'Operating fund' : f.fund === 'reserve' ? 'Reserve fund' : f.fund}</h3>
                  <table style={tbl}><tbody>
                    <tr><td style={secTd} colSpan={2}>Assets</td></tr>
                    {f.assets.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.assets.length === 0 && <tr><td style={td} colSpan={2}><Em>None</Em></td></tr>}
                    <tr><td style={totTd}>Total assets</td><td style={totTdR}>{fmt$(f.totalAssets)}</td></tr>
                    <tr><td style={secTd} colSpan={2}>Liabilities &amp; fund balance</td></tr>
                    {f.liabilities.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.equity.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    <tr><td style={td}>Accumulated surplus / (deficit)</td><td style={tdR}>{fmt$(f.netIncome)}</td></tr>
                    <tr><td style={totTd}>Total liabilities &amp; fund balance</td><td style={totTdR}>{fmt$(f.totalLiabilities + f.totalEquity)}</td></tr>
                  </tbody></table>
                </div>
              ))}
              <table style={{ ...tbl, marginTop: 14 }}><tbody>
                <tr><td style={{ ...totTd, fontSize: 14 }}>Total assets (all funds)</td><td style={{ ...totTdR, fontSize: 14 }}>{fmt$(bsheet.totalAssets)}</td></tr>
                <tr><td style={totTd}>Total liabilities &amp; fund balance</td><td style={totTdR}>{fmt$(bsheet.totalLiabilities + bsheet.totalEquity)}</td></tr>
              </tbody></table>
              <p style={cite}>
                {bsheet.balances
                  ? 'Assets equal liabilities plus fund balance — the ledger is in balance.'
                  : '⚠ Assets do not equal liabilities plus fund balance; rebuild the ledger.'}
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
            <p><Em>No general ledger has been built yet. Once the ledger is built (Accounting → rebuild), this statement populates from your double-entry books.</Em></p>
          ) : (
            <>
              <p>Revenue earned and expenses incurred for {fy.label} ({fy.startISO} through {fyEnd}), accrual basis, by fund.</p>
              {revexp.funds.length === 0 && <p><Em>No revenue or expense entries recorded for {fy.label}.</Em></p>}
              {revexp.funds.map((f: any) => (
                <div key={f.fund}>
                  <h3 style={h3}>{f.fund === 'operating' ? 'Operating fund' : f.fund === 'reserve' ? 'Reserve fund' : f.fund}</h3>
                  <table style={tbl}><tbody>
                    <tr><td style={secTd} colSpan={2}>Revenue</td></tr>
                    {f.revenue.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.revenue.length === 0 && <tr><td style={td} colSpan={2}><Em>None</Em></td></tr>}
                    <tr><td style={totTd}>Total revenue</td><td style={totTdR}>{fmt$(f.totalRevenue)}</td></tr>
                    <tr><td style={secTd} colSpan={2}>Expenses</td></tr>
                    {f.expense.map((a: any) => <tr key={a.code}><td style={td}>{a.name}</td><td style={tdR}>{fmt$(a.amount)}</td></tr>)}
                    {f.expense.length === 0 && <tr><td style={td} colSpan={2}><Em>None</Em></td></tr>}
                    <tr><td style={totTd}>Total expenses</td><td style={totTdR}>{fmt$(f.totalExpense)}</td></tr>
                    <tr><td style={{ ...totTd, fontSize: 14 }}>Net surplus / (deficit)</td><td style={{ ...totTdR, fontSize: 14, color: f.net < 0 ? '#B42318' : '#067647' }}>{fmt$(f.net)}</td></tr>
                  </tbody></table>
                </div>
              ))}
              {revexp.funds.length > 1 && (
                <table style={{ ...tbl, marginTop: 14 }}><tbody>
                  <tr><td style={totTd}>Total revenue (all funds)</td><td style={totTdR}>{fmt$(revexp.totalRevenue)}</td></tr>
                  <tr><td style={totTd}>Total expenses (all funds)</td><td style={totTdR}>{fmt$(revexp.totalExpense)}</td></tr>
                  <tr><td style={{ ...totTd, fontSize: 14 }}>Net surplus / (deficit)</td><td style={{ ...totTdR, fontSize: 14, color: revexp.net < 0 ? '#B42318' : '#067647' }}>{fmt$(revexp.net)}</td></tr>
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
          <table style={tbl}><thead><tr><th style={th}>Category</th><th style={thR}>Budget</th><th style={thR}>Actual</th></tr></thead><tbody>
            {operating.map((b: any) => (
              <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>
            ))}
            {operating.length === 0 && <tr><td style={td} colSpan={3}><Em>No budget categories on file.</Em></td></tr>}
            <tr><td style={totTd}>Total</td><td style={totTdR}>{fmt$(operatingBudget)}</td><td style={totTdR}>{fmt$(operatingActual)}</td></tr>
          </tbody></table>
          {reserveLines.length > 0 && (
            <>
              <h3 style={h3}>Reserves</h3>
              <table style={tbl}><thead><tr><th style={th}>Component</th><th style={thR}>Budget</th><th style={thR}>Actual</th></tr></thead><tbody>
                {reserveLines.map((b: any) => <tr key={b.id}><td style={td}>{b.name}</td><td style={tdR}>{fmt$(b.budget)}</td><td style={tdR}>{fmt$(catActual(b.id))}</td></tr>)}
                <tr><td style={totTd}>Total</td><td style={totTdR}>{fmt$(reserveBudget)}</td><td style={totTdR}>{fmt$(reserveActual)}</td></tr>
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
            <tr><td style={totTd}>Operating total</td><td style={totTdR}>{fmt$(operatingBudget)}</td><td style={totTdR}>{units > 0 ? fmt$(operatingBudget / units) : '—'}</td></tr>
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
                <td style={totTd}>Total</td><td style={{ ...tdC, borderTop: '2px solid #111' }}></td>
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
  const pctUsed = (b: number, a: number) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—')
  return (
    <table style={tbl}><thead><tr>
      <th style={th}>Category</th><th style={thR}>Budget</th><th style={thR}>Actual</th><th style={thR}>Variance</th><th style={thR}>% used</th>
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
      {rows.length === 0 && <tr><td style={td} colSpan={5}><Em>No categories on file.</Em></td></tr>}
      <tr>
        <td style={totTd}>Total</td>
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
const secTd: React.CSSProperties = { ...td, fontWeight: 700, background: '#FAFAFA', fontSize: 12 }
const totTd: React.CSSProperties = { ...td, fontWeight: 800, borderTop: '2px solid #111' }
const totTdR: React.CSSProperties = { ...totTd, textAlign: 'right' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
