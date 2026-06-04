import { NextResponse } from 'next/server'

// Resolves a placeId (picked in the signup autocomplete) to a community name +
// "City, ST" location. Same server-only key gate as the autocomplete route.

export const runtime = 'edge'

export async function GET(req: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return NextResponse.json({ disabled: true })

  const { searchParams } = new URL(req.url)
  const placeId = searchParams.get('placeId')
  const sessionToken = searchParams.get('sessionToken') || undefined
  if (!placeId) return NextResponse.json({ error: 'placeId required' }, { status: 400 })

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken)
    const res = await fetch(url.toString(), {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'displayName,addressComponents,formattedAddress',
      },
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('place details failed:', data?.error?.message || res.status)
      return NextResponse.json({ error: 'lookup failed' }, { status: 502 })
    }
    const comps: { types?: string[], longText?: string, shortText?: string }[] =
      data.addressComponents || []
    const pick = (type: string, short = false) => {
      const c = comps.find((x) => (x.types || []).includes(type))
      return c ? ((short ? c.shortText : c.longText) || '') : ''
    }
    const city = pick('locality') || pick('postal_town') || pick('administrative_area_level_2')
    const state = pick('administrative_area_level_1', true)
    const location = [city, state].filter(Boolean).join(', ')
    return NextResponse.json({
      name: data.displayName?.text || '',
      location,
      formattedAddress: data.formattedAddress || '',
    })
  } catch (e) {
    console.error('place details error:', e)
    return NextResponse.json({ error: 'lookup failed' }, { status: 502 })
  }
}
