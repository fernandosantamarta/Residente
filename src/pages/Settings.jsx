import { useState } from 'react'
import { useAuth } from '../App'
import { THEMES, getTheme, setTheme } from '../lib/theme'

// A small preview swatch per theme: the card surface + the accent chip.
const SWATCH = {
  'sketch':      { bg: '#FFFFFF', accent: '#C76F45', desc: 'Hand-drawn warmth, matches the landing' },
  'linear-dark': { bg: '#17171B', accent: '#7C6CDB', desc: 'Refined charcoal and violet' },
  'original':    { bg: '#16162A', accent: '#FF3B5F', desc: 'The original neon look' },
  'mercury':     { bg: '#FFFFFF', accent: '#1F5C3D', desc: 'Light fintech, forest green' },
  'concierge':   { bg: '#FFFFFF', accent: '#0F6E6A', desc: 'Warm cream, editorial serif' },
}

// Settings — reached by clicking your profile in the sidebar. Holds the
// theme picker; account details are read-only (managed by the board).
export default function Settings() {
  const { profile } = useAuth() || {}
  const [theme, setLocal] = useState(getTheme)

  function pick(id) {
    setLocal(id)
    setTheme(id)
  }

  return (
    <div className="settings-wrap">
      <div className="settings-kicker">Settings</div>
      <h1 className="settings-h1">Preferences</h1>

      <div className="settings-section">
        <div className="settings-section-title">Appearance</div>
        <div className="settings-section-sub">
          Choose how Residente looks. Your pick is saved to this browser.
        </div>
        <div className="theme-grid">
          {THEMES.map(t => {
            const sw = SWATCH[t.id] || { bg: '#FFFFFF', accent: '#999', desc: '' }
            const on = theme === t.id
            return (
              <button
                key={t.id}
                className={`theme-card${on ? ' on' : ''}`}
                onClick={() => pick(t.id)}
                aria-pressed={on}
              >
                <div className="theme-card-swatch" style={{ background: sw.bg }}>
                  <span style={{ background: sw.accent }} />
                </div>
                <div className="theme-card-meta">
                  <div className="theme-card-name">{t.label}</div>
                  <div className="theme-card-desc">{sw.desc}</div>
                </div>
                {on && <div className="theme-card-check">✓</div>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="settings-section" style={{ marginTop: 18 }}>
        <div className="settings-section-title">Account</div>
        <div className="settings-section-sub">Managed by your HOA board.</div>
        <div className="settings-rows">
          <div className="settings-row">
            <span>Name</span><span>{profile?.full_name || '—'}</span>
          </div>
          <div className="settings-row">
            <span>Unit</span>
            <span>{profile?.unit_number ? `Unit ${profile.unit_number}` : '—'}</span>
          </div>
          <div className="settings-row">
            <span>Email</span><span>{profile?.email || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
