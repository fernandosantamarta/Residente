'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { usePathname } from 'next/navigation'
import { supabase, hasSupabase, getProfile, signOut, type Profile } from '@/lib/supabase'
import { applyAppIcon, getAppIcon } from '@/lib/appIcon'
import { isNativeApp } from '@/lib/nativePush'
import { CheckoutProvider } from '@/components/CheckoutProvider'

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  setProfile: (p: Profile | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  return ctx ?? { session: null, profile: null, setProfile: () => {} }
}

const withTimeout = <T,>(promise: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// Wraps the app. Boots the Supabase session on mount, listens for auth
// state changes, exposes session+profile via context. Shows loading and
// error fall-backs so individual pages never see "what if session is
// undefined?" — by the time children render, the bootstrap is settled.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)

  // Tag <html> when running inside the native iOS shell so native-only CSS can
  // scope to it (e.g. the cockpit inner-scroll fix that keeps the fixed bottom
  // tab bar from drifting during scroll in the WKWebView).
  useEffect(() => {
    isNativeApp().then((native) => {
      if (native) document.documentElement.classList.add('is-native-app')
    })
  }, [])

  useEffect(() => {
    if (!hasSupabase || !supabase) { setLoading(false); return }
    let cancelled = false

    const loadProfile = async (user: User) => {
      try {
        const { data } = await withTimeout(getProfile(user.id))
        if (cancelled) return
        if (data) setProfile({ ...data, email: user.email ?? data.email })
      } catch (err) {
        if (!cancelled) setBootError((err as Error)?.message || "Couldn't load your profile")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    // Point the iOS home-screen icon at the resident's saved choice on every load
    // so a later "Add to Home Screen" (from any page) uses it.
    applyAppIcon(getAppIcon())

    const bootstrap = async () => {
      try {
        const { data: { session } } = await withTimeout(supabase!.auth.getSession())
        if (cancelled) return
        setSession(session)
        if (session?.user) await loadProfile(session.user)
        else setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setBootError((err as Error)?.message || "Can't reach the server")
          setLoading(false)
        }
      }
    }
    bootstrap()

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      if (session?.user) loadProfile(session.user)
      else { setProfile(null); setLoading(false) }
    })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  if (bootError) return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="boot-brand">Residente</div>
        <div className="boot-err">Can&apos;t reach the server</div>
        <div className="boot-msg">{bootError}. Check your connection or try again.</div>
        <button className="boot-btn" onClick={() => window.location.reload()}>Retry</button>
      </div>
    </div>
  )

  if (loading) return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="boot-brand">Residente</div>
        <div className="boot-msg">Loading your community...</div>
      </div>
    </div>
  )

  return (
    <AuthContext.Provider value={{ session, profile, setProfile }}>
      <RecoveryGuard />
      <CheckoutProvider>
        {children}
      </CheckoutProvider>
    </AuthContext.Provider>
  )
}

// Signs the user out if they leave the password-reset page without finishing.
// Clicking the emailed recovery link establishes a real session immediately
// (supabase-js detectSessionInUrl), so abandoning the reset — back button,
// "Back to home", typing another URL — would otherwise leave them logged in.
// The reset page sets the 'pw_recovery' flag while its recovery session is live
// and clears it on a successful change.
function RecoveryGuard() {
  const pathname = usePathname()
  useEffect(() => {
    if (typeof window === 'undefined') return
    let recovering = false
    try { recovering = sessionStorage.getItem('pw_recovery') === '1' } catch { /* ignore */ }
    if (recovering && pathname !== '/reset-password') {
      try { sessionStorage.removeItem('pw_recovery') } catch { /* ignore */ }
      signOut()
    }
  }, [pathname])
  return null
}
