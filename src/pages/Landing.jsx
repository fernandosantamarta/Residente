import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase, hasSupabase } from '../lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

// Adds `.in-view` to any element tagged data-anim once it scrolls into the
// viewport. One-shot per element — animations don't re-run when scrolling back.
// Safety net: anything still unrevealed after 3s shows anyway, so a visitor
// who doesn't scroll never stares at an invisible page.
function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-anim]')
    if (!('IntersectionObserver' in window) || els.length === 0) {
      els.forEach((el) => el.classList.add('in-view'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    els.forEach((el) => io.observe(el))
    const fallback = setTimeout(() => {
      document.querySelectorAll('[data-anim]:not(.in-view)').forEach((el) => {
        el.classList.add('in-view')
      })
    }, 3000)
    return () => { io.disconnect(); clearTimeout(fallback) }
  }, [])
}

// Watches window scroll and exposes `scrolled` once the user has moved past
// the threshold. Powers the glass-nav morph.
function useScrolled(threshold = 32) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

export default function Landing() {
  useScrollReveal()
  return (
    <div className="landing-screen">
      <LandingNav />
      <Hero />
      <WhatIs />
      <Cards />
      <StatStrip />
      <TrustMarquee />
      <BuiltForBoth />
      <CtaBlock />
      <LandingFoot />
    </div>
  )
}

function LandingNav() {
  const scrolled = useScrolled(32)
  return (
    <header className={`ln-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="ln-nav-inner">
        <a href="#top" className="ln-brand">
          <span className="ln-brand-dot" />
          <span className="ln-brand-word">Residente</span>
        </a>
        <nav className="ln-nav-links">
          <a href="#what">Product</a>
          <a href="#boards">For boards</a>
          <a href="#residents">For residents</a>
          <Link to="/login" className="ln-nav-signin">Sign in</Link>
        </nav>
        <a href="#waitlist" className="ln-cta-pill">Join waitlist</a>
      </div>
    </header>
  )
}

// Scroll-pinned cinematic hero — ONE comprehensive SVG that holds the
// whole story (focal house at the dead center with a terracotta door,
// surrounded by streets, neighbours, trees, and a community pool). As
// the user scrolls through the tall outer rail, the sticky stage stays
// in view and `p` (0..1) drives a single continuous zoom on the SVG.
// At p=0 the camera is at the door (scale ~10, only the focal house's
// porch is in frame). At p=1 the camera is far out (scale 1, the whole
// community in frame). One layer → no cross-fade discontinuity → no
// "the photo at the end doesn't match" problem. Exponential zoom curve
// gives the cinematic decel of a real dolly pull-back.
function Hero() {
  const pinRef = useRef(null)
  const [p, setP] = useState(0)
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mqNarrow = window.matchMedia('(max-width: 720px)')
    const sync = () => setEnabled(!mqReduce.matches && !mqNarrow.matches)
    sync()
    mqReduce.addEventListener?.('change', sync)
    mqNarrow.addEventListener?.('change', sync)
    return () => {
      mqReduce.removeEventListener?.('change', sync)
      mqNarrow.removeEventListener?.('change', sync)
    }
  }, [])

  useEffect(() => {
    if (!enabled) { setP(1); return }
    let raf = 0
    const update = () => {
      raf = 0
      const el = pinRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const span = el.offsetHeight - window.innerHeight
      if (span <= 0) { setP(0); return }
      const scrolled = Math.min(span, Math.max(0, -rect.top))
      setP(scrolled / span)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [enabled])

  // Exponential zoom: 10^(1-p) → 10 at p=0, 1 at p=1, ~3.16 at p=0.5.
  // Each unit of scroll halves the zoom level (constant log-rate dolly),
  // which is what real camera pull-backs feel like.
  //
  // We zoom by animating the SVG's viewBox attribute instead of applying
  // `transform: scale()` to the container, because scaling a 2400x1500
  // SVG by 10x asks the GPU for a 24000x15000 composited layer — Chromium
  // crashes the page above ~8K. viewBox manipulation re-renders the SVG
  // at viewport size every frame, no GPU layer blow-up.
  const zoom = enabled ? Math.pow(10, 1 - p) : 1
  const VBW = 2400, VBH = 1500, CX = 1200, CY = 750
  const vbW = VBW / zoom
  const vbH = VBH / zoom
  const vbX = CX - vbW / 2
  const vbY = CY - vbH / 2
  const viewBox = `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`

  // Two captions: an intimate opener fades out as the closing tagline fades in.
  const openIn  = Math.max(0, Math.min(1, (0.25 - p) / 0.18))
  const closeIn = Math.max(0, Math.min(1, (p - 0.60) / 0.20))

  return (
    <section className="ln-hero" id="top">
      <div className={`ln-hero-pin${enabled ? '' : ' is-static'}`} ref={pinRef}>
        <div className="ln-hero-stage">
          <div className="ln-zoom-scene" aria-hidden="true">
            <CommunitySvg viewBox={viewBox} />
          </div>

          <div className="ln-hero-overlay">
            <div className="ln-hero-inner">
              <div className="ln-hero-eyebrow">Resident portal · Early access</div>
              <h1 className="ln-hero-title">
                {enabled && (
                  <span className="ln-hero-title-open" style={{ opacity: openIn }}>
                    Your home,<br />in the loop.
                  </span>
                )}
                <span
                  className="ln-hero-title-close"
                  style={enabled ? { opacity: closeIn } : undefined}
                >
                  Your community,<br />finally clear.
                </span>
              </h1>
              <p className="ln-hero-sub">
                The resident portal that shows where your dues go, what the
                board is up to, and how to pay. All in one place.
              </p>
              <div className="ln-hero-ctas">
                <a href="#waitlist" className="ln-hero-btn">Get early access</a>
                <a href="#what" className="ln-hero-ghost">
                  See how it works
                  <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </div>

          {enabled && (
            <div className="ln-hero-scroll" aria-hidden="true">
              <span /><span /><span />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// Shared palette. The CommunitySvg is one giant scene that gets zoomed
// from scale ~10 (camera at the focal door) down to scale 1 (the entire
// neighbourhood in frame). The terracotta door sits at the dead center
// of the SVG (1200, 750), so the default transform-origin: 50% 50% on
// the scaled container produces a clean dolly-out from the door.
const SKY_TOP   = '#F0E7D4'
const SKY_BOT   = '#F4EFE8'
const GROUND_T  = '#B7B488'
const GROUND_B  = '#8E8B62'
const ROOF      = '#2A2E45'
const ROOF_LITE = '#3A3E55'
const WALL_LITE = '#F4EFE8'
const WALL_WARM = '#D6C8AE'
const DOOR      = '#C76F45'
const DOOR_DARK = '#A8552F'
const TREE      = '#7D8C5C'
const TRUNK     = '#5C5238'
const STREET    = '#3A3E55'

// Generic neighbourhood house. Used for every house in CommunitySvg
// except the focal one (which is drawn inline with extra detail).
function House({ x, y, w, h, doorColor = DOOR, wallColor = WALL_WARM, winClass = '' }) {
  const cx = x + w / 2
  const doorW = Math.max(18, w * 0.13)
  const doorH = Math.max(36, h * 0.4)
  const winW = Math.max(20, w * 0.18)
  const winH = Math.max(20, h * 0.22)
  const winY = y + h * 0.18
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={wallColor} />
      <path d={`M${x} ${y} L${cx} ${y - h * 0.6} L${x + w} ${y} Z`} fill={ROOF} />
      <rect x={x + w * 0.15} y={winY} width={winW} height={winH} fill="#9FB7C2" className={winClass} />
      <rect x={x + w - w * 0.15 - winW} y={winY} width={winW} height={winH} fill="#9FB7C2" />
      <rect x={cx - doorW / 2} y={y + h - doorH} width={doorW} height={doorH} fill={doorColor} />
    </g>
  )
}

// One comprehensive scene. ViewBox 2400x1500 matches a 1440x900 stage
// exactly (1.6:1), so nothing gets sliced. The focal terracotta door is
// at the dead center (1200, 750) — that's the zoom anchor. Drawn from
// back-to-front so the foreground layers (focal house, foreground trees)
// occlude the rest correctly.
function CommunitySvg({ viewBox = '0 0 2400 1500' }) {
  const DX = 1200  // door anchor X
  const DY = 750   // door anchor Y (also: ground level / horizon-ish)
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid slice" role="img" aria-label="An aerial illustration of a small HOA community">
      <defs>
        <linearGradient id="cm-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="1" stopColor={SKY_BOT} />
        </linearGradient>
        <linearGradient id="cm-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={GROUND_T} />
          <stop offset="1" stopColor={GROUND_B} />
        </linearGradient>
      </defs>

      {/* Sky + ground */}
      <rect width="2400" height={DY + 50} fill="url(#cm-sky)" />
      <rect y={DY + 50} width="2400" height={1500 - DY - 50} fill="url(#cm-ground)" />

      {/* Distant background houses — tiny silhouettes at the horizon,
          only visible when fully zoomed out. */}
      <g opacity="0.55">
        {[120, 260, 400, 540, 680, 820, 1030, 1230, 1430, 1580, 1740, 1900, 2060, 2220].map((x, i) => (
          <g key={`dist-${i}`}>
            <rect x={x} y={DY + 5} width="28" height="22" fill={WALL_WARM} />
            <path d={`M${x} ${DY + 5} L${x + 14} ${DY - 8} L${x + 28} ${DY + 5} Z`} fill={ROOF} />
          </g>
        ))}
      </g>

      {/* Back street (winds along the horizon behind the focal house) */}
      <path
        d={`M-50 ${DY + 95} Q400 ${DY + 80} 1200 ${DY + 85} Q2000 ${DY + 90} 2450 ${DY + 95} L2450 ${DY + 150} Q2000 ${DY + 140} 1200 ${DY + 135} Q400 ${DY + 130} -50 ${DY + 150} Z`}
        fill={STREET}
        opacity="0.85"
      />

      {/* Mid-distance houses — back row of the neighbourhood */}
      <g>
        {[
          { x: 60,   y: DY + 30, w: 130, h: 90,  win: 'ln-win-glow', dc: DOOR },
          { x: 220,  y: DY + 30, w: 140, h: 95,  win: '',            dc: '#8B5A3C' },
          { x: 390,  y: DY + 30, w: 130, h: 88,  win: 'ln-win-dim',  dc: '#8B5A3C' },
          { x: 560,  y: DY + 30, w: 140, h: 92,  win: 'ln-win-glow-a', dc: DOOR },
          { x: 730,  y: DY + 30, w: 130, h: 88,  win: '',            dc: '#8B5A3C' },
          { x: 900,  y: DY + 30, w: 130, h: 90,  win: 'ln-win-glow-b', dc: '#8B5A3C' },
          // big gap in the middle behind the focal house — gives breathing room
          { x: 1430, y: DY + 30, w: 130, h: 90,  win: 'ln-win-glow', dc: '#8B5A3C' },
          { x: 1600, y: DY + 30, w: 140, h: 95,  win: 'ln-win-dim',  dc: DOOR },
          { x: 1770, y: DY + 30, w: 130, h: 88,  win: '',            dc: '#8B5A3C' },
          { x: 1940, y: DY + 30, w: 140, h: 92,  win: 'ln-win-glow-a', dc: '#8B5A3C' },
          { x: 2110, y: DY + 30, w: 130, h: 88,  win: 'ln-win-glow-b', dc: DOOR },
          { x: 2270, y: DY + 30, w: 120, h: 86,  win: '',            dc: '#8B5A3C' },
        ].map((h, i) => (
          <House key={`mid-${i}`} x={h.x} y={h.y} w={h.w} h={h.h} doorColor={h.dc} winClass={h.win} />
        ))}
      </g>

      {/* Horizon trees */}
      {[40, 200, 370, 540, 710, 880, 1040, 1410, 1580, 1750, 1920, 2090, 2250, 2380].map((cx, i) => (
        <g key={`htree-${i}`}>
          <rect x={cx - 3} y={DY + 35} width="6" height="32" fill={TRUNK} />
          <circle cx={cx} cy={DY + 30} r="22" fill={TREE} className={['ln-tree-sway', 'ln-tree-sway-a', 'ln-tree-sway-b'][i % 3]} />
        </g>
      ))}

      {/* Cul-de-sac in front of the focal house */}
      <path
        d="M-50 1280 Q400 1180 1200 1195 Q2000 1210 2450 1280 L2450 1500 L-50 1500 Z"
        fill={STREET}
      />
      <ellipse cx="1200" cy="1180" rx="200" ry="62" fill={STREET} />
      <ellipse cx="1200" cy="1180" rx="120" ry="38" fill={GROUND_T} />
      {/* lane dashes */}
      <path d="M-50 1340 Q400 1240 1200 1255 Q2000 1270 2450 1340" fill="none" stroke="#E6DBC8" strokeOpacity="0.35" strokeWidth="3" strokeDasharray="16 22" />

      {/* Foreground row of houses on either side of the focal */}
      <g>
        {[
          { x: 60,   y: DY + 200, w: 200, h: 150, win: 'ln-win-glow', dc: DOOR },
          { x: 320,  y: DY + 220, w: 210, h: 155, win: '',           dc: '#8B5A3C' },
          { x: 580,  y: DY + 210, w: 220, h: 160, win: 'ln-win-dim', dc: DOOR },
          { x: 840,  y: DY + 230, w: 200, h: 145, win: 'ln-win-glow-a', dc: '#8B5A3C' },
          { x: 1400, y: DY + 230, w: 200, h: 145, win: 'ln-win-glow', dc: '#8B5A3C' },
          { x: 1610, y: DY + 210, w: 220, h: 160, win: '',            dc: DOOR },
          { x: 1870, y: DY + 220, w: 210, h: 155, win: 'ln-win-glow-b', dc: '#8B5A3C' },
          { x: 2140, y: DY + 200, w: 200, h: 150, win: 'ln-win-glow-a', dc: DOOR },
        ].map((h, i) => (
          <House key={`fore-${i}`} x={h.x} y={h.y} w={h.w} h={h.h} doorColor={h.dc} winClass={h.win} />
        ))}
      </g>

      {/* Foreground trees for parallax + life */}
      {[30, 290, 550, 810, 1070, 1370, 1620, 1880, 2150, 2370].map((cx, i) => (
        <g key={`ftree-${i}`}>
          <rect x={cx - 4} y={DY + 270} width="8" height="42" fill={TRUNK} />
          <circle cx={cx} cy={DY + 265} r="32" fill={TREE} className={['ln-tree-sway', 'ln-tree-sway-a', 'ln-tree-sway-b'][i % 3]} />
        </g>
      ))}

      {/* === FOCAL HOUSE — drawn in extra detail because the zoom-in
          frame at scale ~10 sits right on top of it === */}
      {/* yard around focal */}
      <rect x={DX - 320} y={DY - 200} width="640" height="380" fill={GROUND_T} opacity="0.5" />

      {/* house body */}
      <rect x={DX - 200} y={DY - 200} width="400" height="280" fill={WALL_LITE} />
      {/* subtle siding so the wall reads as material at extreme zoom */}
      <g stroke="#1F2233" strokeOpacity="0.06" strokeWidth="1">
        {Array.from({ length: 14 }).map((_, i) => (
          <line key={i} x1={DX - 200} y1={DY - 200 + i * 20} x2={DX + 200} y2={DY - 200 + i * 20} />
        ))}
      </g>
      {/* roof */}
      <path d={`M${DX - 200} ${DY - 200} L${DX} ${DY - 400} L${DX + 200} ${DY - 200} Z`} fill={ROOF_LITE} />
      <path d={`M${DX - 200} ${DY - 200} L${DX} ${DY - 400} L${DX + 200} ${DY - 200} Z`} fill={ROOF} opacity="0.55" />

      {/* big front windows with mullions */}
      <rect x={DX - 170} y={DY - 160} width="80" height="80" fill="#9FB7C2" className="ln-win-glow" />
      <rect x={DX - 170} y={DY - 160} width="80" height="80" fill="none" stroke="#1F2233" strokeOpacity="0.30" strokeWidth="2" />
      <line x1={DX - 130} y1={DY - 160} x2={DX - 130} y2={DY - 80} stroke="#1F2233" strokeOpacity="0.30" strokeWidth="2" />
      <line x1={DX - 170} y1={DY - 120} x2={DX - 90} y2={DY - 120} stroke="#1F2233" strokeOpacity="0.30" strokeWidth="2" />
      <rect x={DX + 90} y={DY - 160} width="80" height="80" fill="#9FB7C2" className="ln-win-glow-a" />
      <rect x={DX + 90} y={DY - 160} width="80" height="80" fill="none" stroke="#1F2233" strokeOpacity="0.30" strokeWidth="2" />
      <line x1={DX + 130} y1={DY - 160} x2={DX + 130} y2={DY - 80} stroke="#1F2233" strokeOpacity="0.30" strokeWidth="2" />
      <line x1={DX + 90} y1={DY - 120} x2={DX + 170} y2={DY - 120} stroke="#1F2233" strokeOpacity="0.30" strokeWidth="2" />

      {/* address plaque */}
      <rect x={DX - 28} y={DY - 195} width="56" height="22" rx="3" fill="#1F2233" />
      <text x={DX} y={DY - 178} textAnchor="middle" fontFamily="Inter, system-ui" fontSize="16" fontWeight="700" fill={WALL_LITE}>12</text>

      {/* porch lights */}
      <rect x={DX - 60} y={DY - 110} width="6" height="22" fill="#1F2233" />
      <circle cx={DX - 57} cy={DY - 115} r="6" fill="#FFE3B8" className="ln-porch-glow" />
      <rect x={DX + 54} y={DY - 110} width="6" height="22" fill="#1F2233" />
      <circle cx={DX + 57} cy={DY - 115} r="6" fill="#FFE3B8" className="ln-porch-glow-a" />

      {/* DOOR — the eye anchor. Frame + door + two panels + knob. */}
      <rect x={DX - 32} y={DY - 80} width="64" height="160" rx="4" fill="#1F2233" />
      <g className="ln-door-anchor">
        <rect x={DX - 28} y={DY - 76} width="56" height="152" rx="3" fill={DOOR} />
        <rect x={DX - 22} y={DY - 70} width="44" height="62" rx="2" fill={DOOR_DARK} opacity="0.45" />
        <rect x={DX - 22} y={DY + 2}  width="44" height="62" rx="2" fill={DOOR_DARK} opacity="0.45" />
      </g>
      <circle cx={DX + 19} cy={DY + 4} r="3.5" fill="#1F2233" />
      <circle cx={DX + 19} cy={DY + 4} r="1.6" fill="#E6C079" />
      {/* welcome mat */}
      <rect x={DX - 44} y={DY + 80} width="88" height="14" rx="2" fill="#1F2233" />
      <text x={DX} y={DY + 91} textAnchor="middle" fontFamily="Inter, system-ui" fontSize="7" fontWeight="600" fill={WALL_LITE} letterSpacing="3">WELCOME</text>

      {/* walkway down to the street */}
      <path d={`M${DX - 50} ${DY + 100} L${DX + 50} ${DY + 100} L${DX + 130} 1180 L${DX - 130} 1180 Z`} fill={WALL_WARM} opacity="0.75" />

      {/* trees flanking the focal house */}
      <rect x={DX - 250} y={DY + 30} width="8" height="70" fill={TRUNK} />
      <circle cx={DX - 246} cy={DY + 20}  r="44" fill={TREE} className="ln-tree-sway" />
      <circle cx={DX - 280} cy={DY + 10}  r="30" fill="#8FA070" opacity="0.85" className="ln-tree-sway-a" />
      <rect x={DX + 242} y={DY + 30} width="8" height="70" fill={TRUNK} />
      <circle cx={DX + 246} cy={DY + 20}  r="40" fill={TREE} className="ln-tree-sway-b" />

      {/* mailbox at the curb */}
      <rect x={DX - 4} y={DY + 220} width="8" height="60" fill="#5C5238" />
      <rect x={DX - 18} y={DY + 208} width="36" height="18" rx="2" fill="#1F2233" />
    </svg>
  )
}

function WhatIs() {
  return (
    <section className="ln-what" id="what" data-anim>
      <div className="ln-what-left">
        <div className="ln-eyebrow">What is Residente?</div>
        <h2 className="ln-what-title">
          The HOA cockpit your community has been quietly hoping for.
        </h2>
        <a href="#waitlist" className="ln-pill-btn">Join the waitlist</a>
      </div>
      <p className="ln-what-body">
        Most small HOAs still run on email chains, paper notices, and a
        QuickBooks file only the treasurer can read. Residente replaces all
        of that with a portal residents actually want to open — transparent
        budgets, board decisions in a feed, and one-tap dues.
      </p>
    </section>
  )
}

function Cards() {
  return (
    <section className="ln-cards" data-anim>
      <div className="ln-card ln-card-accent" data-stagger="1">
        <div className="ln-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a14 14 0 0 1 0 18" />
            <path d="M12 3a14 14 0 0 0 0 18" />
            <path d="M3 12h18" />
          </svg>
        </div>
        <h3>See where every dollar goes</h3>
        <p>
          Live budget rings, category by category. Landscaping, pool,
          reserves — no more guessing what your dues actually paid for.
        </p>
      </div>

      <div className="ln-card ln-card-dark" data-stagger="2">
        <div className="ln-card-shine" aria-hidden="true" />
        <h3>Board decisions in one feed</h3>
        <p>
          Vendor invoices, votes, repairs. Searchable, timestamped, and
          visible to every household — not buried in a treasurer's inbox.
        </p>
      </div>

      <div className="ln-card ln-card-dark" data-stagger="3">
        <div className="ln-card-shine" aria-hidden="true" />
        <h3>Pay dues in 30 seconds</h3>
        <p>
          Card or ACH. Late-fee math handled, receipt to your email, balance
          updates instantly. No more checks in the mail.
        </p>
      </div>
    </section>
  )
}

function StatStrip() {
  return (
    <section className="ln-stats" data-anim>
      <Stat n="20 min" l="To set up a community" />
      <Stat n="30 sec" l="To pay your dues" />
      <Stat n="0" l="Spreadsheets you'll keep" />
      <Stat n="100%" l="Of activity visible to residents" />
    </section>
  )
}
function Stat({ n, l }) {
  return (
    <div className="ln-stat">
      <div className="ln-stat-n">{n}</div>
      <div className="ln-stat-l">{l}</div>
    </div>
  )
}

function TrustMarquee() {
  const names = [
    'Sunset Lakes', 'Pelican Reserve', 'Bayshore Pointe',
    'Miramar Oaks',  'Coral Bend',      'Palm Crossing',
    'Heron Cove',    'Magnolia Park',   'Cypress Bend',
  ]
  return (
    <section className="ln-trust" data-anim>
      <div className="ln-trust-label">
        Designed with the small Florida HOAs that
        <br />make up most of the country.
      </div>
      <div className="ln-marquee">
        <div className="ln-marquee-track">
          {[...names, ...names].map((name, i) => (
            <span key={i} className="ln-marquee-item">{name}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

function BuiltForBoth() {
  return (
    <section className="ln-uses" data-anim>
      <div className="ln-uses-left">
        <div className="ln-eyebrow">Residente in action</div>
        <h2 className="ln-uses-title">Built for<br />both sides.</h2>
        <p className="ln-uses-body">
          The board gets the back-office they actually wanted. Residents get
          the transparency they'd been quietly hoping for. Same product, two
          experiences.
        </p>
      </div>

      <div className="ln-use-card" id="boards" data-stagger="1">
        <div className="ln-use-tag">For boards</div>
        <h3>Run your community in 20 minutes a week.</h3>
        <p>
          Roster with subdivisions, dues collection, decisions log, budget
          editor, document vault. Imports your existing CSV. Replaces the
          spreadsheet, the WhatsApp group, and the manila folder.
        </p>
        <a href="#waitlist" className="ln-use-link">Get on the list <span aria-hidden="true">→</span></a>
      </div>

      <div className="ln-use-card ln-use-card-soft" id="residents" data-stagger="2">
        <div className="ln-use-tag">For residents</div>
        <h3>Finally know what your HOA is doing.</h3>
        <p>
          Your balance, your share of the budget, every board decision since
          you moved in — visible the second you log in. No more chasing the
          treasurer for a PDF.
        </p>
        <a href="#waitlist" className="ln-use-link">Get on the list <span aria-hidden="true">→</span></a>
      </div>
    </section>
  )
}

function CtaBlock() {
  const [email, setEmail] = useState('')
  const [community, setCommunity] = useState('')
  const [state, setState] = useState({ status: 'idle', msg: null })

  const submit = async (e) => {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setState({ status: 'error', msg: "That doesn't look like a valid email." })
      return
    }
    if (!hasSupabase) {
      setState({ status: 'error', msg: 'Supabase is not configured locally.' })
      return
    }
    setState({ status: 'submitting', msg: null })
    try {
      const { error } = await withTimeout(
        supabase.from('waitlist').insert({
          email: trimmed,
          community: community.trim() || null,
          source: 'landing',
        })
      )
      if (error) {
        if (error.code === '23505') {
          setState({ status: 'success', msg: "You're already on the list — we'll be in touch." })
        } else {
          setState({ status: 'error', msg: error.message || 'Something went wrong. Try again?' })
        }
        return
      }
      setState({ status: 'success', msg: "You're on the list. We'll be in touch soon." })
      setEmail('')
      setCommunity('')
    } catch (err) {
      setState({ status: 'error', msg: err?.message || "Couldn't reach the server. Try again?" })
    }
  }

  return (
    <section className="ln-waitlist" id="waitlist" data-anim>
      <div className="ln-waitlist-card">
        <div className="ln-waitlist-glow" aria-hidden="true" />
        <div className="ln-waitlist-inner">
          <div className="ln-waitlist-kicker">Early access</div>
          <h2 className="ln-waitlist-title">
            We're rolling out one community at a time.
          </h2>
          <p className="ln-waitlist-sub">
            Drop your email and where you live. We'll get back to you when
            we're ready for your community. No spam, no upsell.
          </p>
          <form className="ln-waitlist-form" onSubmit={submit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={state.status === 'submitting' || state.status === 'success'}
            />
            <input
              type="text"
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
              placeholder="Community or city (optional)"
              disabled={state.status === 'submitting' || state.status === 'success'}
            />
            <button
              type="submit"
              className="ln-waitlist-btn"
              disabled={state.status === 'submitting' || state.status === 'success'}
            >
              {state.status === 'submitting' ? 'Adding you...' : state.status === 'success' ? 'You’re in ✓' : 'Get early access'}
            </button>
          </form>
          {state.msg && (
            <div className={`ln-waitlist-msg ${state.status}`}>{state.msg}</div>
          )}
        </div>
      </div>
    </section>
  )
}

function LandingFoot() {
  return (
    <footer className="ln-foot">
      <div className="ln-foot-inner">
        <div className="ln-foot-brand">
          <span className="ln-brand-dot" />
          <span>Residente</span>
        </div>
        <div className="ln-foot-meta">
          <span>© {new Date().getFullYear()} Residente</span>
          <Link to="/login" className="ln-foot-link">Already a resident? Sign in</Link>
        </div>
      </div>
    </footer>
  )
}
