import { NextResponse } from 'next/server'

// Exposes the Stripe PUBLISHABLE key (safe to be public) to the browser so the
// embedded Checkout can call loadStripe(). Reuses the existing server-only
// STRIPE_PUBLISHABLE_KEY env var.
//
// SAFETY: only ever return a well-formed publishable key (pk_test_/pk_live_).
// If the env var is misconfigured (e.g. holds a secret key or a malformed value)
// we return an empty string rather than leak anything that isn't a public key.
export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.STRIPE_PUBLISHABLE_KEY || ''
  const isPublishable = /^pk_(test|live)_[A-Za-z0-9]+$/.test(key)
  return NextResponse.json({ publishableKey: isPublishable ? key : '' })
}
