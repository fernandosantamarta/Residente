'use client'

// Lightweight in-repo i18n for the resident app. Residente is fully
// client-rendered and the resident's language already lives in localStorage
// (usePreferences().language), so we drive translation off that rather than
// pulling in a routing-based library (next-intl with /es/ URLs would fight the
// single-locale-in-localStorage model). One hook, three dictionaries.
//
// English fallback is the whole point: a key missing from the active language
// falls back to English, and a key missing everywhere falls back to itself.
// That means a screen not yet translated renders English — never a blank or a
// raw `nav.home` key. Safe to roll out screen by screen.

import { usePreferences, type LanguageCode } from '../preferences'
import { en } from './en'
import { es } from './es'
import { pt } from './pt'

export type Dict = Record<string, string>

const DICTS: Record<LanguageCode, Dict> = { en, es, pt }

// useT() — returns a t(key, vars?) function bound to the resident's saved
// language. `vars` interpolates {name}-style placeholders. Re-renders when the
// language changes because usePreferences subscribes to the prefs-change event.
export function useT() {
  const [prefs] = usePreferences()
  const lang = (prefs.language || 'en') as LanguageCode
  const dict = DICTS[lang] || en
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = dict[key] ?? en[key] ?? key
    if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]))
    return s
  }
}
