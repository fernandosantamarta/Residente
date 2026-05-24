// Returns the requester's IP address so the /onboard consent screen can
// write a server-derived (non-spoofable) value to ev_consents.ip_address.
//
// We trust `x-forwarded-for` because Vercel sets it and strips client-set
// versions on the edge. Locally it falls back to the request's address.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export function GET(req: NextRequest) {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || ''
  return NextResponse.json({ ip })
}
