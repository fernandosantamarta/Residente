// Day-one setup pass — turns "nothing configured yet" into actionable to-dos
// instead of a silently-green dashboard.
//
// The other compliance builders are REACTIVE: they flag problems with records
// that already exist (a scheduled meeting missing notice, a held meeting with no
// minutes). A brand-new community has no records, so those builders stay quiet
// and every workspace reads "On track" — which can lull a new board into
// thinking they are set up when they have not started.
//
// These signals are the opposite: PROACTIVE setup nudges. They are advisory
// (severity 'info' → "To do"), not statutory obligations, so they never count
// against the statutory Compliant %. They simply guide a new board through the
// essentials and clear themselves the moment the underlying thing exists.

import { signal, type ComplianceSignal } from './rules-core'

export interface SetupInput {
  community: Record<string, any> | null | undefined
  residents: any[]
  budgets: any[]
  documents: any[]
}

const DOMAIN = 'Setup'

/**
 * Emit a "To do" signal for each day-one essential that has not been set up yet.
 * Side-effect free; tolerates partial/empty inputs; never throws. Each signal
 * disappears automatically once its underlying record/setting exists.
 */
export function setupSignals({ community, residents, budgets, documents }: SetupInput): ComplianceSignal[] {
  if (!community) return []
  const out: ComplianceSignal[] = []
  const todo = (id: string, title: string, detail: string, href: string) =>
    out.push(signal({ id: `setup:${id}`, domain: DOMAIN, severity: 'info', title, detail, href }))

  const list = residents || []
  const boardCount = list.filter((r: any) => r?.is_board).length

  if (list.length <= 1) {
    todo('roster', 'Add your residents',
      "Import your owner roster so dues, notices, and voting reach everyone.",
      '/admin/residents')
  }
  if (boardCount === 0) {
    todo('board', 'Add your board members',
      "Set your President, Treasurer, and Secretary so the right people get admin access and appear on official records.",
      '/admin/voice#board')
  }
  if ((budgets || []).length === 0) {
    todo('budget', 'Adopt your annual operating budget',
      "Set this year's categories and amounts so resident Home cards and budget-vs-actual have something to track against.",
      '/admin/budget')
  }
  if (community.plaid_status !== 'active') {
    todo('bank', 'Link your bank account',
      "Connect the association's bank (read-only) so spending tracks against the budget automatically.",
      '/admin/budget')
  }
  if (community.stripe_connect_status !== 'active') {
    todo('stripe', 'Connect Stripe to collect dues',
      "Link the association's own Stripe account so residents can pay dues and fines online.",
      '/admin/financials')
  }
  if ((documents || []).length === 0) {
    todo('documents', 'Upload your governing documents',
      "Add your declaration / CC&Rs, bylaws, budget, and latest minutes so residents can read them and records requests resolve.",
      '/admin/documents')
  }
  return out
}
