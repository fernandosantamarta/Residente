import { useEffect, useState } from 'react'

// Live local weather for the community, via Open-Meteo (free, no API key).
// Two hops: geocode the community's "City, ST" location to lat/lon, then pull
// the current temperature + condition. Results are cached per location for the
// browser session so flipping between pages doesn't refetch.

export type Weather = { temp: number; condition: string }

// WMO weather codes → short, human labels. The strings also line up with the
// dashboard's weatherIcon() matcher (sunny / partly / cloud / rain / snow /
// storm / fog) in case we ever surface an icon.
function codeToCondition(code: number): string {
  if (code === 0) return 'Sunny'
  if (code === 1) return 'Mostly sunny'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Cloudy'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  if (code >= 85 && code <= 86) return 'Snow'
  if (code >= 95) return 'Storms'
  return 'Clear'
}

const cache = new Map<string, Weather>()

export function useWeather(location?: string | null): { weather: Weather | null; loading: boolean } {
  const key = (location || '').trim()
  const [weather, setWeather] = useState<Weather | null>(() => cache.get(key) ?? null)
  const [loading, setLoading] = useState(!!key && !cache.has(key))

  useEffect(() => {
    if (!key) { setWeather(null); setLoading(false); return }
    if (cache.has(key)) { setWeather(cache.get(key)!); setLoading(false); return }

    let cancelled = false
    setLoading(true)

    const run = async () => {
      try {
        // "Miramar, FL" → city + optional state for a tighter geocode match.
        const [city, region] = key.split(',').map(s => s.trim())
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
        const geoRes = await fetch(geoUrl)
        const geo = await geoRes.json()
        const place = geo?.results?.[0]
        if (!place) throw new Error('no geocode')

        const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
        const wxRes = await fetch(wxUrl)
        const wx = await wxRes.json()
        const t = wx?.current?.temperature_2m
        const code = wx?.current?.weather_code
        if (typeof t !== 'number') throw new Error('no weather')

        const result: Weather = { temp: Math.round(t), condition: codeToCondition(Number(code)) }
        cache.set(key, result)
        if (!cancelled) setWeather(result)
      } catch {
        // Network/geocode miss — leave weather null so the UI shows a neutral
        // fallback rather than a wrong hardcoded value.
        if (!cancelled) setWeather(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [key])

  return { weather, loading }
}
