// Live current-FY GL revenue for the CPA audit tier (Workstream E).
//
// Reads the security_invoker view gl_trial_balance_fy, so RLS scopes per caller:
// the service-role compliance cron sees all; a board member (financials.view) sees
// their whole community. No caller of this helper is resident-facing — every one is
// a board /admin page or the cron — so the partial view a resident would get under
// RLS (only their OWN attributed lines; never another owner's) is never used for
// the audit tier. Returns null when no ledger exists yet or it can't be read —
// callers then fall back to the budget estimate (estimateAnnualRevenue). Never throws.

import type { SupabaseClient } from '@supabase/supabase-js'
import { currentFiscalYear } from '@/lib/fiscal'
import { glCurrentFyRevenue, type TBRow } from '@/lib/gl/statements'

export async function fetchGlCurrentFyRevenue(
  client: SupabaseClient,
  communityId: string,
  fyStartMonth: number,
  asOf: Date = new Date(),
): Promise<number | null> {
  try {
    const fy = currentFiscalYear(Number(fyStartMonth) || 1, asOf).year
    const { data, error } = await client
      .from('gl_trial_balance_fy')
      .select('type, fiscal_year, debit, credit, balance')
      .eq('community_id', communityId)
      .eq('fiscal_year', fy)
    if (error || !data || data.length === 0) return null
    return glCurrentFyRevenue(data as TBRow[], fy)
  } catch {
    return null
  }
}
