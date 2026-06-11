// Connected-account routing for "link, don't hold" (MONEY_FLOW_PLAN.md).
//
// When a community has linked its OWN Stripe (Connect Standard) and finished
// onboarding (stripe_connect_status = 'active'), charges and refunds are created
// ON that account so the money lands with the HOA and never touches Residente's
// platform balance. Until a community links, everything falls back to the legacy
// single (platform) account.
//
// This mirrors the routing create-checkout has done since the money-flow merge;
// the helpers exist so fines / amenities / refunds / autopay route identically.

// Resolve a community's connected account, or null for the legacy platform flow.
// Pass whatever Supabase client the caller already has: a caller-JWT client (the
// browser edge fns — members can read their own community row) or a service-role
// client (the cron fns). Reads stripe_account_id exactly like create-checkout.
export async function connectedAccountFor(
  supabase: { from: (table: string) => any },
  communityId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('communities')
    .select('stripe_account_id, stripe_connect_status')
    .eq('id', communityId)
    .single()
  return data?.stripe_connect_status === 'active' && data?.stripe_account_id
    ? (data.stripe_account_id as string)
    : null
}

// Build the Stripe request-options argument. Pass the return value straight into
// the final argument of any stripe.*.create / .retrieve call — it sets the
// Stripe-Account header so the call runs ON the connected account. undefined
// (legacy platform) when account is null. Spread it when merging with other
// options, e.g. { idempotencyKey, ...acctOpts(acct) }.
export function acctOpts(account: string | null): { stripeAccount: string } | undefined {
  return account ? { stripeAccount: account } : undefined
}

// Stripe Customers / PaymentMethods are per-account, so a card or bank account a
// resident saved on the platform BEFORE their community linked Connect cannot be
// used on the connected account (and vice-versa). residents.stripe_customer_account
// records which account the saved customer lives on ('' / null = platform); this
// reports whether that still matches the account we're about to charge on. When it
// doesn't, the setup flow creates a fresh Customer and the charge flow skips the
// resident (they must re-save their method on the new account).
export function customerMatchesAccount(
  storedAccount: string | null | undefined,
  account: string | null,
): boolean {
  return (storedAccount ?? '') === (account ?? '')
}
