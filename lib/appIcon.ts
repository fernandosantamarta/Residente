'use client'

import { useCallback, useEffect, useState } from 'react'

// Resident-chosen home-screen icon background (white / black). Device-local
// (localStorage), not synced to the account — it controls which apple-touch-icon
// the page advertises. iOS reads that <link> at "Add to Home Screen" time, so
// changing it here updates the icon used for the NEXT add-to-home. iOS can't
// repaint an icon that's already installed — the user must remove + re-add it.
// (iOS also paints transparency black in dark mode, which is why each variant is
// a fully opaque PNG: apple-touch-icon.png = white, apple-touch-icon-black.png = black.)

export type AppIconChoice = 'white' | 'black'

const KEY = 'residente_app_icon_bg'
const HREF: Record<AppIconChoice, string> = {
  white: '/apple-touch-icon.png',
  black: '/apple-touch-icon-black.png',
}
const CHANGE_EVENT = 'residente-appicon-changed'

export function getAppIcon(): AppIconChoice {
  if (typeof window === 'undefined') return 'white'
  return localStorage.getItem(KEY) === 'black' ? 'black' : 'white'
}

/** Point the apple-touch-icon <link> at the chosen variant (collapse any dupes,
 *  drop a dark-mode `media` variant so the choice wins regardless of dark mode). */
export function applyAppIcon(choice: AppIconChoice) {
  if (typeof document === 'undefined') return
  const href = HREF[choice]
  const links = Array.from(
    document.querySelectorAll('link[rel="apple-touch-icon"]'),
  ) as HTMLLinkElement[]
  if (links.length === 0) {
    const link = document.createElement('link')
    link.rel = 'apple-touch-icon'
    link.href = href
    document.head.appendChild(link)
    return
  }
  links.forEach((l, i) => {
    if (i === 0) { l.removeAttribute('media'); l.href = href }
    else l.remove()
  })
}

export function setAppIcon(choice: AppIconChoice) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, choice)
  applyAppIcon(choice)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** React state synced to the saved choice (stays in sync across components via a
 *  window event, so the settings row summary updates when the dialog changes it). */
export function useAppIcon(): [AppIconChoice, (c: AppIconChoice) => void] {
  const [choice, setChoice] = useState<AppIconChoice>('white')
  useEffect(() => {
    setChoice(getAppIcon())
    const onChange = () => setChoice(getAppIcon())
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CHANGE_EVENT, onChange)
  }, [])
  return [choice, useCallback((c: AppIconChoice) => setAppIcon(c), [])]
}
