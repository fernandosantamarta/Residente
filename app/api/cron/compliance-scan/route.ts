// Weekly compliance sweep — invoked by Vercel Cron (see vercel.json).
//
// For every community it recomputes the same Monitor signals the /admin/
// compliance dashboard shows, and — when anything is overdue or due soon —
// drops ONE board-directed 'compliance_alert' digest notice linking back to the
// dashboard. Advisory only; it never changes association data.
//
// channels=[] so the generic ev_notice_fanout skips it; we insert recipient
// rows for the community's board members / admins only. Idempotent: one digest
// per community per scan window.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// Env: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, a Supabase URL.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sortSignals } from '@/lib/compliance/rules-core'
import { foundationSignals } from '@/lib/compliance/signals'
import { estoppelSignals, type EstoppelRequestRow } from '@/lib/compliance/estoppel'
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
  enforcementSignals, suspensionSignals, fineDisputeSignals, votingSuspensionCandidates, votingSuspensionSignals,
  type ViolationRow, type HearingRow, type FiningCommitteeMemberRow, type SuspensionRow,
} from '@/lib/compliance/enforcement'
import { meetingsSignals, type MeetingRow } from '@/lib/compliance/meetings'
import { electionsSignals, recallSignals, type ElectionRow, type RecallRow } from '@/lib/compliance/elections'
import { arcSignals, type ArcRequestRow } from '@/lib/compliance/arc'
import { insuranceSignals, type InsurancePolicyRow } from '@/lib/compliance/insurance'
import { contractsSignals, type ContractRow } from '@/lib/compliance/contracts'

export const dynamic = 'force-dynamic'

// Don't re-digest a community more than once per scan window (weekly cron).
const RECENT_DAYS = 6

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    'https://nozzfcxijdnllkiydhfi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'

  const { data: comms, error: cErr } = await admin.from('communities').select('*')
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  // Resilient: a domain table whose migration hasn't run returns [] not a throw.
  const safe = async (table: string, communityId: string): Promise<any[]> => {
    const { data, error } = await admin.from(table).select('*').eq('community_id', communityId)
    return error ? [] : (data || [])
  }

  const sinceISO = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const summary: Array<Record<string, unknown>> = []
  let totalNotified = 0

  for (const c of comms ?? []) {
    const estoppel = (await safe('ev_estoppel_requests', c.id)) as EstoppelRequestRow[]
    const buildings = (await safe('ev_buildings', c.id)) as BuildingRow[]
    const assessments = (await safe('ev_structural_assessments', c.id)) as StructuralAssessmentRow[]
    const sirsComponents = (await safe('ev_sirs_components', c.id)) as SirsComponentRow[]
    const documents = (await safe('documents', c.id)) as DocumentRow[]
    const recordsRequests = (await safe('resident_requests', c.id)) as RecordsRequestRow[]
    const budgets = (await safe('budget_categories', c.id)) as BudgetCategoryRow[]
    const reserves = (await safe('ev_reserve_components', c.id)) as ReserveComponentRow[]
    const filings = (await safe('ev_financial_filings', c.id)) as FinancialFilingRow[]
    const directors = (await safe('residents', c.id)).filter((r: any) => r.is_board)
    const boardTerms = (await safe('ev_board_terms', c.id)) as BoardTermRow[]
    const directorCerts = (await safe('ev_director_certifications', c.id)) as DirectorCertRow[]
    const directorElig = (await safe('ev_director_eligibility', c.id)) as DirectorEligibilityRow[]
    const managers = (await safe('ev_managers', c.id)) as ManagerRow[]
    const govVendors = await safe('vendors', c.id)
    const disclosures = (await safe('ev_conflict_disclosures', c.id)) as ConflictDisclosureRow[]
    const violations = (await safe('ev_violations', c.id)) as ViolationRow[]
    const hearings = (await safe('ev_violation_hearings', c.id)) as HearingRow[]
    const finingCommittee = (await safe('ev_fining_committee_members', c.id)) as FiningCommitteeMemberRow[]
    const suspensions = (await safe('ev_suspensions', c.id)) as SuspensionRow[]
    const cases = await safe('ev_collection_cases', c.id)
    const meetings = (await safe('ev_meetings', c.id)) as MeetingRow[]
    const elections = (await safe('ev_elections', c.id)) as ElectionRow[]
    const recalls = (await safe('ev_recalls', c.id)) as RecallRow[]
    const arcRequests = (await safe('ev_arc_requests', c.id)) as ArcRequestRow[]
    const insurancePolicies = (await safe('ev_insurance_policies', c.id)) as InsurancePolicyRow[]
    const contracts = (await safe('ev_contracts', c.id)) as ContractRow[]
    const signals = sortSignals([
      ...foundationSignals(c),
      ...estoppelSignals(estoppel),
      ...structuralSignals(buildings, assessments, sirsComponents, c), // condo-only (returns [] for HOA)
      ...officialRecordsSignals(c, documents, recordsRequests),
      ...financialSignals(c, budgets, reserves, filings),
      ...governanceSignals(c, directors, boardTerms, directorCerts, directorElig, managers, govVendors, disclosures),
      ...enforcementSignals(c, violations, hearings, finingCommittee),
      ...fineDisputeSignals(violations, hearings),
      ...suspensionSignals(suspensions, hearings),
      ...votingSuspensionSignals(votingSuspensionCandidates(cases, suspensions, c.association_type), c.association_type),
      ...meetingsSignals(meetings, c),
      ...electionsSignals(elections, c),
      ...recallSignals(recalls),
      ...arcSignals(arcRequests, c),
      ...insuranceSignals(c, insurancePolicies, reserves), // property half condo-only; bond both regimes
      ...contractsSignals(c, contracts, budgets), // competitive-bid threshold uses budgets INCL reserves
    ])
    const actionable = signals.filter(s => s.severity === 'overdue' || s.severity === 'soon')
    if (!actionable.length) { summary.push({ community: c.id, actionable: 0 }); continue }

    if (dryRun) { summary.push({ community: c.id, wouldDigest: actionable.length }); continue }

    // Idempotency: one compliance digest per community per window.
    const { data: recent } = await admin
      .from('ev_notices')
      .select('id')
      .eq('community_id', c.id)
      .eq('kind', 'compliance_alert')
      .gte('sent_at', sinceISO)
      .limit(1)
    if (recent?.length) { summary.push({ community: c.id, skipped: 'recent' }); continue }

    // Board + admins only — compliance is board-facing.
    const { data: board } = await admin
      .from('profiles')
      .select('id')
      .eq('community_id', c.id)
      .in('role', ['board_member', 'admin'])
    if (!board?.length) { summary.push({ community: c.id, skipped: 'no-board' }); continue }

    const overdue = actionable.filter(s => s.severity === 'overdue').length
    const soon = actionable.length - overdue
    const parts = [overdue ? `${overdue} overdue` : '', soon ? `${soon} due soon` : ''].filter(Boolean).join(', ')

    const { data: notice, error: nErr } = await admin
      .from('ev_notices')
      .insert({
        community_id: c.id,
        kind: 'compliance_alert',
        channels: [],
        subject: `Compliance: ${parts}`,
        body: `Your association has ${parts} statutory item(s) needing attention. Open the Compliance dashboard to review.`,
        sent_by: null,
      })
      .select('id')
      .single()
    if (nErr || !notice) { summary.push({ community: c.id, error: nErr?.message }); continue }

    const rows = board.map(b => ({
      notice_id: notice.id,
      community_id: c.id,
      profile_id: b.id,
      channel: 'in_app',
    }))
    const { error: rErr } = await admin.from('ev_notice_recipients').insert(rows)
    if (rErr) { summary.push({ community: c.id, error: rErr.message }); continue }

    totalNotified += rows.length
    summary.push({ community: c.id, actionable: actionable.length, notified: rows.length })
  }

  return NextResponse.json({ ok: true, dryRun, totalNotified, communities: summary })
}
