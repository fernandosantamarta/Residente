// Platform subscription plan = a function of community size. One product.
// Village, Town, and City step up per home; the smallest tier (≤25 homes) is a
// flat $25/mo "Cottage". Every NEW community gets 3 months free (no card) — the
// trial; after that the plan charges automatically. This mirrors the landing
// Pricing section and is the single source of truth the signup flow, the
// Activate banner, and the checkout edge fn all read.
// (The edge functions are Deno and can't import this file, so the same bands
//  are inlined in create-subscription-checkout + signup-provision — keep in sync.)

export type Plan = 'free' | 'pro' | 'premium' | 'enterprise'

// How many free months every new community gets before billing starts.
export const FREE_TRIAL_MONTHS = 3

export interface PlanBand {
  plan: Plan
  label: string
  perHomeCents: number   // monthly, per home. 0 for the flat Cottage tier.
  flatCents: number      // monthly flat fee (Cottage). 0 for per-home tiers.
  band: string           // human range, for copy
}

export function planForHomes(homes: number | null | undefined): PlanBand {
  const n = Number(homes) || 0
  if (n <= 25)  return { plan: 'free',       label: 'Cottage',    perHomeCents: 0,   flatCents: 2500, band: 'Up to 25 homes' }
  if (n <= 100) return { plan: 'pro',        label: 'Village',    perHomeCents: 200, flatCents: 0,    band: '26–100 homes' }
  if (n <= 500) return { plan: 'premium',    label: 'Town',       perHomeCents: 400, flatCents: 0,    band: '101–500 homes' }
  return              { plan: 'enterprise', label: 'City',       perHomeCents: 600, flatCents: 0,    band: '500+ homes' }
}

// Whole-community monthly total in cents (flat fee, or homes × per-home price).
export function monthlyTotalCents(homes: number | null | undefined): number {
  const n = Number(homes) || 0
  const b = planForHomes(n)
  return b.flatCents > 0 ? b.flatCents : n * b.perHomeCents
}

// "$120/mo" style label for the whole community.
export function monthlyTotalLabel(homes: number | null | undefined): string {
  const cents = monthlyTotalCents(homes)
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toLocaleString('en-US')}/mo`
}

// Every tier is paid now (the smallest is the flat Starter), so any provisioned
// community will need payment once its 3 free months end.
export function planNeedsPayment(plan: string | null | undefined): boolean {
  return plan != null
}
