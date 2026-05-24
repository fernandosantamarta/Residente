import { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase, hasSupabase, getProfile } from './lib/supabase'
import Layout from './components/Layout'
import Home from './pages/Home'
import Pay from './pages/Pay'
import Board from './pages/Board'
import Rules from './pages/Rules'
import Documents from './pages/Documents'
import Contact from './pages/Contact'
import Community from './pages/Community'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Landing from './pages/Landing'
import AdminLayout from './components/AdminLayout'
import AdminResidents from './pages/admin/Residents'
import AdminCommunity from './pages/admin/CommunitySettings'
import AdminBoard from './pages/admin/Board'
import AdminRules from './pages/admin/Rules'
import AdminDocuments from './pages/admin/Documents'
import './admin.css'
import './landing.css'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const withTimeout = (promise, ms = 10000) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))
  ])

export default function App() {
  const [session, setSession]     = useState(null)
  const [profile, setProfile]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [bootError, setBootError] = useState(null)

  useEffect(() => {
    if (!hasSupabase) {
      setLoading(false)
      return
    }

    let cancelled = false

    const bootstrap = async () => {
      try {
        const { data: { session } } = await withTimeout(supabase.auth.getSession())
        if (cancelled) return
        setSession(session)
        if (session) await loadProfile(session.user)
        else setLoading(false)
      } catch (err) {
        if (cancelled) return
        console.error('Auth bootstrap error:', err)
        setBootError(err?.message || "Can't reach the server")
        setLoading(false)
      }
    }
    bootstrap()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      if (session) loadProfile(session.user)
      else { setProfile(null); setLoading(false) }
    })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  const loadProfile = async (user) => {
    try {
      const { data } = await withTimeout(getProfile(user.id))
      if (data) setProfile({ ...data, email: user.email })
    } catch (err) {
      console.error('Profile load error:', err)
      setBootError(err?.message || "Couldn't load your profile")
    } finally {
      setLoading(false)
    }
  }

  if (bootError) return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="boot-brand">Residente</div>
        <div className="boot-err">Can't reach the server</div>
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

  const requireAuth = hasSupabase && !session
  // Admin is board-only. Local dev without Supabase is allowed through, so the
  // section stays reachable un-gated locally — mirrors the app's env-guarded behavior.
  const isBoard = !hasSupabase || ['board_member', 'admin'].includes(profile?.role)

  return (
    <AuthContext.Provider value={{ session, profile, setProfile }}>
      {/* Global SVG defs — the Sketch theme references #sketch-wobble
          via `filter: url(...)` to add a hand-drawn wobble to card
          borders, icons, and decorative strokes. Lives at the root so
          it's available on every page (Login, Landing, cockpit). */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          <filter id="sketch-wobble" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="sketch-wobble-strong" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={session ? <Navigate to="/app" replace /> : <Landing />} />
          <Route path="/login" element={!session ? <Login /> : <Navigate to="/app" replace />} />
          <Route
            path="/admin"
            element={requireAuth ? <Navigate to="/login" replace /> : isBoard ? <AdminLayout /> : <Navigate to="/app" replace />}
          >
            <Route index element={<Navigate to="/admin/community" replace />} />
            <Route path="residents" element={<AdminResidents />} />
            <Route path="community" element={<AdminCommunity />} />
            <Route path="board" element={<AdminBoard />} />
            <Route path="rules" element={<AdminRules />} />
            <Route path="documents" element={<AdminDocuments />} />
          </Route>
          <Route path="/app" element={requireAuth ? <Navigate to="/login" replace /> : <Layout />}>
            <Route index            element={<Home />} />
            <Route path="pay"       element={<Pay />} />
            <Route path="board"     element={<Board />} />
            <Route path="rules"     element={<Rules />} />
            <Route path="documents" element={<Documents />} />
            <Route path="contact"   element={<Contact />} />
            <Route path="community" element={<Community />} />
            <Route path="settings"  element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
