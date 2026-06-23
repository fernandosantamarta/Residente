import { NextResponse } from 'next/server'

// Exposes the Stripe PUBLISHABLE key (safe to be public) to the browser so the
// embedded Checkout can call loadStripe(). Reuses the existing server-only
// STRIPE_PUBLISHABLE_KEY env var — no NEXT_PUBLIC_ duplicate needed.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' })
}
