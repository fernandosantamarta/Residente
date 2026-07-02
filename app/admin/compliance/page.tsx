'use client'

// Compliance dashboard (Monitor surface). Merges per-domain signal producers
// into one prioritised board worklist. Advisory only — nothing here blocks.
// Each compliance domain plugs in by exporting a `*Signals()` producer and
// adding it to `gatherSignals()` below.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { sortSignals, type ComplianceSignal, type Severity } from '@/lib/compliance/rules-core'
import { AttorneyNote } from '../AttorneyNote'
import { ClampText } from '@/components/ClampText'
import { Pager } from '@/components/Pager'
import { communityDuesConfig } from '@/lib/dues'
import { useExpenses } from '@/hooks/useExpenses'
import { computeCommunityRating } from '@/lib/community-health'
import { foundationSignals } from '@/lib/compliance/signals'
import { setupSignals, SETUP_TASK_COUNT } from '@/lib/compliance/setup'
import { estoppelSignals, type EstoppelRequestRow } from '@/lib/compliance/estoppel'
import {
  collectionsSignals, paymentPlanSignals, delinquencySignals, delinquentOwnersWithoutCase,
  type CollectionCaseRow, type PaymentPlanRow,
} from '@/lib/compliance/collections'
import {
  structuralSignals,
  type BuildingRow, type StructuralAssessmentRow, type SirsComponentRow,
} from '@/lib/compliance/structural'
import {
  officialRecordsSignals,
  type DocumentRow, type RecordsRequestRow,
} from '@/lib/compliance/official-records'
import {
  financialSignals,
  type BudgetCategoryRow, type ReserveComponentRow, type FinancialFilingRow,
} from '@/lib/compliance/financials'
import { fetchGlCurrentFyRevenue } from '@/lib/gl/liveRevenue'
import {
  governanceSignals,
  type BoardTermRow, type DirectorCertRow, type DirectorEligibilityRow, type ManagerRow, type ConflictDisclosureRow,
} from '@/lib/compliance/governance'
import {
  enforcementSignals, suspensionSignals, fineDisputeSignals, votingSuspensionCandidates, votingSuspensionSignals,
  type ViolationRow, type HearingRow, type FiningCommitteeMemberRow, type SuspensionRow,
} from '@/lib/compliance/enforcement'
import { meetingsSignals, type MeetingRow } from '@/lib/compliance/meetings'
import { electionsSignals, recallSignals, type ElectionRow, type RecallRow } from '@/lib/compliance/elections'
import { arcSignals, type ArcRequestRow } from '@/lib/compliance/arc'
import { insuranceSignals, type InsurancePolicyRow } from '@/lib/compliance/insurance'
import { contractsSignals, type ContractRow } from '@/lib/compliance/contracts'
import { advisoriesSignals, type ComplianceEventRow, type ProxyRow } from '@/lib/compliance/advisories'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const SEVERITY_META: Record<Severity, { label: string; color: string; bg: string }> = {
  overdue: { label: 'Overdue', color: '#B42318', bg: 'rgba(180,35,24,0.08)' },
  soon:    { label: 'Due soon', color: '#B54708', bg: 'rgba(181,71,8,0.08)' },
  info:    { label: 'To do',   color: '#175CD3', bg: 'rgba(23,92,211,0.07)' },
}

// A signal/workspace href reduced to its base path (drop #hash / ?query) so
// signals can be tallied per workspace card.
const wsBase = (href: string) => href.split('#')[0].split('?')[0]

// Persistent entry points to the compliance workspaces. The signal worklist
// only links to a workspace when it has an active deadline, so these cards keep
// every workspace reachable from the dashboard even when nothing is flagged.
const WORKSPACES: { href: string; label: string; desc: string; color: string; group: string }[] = [
  // Money & assessments
  { href: '/admin/financials', label: 'Financial reporting & reserves', desc: 'Audit tier, the annual financial report & budget clocks, and reserve funding.', color: '#0E7490', group: 'Money & assessments' },
  { href: '/admin/collections', label: 'Collections & liens', desc: 'Work the statutory ladder: late-assessment notice, intent-to-lien, lien, foreclosure.', color: '#B54708', group: 'Money & assessments' },
  { href: '/admin/contracts', label: 'Procurement & contracts', desc: 'Competitive bids over 5% (condo) / 10% (HOA) of the budget, written contracts, and management-agreement terms.', color: '#6D28D9', group: 'Money & assessments' },
  { href: '/admin/estoppel', label: 'Estoppel certificates', desc: 'Intake requests, track the delivery clock + fee, and issue the certificate.', color: '#175CD3', group: 'Money & assessments' },
  // Governance
  { href: '/admin/governance', label: 'Directors & management', desc: 'Term limits, the director certification clock, conflicts of interest, and CAM licensing.', color: '#9333EA', group: 'Governance' },
  { href: '/admin/meetings', label: 'Meetings & notice', desc: 'Track the 48-hour / 14-day meeting-notice clock, agendas, and minutes availability.', color: '#0891B2', group: 'Governance' },
  { href: '/admin/elections', label: 'Elections & recall', desc: 'The 60 / 40 / 14-day election timeline, the election quorum, and the 5-business-day recall clock.', color: '#7C3AED', group: 'Governance' },
  { href: '/admin/enforcement', label: 'Violations, fines & hearings', desc: 'Run a fine through the independent committee, the 14-day hearing notice, and voting/use-rights suspensions.', color: '#DC6803', group: 'Governance' },
  // Property & records
  { href: '/admin/structural', label: 'Structural integrity', desc: 'Milestone inspections & SIRS. Track each building’s deadlines (condominium only).', color: '#067647', group: 'Property & records' },
  { href: '/admin/insurance', label: 'Insurance', desc: 'Property replacement-cost appraisal (every 36 months, condo) and the fidelity bond covering funds in custody.', color: '#DD2590', group: 'Property & records' },
  { href: '/admin/documents#documents', label: 'Official records', desc: 'Post required records, track retention, and answer records-inspection requests on the clock.', color: '#7A5AF8', group: 'Property & records' },
  { href: '/admin/arc', label: 'Architectural review', desc: 'Owner ARC requests against the response deadline, written-reason denials, and material-alteration votes.', color: '#65A30D', group: 'Property & records' },
  { href: '/admin/advisories', label: 'Advisories & event clocks', desc: 'Developer turnover, board-vacancy receivership, invoice delivery-method changes, the HOA tiered-report petition, and proxy expiry.', color: '#1D4ED8', group: 'Governance' },
]
const WORKSPACE_GROUPS = ['Money & assessments', 'Governance', 'Property & records']

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
  buildings: BuildingRow[],
  assessments: StructuralAssessmentRow[],
  sirsComponents: SirsComponentRow[],
  documents: DocumentRow[],
  recordsRequests: RecordsRequestRow[],
  budgets: BudgetCategoryRow[],
  reserves: ReserveComponentRow[],
  filings: FinancialFilingRow[],
  boardTerms: BoardTermRow[],
  directorCerts: DirectorCertRow[],
  directorElig: DirectorEligibilityRow[],
  managers: ManagerRow[],
  vendors: any[],
  disclosures: ConflictDisclosureRow[],
  violations: ViolationRow[],
  hearings: HearingRow[],
  finingCommittee: FiningCommitteeMemberRow[],
  suspensions: SuspensionRow[],
  meetings: MeetingRow[],
  elections: ElectionRow[],
  recalls: RecallRow[],
  arcRequests: ArcRequestRow[],
  insurancePolicies: InsurancePolicyRow[],
  contracts: ContractRow[],
  liveRevenue: number | null = null,
  complianceEvents: ComplianceEventRow[],
  proxies: ProxyRow[],
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
    ...setupSignals({ community, residents, budgets, documents }),
    ...foundationSignals(community),
    ...estoppelSignals(estoppel),
    ...collectionsSignals(cases, community?.association_type),
    ...paymentPlanSignals(plans),
    ...delinquencySignals(candidates),
    ...structuralSignals(buildings, assessments, sirsComponents, community), // condo-only (returns [] for HOA)
    ...officialRecordsSignals(community, documents, recordsRequests),
    ...financialSignals(community, budgets, reserves, filings, undefined, liveRevenue ?? undefined),
    ...governanceSignals(community, (residents || []).filter((r: any) => r.is_board), boardTerms, directorCerts, directorElig, managers, vendors, disclosures),
    ...enforcementSignals(community, violations, hearings, finingCommittee),
    ...fineDisputeSignals(violations, hearings),
    ...suspensionSignals(suspensions, hearings),
    ...votingSuspensionSignals(votingSuspensionCandidates(cases, suspensions, community?.association_type), community?.association_type),
    ...meetingsSignals(meetings, community),
    ...electionsSignals(elections, community),
    ...recallSignals(recalls),
    ...arcSignals(arcRequests, community),
    ...insuranceSignals(community, insurancePolicies, reserves), // property half condo-only; bond both regimes
    ...contractsSignals(community, contracts, budgets), // competitive-bid threshold uses budgets INCL reserves
    ...advisoriesSignals(community, complianceEvents, proxies), // niche/event-driven clocks + proxy expiry
  ])
}

export default function CompliancePage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  // Expense ledger feeds the shared community-health rating (same number the
  // resident Home "Where your dues go" card shows).
  const { expenses } = useExpenses()
  const [community, setCommunity] = useState<any>(null)
  const [estoppel, setEstoppel] = useState<EstoppelRequestRow[]>([])
  const [cases, setCases] = useState<CollectionCaseRow[]>([])
  const [plans, setPlans] = useState<PaymentPlanRow[]>([])
  const [residents, setResidents] = useState<any[]>([])
  const [payByResident, setPayByResident] = useState<Record<string, { amount: number }[]>>({})
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [assessments, setAssessments] = useState<StructuralAssessmentRow[]>([])
  const [sirsComponents, setSirsComponents] = useState<SirsComponentRow[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [recordsRequests, setRecordsRequests] = useState<RecordsRequestRow[]>([])
  const [budgets, setBudgets] = useState<BudgetCategoryRow[]>([])
  const [reserves, setReserves] = useState<ReserveComponentRow[]>([])
  const [filings, setFilings] = useState<FinancialFilingRow[]>([])
  const [boardTerms, setBoardTerms] = useState<BoardTermRow[]>([])
  const [directorCerts, setDirectorCerts] = useState<DirectorCertRow[]>([])
  const [directorElig, setDirectorElig] = useState<DirectorEligibilityRow[]>([])
  const [managers, setManagers] = useState<ManagerRow[]>([])
  const [vendors, setVendors] = useState<any[]>([])
  const [disclosures, setDisclosures] = useState<ConflictDisclosureRow[]>([])
  const [violations, setViolations] = useState<ViolationRow[]>([])
  const [hearings, setHearings] = useState<HearingRow[]>([])
  const [finingCommittee, setFiningCommittee] = useState<FiningCommitteeMemberRow[]>([])
  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([])
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [elections, setElections] = useState<ElectionRow[]>([])
  const [recalls, setRecalls] = useState<RecallRow[]>([])
  const [arcRequests, setArcRequests] = useState<ArcRequestRow[]>([])
  const [insurancePolicies, setInsurancePolicies] = useState<InsurancePolicyRow[]>([])
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [glRevenue, setGlRevenue] = useState<number | null>(null)
  const [complianceEvents, setComplianceEvents] = useState<ComplianceEventRow[]>([])
  const [proxies, setProxies] = useState<ProxyRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  // "Needs attention" filter toggle (mock parity): All / Overdue / Due soon.
  const [seg, setSeg] = useState<'all' | 'overdue' | 'soon'>('all')
  // Pagination for the (potentially long) needs-attention worklist.
  const [attnPage, setAttnPage] = useState(0)
  // Jump back to the first page whenever the filter changes so the view never
  // lands on an out-of-range page.
  useEffect(() => { setAttnPage(0) }, [seg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      // Every compliance domain reads its own table, all keyed only by
      // community_id with no dependency between them. Fire them in ONE parallel
      // batch instead of awaiting ~30 selects in series — the page used to wait
      // for the SUM of every round-trip (several seconds); now it waits for the
      // slowest single query. setState calls below land in one render pass.
      const sel = (table: string) => safeSelect(table, communityId)
      const [
        communityRes,
        estoppelRows, casesRows, plansRows, residentsRows, paysRows,
        buildingsRows, assessmentsRows, sirsRows, documentsRows, recordsRows,
        budgetsRows, reservesRows, filingsRows, boardTermsRows, certsRows,
        eligRows, managersRows, vendorsRows, disclosuresRows, violationsRows,
        hearingsRows, finingRows, suspensionsRows, meetingsRows, electionsRows,
        recallsRows, arcRows, insuranceRows, contractsRows, eventsRows, proxiesRows,
      ] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        sel('ev_estoppel_requests'), sel('ev_collection_cases'), sel('ev_payment_plans'),
        sel('residents'), sel('payments'),
        sel('ev_buildings'), sel('ev_structural_assessments'), sel('ev_sirs_components'),
        sel('documents'), sel('resident_requests'),
        sel('budget_categories'), sel('ev_reserve_components'), sel('ev_financial_filings'),
        sel('ev_board_terms'), sel('ev_director_certifications'), sel('ev_director_eligibility'),
        sel('ev_managers'), sel('vendors'), sel('ev_conflict_disclosures'),
        sel('ev_violations'), sel('ev_violation_hearings'), sel('ev_fining_committee_members'),
        sel('ev_suspensions'), sel('ev_meetings'), sel('ev_elections'),
        sel('ev_recalls'), sel('ev_arc_requests'), sel('ev_insurance_policies'),
        sel('ev_contracts'), sel('ev_compliance_events'), sel('ev_proxies'),
      ])

      const { data, error } = communityRes as any
      if (error) throw error
      setCommunity(data)

      const map: Record<string, { amount: number }[]> = {}
      for (const p of paysRows) { (map[p.resident_id] ||= []).push({ amount: Number(p.amount) || 0 }) }
      setPayByResident(map)

      setEstoppel(estoppelRows); setCases(casesRows); setPlans(plansRows)
      setResidents(residentsRows)
      setBuildings(buildingsRows); setAssessments(assessmentsRows); setSirsComponents(sirsRows)
      setDocuments(documentsRows); setRecordsRequests(recordsRows)
      setBudgets(budgetsRows); setReserves(reservesRows); setFilings(filingsRows)
      setBoardTerms(boardTermsRows); setDirectorCerts(certsRows); setDirectorElig(eligRows)
      setManagers(managersRows); setVendors(vendorsRows); setDisclosures(disclosuresRows)
      setViolations(violationsRows); setHearings(hearingsRows); setFiningCommittee(finingRows)
      setSuspensions(suspensionsRows); setMeetings(meetingsRows); setElections(electionsRows)
      setRecalls(recallsRows); setArcRequests(arcRows); setInsurancePolicies(insuranceRows)
      setContracts(contractsRows); setComplianceEvents(eventsRows); setProxies(proxiesRows)
      // Live current-FY GL revenue for the audit-tier signal (null until a ledger exists).
      setGlRevenue(await fetchGlCurrentFyRevenue(supabase, communityId, Number(data?.fiscal_year_start_month) || 1))
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.compliance.loadError')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const signals = useMemo(() => gatherSignals(community, estoppel, cases, plans, residents, payByResident, buildings, assessments, sirsComponents, documents, recordsRequests, budgets, reserves, filings, boardTerms, directorCerts, directorElig, managers, vendors, disclosures, violations, hearings, finingCommittee, suspensions, meetings, elections, recalls, arcRequests, insurancePolicies, contracts, glRevenue, complianceEvents, proxies), [community, estoppel, cases, plans, residents, payByResident, buildings, assessments, sirsComponents, documents, recordsRequests, budgets, reserves, filings, boardTerms, directorCerts, directorElig, managers, vendors, disclosures, violations, hearings, finingCommittee, suspensions, meetings, elections, recalls, arcRequests, insurancePolicies, contracts, glRevenue, complianceEvents, proxies])
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { overdue: 0, soon: 0, info: 0 }
    for (const s of signals) c[s.severity]++
    return c
  }, [signals])
  // Per-workspace open-signal counts — match a signal's href to a workspace so
  // each card can carry its own overdue/soon badge (folds the old count cards in).
  const wsCounts = useMemo(() => {
    const m: Record<string, { overdue: number; soon: number; info: number }> = {}
    for (const s of signals) {
      if (!s.href) continue
      const b = wsBase(s.href)
      ;(m[b] ||= { overdue: 0, soon: 0, info: 0 })
      if (s.severity === 'overdue') m[b].overdue++
      else if (s.severity === 'soon') m[b].soon++
      else m[b].info++
    }
    return m
  }, [signals])

  // Mock-parity derived values: the deadline-sorted "needs attention" list
  // (filtered by the seg toggle) and the on-track / compliant read for the tiles.
  const attention = useMemo(
    () => signals.filter(s => seg === 'all' || (seg === 'overdue' ? s.severity === 'overdue' : s.severity === 'soon')),
    [signals, seg],
  )
  const visibleWs = useMemo(
    () => WORKSPACES.filter(w => !(w.href === '/admin/structural' && community?.association_type === 'hoa')),
    [community],
  )
  const clearWs = useMemo(
    () => visibleWs.filter(w => { const c = wsCounts[wsBase(w.href)]; return !c || (!c.overdue && !c.soon) }).length,
    [visibleWs, wsCounts],
  )
  // Readiness blends two halves so a brand-new community reads as "getting
  // started", not "fully compliant": how much of the day-one setup is done, and
  // how many workspaces are statutorily on track. Each weighs 50%, so an unset
  // community lands low and climbs to 100% as setup + compliance are completed.
  const openSetup = useMemo(() => signals.filter(s => s.id.startsWith('setup:')).length, [signals])
  const setupScore = SETUP_TASK_COUNT ? Math.max(0, SETUP_TASK_COUNT - openSetup) / SETUP_TASK_COUNT : 1
  const complianceScore = visibleWs.length ? clearWs / visibleWs.length : 1
  const compliantPct = Math.round(((setupScore + complianceScore) / 2) * 100)
  // Community "health" — financial money-management grade, same rating the
  // resident Home shows. Distinct from Ready (setup + statutory compliance), so
  // they measure different things and don't contradict. Uses the budget_categories
  // already loaded (as `budgets`) + the expense ledger.
  // Same collections signal the resident Home card uses, so both grades stay
  // identical. Graceful until the community-collection-rate.sql RPC is run.
  const [collectionRate, setCollectionRate] = useState<number | null>(null)
  useEffect(() => {
    if (!hasSupabase || !supabase || !community?.id) { setCollectionRate(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('community_collection_rate', { p_community: community.id })
        if (!cancelled) setCollectionRate(error || data == null ? null : Number(data))
      } catch { if (!cancelled) setCollectionRate(null) }
    })()
    return () => { cancelled = true }
  }, [community?.id])
  const communityHealth = useMemo(
    () => computeCommunityRating({ community, categories: budgets, expenses, collectionRate }),
    [community, budgets, expenses, collectionRate],
  )

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">{t('admin.compliance.kicker')}</div>
      <h1 className="admin-h1">{t('admin.compliance.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.compliance.pageDek')}
      </p>

      <AttorneyNote />

      {status === 'loading' && <div className="admin-note">{t('admin.compliance.loading')}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          {t('admin.compliance.noCommunity')}
        </div>
      )}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.compliance.retry')}</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* Stat tiles (mock parity) — flagged counts + an on-track / compliant read. */}
          <div className="cmp-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, margin: '18px 0 22px' }}>
            {[
              { v: counts.overdue, l: t('admin.compliance.statOverdue'), c: '#B42318' },
              { v: counts.soon, l: t('admin.compliance.statDueSoon'), c: '#B54708' },
              { v: counts.info, l: t('admin.compliance.statToDo'), c: '#175CD3' },
              { v: clearWs, l: t('admin.compliance.statOnTrack'), c: '#067647' },
              { v: `${compliantPct}%`, l: t('admin.compliance.statReady'), c: '#2A1206' },
              { v: `${communityHealth}%`, l: t('admin.compliance.statHealth'), c: '#067647' },
            ].map(s => (
              <div key={s.l} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: s.c }}>{s.v}</div>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Needs attention — one deadline-sorted list with a filter toggle. */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-head">
              <div><h2>{t('admin.compliance.needsAttentionTitle')}</h2><div className="sub">{t('admin.compliance.sortedByDeadline')}</div></div>
              <div className="attn-filter" style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'rgba(0,0,0,0.05)', borderRadius: 999 }}>
                {(['all', 'overdue', 'soon'] as const).map(k => (
                  <button key={k} type="button" onClick={() => setSeg(k)}
                    style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 13px', fontSize: 12.5, fontWeight: 700,
                      background: seg === k ? '#fff' : 'transparent', color: seg === k ? '#2A1206' : 'rgba(0,0,0,0.5)',
                      boxShadow: seg === k ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}>
                    {k === 'all' ? t('admin.compliance.filterAll') : k === 'overdue' ? t('admin.compliance.filterOverdue') : t('admin.compliance.filterDueSoon')}
                  </button>
                ))}
              </div>
            </div>
            {attention.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '26px 16px', color: 'rgba(0,0,0,0.55)' }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
                {seg === 'all'
                  ? t('admin.compliance.emptyAll')
                  : seg === 'overdue' ? t('admin.compliance.emptyOverdue') : t('admin.compliance.emptyDueSoon')}
              </div>
            ) : (() => {
              const ATTN_SIZE = 8
              const pageCount = Math.ceil(attention.length / ATTN_SIZE)
              const page = Math.min(attnPage, Math.max(0, pageCount - 1))
              const paged = attention.slice(page * ATTN_SIZE, (page + 1) * ATTN_SIZE)
              return (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {paged.map(s => <SignalRow key={s.id} signal={s} />)}
                  </div>
                  {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setAttnPage} />}
                </>
              )
            })()}
          </div>

          {/* Workspaces — every compliance domain as a clean row list, grouped
              and badged with its own count (matches the Needs-attention rows). */}
          <h2 className="bc-title" style={{ margin: '4px 0 14px' }}>{t('admin.compliance.workspacesTitle')}</h2>
          {WORKSPACE_GROUPS.map(group => {
            const items = WORKSPACES.filter(w => w.group === group && !(w.href === '/admin/structural' && community?.association_type === 'hoa'))
            if (!items.length) return null
            const groupLabel = group === 'Money & assessments' ? t('admin.compliance.groupMoney')
              : group === 'Governance' ? t('admin.compliance.groupGovernance')
              : t('admin.compliance.groupProperty')
            return (
              <div className="card" key={group} style={{ marginBottom: 16 }}>
                <div className="card-head"><div><h2>{groupLabel}</h2></div></div>
                <div className="wslist">
                  {items.map(w => {
                    const c = wsCounts[wsBase(w.href)] || { overdue: 0, soon: 0, info: 0 }
                    const badge = c.overdue ? { t: t('admin.compliance.badgeOverdue', { count: c.overdue }), col: '#B42318' }
                      : c.soon ? { t: t('admin.compliance.badgeDueSoon', { count: c.soon }), col: '#B54708' }
                      : c.info ? { t: t('admin.compliance.badgeToDo', { count: c.info }), col: '#175CD3' }
                      : { t: t('admin.compliance.badgeOnTrack'), col: '#067647' }
                    return (
                      <Link key={w.href} href={w.href} className="wsrow">
                        <span className="wsrow-glyph" style={{ color: w.color, background: w.color + '18' }}><WsGlyph /></span>
                        <div className="wsrow-main">
                          <div className="wsrow-title">{w.label}</div>
                          <div className="wsrow-desc">{w.desc}</div>
                        </div>
                        <span className="wsrow-badge" style={{ color: badge.col, background: badge.col + '14' }}>{badge.t}</span>
                        <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// One row in the "Needs attention" list (mock .lrow): severity pill, title +
// statute/detail meta, Review link. Rows are separated by a hairline top border.
function SignalRow({ signal: s }: { signal: ComplianceSignal }) {
  const t = useT()
  const meta = SEVERITY_META[s.severity]
  // Collections to-dos carry a reviewHref that jumps straight to the owner's
  // case / 30-day notice; everything else uses its workspace href.
  const target = s.reviewHref || s.href
  const severityLabel = s.severity === 'overdue' ? t('admin.compliance.severityOverdue')
    : s.severity === 'soon' ? t('admin.compliance.severityDueSoon')
    : t('admin.compliance.severityToDo')
  const body = (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '13px 2px', borderTop: '1px solid rgba(0,0,0,0.06)',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
        color: meta.color, background: meta.bg, padding: '3px 0', borderRadius: 999, whiteSpace: 'nowrap', marginTop: 1,
        width: 84, textAlign: 'center', flexShrink: 0, boxSizing: 'border-box',
      }}>{severityLabel}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{s.title}</div>
        <ClampText
          className="sig-meta"
          lines={2}
          text={`${s.domain}${s.citation ? ` · ${s.citation}` : ''}${s.detail ? ` · ${s.detail}` : ''}`}
        />
      </div>
      {target && <span style={{ fontSize: 13, color: meta.color, fontWeight: 700, whiteSpace: 'nowrap', marginTop: 1 }}>{t('admin.compliance.review')} →</span>}
    </div>
  )
  return target ? <Link href={target} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{body}</Link> : body
}

// Generic workspace glyph — a shield-check, tinted per workspace color.
function WsGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 4v6c0 5-3.5 7-8 8-4.5-1-8-3-8-8V7z" /><path d="M9 12l2 2 4-4" />
    </svg>
  )
}
