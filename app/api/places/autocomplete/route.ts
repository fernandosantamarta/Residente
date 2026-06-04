import { NextResponse } from 'next/server'

// Server-side proxy for Google Places Autocomplete (New). Keeps GOOGLE_MAPS_API_KEY
// server-only so it never ships to the browser. Accepts any query — community /
// subdivision name, city, state, or a full street address — US-biased.
//
// If the key isn't configured it returns { disabled: true }, which tells the
// signup form to hide the search box and fall back to plain text inputs instead
// of surfacing an error. So this is safe to ship before the key exists.

export const runtime = 'edge'

export async function POST(req: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return NextResponse.json({ disabled: true, predictions: [] })

  let body: { input?: string; sessionToken?: string } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const input = (body.input || '').trim()
  if (input.length < 3) return NextResponse.json({ predictions: [] })

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify({
        input,
        sessionToken: body.sessionToken,
        includedRegionCodes: ['us'],
        languageCode: 'en',
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('places autocomplete failed:', data?.error?.message || res.status)
      return NextResponse.json({ predictions: [] })
    }
    const predictions = (data.suggestions || [])
      .map((s: { placePrediction?: unknown }) => s.placePrediction)
      .filter(Boolean)
      .map((p: {
        placeId: string
        text?: { text?: string }
        structuredFormat?: { mainText?: { text?: string }, secondaryText?: { text?: string } }
      }) => ({
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text || p.text?.text || '',
        secondary: p.structuredFormat?.secondaryText?.text || '',
      }))
    return NextResponse.json({ predictions })
  } catch (e) {
    console.error('places autocomplete error:', e)
    return NextResponse.json({ predictions: [] })
  }
}
