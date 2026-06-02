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
import {
  governanceSignals,
  type BoardTermRow, type DirectorCertRow, type DirectorEligibilityRow, type ManagerRow, type ConflictDisclosureRow,
} from '@/lib/compliance/governance'
import {
  enforcementSignals, suspensionSignals, votingSuspensionCandidates, votingSuspensionSignals,
  type ViolationRow, type HearingRow, type FiningCommitteeMemberRow, type SuspensionRow,
} from '@/lib/compliance/enforcement'
import { meetingsSignals, type MeetingRow } from '@/lib/compliance/meetings'
import { electionsSignals, recallSignals, type ElectionRow, type RecallRow } from '@/lib/compliance/elections'
import { arcSignals, type ArcRequestRow } from '@/lib/compliance/arc'

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
  { href: '/admin/collections', label: 'Collections & liens', desc: 'Work the statutory ladder — late-assessment notice, intent-to-lien, lien, foreclosure.', color: '#B54708', group: 'Money & assessments' },
  { href: '/admin/estoppel', label: 'Estoppel certificates', desc: 'Intake requests, track the delivery clock + fee, and issue the certificate.', color: '#175CD3', group: 'Money & assessments' },
  { href: '/admin/financials', label: 'Financial reporting & reserves', desc: 'Audit tier, the annual financial report & budget clocks, and reserve funding.', color: '#0E7490', group: 'Money & assessments' },
  // Governance
  { href: '/admin/governance', label: 'Directors & management', desc: 'Term limits, the director certification clock, conflicts of interest, and CAM licensing.', color: '#9333EA', group: 'Governance' },
  { href: '/admin/meetings', label: 'Meetings & notice', desc: 'Track the 48-hour / 14-day meeting-notice clock, agendas, and minutes availability.', color: '#0891B2', group: 'Governance' },
  { href: '/admin/elections', label: 'Elections & recall', desc: 'The 60 / 40 / 14-day election timeline, the election quorum, and the 5-business-day recall clock.', color: '#7C3AED', group: 'Governance' },
  { href: '/admin/enforcement', label: 'Violations, fines & hearings', desc: 'Run a fine through the independent committee, the 14-day hearing notice, and voting/use-rights suspensions.', color: '#DC6803', group: 'Governance' },
  // Property & records
  { href: '/admin/structural', label: 'Structural integrity', desc: 'Milestone inspections & SIRS — track each building’s deadlines (condominium only).', color: '#067647', group: 'Property & records' },
  { href: '/admin/arc', label: 'Architectural review', desc: 'Owner ARC requests against the response deadline, written-reason denials, and material-alteration votes.', color: '#65A30D', group: 'Property & records' },
  { href: '/admin/documents#documents', label: 'Official records', desc: 'Post required records, track retention, and answer records-inspection requests on the clock.', color: '#7A5AF8', group: 'Property & records' },
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
    ...structuralSignals(buildings, assessments, sirsComponents, community), // condo-only (returns [] for HOA)
    ...officialRecordsSignals(community, documents, recordsRequests),
    ...financialSignals(community, budgets, reserves, filings),
    ...governanceSignals(community, (residents || []).filter((r: any) => r.is_board), boardTerms, directorCerts, directorElig, managers, vendors, disclosures),
    ...enforcementSignals(community, violations, hearings, finingCommittee),
    ...suspensionSignals(suspensions, hearings),
    ...votingSuspensionSignals(votingSuspensionCandidates(cases, suspensions)),
    ...meetingsSignals(meetings, community),
    ...electionsSignals(elections, community),
    ...recallSignals(recalls),
    ...arcSignals(arcRequests, community),
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
      setBuildings(await safeSelect('ev_buildings', communityId))
      setAssessments(await safeSelect('ev_structural_assessments', communityId))
      setSirsComponents(await safeSelect('ev_sirs_components', communityId))
      setDocuments(await safeSelect('documents', communityId))
      setRecordsRequests(await safeSelect('resident_requests', communityId))
      setBudgets(await safeSelect('budget_categories', communityId))
      setReserves(await safeSelect('ev_reserve_components', communityId))
      setFilings(await safeSelect('ev_financial_filings', communityId))
      setBoardTerms(await safeSelect('ev_board_terms', communityId))
      setDirectorCerts(await safeSelect('ev_director_certifications', communityId))
      setDirectorElig(await safeSelect('ev_director_eligibility', communityId))
      setManagers(await safeSelect('ev_managers', communityId))
      setVendors(await safeSelect('vendors', communityId))
      setDisclosures(await safeSelect('ev_conflict_disclosures', communityId))
      setViolations(await safeSelect('ev_violations', communityId))
      setHearings(await safeSelect('ev_violation_hearings', communityId))
      setFiningCommittee(await safeSelect('ev_fining_committee_members', communityId))
      setSuspensions(await safeSelect('ev_suspensions', communityId))
      setMeetings(await safeSelect('ev_meetings', communityId))
      setElections(await safeSelect('ev_elections', communityId))
      setRecalls(await safeSelect('ev_recalls', communityId))
      setArcRequests(await safeSelect('ev_arc_requests', communityId))
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load compliance data'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const signals = useMemo(() => gatherSignals(community, estoppel, cases, plans, residents, payByResident, buildings, assessments, sirsComponents, documents, recordsRequests, budgets, reserves, filings, boardTerms, directorCerts, directorElig, managers, vendors, disclosures, violations, hearings, finingCommittee, suspensions, meetings, elections, recalls, arcRequests), [community, estoppel, cases, plans, residents, payByResident, buildings, assessments, sirsComponents, documents, recordsRequests, budgets, reserves, filings, boardTerms, directorCerts, directorElig, managers, vendors, disclosures, violations, hearings, finingCommittee, suspensions, meetings, elections, recalls, arcRequests])
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { overdue: 0, soon: 0, info: 0 }
    for (const s of signals) c[s.severity]++
    return c
  }, [signals])
  // Per-workspace open-signal counts — match a signal's href to a workspace so
  // each card can carry its own overdue/soon badge (folds the old count cards in).
  const wsCounts = useMemo(() => {
    const m: Record<string, { overdue: number; soon: number }> = {}
    for (const s of signals) {
      if (!s.href) continue
      const b = wsBase(s.href)
      ;(m[b] ||= { overdue: 0, soon: 0 })
      if (s.severity === 'overdue') m[b].overdue++
      else if (s.severity === 'soon') m[b].soon++
    }
    return m
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
          {/* Workspaces — overall status summarised inline in the header, and
              each card badged with its own overdue/soon count (this combines the
              former standalone Overdue / Due-soon / To-do count cards). */}
          <section style={{ margin: '18px 0 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <h2 className="bc-title" style={{ margin: 0 }}>Workspaces</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['overdue', 'soon', 'info'] as Severity[]).map(sev => (
                  <span key={sev} style={{ fontSize: 12, fontWeight: 700, color: SEVERITY_META[sev].color, background: SEVERITY_META[sev].bg, padding: '4px 11px', borderRadius: 999 }}>
                    {counts[sev]} {SEVERITY_META[sev].label}
                  </span>
                ))}
              </div>
            </div>
            {WORKSPACE_GROUPS.map(group => {
              const items = WORKSPACES.filter(w => w.group === group && !(w.href === '/admin/structural' && community?.association_type === 'hoa'))
              if (!items.length) return null
              return (
                <div key={group} style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'rgba(0,0,0,0.4)', marginBottom: 8 }}>{group}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                    {items.map(w => {
                      const c = wsCounts[wsBase(w.href)] || { overdue: 0, soon: 0 }
                      const badge = c.overdue
                        ? { t: `${c.overdue} overdue`, col: '#B42318' }
                        : c.soon
                          ? { t: `${c.soon} due soon`, col: '#B54708' }
                          : { t: 'Clear', col: '#067647' }
                      return (
                        <Link key={w.href} href={w.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderLeft: `4px solid ${w.color}`, borderRadius: 12, padding: '14px 16px', background: '#fff', height: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{w.label}</div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: badge.col, background: badge.col + '14', padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{badge.t}</span>
                            </div>
                            <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 4 }}>{w.desc}</div>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>

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
