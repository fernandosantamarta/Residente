'use client'

import { useState } from 'react'
import Link from 'next/link'
import { hasSupabase, signIn, signUp, supabase } from '@/lib/supabase'
import {
  provisionAccount,
  ProvisionError,
  type ProvisionInput,
  type PropertyType,
} from '@/lib/signup'
import './signup.css'

// Duolingo-style self-serve sign-up. Full-orange, one decision per screen, a
// friendly house on every slide, account creation deferred to the end. Two
// branches: board/management create a community (free trial) → /admin;
// residents join an existing community → /onboard (consent).

type Who = 'resident' | 'board' | 'management'
type Step =
  | 'property' | 'role'
  | 'community' | 'connect' | 'details' | 'account'
  | 'working' | 'confirm-email'

const FLOW: Record<Who, Step[]> = {
  resident:   ['property', 'role', 'connect', 'details', 'account'],
  board:      ['property', 'role', 'community', 'details', 'account'],
  management: ['property', 'role', 'community', 'details', 'account'],
}

export default function SignupPage() {
  const [step, setStep] = useState<Step>('property')
  const [who, setWho] = useState<Who | null>(null)
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null)

  const [communityName, setCommunityName] = useState('')
  const [location, setLocation] = useState('')
  const [unitCount, setUnitCount] = useState('')
  const [fullName, setFullName] = useState('')
  const [unitNumber, setUnitNumber] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const seq = who ? FLOW[who] : (['property', 'role'] as Step[])
  const idx = Math.max(0, seq.indexOf(step))
  const progress = step === 'working' ? 100 : ((idx + 1) / seq.length) * 100
  const canBack = step !== 'working'

  const goBack = () => {
    setErr(null)
    if (idx > 0) setStep(seq[idx - 1])
    else window.location.assign('/')
  }

  const startBranch = (w: Who) => {
    setWho(w)
    setErr(null)
    setStep(w === 'resident' ? 'connect' : 'community')
  }

  const finish = async () => {
    if (!hasSupabase || !supabase) {
      setErr('Sign-up is not available in local preview (Supabase not configured).')
      return
    }
    setBusy(true); setErr(null)
    try {
      let session = (await supabase.auth.getSession()).data.session
      if (!session) {
        const { data: su, error: suErr } = await signUp({ email: email.trim(), password })
        if (suErr) {
          if (/already|registered|exists/i.test(suErr.message)) {
            const { data: si, error: siErr } = await signIn({ email: email.trim(), password })
            if (siErr) {
              setErr('That email already has an account. Try signing in instead.')
              setBusy(false); return
            }
            session = si.session
          } else {
            setErr(suErr.message || 'Could not create your account.')
            setBusy(false); return
          }
        } else {
          session = su.session
        }
      }
      if (!session) { setStep('confirm-email'); setBusy(false); return }

      setStep('working')
      const input: ProvisionInput = who === 'resident'
        ? {
            mode: 'join',
            full_name: fullName.trim(),
            join_code: joinCode.trim() || undefined,
            unit_number: unitNumber.trim() || undefined,
          }
        : {
            mode: 'create',
            association_type: propertyType!,
            community_name: communityName.trim(),
            location: location.trim() || undefined,
            unit_count: unitCount.trim() ? Number(unitCount) : undefined,
            role: who === 'management' ? 'admin' : 'board_member',
            full_name: fullName.trim(),
            unit_number: unitNumber.trim() || undefined,
          }
      const res = await provisionAccount(input)
      const dest = res.role === 'resident' ? '/onboard' : '/admin'
      window.location.assign(dest)
    } catch (e) {
      const pe = e as ProvisionError
      if (['bad_code', 'no_match', 'ambiguous'].includes(pe.code || '')) {
        setErr(pe.message)
        setStep('connect')
        setBusy(false)
        return
      }
      setErr(pe.message || 'Something went wrong finishing your setup.')
      setStep('account')
      setBusy(false)
    }
  }

  return (
    <div className="su-screen">
      <Sparkles />
      <div className="su-top">
        <div className="su-topbar">
          {canBack ? (
            <button className="su-back-circle" onClick={goBack} aria-label="Back" type="button">
              <Chevron dir="left" />
            </button>
          ) : <span className="su-topbar-spacer" />}
          <Link href="/" className="su-brand" aria-label="Residente home">
            <span className="su-brand-chip"><img src="/residente-logo.png" alt="" /></span>
            <span className="su-brand-word">Residente</span>
          </Link>
          <span className="su-topbar-spacer" />
        </div>

        <div className="su-progress">
          <div className="su-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="su-stage">
        <div className="su-stage-inner">
        {step === 'property' && (
          <Property
            value={propertyType}
            onPick={(t) => { setPropertyType(t); setErr(null); setStep('role') }}
          />
        )}

        {step === 'role' && <Role onPick={startBranch} />}

        {step === 'community' && (
          <Community
            who={who!} propertyType={propertyType!}
            name={communityName} setName={setCommunityName}
            location={location} setLocation={setLocation}
            unitCount={unitCount} setUnitCount={setUnitCount}
            onNext={() => { setErr(null); setStep('details') }}
          />
        )}

        {step === 'connect' && (
          <Connect
            code={joinCode} setCode={setJoinCode}
            onNext={() => { setErr(null); setStep('details') }}
            err={err}
          />
        )}

        {step === 'details' && (
          <Details
            who={who!}
            fullName={fullName} setFullName={setFullName}
            unitNumber={unitNumber} setUnitNumber={setUnitNumber}
            onNext={() => { setErr(null); setStep('account') }}
          />
        )}

        {step === 'account' && (
          <Account
            email={email} setEmail={setEmail}
            password={password} setPassword={setPassword}
            busy={busy} err={err} onSubmit={finish}
          />
        )}

        {step === 'working' && (
          <>
            <div className="su-kicker">Almost done</div>
            <h1 className="su-h1">Setting things up…</h1>
            <p className="su-sub">Creating your account and getting your home ready.</p>
            <HouseArt />
          </>
        )}

        {step === 'confirm-email' && (
          <>
            <h1 className="su-h1">Check your email</h1>
            <p className="su-sub">
              We sent a confirmation link to <strong>{email}</strong>. Click it to
              activate your account, then come back and sign in to finish.
            </p>
            <HouseArt />
            <div className="su-actions">
              <Link href="/login" className="su-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Go to sign in
              </Link>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

/* ----------------------------- steps ----------------------------- */

function Property({ value, onPick }: {
  value: PropertyType | null
  onPick: (t: PropertyType) => void
}) {
  return (
    <>
      <div className="su-kicker">Get started</div>
      <h1 className="su-h1">Let&apos;s get started!</h1>
      <p className="su-sub">First, what kind of community is it?</p>
      <HouseArt />
      <div className="su-content">
        <div className="su-choices">
          <Tile icon={<IconHouse />} title="Home"
            desc="A house in an HOA community (Florida Ch. 720)."
            selected={value === 'hoa'} onClick={() => onPick('hoa')} />
          <Tile icon={<IconBuilding />} title="Condo"
            desc="A unit in a condo association (Florida Ch. 718)."
            selected={value === 'condo'} onClick={() => onPick('condo')} />
        </div>
        <p className="su-foot">Already have an account? <Link href="/login">Sign in</Link></p>
      </div>
    </>
  )
}

function Role({ onPick }: { onPick: (w: Who) => void }) {
  return (
    <>
      <div className="su-kicker">Get started</div>
      <h1 className="su-h1">And who are you?</h1>
      <p className="su-sub">We&apos;ll set you up with the right tools.</p>
      <HouseArt />
      <div className="su-content">
        <div className="su-choices">
          <Tile icon={<IconPerson />} title="A resident / owner"
            desc="Join your community to see notices, docs, and vote."
            onClick={() => onPick('resident')} />
          <Tile icon={<IconPeople />} title="Resident board or HOA management"
            desc="Set up your community and run it. Free trial."
            onClick={() => onPick('board')} />
          <Tile icon={<IconBuilding />} title="Property management"
            desc="Manage one or many associations. Free trial."
            onClick={() => onPick('management')} />
        </div>
      </div>
    </>
  )
}

function Community({
  who, propertyType, name, setName, location, setLocation,
  unitCount, setUnitCount, onNext,
}: {
  who: Who; propertyType: PropertyType
  name: string; setName: (s: string) => void
  location: string; setLocation: (s: string) => void
  unitCount: string; setUnitCount: (s: string) => void
  onNext: () => void
}) {
  const valid = name.trim().length > 1
  const label = propertyType === 'condo' ? 'condo association' : 'community'
  return (
    <>
      <div className="su-kicker">{who === 'management' ? 'Your first community' : 'Your community'}</div>
      <h1 className="su-h1">Tell us about your {label}.</h1>
      <p className="su-sub">You can change all of this later.</p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); if (valid) onNext() }}>
        <div className="su-form">
          <label className="su-field">
            <span className="su-label">Community name</span>
            <div className="su-input-wrap">
              <input className="su-input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Palm Grove" autoFocus required />
            </div>
          </label>
          <label className="su-field">
            <span className="su-label">City / location (optional)</span>
            <div className="su-input-wrap">
              <input className="su-input" value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Miami, FL" />
            </div>
          </label>
          <label className="su-field">
            <span className="su-label">Number of units (optional)</span>
            <div className="su-input-wrap">
              <input className="su-input" value={unitCount}
                onChange={(e) => setUnitCount(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric" placeholder="e.g. 120" />
            </div>
          </label>
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit" disabled={!valid}>Continue</button>
        </div>
      </form>
    </>
  )
}

function Connect({
  code, setCode, onNext, err,
}: {
  code: string; setCode: (s: string) => void
  onNext: () => void; err: string | null
}) {
  return (
    <>
      <div className="su-kicker">Find your community</div>
      <h1 className="su-h1">Got a join code?</h1>
      <p className="su-sub">
        Your board can share a short code. No code? If they already added your
        email, we&apos;ll find you automatically — just continue.
      </p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); onNext() }}>
        <div className="su-form">
          <label className="su-field">
            <span className="su-label">Join code (optional)</span>
            <div className="su-input-wrap">
              <input className="su-input" value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                placeholder="e.g. PALM24" autoFocus maxLength={12}
                style={{ letterSpacing: '2px', fontWeight: 700 }} />
            </div>
          </label>
          {err && <div className="su-err">{err}</div>}
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit">Continue</button>
        </div>
      </form>
    </>
  )
}

function Details({
  who, fullName, setFullName, unitNumber, setUnitNumber, onNext,
}: {
  who: Who
  fullName: string; setFullName: (s: string) => void
  unitNumber: string; setUnitNumber: (s: string) => void
  onNext: () => void
}) {
  const valid = fullName.trim().length > 1
  const showUnit = who !== 'management'
  return (
    <>
      <div className="su-kicker">About you</div>
      <h1 className="su-h1">What&apos;s your name?</h1>
      <p className="su-sub">This is how neighbors and the board will see you.</p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); if (valid) onNext() }}>
        <div className="su-form">
          <label className="su-field">
            <span className="su-label">Full name</span>
            <div className="su-input-wrap">
              <input className="su-input" value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Jane Doe" autoFocus required autoComplete="name" />
            </div>
          </label>
          {showUnit && (
            <label className="su-field">
              <span className="su-label">Your unit / address (optional)</span>
              <div className="su-input-wrap">
                <input className="su-input" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)}
                  placeholder="e.g. 4B or 1420 Palm St" />
              </div>
            </label>
          )}
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit" disabled={!valid}>Continue</button>
        </div>
      </form>
    </>
  )
}

function Account({
  email, setEmail, password, setPassword, busy, err, onSubmit,
}: {
  email: string; setEmail: (s: string) => void
  password: string; setPassword: (s: string) => void
  busy: boolean; err: string | null
  onSubmit: () => void
}) {
  const [show, setShow] = useState(false)
  const reqs = [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'Includes a number', ok: /[0-9]/.test(password) },
    { label: 'Includes a letter', ok: /[a-zA-Z]/.test(password) },
  ]
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const valid = emailOk && reqs.every(r => r.ok)
  return (
    <>
      <div className="su-kicker">Almost there</div>
      <h1 className="su-h1">Create a password</h1>
      <p className="su-sub">Make it strong and secure.</p>
      <HouseArt />
      <form className="su-content" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) onSubmit() }}>
        <div className="su-form">
          <label className="su-field">
            <span className="su-label">Email</span>
            <div className="su-input-wrap">
              <input className="su-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoFocus required autoComplete="email" />
            </div>
          </label>
          <label className="su-field">
            <span className="su-label">Password</span>
            <div className="su-input-wrap">
              <input className="su-input" type={show ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                required autoComplete="new-password" />
              <button type="button" className="su-eye" onClick={() => setShow(s => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </label>
          <div className="su-reqs">
            {reqs.map(r => (
              <div key={r.label} className={`su-req${r.ok ? ' met' : ''}`}>
                <span className="su-req-dot"><IconCheck /></span>
                {r.label}
              </div>
            ))}
          </div>
          {err && <div className="su-err">{err}</div>}
        </div>
        <div className="su-actions">
          <button className="su-btn" type="submit" disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </div>
      </form>
    </>
  )
}

function Tile({
  icon, title, desc, selected, onClick,
}: {
  icon: React.ReactNode; title: string; desc: string; selected?: boolean; onClick: () => void
}) {
  return (
    <button type="button" className={`su-tile${selected ? ' selected' : ''}`} onClick={onClick}>
      <span className="su-tile-icon">{icon}</span>
      <span className="su-tile-text">
        <span className="su-tile-title">{title}</span>
        <span className="su-tile-desc">{desc}</span>
      </span>
      <span className="su-tile-chev"><Chevron dir="right" /></span>
    </button>
  )
}

/* ----------------------------- art ----------------------------- */

// Friendly smiling-house mascot — shown on every slide. Glossy orange roof,
// cream walls with a happy face, rosy cheeks, a little window, and green
// bushes at the base. No hearts, no bird.
function HouseArt() {
  return (
    <div className="su-house">
      <svg viewBox="0 0 240 206" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="House">
        {/* ground shadow */}
        <ellipse cx="124" cy="190" rx="78" ry="10" fill="rgba(90,28,0,0.18)" />

        {/* bushes */}
        <ellipse cx="58" cy="180" rx="26" ry="18" fill="#4E9E33" />
        <ellipse cx="188" cy="182" rx="30" ry="19" fill="#4E9E33" />
        <ellipse cx="150" cy="188" rx="22" ry="14" fill="#5BB23E" />
        <circle cx="46" cy="171" r="11" fill="#6BC24C" />
        <circle cx="200" cy="172" r="12" fill="#6BC24C" />
        <circle cx="74" cy="174" r="9" fill="#6BC24C" />

        {/* picket fence (left) */}
        <g fill="#FFF7EC" stroke="#E7C9A8" strokeWidth="1.4">
          <path d="M24 152 h7 v32 h-7 z" />
          <path d="M36 147 h7 v37 h-7 z" />
          <path d="M48 152 h7 v32 h-7 z" />
          <rect x="20" y="160" width="40" height="6" rx="2" />
        </g>

        {/* house body */}
        <rect x="76" y="98" width="104" height="84" rx="14" fill="#FFF4E4" />
        <path d="M152 98 h14 a14 14 0 0 1 14 14 v56 a14 14 0 0 1 -14 14 h-14 z" fill="#F1DFC6" opacity="0.55" />

        {/* roof */}
        <path d="M66 106 L128 52 L190 106 a7 7 0 0 1 -5 3 H71 a7 7 0 0 1 -5 -3 Z" fill="#E5732A" />
        <path d="M128 52 L190 106 a7 7 0 0 1 -5 3 H128 Z" fill="#CF541A" opacity="0.5" />
        <path d="M66 106 L128 52 L134 56 L75 108 Z" fill="#FB9A4E" opacity="0.7" />

        {/* chimney */}
        <rect x="160" y="62" width="14" height="26" rx="3" fill="#CF541A" />

        {/* window (forehead) */}
        <rect x="112" y="110" width="30" height="20" rx="6" fill="#F4A23E" />
        <rect x="112" y="110" width="30" height="20" rx="6" fill="none" stroke="#E5732A" strokeWidth="2.5" />

        {/* face */}
        <path d="M102 146 Q108 138 114 146" stroke="#5A2A14" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M138 146 Q144 138 150 146" stroke="#5A2A14" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <ellipse cx="98" cy="158" rx="8" ry="5" fill="#FFAE9A" />
        <ellipse cx="154" cy="158" rx="8" ry="5" fill="#FFAE9A" />
        <path d="M114 154 Q126 172 138 154 Z" fill="#8A2E1E" />
        <path d="M120 160 Q126 168 132 160 Z" fill="#FF7B6B" />
      </svg>
    </div>
  )
}

function Sparkles() {
  const stars = [
    { top: '12%', left: '14%', size: 22, o: 0.9 },
    { top: '22%', left: '82%', size: 16, o: 0.7 },
    { top: '54%', left: '8%', size: 14, o: 0.6 },
    { top: '68%', left: '88%', size: 20, o: 0.8 },
    { top: '40%', left: '90%', size: 12, o: 0.5 },
    { top: '83%', left: '20%', size: 16, o: 0.7 },
  ]
  return (
    <div className="su-sparkles" aria-hidden="true">
      {stars.map((s, i) => (
        <span key={i} className="su-sparkle" style={{ top: s.top, left: s.left, opacity: s.o }}>
          <Star size={s.size} />
        </span>
      ))}
    </div>
  )
}

function Star({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFF">
      <path d="M12 0c.8 6.4 4.8 10.4 12 11.2-7.2.8-11.2 4.8-12 12-.8-7.2-4.8-11.2-12-12C7.2 10.4 11.2 6.4 12 0Z" />
    </svg>
  )
}

/* ----------------------------- icons ----------------------------- */

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  )
}
function IconHouse() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />
    </svg>
  )
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /><path d="M10 21v-3h4v3" />
    </svg>
  )
}
function IconPerson() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  )
}
function IconPeople() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 5.5a3.2 3.2 0 0 1 0 6M17.5 14c2.5.4 4 2 4 5" />
    </svg>
  )
}
function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function IconEyeOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.4 3.2M6.1 6.1A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.3 9.3 0 0 0 4-.9" /><path d="m3 3 18 18" /><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 12 10 17 19 7" />
    </svg>
  )
}
