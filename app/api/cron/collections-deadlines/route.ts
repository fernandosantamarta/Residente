import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { communityDuesConfig } from '@/lib/dues'
import { sortSignals } from '@/lib/compliance/rules-core'
import {
  collectionsSignals, paymentPlanSignals, delinquencySignals, delinquentOwnersWithoutCase,
  type CollectionCaseRow, type PaymentPlanRow,
} from '@/lib/compliance/collections'

// Daily sweep over collection cases: raise a board digest when a statutory
// deadline is overdue / due soon (a waiting period has elapsed, a recorded
// lien's enforcement window is closing, a payment-plan installment is missed).
// Idempotent: skips a community already digested within RECENT_DAYS. Advisory.

export const dynamic = 'force-dynamic'

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

  // A table whose migration hasn't run yet errors — treat as "no rows".
  const safe = async (table: string, communityId: string): Promise<any[]> => {
    const { data, error } = await admin.from(table).select('*').eq('community_id', communityId)
    return error ? [] : (data || [])
  }

  const sinceISO = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const summary: Array<Record<string, unknown>> = []
  let totalNotified = 0

  const today = new Date().toISOString().slice(0, 10)

  for (const c of comms ?? []) {
    let cases = (await safe('ev_collection_cases', c.id)) as CollectionCaseRow[]
    const plans = (await safe('ev_payment_plans', c.id)) as PaymentPlanRow[]

    // Optional auto-open: create PRE-NOTICE cases for delinquents with no open
    // case (never sends a notice / records a lien — just opens the case).
    let opened = 0
    if (c.collections_auto_open) {
      const residents = await safe('residents', c.id)
      const pays = await safe('payments', c.id)
      const map: Record<string, { amount: number }[]> = {}
      for (const p of pays) { (map[p.resident_id] ||= []).push({ amount: Number(p.amount) || 0 }) }
      const candidates = delinquentOwnersWithoutCase({
        residents, paymentsByResident: map, cases,
        monthlyDues: Number(c.monthly_dues) || 0,
        duesConfig: communityDuesConfig(c),
        minBalance: Number(c.collections_min_balance) || 0,
        minDays: Number(c.collections_min_days) || 0,
        dueDay: Number(c.assessment_due_day) || 1,
      })
      if (candidates.length && dryRun) {
        opened = candidates.length
      } else {
        // Insert per-candidate so a single conflict (the partial unique index
        // blocks a duplicate OPEN case per owner — e.g. a concurrent run or a
        // case opened manually mid-sweep) just skips, not aborts the batch.
        for (const cand of candidates) {
          const { data: ins } = await admin.from('ev_collection_cases').insert({
            community_id: c.id,
            resident_id: cand.resident_id,
            profile_id: cand.profile_id,
            unit_label: cand.unit_label,
            stage: 'delinquent',
            opened_at: today,
            principal_balance: cand.balance,
            total_balance: cand.balance,
            notes: `Auto-opened by delinquency scan (~${cand.months_late} mo / ${cand.days_past_due} days past due).`,
            created_by: null,
          }).select('*').single()
          if (ins) { opened++; cases.push(ins as CollectionCaseRow) }
        }
      }
    }

    // Delinquent owners with NO open case — surface them to the board even when
    // auto-open is OFF. (With auto-open ON, those owners were just opened above,
    // so computing from the post-open `cases` list leaves this empty.) Mirrors
    // the admin dashboard, which always includes delinquencySignals.
    const dqResidents = await safe('residents', c.id)
    const dqPays = await safe('payments', c.id)
    const dqMap: Record<string, { amount: number }[]> = {}
    for (const p of dqPays) { (dqMap[p.resident_id] ||= []).push({ amount: Number(p.amount) || 0 }) }
    const dqCandidates = delinquentOwnersWithoutCase({
      residents: dqResidents, paymentsByResident: dqMap, cases,
      monthlyDues: Number(c.monthly_dues) || 0,
      duesConfig: communityDuesConfig(c),
      minBalance: Number(c.collections_min_balance) || 0,
      minDays: Number(c.collections_min_days) || 0,
      dueDay: Number(c.assessment_due_day) || 1,
    })

    const signals = sortSignals([
      ...collectionsSignals(cases, c.association_type),
      ...paymentPlanSignals(plans),
      ...delinquencySignals(dqCandidates),
    ])
    const actionable = signals.filter(s => s.severity === 'overdue' || s.severity === 'soon')
    if (!actionable.length && !opened) { summary.push({ community: c.id, actionable: 0 }); continue }

    if (dryRun) { summary.push({ community: c.id, wouldDigest: actionable.length, wouldOpen: opened }); continue }

    const { data: recent } = await admin
      .from('ev_notices')
      .select('id')
      .eq('community_id', c.id)
      .eq('kind', 'collections_deadline')
      .gte('sent_at', sinceISO)
      .limit(1)
    if (recent?.length) { summary.push({ community: c.id, skipped: 'recent', opened }); continue }

    const { data: board } = await admin
      .from('profiles')
      .select('id')
      .eq('community_id', c.id)
      .in('role', ['board_member', 'admin'])
    if (!board?.length) { summary.push({ community: c.id, skipped: 'no-board', opened }); continue }

    const overdue = actionable.filter(s => s.severity === 'overdue').length
    const soon = actionable.length - overdue
    const parts = [opened ? `${opened} newly opened` : '', overdue ? `${overdue} overdue` : '', soon ? `${soon} actionable` : ''].filter(Boolean).join(', ')

    const { data: notice, error: nErr } = await admin
      .from('ev_notices')
      .insert({
        community_id: c.id,
        kind: 'collections_deadline',
        channels: [],
        subject: `Collections: ${parts} item(s)`,
        body: `Your association has ${parts} collection item(s) needing attention. Open the Collections worklist to review.`,
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
    summary.push({ community: c.id, actionable: actionable.length, opened, notified: rows.length })
  }

  return NextResponse.json({ ok: true, dryRun, totalNotified, communities: summary })
}
