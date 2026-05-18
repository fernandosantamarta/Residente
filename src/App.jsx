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
import Login from './pages/Login'

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

  return (
    <AuthContext.Provider value={{ session, profile, setProfile }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!session ? <Login /> : <Navigate to="/" replace />} />
          <Route element={requireAuth ? <Navigate to="/login" replace /> : <Layout />}>
            <Route path="/"            element={<Home />} />
            <Route path="/pay"         element={<Pay />} />
            <Route path="/board"       element={<Board />} />
            <Route path="/rules"       element={<Rules />} />
            <Route path="/documents"   element={<Documents />} />
            <Route path="/contact"     element={<Contact />} />
            <Route path="/community"   element={<Community />} />
            <Route path="*"            element={<Navigate to="/" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
