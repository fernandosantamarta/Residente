import { NextResponse } from 'next/server'

// Server-side place autocomplete for the signup community search. Two providers,
// auto-selected: if GOOGLE_MAPS_API_KEY is set we use Google Places (New); if
// not, we fall back to OpenStreetMap (Photon) — free, no key, no billing. So the
// search works today on OSM and silently upgrades to Google the day a key is
// added in Vercel. Accepts community/subdivision name, city, state, or address.
//
// Shape returned to the client:
//   { predictions: [{ placeId, primary, secondary, name?, location? }] }
// OSM predictions carry name+location inline (no details round-trip needed);
// Google predictions omit them and the client resolves via /api/places/details.

export const runtime = 'edge'

type Prediction = {
  placeId: string
  primary: string
  secondary: string
  name?: string
  location?: string
}

export async function POST(req: Request) {
  let body: { input?: string; sessionToken?: string; kind?: string } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const input = (body.input || '').trim()
  if (input.length < 3) return NextResponse.json({ predictions: [] })

  // kind 'city' biases to localities/states (for the City & state field);
  // anything else is a general place search (community name / address).
  const kind = body.kind === 'city' ? 'city' : 'place'
  const key = process.env.GOOGLE_MAPS_API_KEY
  try {
    const predictions = key
      ? await googleAutocomplete(input, key, kind, body.sessionToken)
      : await osmAutocomplete(input, kind)
    return NextResponse.json({ predictions })
  } catch (e) {
    console.error('places autocomplete error:', e)
    return NextResponse.json({ predictions: [] })
  }
}

async function googleAutocomplete(input: string, key: string, kind: string, sessionToken?: string): Promise<Prediction[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({
      input, sessionToken, includedRegionCodes: ['us'], languageCode: 'en',
      ...(kind === 'city' ? { includedPrimaryTypes: ['locality', 'administrative_area_level_1'] } : {}),
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    console.error('google autocomplete failed:', data?.error?.message || res.status)
    return []
  }
  return (data.suggestions || [])
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
}

// Photon (https://photon.komoot.io) — OSM-backed, prefix search, no key. We
// US-filter the results client-side here since the public instance has no
// country param, and build a clean name + "City, ST" location from the OSM tags.
async function osmAutocomplete(input: string, kind: string): Promise<Prediction[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(input)}&limit=10&lang=en`
  const res = await fetch(url, { headers: { 'User-Agent': 'Residente/1.0 (residente.io)' } })
  if (!res.ok) { console.error('photon failed:', res.status); return [] }
  const data = await res.json()
  const feats: { properties?: Record<string, string> }[] = data.features || []
  const us = feats.filter((f) => (f.properties?.countrycode || '').toUpperCase() === 'US')
  let chosen = us.length ? us : feats

  // City & state field: keep only localities / states, drop addresses + POIs.
  if (kind === 'city') {
    const CITY_VALUES = ['city', 'town', 'village', 'hamlet', 'municipality', 'state', 'county', 'administrative']
    chosen = chosen.filter((f) => {
      const p = f.properties || {}
      return p.osm_key === 'place' || CITY_VALUES.includes(p.osm_value || '') || CITY_VALUES.includes(p.type || '')
    })
    return chosen.slice(0, 6).map((f, i) => {
      const p = f.properties || {}
      const isState = p.osm_value === 'state' || p.type === 'state'
      const location = isState ? (p.name || '') : [p.name, p.state].filter(Boolean).join(', ')
      const secondary = isState
        ? (p.country || '')
        : [p.state, p.country].filter((x) => x && x !== p.name).join(', ')
      return { placeId: `osm:${p.osm_type || ''}${p.osm_id || i}`, primary: p.name || location, secondary, name: p.name, location }
    }).filter((pr) => pr.primary)
  }

  return chosen.slice(0, 6).map((f, i) => {
    const p = f.properties || {}
    const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ')
    const primary = p.name || streetLine || p.city || p.state || ''
    const location = [p.city, p.state].filter(Boolean).join(', ')
    const secondary = [streetLine && streetLine !== primary ? streetLine : '', p.city, p.state, p.postcode]
      .filter((x) => x && x !== primary).join(', ')
    return {
      placeId: `osm:${p.osm_type || ''}${p.osm_id || i}`,
      primary,
      secondary,
      name: p.name || p.street || p.city || primary,
      location,
    }
  }).filter((pr) => pr.primary)
}
