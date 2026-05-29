// Shared user preferences. Persisted to localStorage so the demo path
// works without Supabase wired up; when the real `profiles` /
// `resident_preferences` tables exist, swap the storage functions
// below for queries and the consumers don't change.
//
// Used by /app/settings — every row + sidebar tile reads/writes here.

import { useEffect, useState } from 'react'

export type EmailPref     = 'all' | 'important' | 'none'
export type SmsPref       = 'all' | 'emergency' | 'none'
export type PushPref      = 'all' | 'important' | 'none'
export type LanguageCode  = 'en' | 'es' | 'pt'
export type TimezoneCode  = 'ET' | 'CT' | 'MT' | 'PT'
export type HomepageRoute = '/app' | '/app/track' | '/app/voice' | '/app/schedule'
export type WeekStart     = 'sun' | 'mon'

export type EmergencyContact = {
  id: string
  name: string
  relation: string
  phone: string
}
export type Vehicle = {
  id: string
  make: string
  model: string
  plate: string
  color: string
}
export type Pet = {
  id: string
  name: string
  species: string
  breed: string
}
export type PaymentMethod = {
  id: string
  brand: string        // "Visa", "Bank of America", etc.
  last4: string
  kind: 'card' | 'bank'
}

export type Preferences = {
  // Profile
  full_name: string
  email: string
  phone: string
  profile_image: string        // base64 data URL, '' = no image (fall back to initial)

  // Communication
  email_pref: EmailPref
  sms_pref: SmsPref
  push_pref: PushPref
  quiet_hours_start: string    // "HH:MM" 24h
  quiet_hours_end: string

  // Language / Region
  language: LanguageCode
  timezone: TimezoneCode

  // Accessibility
  large_text: boolean
  reduced_motion: boolean
  high_contrast: boolean

  // App
  default_homepage: HomepageRoute
  calendar_week_start: WeekStart

  // Lists
  emergency_contacts: EmergencyContact[]
  vehicles: Vehicle[]
  pets: Pet[]
  payment_methods: PaymentMethod[]
}

export const DEFAULT_PREFERENCES: Preferences = {
  full_name: '',
  email: '',
  phone: '',
  profile_image: '',

  email_pref: 'all',
  sms_pref: 'emergency',
  push_pref: 'all',
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',

  language: 'en',
  timezone: 'ET',

  large_text: false,
  reduced_motion: false,
  high_contrast: false,

  default_homepage: '/app',
  calendar_week_start: 'sun',

  emergency_contacts: [
    { id: 'c-demo-1', name: 'Maria Santos',  relation: 'Spouse', phone: '(305) 555-0142' },
    { id: 'c-demo-2', name: 'Dr. Reyes',     relation: 'Doctor', phone: '(305) 555-0188' },
  ],
  vehicles: [
    { id: 'v-demo-1', make: 'Toyota', model: 'RAV4',   plate: 'FL-7G3K2P', color: 'Silver' },
  ],
  pets: [
    { id: 'p-demo-1', name: 'Luna', species: 'Dog', breed: 'Mini Labradoodle' },
  ],
  payment_methods: [
    { id: 'pm-demo-1', brand: 'Visa',              last4: '4242', kind: 'card' },
    { id: 'pm-demo-2', brand: 'Bank of America',   last4: '8821', kind: 'bank' },
  ],
}

const STORAGE_KEY = 'residente-preferences'

export const LANGUAGE_LABEL: Record<LanguageCode, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
}
export const TIMEZONE_LABEL: Record<TimezoneCode, string> = {
  ET: 'Eastern (ET)',
  CT: 'Central (CT)',
  MT: 'Mountain (MT)',
  PT: 'Pacific (PT)',
}
export const EMAIL_PREF_LABEL: Record<EmailPref, string> = {
  all:       'All updates',
  important: 'Important only',
  none:      'None',
}
export const SMS_PREF_LABEL: Record<SmsPref, string> = {
  all:       'All texts',
  emergency: 'Emergency only',
  none:      'None',
}
export const PUSH_PREF_LABEL: Record<PushPref, string> = {
  all:       'All',
  important: 'Important only',
  none:      'None',
}
export const HOMEPAGE_LABEL: Record<HomepageRoute, string> = {
  '/app':          'Home',
  '/app/track':    'Easy Track',
  '/app/voice':    'Easy Voice',
  '/app/schedule': 'Schedule',
}
export const WEEK_START_LABEL: Record<WeekStart, string> = {
  sun: 'Sunday',
  mon: 'Monday',
}

// "HH:MM" 24h → "10:00 PM" friendly. Used in summary tiles.
export function formatTime12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return hhmm || '—'
  let h = parseInt(m[1], 10)
  const mins = m[2]
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${mins} ${suffix}`
}

export function getStoredPrefs(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_PREFERENCES, ...parsed }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function setStoredPrefs(next: Preferences) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('residente-prefs-change'))
}

export function patchPrefs(patch: Partial<Preferences>) {
  setStoredPrefs({ ...getStoredPrefs(), ...patch })
}

// React hook — current preferences + a patch function. Listens for
// changes from sibling tabs and sibling components.
export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES)

  useEffect(() => {
    const refresh = () => setPrefs(getStoredPrefs())
    refresh()
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) refresh() }
    const onLocal = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('residente-prefs-change', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('residente-prefs-change', onLocal)
    }
  }, [])

  return [prefs, patchPrefs]
}

// Helper for unique IDs in list items.
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

// Resize an uploaded image File to a square JPEG data URL. Crops
// center-square, scales to maxSize (default 256), encodes as JPEG at
// the given quality. Keeps localStorage usage in check — a 256×256
// JPEG at 0.85 quality is typically 15–40 KB regardless of the source.
export function fileToProfileImage(
  file: File,
  maxSize = 256,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Pick an image file.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Couldn't read that file."))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("Couldn't decode that image."))
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        const sx = (img.naturalWidth - side) / 2
        const sy = (img.naturalHeight - side) / 2
        const canvas = document.createElement('canvas')
        canvas.width = maxSize
        canvas.height = maxSize
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas unavailable.')); return }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
