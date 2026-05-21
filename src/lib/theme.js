// Theme switching — Original / Linear Dark / Mercury / Concierge.
// The choice is stored in localStorage and applied as a data-theme attribute
// on <html>. index.html sets it pre-paint so there's no flash on load.

export const THEMES = [
  { id: 'original',    label: 'Original' },
  { id: 'linear-dark', label: 'Linear Dark' },
  { id: 'mercury',     label: 'Mercury Light' },
  { id: 'concierge',   label: 'Concierge' },
]

const KEY = 'residente-theme'
const DEFAULT = 'original'

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY)
    return THEMES.some(x => x.id === t) ? t : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function setTheme(id) {
  try { localStorage.setItem(KEY, id) } catch { /* private mode — apply anyway */ }
  document.documentElement.setAttribute('data-theme', id)
}
