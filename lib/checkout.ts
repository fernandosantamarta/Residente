import { supabase, hasSupabase } from './supabase'

// Invoke any checkout edge function in EMBEDDED mode and return the session's
// client_secret plus (for Stripe Connect flows) the connected account id. Used by
// CheckoutModal so every checkout renders Stripe Embedded Checkout in-app — no
// redirect out to a hosted page. Throws with the edge fn's message on failure.
export async function embeddedCheckout(
  fn: string,
  body: Record<string, unknown> = {},
): Promise<{ clientSecret: string; account?: string | null }> {
  if (!hasSupabase || !supabase) throw new Error('Payments are not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke(fn, {
    body: { ...body, embedded: true },
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) {
    let msg = 'Could not start checkout.'
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  if (!data?.client_secret) throw new Error('Could not start checkout.')
  return { clientSecret: data.client_secret as string, account: (data.account ?? null) as string | null }
}
