// Theme switching — Sketch (default) / Original / Linear Dark / Mercury /
// Concierge. The choice is stored in localStorage and applied as a
// data-theme attribute on <html>. app/layout.tsx renders a pre-paint
// inline script so there's no flash on load.

export type ThemeId = 'sketch'

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'sketch', label: 'Sketch' },
]

const KEY = 'residente-theme'
const DEFAULT: ThemeId = 'sketch'

export function getTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const t = localStorage.getItem(KEY) as ThemeId | null
    return t && THEMES.some(x => x.id === t) ? t : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function setTheme(id: ThemeId) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(KEY, id) } catch { /* private mode — apply anyway */ }
  document.documentElement.setAttribute('data-theme', id)
}
