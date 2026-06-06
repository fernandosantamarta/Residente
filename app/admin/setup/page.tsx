'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import './setup.css'

// Guided setup wizard — the signup-style, one-decision-per-screen onboarding for
// a board, reachable from the admin Overview ("Start guided setup"). Reads the
// real community + completion counts; the dues step saves directly to Supabase;
// the heavier steps deep-link to their existing admin pages and reflect real
// completion. Ends on the live resident join code.

type Counts = { residents: number; board: number; documents: number; budgets: number }

export default function AdminSetup() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const router = useRouter()

  const [community, setCommunity] = useState<any>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [step, setStep] = useState(0)
  const [dues, setDues] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId || !supabase) return
    const countOf = (table: string, build?: (q: any) => any) => {
      const q = supabase!.from(table).select('id', { count: 'exact', head: true }).eq('community_id', communityId)
      return build ? build(q) : q
    }
    const [c, res, board, docs, bud] = await Promise.all([
      supabase.from('communities').select('*').eq('id', communityId).single(),
      countOf('residents'),
      countOf('residents', (q: any) => q.not('board_position', 'is', null)),
      countOf('documents'),
      countOf('budget_categories'),
    ]) as any[]
    setCommunity(c.data)
    if (c.data?.monthly_dues) setDues(String(c.data.monthly_dues))
    setCounts({ residents: res.count || 0, board: board.count || 0, documents: docs.count || 0, budgets: bud.count || 0 })
  }, [communityId])
  useEffect(() => { load() }, [load])

  const saveDues = async () => {
    if (!supabase || !communityId) return
    const n = Number(dues)
    if (!Number.isFinite(n) || n <= 0) return
    setSaving(true)
    await supabase.from('communities').update({ monthly_dues: n }).eq('id', communityId)
    setSaving(false)
    await load()
    next()
  }

  const copyCode = async () => {
    if (!community?.join_code) return
    try { await navigator.clipboard.writeText(community.join_code); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch {}
  }

  // Step definitions. `done` reflects real data; deep-link steps carry an href.
  const duesNum = Number(community?.monthly_dues) || 0
  const steps = [
    { key: 'welcome' },
    { key: 'board', done: (counts?.board || 0) >= 1, href: '/admin/voice',
      ic: 'people', title: 'Add your board members', blurb: 'President, Treasurer, and Secretary. They get admin access too.' },
    { key: 'residents', done: (counts?.residents || 0) > 1, href: '/admin/residents',
      ic: 'person', title: 'Add your residents', blurb: 'Import your owner roster, or add households one at a time.' },
    { key: 'dues', done: duesNum > 0 },
    { key: 'documents', done: (counts?.documents || 0) >= 1, href: '/admin/documents',
      ic: 'doc', title: 'Upload your documents', blurb: 'Bylaws, declaration, budget, insurance, and latest minutes.' },
    { key: 'done' },
  ]
  const total = steps.length
  const pct = Math.round(((step + 1) / total) * 100)
  const cur = steps[step]

  const next = () => setStep(s => Math.min(total - 1, s + 1))
  const back = () => { if (step === 0) router.push('/admin'); else setStep(s => s - 1) }

  const KICK: Record<string, string> = {
    welcome: 'Get set up', board: 'Step 1', residents: 'Step 2', dues: 'Step 3', documents: 'Step 4', done: 'All done',
  }

  return (
    <div className="sw-screen">
      <Sparkles />
      <div className="sw-top">
        <div className="sw-topbar">
          <button className="sw-back" onClick={back} aria-label="Back" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span className="sw-brand"><span className="sw-brand-chip"><img src="/residente-logo.png" alt="" /></span><span className="sw-brand-word">Residente</span></span>
          <span className="sw-spacer" />
        </div>
        <div className="sw-progress"><div className="sw-progress-fill" style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="sw-stage"><div className="sw-inner">
        <div className="sw-kicker">{KICK[cur.key]}</div>

        {cur.key === 'welcome' && (
          <>
            <h1 className="sw-h1">Let&rsquo;s set up {community?.name || 'your community'}.</h1>
            <p className="sw-sub">A few quick steps and your community is live for every neighbor.</p>
            <House />
            <div className="sw-actions"><button className="sw-btn" onClick={next}>Start setup</button></div>
          </>
        )}

        {(cur.key === 'board' || cur.key === 'residents' || cur.key === 'documents') && (
          <>
            <h1 className="sw-h1">{cur.title}</h1>
            <p className="sw-sub">{cur.blurb}</p>
            <House />
            <div className="sw-content">
              <div className="sw-card">
                <span className="sw-card-ic"><StepIcon kind={cur.ic!} /></span>
                <span className="sw-card-tx">
                  <span className="sw-card-ti">{cur.title}</span>
                  <span className="sw-card-de">{cur.blurb}</span>
                </span>
                <span className={`sw-pill ${cur.done ? 'ok' : 'todo'}`}>{cur.done ? 'Done ✓' : 'To do'}</span>
              </div>
              <a className="sw-open" href={cur.href!}>{cur.done ? 'Open & edit →' : 'Open this step →'}</a>
            </div>
            <div className="sw-actions">
              <button className="sw-btn" onClick={next}>Continue</button>
              <button className="sw-skip" onClick={next}>I&rsquo;ll do this later</button>
            </div>
          </>
        )}

        {cur.key === 'dues' && (
          <>
            <h1 className="sw-h1">Set your monthly dues</h1>
            <p className="sw-sub">What each home pays per month. Residents then see their balance.</p>
            <House />
            <div className="sw-content">
              <div className="sw-field">
                <span className="sw-label">Monthly dues per home (USD)</span>
                <input className="sw-input" value={dues} inputMode="numeric" placeholder="e.g. 285"
                  onChange={e => setDues(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
            </div>
            <div className="sw-actions">
              <button className="sw-btn" onClick={saveDues} disabled={saving || !(Number(dues) > 0)}>
                {saving ? 'Saving…' : 'Save & continue'}
              </button>
              <button className="sw-skip" onClick={next}>Skip for now</button>
            </div>
          </>
        )}

        {cur.key === 'done' && (
          <>
            <h1 className="sw-h1">{community?.name || 'Your community'} is ready! 🎉</h1>
            <p className="sw-sub">Share your join code so owners can sign in to their homes.</p>
            <House />
            <div className="sw-content">
              <div className="sw-code-card">
                <div className="sw-code-lbl">Resident join code</div>
                <div className="sw-code">{community?.join_code || '—'}</div>
                {community?.join_code && <button className="sw-copy" onClick={copyCode}>{copied ? 'Copied ✓' : 'Copy code'}</button>}
              </div>
            </div>
            <div className="sw-actions"><button className="sw-btn" onClick={() => router.push('/admin')}>Go to dashboard</button></div>
          </>
        )}
      </div></div>
    </div>
  )
}

function StepIcon({ kind }: { kind: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'people') return (<svg {...common}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 5.5a3.2 3.2 0 0 1 0 6M17.5 14c2.5.4 4 2 4 5" /></svg>)
  if (kind === 'doc') return (<svg {...common}><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /></svg>)
  return (<svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>)
}

function House() {
  return (
    <div className="sw-house" aria-hidden="true">
      <svg viewBox="0 0 240 206" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="124" cy="190" rx="78" ry="10" fill="rgba(90,28,0,0.18)" />
        <ellipse cx="58" cy="180" rx="26" ry="18" fill="#4E9E33" /><ellipse cx="188" cy="182" rx="30" ry="19" fill="#4E9E33" /><ellipse cx="150" cy="188" rx="22" ry="14" fill="#5BB23E" />
        <rect x="76" y="98" width="104" height="84" rx="14" fill="#FFF4E4" />
        <path d="M66 106 L128 52 L190 106 a7 7 0 0 1 -5 3 H71 a7 7 0 0 1 -5 -3 Z" fill="#E5732A" />
        <path d="M128 52 L190 106 a7 7 0 0 1 -5 3 H128 Z" fill="#CF541A" opacity="0.5" />
        <rect x="160" y="62" width="14" height="26" rx="3" fill="#CF541A" />
        <rect x="112" y="110" width="30" height="20" rx="6" fill="#F4A23E" /><rect x="112" y="110" width="30" height="20" rx="6" fill="none" stroke="#E5732A" strokeWidth="2.5" />
        <ellipse cx="108" cy="143" rx="4.6" ry="6.4" fill="#5A2A14" /><ellipse cx="144" cy="143" rx="4.6" ry="6.4" fill="#5A2A14" />
        <ellipse cx="98" cy="158" rx="8" ry="5" fill="#FFAE9A" /><ellipse cx="154" cy="158" rx="8" ry="5" fill="#FFAE9A" />
        <path d="M114 154 Q126 172 138 154 Z" fill="#8A2E1E" />
      </svg>
    </div>
  )
}

function Sparkles() {
  const stars = [{ t: '12%', l: '13%', s: 18 }, { t: '24%', l: '84%', s: 13 }, { t: '70%', l: '88%', s: 16 }, { t: '80%', l: '18%', s: 12 }]
  return (
    <div className="sw-sparkles" aria-hidden="true">
      {stars.map((s, i) => (
        <span key={i} className="sw-sparkle" style={{ top: s.t, left: s.l, opacity: 0.8 }}>
          <svg width={s.s} height={s.s} viewBox="0 0 24 24" fill="#fff"><path d="M12 0c.8 6.4 4.8 10.4 12 11.2-7.2.8-11.2 4.8-12 12-.8-7.2-4.8-11.2-12-12C7.2 10.4 11.2 6.4 12 0Z" /></svg>
        </span>
      ))}
    </div>
  )
}
