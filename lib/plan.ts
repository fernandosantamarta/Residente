// Platform subscription plan = a function of community size. One product, the
// per-home price steps up by band. ≤25 homes is free forever (no card). This
// mirrors the landing Pricing section and is the single source of truth the
// signup flow, the Activate banner, and the checkout edge fn all read.
// (The edge functions are Deno and can't import this file, so the same bands
//  are inlined in create-subscription-checkout + signup-provision — keep in sync.)

export type Plan = 'free' | 'pro' | 'premium' | 'enterprise'

export interface PlanBand {
  plan: Plan
  label: string
  perHomeCents: number   // monthly, per home. 0 for free.
  band: string           // human range, for copy
}

export function planForHomes(homes: number | null | undefined): PlanBand {
  const n = Number(homes) || 0
  if (n <= 25)  return { plan: 'free',       label: 'Free',       perHomeCents: 0,    band: 'Up to 25 homes' }
  if (n <= 100) return { plan: 'pro',        label: 'Pro',        perHomeCents: 200,  band: '26–100 homes' }
  if (n <= 500) return { plan: 'premium',    label: 'Premium',    perHomeCents: 500,  band: '101–500 homes' }
  return              { plan: 'enterprise', label: 'Enterprise', perHomeCents: 1000, band: '500+ homes' }
}

// Whole-community monthly total in cents (homes × per-home price).
export function monthlyTotalCents(homes: number | null | undefined): number {
  const n = Number(homes) || 0
  return n * planForHomes(n).perHomeCents
}

// "$120/mo" style label for the whole community, or "Free".
export function monthlyTotalLabel(homes: number | null | undefined): string {
  const cents = monthlyTotalCents(homes)
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toLocaleString('en-US')}/mo`
}

export function planNeedsPayment(plan: string | null | undefined): boolean {
  return plan != null && plan !== 'free'
}
