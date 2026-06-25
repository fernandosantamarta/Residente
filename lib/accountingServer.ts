// Server-side accounting entitlement check — the privileged twin of the client
// hook useAccountingAccess(). Use this in service-role API routes / cron so the
// paid Accounting engine (GL rebuild, bank reconciliation, CPA bundle) can't be
// driven for a community that hasn't bought the add-on, even by a direct call.
//
// Same two OR'd gates as the client: the global rollout flag
// (NEXT_PUBLIC_ACCOUNTING_ENABLED) OR communities.accounting_addon.
//
// FAILS CLOSED: if the column read errors we return false (deny) rather than
// risk running a paid job for free — reconcile is idempotent + non-money-moving,
// so skipping a tick is harmless; a wrong free run is not.

import type { SupabaseClient } from '@supabase/supabase-js'
import { accountingEnabled } from '@/lib/accounting'

export async function communityHasAccounting(
  admin: SupabaseClient,
  communityId: string,
): Promise<boolean> {
  if (accountingEnabled) return true              // launched-to-everyone flag
  if (!communityId) return false
  try {
    const { data, error } = await admin
      .from('communities')
      .select('accounting_addon')
      .eq('id', communityId)
      .single()
    if (error) return false
    return !!(data as { accounting_addon?: boolean } | null)?.accounting_addon
  } catch {
    return false
  }
}
