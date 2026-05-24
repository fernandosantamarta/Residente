import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase, hasSupabase } from '../lib/supabase'

const withTimeout = (p, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-ev-anim]')
    if (!('IntersectionObserver' in window) || els.length === 0) {
      els.forEach(el => el.classList.add('in-view'))
      return
    }
    const io = new IntersectionObserver(
      entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view')
          io.unobserve(entry.target)
        }
      }),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    els.forEach(el => io.observe(el))
    const fallback = setTimeout(() => {
      document.querySelectorAll('[data-ev-anim]:not(.in-view)').forEach(el => el.classList.add('in-view'))
    }, 3000)
    return () => { io.disconnect(); clearTimeout(fallback) }
  }, [])
}

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

export default function EasyVoice() {
  useScrollReveal()
  return (
    <div className="ev-screen">
      <EVNav />
      <EVHero />
      <EVWhat />
      <EVFeatures />
      <EVStats />
      <EVCompliance />
      <EVBuiltFor />
      <EVCta />
      <EVFoot />
    </div>
  )
}

function EVNav() {
  const scrolled = useScrolled(32)
  return (
    <header className={`ev-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="ev-nav-inner">
        <a href="#top" className="ev-brand">
          <span className="ev-brand-dot" />
          <span>Easy Voice</span>
          <span className="ev-brand-family">by Residente</span>
        </a>
        <nav className="ev-nav-links">
          <a href="#what">Product</a>
          <a href="#boards">For admins</a>
          <a href="#residents">For residents</a>
          <Link to="/login" className="ev-nav-signin">Sign in</Link>
        </nav>
        <a href="#waitlist" className="ev-cta-pill">Request access</a>
      </div>
    </header>
  )
}

// Same zoom-pinned hero pattern as the Landing page.
// p=0 → wide community view with the clubhouse prominent
// p=0.78 → zoomed to the clubhouse entrance door
// p=1 → interior meeting room crossfade
function EVHero() {
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

  const ZOOM_END = 0.78
  const zp = Math.min(1, p / ZOOM_END)
  const zoom = enabled ? Math.pow(12, zp) : 1
  const VBW = 2400, VBH = 1500, CX = 1200, CY = 750
  const vbW = VBW / zoom
  const vbH = VBH / zoom
  const vbX = CX - vbW / 2
  const vbY = CY - vbH / 2
  const viewBox = `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`

  const interiorOpacity = enabled
    ? Math.max(0, Math.min(1, (p - ZOOM_END) / (1 - ZOOM_END)))
    : 0

  const cap1 = Math.max(0, Math.min(1, 1 - p / 0.30))
  const cap2 = Math.max(0, Math.min(1, Math.min((p - 0.30) / 0.15, (0.68 - p) / 0.15)))
  const cap3 = Math.max(0, Math.min(1, (p - 0.72) / 0.18))

  return (
    <section className="ev-hero" id="top">
      <div className={`ev-hero-pin${enabled ? '' : ' is-static'}`} ref={pinRef}>
        <div className="ev-hero-stage">
          <div className="ev-zoom-scene" aria-hidden="true">
            <ClubhouseSvg viewBox={viewBox} />
          </div>
          <div
            className="ev-zoom-interior"
            style={{ opacity: interiorOpacity }}
            aria-hidden="true"
          >
            <MeetingInteriorSvg />
          </div>

          <div className="ev-hero-overlay">
            <div className="ev-hero-inner">
              <div className="ev-hero-eyebrow">Easy Voice · Florida HOA Governance</div>
              <h1 className="ev-hero-title">
                {enabled && (
                  <>
                    <span className="ev-hero-title-stack" style={{ opacity: cap1 }}>
                      Your community's<br />voice, finally heard.
                    </span>
                    <span className="ev-hero-title-stack" style={{ opacity: cap2 }}>
                      Every meeting,<br />on the record.
                    </span>
                  </>
                )}
                <span
                  className="ev-hero-title-stack"
                  style={enabled ? { opacity: cap3 } : undefined}
                >
                  Every vote,<br />counted.
                </span>
              </h1>
              <p className="ev-hero-sub">
                Florida-compliant meetings, secure ballots, and document
                archives — built for HOA communities that take governance
                seriously.
              </p>
              <div className="ev-hero-ctas">
                <a href="#waitlist" className="ev-hero-btn">Request early access</a>
                <a href="#what" className="ev-hero-ghost">
                  See how it works
                  <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </div>

          {enabled && (
            <div className="ev-hero-scroll" aria-hidden="true">
              <span /><span /><span />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ——— Shared palette (mirrors Landing.jsx) ———————————————————————
const SKY_TOP   = '#F0E7D4'
const SKY_BOT   = '#F4EFE8'
const GROUND_T  = '#B7B488'
const GROUND_B  = '#8E8B62'
const ROOF      = '#2A2E45'
const WALL_LITE = '#F4EFE8'
const WALL_WARM = '#D6C8AE'
const DOOR      = '#C76F45'
const DOOR_DARK = '#A8552F'
const TREE      = '#7D8C5C'
const TRUNK     = '#5C5238'
const STREET    = '#3A3E55'
const INK = '#1F2233'
const inkStroke = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: 'round', strokeLinecap: 'round' }
const thinInk   = { stroke: INK, strokeWidth: 1.4, strokeOpacity: 0.6, strokeLinecap: 'round' }

function SketchFilter({ id }) {
  return (
    <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="7" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  )
}

function House({ x, y, w, h, doorColor = DOOR, wallColor = WALL_WARM, winClass = '' }) {
  const cx = x + w / 2
  const doorW = Math.max(18, w * 0.13)
  const doorH = Math.max(36, h * 0.4)
  const winW = Math.max(20, w * 0.18)
  const winH = Math.max(20, h * 0.22)
  const winY = y + h * 0.18
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={wallColor} {...inkStroke} />
      <path d={`M${x - 6} ${y} L${cx} ${y - h * 0.6} L${x + w + 6} ${y} Z`} fill={ROOF} {...inkStroke} />
      <rect x={x + w * 0.15} y={winY} width={winW} height={winH} fill="#9FB7C2" className={winClass} {...thinInk} />
      <rect x={x + w - w * 0.15 - winW} y={winY} width={winW} height={winH} fill="#9FB7C2" {...thinInk} />
      <rect x={cx - doorW / 2} y={y + h - doorH} width={doorW} height={doorH} fill={doorColor} {...thinInk} rx="2" />
    </g>
  )
}

function Person({ x, y, scale = 1, color = INK, hairColor }) {
  const s = scale
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d={`M0 ${10*s} L0 ${36*s} M-${8*s} ${50*s} L0 ${36*s} L${8*s} ${50*s} M-${10*s} ${22*s} L${10*s} ${22*s}`}
            fill="none" stroke={color} strokeWidth={2*s} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="0" cy={3*s} r={7*s} fill={hairColor || '#F4D6B8'} stroke={color} strokeWidth={1.8*s} />
    </g>
  )
}

// Clubhouse exterior — a community center building at the zoom anchor (1200, 750).
// The same neighbourhood houses fill the background. The focal building is wider
// and more civic: classical columns, double doors, a "MEETING" sign, and a flagpole.
function ClubhouseSvg({ viewBox = '0 0 2400 1500' }) {
  const DX = 1200
  const DY = 750
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid slice" role="img" aria-label="A hand-drawn sketch of a community with a clubhouse at the center">
      <defs>
        <linearGradient id="cl-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="1" stopColor={SKY_BOT} />
        </linearGradient>
        <linearGradient id="cl-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={GROUND_T} />
          <stop offset="1" stopColor={GROUND_B} />
        </linearGradient>
        <SketchFilter id="cl-sketch" />
      </defs>
      <g filter="url(#cl-sketch)">

      {/* Sky + ground */}
      <rect width="2400" height={DY + 50} fill="url(#cl-sky)" />
      <rect y={DY + 50} width="2400" height={1500 - DY - 50} fill="url(#cl-ground)" />

      {/* Distant background houses */}
      <g opacity="0.55">
        {[80, 240, 390, 530, 680, 820, 960, 1290, 1450, 1590, 1740, 1890, 2040, 2200].map((x, i) => (
          <g key={`dist-${i}`}>
            <rect x={x} y={DY + 5} width="28" height="22" fill={WALL_WARM} />
            <path d={`M${x} ${DY + 5} L${x + 14} ${DY - 8} L${x + 28} ${DY + 5} Z`} fill={ROOF} />
          </g>
        ))}
      </g>

      {/* Back street */}
      <path
        d={`M-50 ${DY + 95} Q400 ${DY + 80} 1200 ${DY + 85} Q2000 ${DY + 90} 2450 ${DY + 95} L2450 ${DY + 150} Q2000 ${DY + 140} 1200 ${DY + 135} Q400 ${DY + 130} -50 ${DY + 150} Z`}
        fill={STREET} opacity="0.85"
      />

      {/* Mid-distance houses — flanking the clubhouse */}
      <g>
        {[
          { x: 60,   y: DY + 30, w: 130, h: 90,  win: 'ev-win-glow', dc: DOOR },
          { x: 220,  y: DY + 30, w: 140, h: 95,  win: '',            dc: '#8B5A3C' },
          { x: 390,  y: DY + 30, w: 130, h: 88,  win: 'ev-win-dim',  dc: '#8B5A3C' },
          { x: 560,  y: DY + 30, w: 140, h: 92,  win: 'ev-win-glow-a', dc: DOOR },
          { x: 730,  y: DY + 30, w: 130, h: 88,  win: '',            dc: '#8B5A3C' },
          { x: 900,  y: DY + 30, w: 130, h: 90,  win: 'ev-win-glow-b', dc: '#8B5A3C' },
          { x: 1430, y: DY + 30, w: 130, h: 90,  win: 'ev-win-glow', dc: '#8B5A3C' },
          { x: 1600, y: DY + 30, w: 140, h: 95,  win: 'ev-win-dim',  dc: DOOR },
          { x: 1770, y: DY + 30, w: 130, h: 88,  win: '',            dc: '#8B5A3C' },
          { x: 1940, y: DY + 30, w: 140, h: 92,  win: 'ev-win-glow-a', dc: '#8B5A3C' },
          { x: 2110, y: DY + 30, w: 130, h: 88,  win: 'ev-win-glow-b', dc: DOOR },
          { x: 2270, y: DY + 30, w: 120, h: 86,  win: '',            dc: '#8B5A3C' },
        ].map((h, i) => (
          <House key={`mid-${i}`} x={h.x} y={h.y} w={h.w} h={h.h} doorColor={h.dc} winClass={h.win} />
        ))}
      </g>

      {/* Horizon trees */}
      {[40, 200, 360, 520, 690, 860, 1040, 1410, 1580, 1750, 1920, 2090, 2250, 2380].map((cx, i) => (
        <g key={`htree-${i}`}>
          <rect x={cx - 3} y={DY + 35} width="6" height="32" fill={TRUNK} />
          <circle cx={cx} cy={DY + 30} r="22" fill={TREE} className={['ev-tree-sway', 'ev-tree-sway-a', 'ev-tree-sway-b'][i % 3]} />
        </g>
      ))}

      {/* Circular drive in front of the clubhouse */}
      <path d="M-50 1280 Q400 1180 1200 1195 Q2000 1210 2450 1280 L2450 1500 L-50 1500 Z" fill={STREET} />
      <ellipse cx="1200" cy="1175" rx="240" ry="70" fill={STREET} />
      <ellipse cx="1200" cy="1175" rx="150" ry="44" fill={GROUND_T} />
      {/* flagpole island in the center of the drive */}
      <rect x="1196" y="1090" width="8" height="80" fill="#1F2233" />
      <path d={`M1204 1090 L1240 1102 L1204 1114 Z`} fill={DOOR} />
      {/* lane dashes */}
      <path d="M-50 1340 Q400 1240 1200 1255 Q2000 1270 2450 1340" fill="none" stroke="#E6DBC8" strokeOpacity="0.35" strokeWidth="3" strokeDasharray="16 22" />

      {/* Foreground houses on either side */}
      <g>
        {[
          { x: 60,   y: DY + 200, w: 200, h: 150, win: 'ev-win-glow', dc: DOOR },
          { x: 320,  y: DY + 220, w: 210, h: 155, win: '',            dc: '#8B5A3C' },
          { x: 580,  y: DY + 210, w: 220, h: 160, win: 'ev-win-dim',  dc: DOOR },
          { x: 840,  y: DY + 230, w: 200, h: 145, win: 'ev-win-glow-a', dc: '#8B5A3C' },
          { x: 1400, y: DY + 230, w: 200, h: 145, win: 'ev-win-glow', dc: '#8B5A3C' },
          { x: 1610, y: DY + 210, w: 220, h: 160, win: '',            dc: DOOR },
          { x: 1870, y: DY + 220, w: 210, h: 155, win: 'ev-win-glow-b', dc: '#8B5A3C' },
          { x: 2140, y: DY + 200, w: 200, h: 150, win: 'ev-win-glow-a', dc: DOOR },
        ].map((h, i) => (
          <House key={`fore-${i}`} x={h.x} y={h.y} w={h.w} h={h.h} doorColor={h.dc} winClass={h.win} />
        ))}
      </g>

      {/* Foreground trees */}
      {[30, 290, 550, 810, 1360, 1620, 1880, 2150, 2370].map((cx, i) => (
        <g key={`ftree-${i}`}>
          <rect x={cx - 4} y={DY + 270} width="8" height="42" fill={TRUNK} />
          <circle cx={cx} cy={DY + 265} r="32" fill={TREE} className={['ev-tree-sway', 'ev-tree-sway-a', 'ev-tree-sway-b'][i % 3]} />
        </g>
      ))}

      {/* === FOCAL CLUBHOUSE — the zoom anchor ===
          A classical civic building: columns, pediment, double doors,
          bulletin board, parked cars. Wider and more prominent than a house. */}

      {/* grounds */}
      <rect x={DX - 380} y={DY - 260} width="760" height="420" fill={GROUND_T} opacity="0.4" />

      {/* building body */}
      <rect x={DX - 260} y={DY - 280} width="520" height="340" fill={WALL_LITE} {...inkStroke} />

      {/* siding lines */}
      <g stroke={INK} strokeOpacity="0.05" strokeWidth="1">
        {Array.from({ length: 17 }).map((_, i) => (
          <line key={i} x1={DX - 260} y1={DY - 280 + i * 20} x2={DX + 260} y2={DY - 280 + i * 20} />
        ))}
      </g>

      {/* pediment roof */}
      <path d={`M${DX - 280} ${DY - 280} L${DX} ${DY - 450} L${DX + 280} ${DY - 280} Z`} fill={ROOF} {...inkStroke} />
      <path d={`M${DX - 280} ${DY - 280} L${DX} ${DY - 450} L${DX + 280} ${DY - 280} Z`} fill="#3A3E55" opacity="0.4" />
      {/* entablature cornice */}
      <rect x={DX - 280} y={DY - 290} width="560" height="14" fill={ROOF} />
      <rect x={DX - 270} y={DY - 278} width="540" height="10" fill={WALL_WARM} opacity="0.5" />

      {/* four columns */}
      {[-150, -50, 50, 150].map((offset, i) => (
        <g key={`col-${i}`}>
          <rect x={DX + offset - 10} y={DY - 278} width="20" height="218" fill={WALL_LITE} stroke={INK} strokeWidth="1.2" strokeOpacity="0.4" />
          {/* capital */}
          <rect x={DX + offset - 14} y={DY - 282} width="28" height="8" fill={WALL_WARM} stroke={INK} strokeWidth="1" strokeOpacity="0.4" />
          {/* base */}
          <rect x={DX + offset - 14} y={DY - 62} width="28" height="8" fill={WALL_WARM} stroke={INK} strokeWidth="1" strokeOpacity="0.4" />
        </g>
      ))}

      {/* tall windows on each side of the door */}
      <rect x={DX - 240} y={DY - 230} width="60" height="120" fill="#9FB7C2" className="ev-win-glow" rx="4" {...thinInk} />
      <line x1={DX - 210} y1={DY - 230} x2={DX - 210} y2={DY - 110} stroke={INK} strokeOpacity="0.3" strokeWidth="1.5" />
      <line x1={DX - 240} y1={DY - 170} x2={DX - 180} y2={DY - 170} stroke={INK} strokeOpacity="0.3" strokeWidth="1.5" />

      <rect x={DX + 180} y={DY - 230} width="60" height="120" fill="#9FB7C2" className="ev-win-glow-a" rx="4" {...thinInk} />
      <line x1={DX + 210} y1={DY - 230} x2={DX + 210} y2={DY - 110} stroke={INK} strokeOpacity="0.3" strokeWidth="1.5" />
      <line x1={DX + 180} y1={DY - 170} x2={DX + 240} y2={DY - 170} stroke={INK} strokeOpacity="0.3" strokeWidth="1.5" />

      {/* building name plaque above door */}
      <rect x={DX - 90} y={DY - 255} width="180" height="28" rx="3" fill={INK} />
      <text x={DX} y={DY - 235} textAnchor="middle" fontFamily="Inter, system-ui" fontSize="13" fontWeight="700" fill={WALL_LITE} letterSpacing="3">COMMUNITY CENTER</text>

      {/* porch lights */}
      <rect x={DX - 120} y={DY - 120} width="6" height="28" fill={INK} />
      <circle cx={DX - 117} cy={DY - 126} r="7" fill="#FFE3B8" className="ev-porch-glow" />
      <rect x={DX + 114} y={DY - 120} width="6" height="28" fill={INK} />
      <circle cx={DX + 117} cy={DY - 126} r="7" fill="#FFE3B8" className="ev-porch-glow-a" />

      {/* DOUBLE DOOR — the zoom anchor */}
      <rect x={DX - 64} y={DY - 90} width="128" height="150" rx="4" fill={INK} />
      <g className="ev-door-anchor">
        {/* left leaf */}
        <rect x={DX - 60} y={DY - 86} width="56" height="142" rx="3" fill={DOOR} />
        <rect x={DX - 54} y={DY - 80} width="42" height="56" rx="2" fill={DOOR_DARK} opacity="0.45" />
        <rect x={DX - 54} y={DY - 16} width="42" height="56" rx="2" fill={DOOR_DARK} opacity="0.45" />
        <circle cx={DX - 10} cy={DY + 5} r="4" fill={INK} />
        <circle cx={DX - 10} cy={DY + 5} r="2" fill="#E6C079" />
        {/* right leaf */}
        <rect x={DX + 4}  y={DY - 86} width="56" height="142" rx="3" fill={DOOR} />
        <rect x={DX + 10} y={DY - 80} width="42" height="56" rx="2" fill={DOOR_DARK} opacity="0.45" />
        <rect x={DX + 10} y={DY - 16} width="42" height="56" rx="2" fill={DOOR_DARK} opacity="0.45" />
        <circle cx={DX + 10} cy={DY + 5} r="4" fill={INK} />
        <circle cx={DX + 10} cy={DY + 5} r="2" fill="#E6C079" />
      </g>

      {/* bulletin board beside the door */}
      <rect x={DX + 110} y={DY - 50} width="80" height="60" rx="4" fill={WALL_WARM} stroke={INK} strokeWidth="1.4" strokeOpacity="0.5" />
      <rect x={DX + 116} y={DY - 44} width="68" height="10" rx="2" fill={DOOR} opacity="0.7" />
      <rect x={DX + 116} y={DY - 30} width="68" height="5" rx="1" fill={INK} opacity="0.4" />
      <rect x={DX + 116} y={DY - 21} width="52" height="5" rx="1" fill={INK} opacity="0.3" />
      <rect x={DX + 116} y={DY - 12} width="60" height="5" rx="1" fill={INK} opacity="0.3" />
      <text x={DX + 150} y={DY - 36} textAnchor="middle" fontFamily="Inter, system-ui" fontSize="8" fontWeight="700" fill={WALL_LITE} letterSpacing="2">MEETING</text>

      {/* front steps */}
      <rect x={DX - 90} y={DY + 66} width="180" height="12" rx="1" fill={WALL_WARM} stroke={INK} strokeWidth="1.2" strokeOpacity="0.4" />
      <rect x={DX - 100} y={DY + 78} width="200" height="12" rx="1" fill={WALL_WARM} stroke={INK} strokeWidth="1.2" strokeOpacity="0.4" />
      <rect x={DX - 110} y={DY + 90} width="220" height="12" rx="1" fill={WALL_WARM} stroke={INK} strokeWidth="1.2" strokeOpacity="0.4" />

      {/* walkway to the circular drive */}
      <path d={`M${DX - 80} ${DY + 102} L${DX + 80} ${DY + 102} L${DX + 160} 1175 L${DX - 160} 1175 Z`} fill={WALL_WARM} opacity="0.65" />

      {/* flanking trees */}
      <rect x={DX - 320} y={DY + 20} width="8" height="80" fill={TRUNK} />
      <circle cx={DX - 316} cy={DY + 10}  r="50" fill={TREE} className="ev-tree-sway" />
      <circle cx={DX - 355} cy={DY}        r="34" fill="#8FA070" opacity="0.85" className="ev-tree-sway-a" />
      <rect x={DX + 312} y={DY + 20} width="8" height="80" fill={TRUNK} />
      <circle cx={DX + 316} cy={DY + 10}  r="46" fill={TREE} className="ev-tree-sway-b" />

      {/* parked cars near the entrance */}
      <g transform={`translate(${DX - 380}, ${DY + 220})`}>
        <rect x="-50" y="-18" width="100" height="36" rx="6" fill="#3A3E55" stroke={INK} strokeWidth="1.4" />
        <rect x="-40" y="-24" width="80" height="28" rx="8" fill="#4A4E65" stroke={INK} strokeWidth="1.2" />
        <circle cx="-32" cy="18" r="9" fill="#1F2233" stroke={INK} strokeWidth="1" />
        <circle cx="32"  cy="18" r="9" fill="#1F2233" stroke={INK} strokeWidth="1" />
        <rect x="-16" y="-12" width="32" height="18" rx="3" fill="#9FB7C2" opacity="0.7" />
      </g>
      <g transform={`translate(${DX + 380}, ${DY + 230})`}>
        <rect x="-50" y="-18" width="100" height="36" rx="6" fill={WALL_WARM} stroke={INK} strokeWidth="1.4" />
        <rect x="-40" y="-24" width="80" height="28" rx="8" fill="#D6C8AE" stroke={INK} strokeWidth="1.2" />
        <circle cx="-32" cy="18" r="9" fill="#1F2233" stroke={INK} strokeWidth="1" />
        <circle cx="32"  cy="18" r="9" fill="#1F2233" stroke={INK} strokeWidth="1" />
        <rect x="-16" y="-12" width="32" height="18" rx="3" fill="#9FB7C2" opacity="0.7" />
      </g>

      {/* residents walking toward the clubhouse */}
      <Person x={DX - 60} y={DY + 130} scale={1.0} hairColor="#3A2A1A" />
      <Person x={DX + 20} y={DY + 145} scale={1.0} hairColor="#D4A56A" />
      <Person x={DX - 260} y={DY + 250} scale={1.1} hairColor="#7C4D2A" />
      <Person x={DX + 220} y={DY + 260} scale={0.9} hairColor="#E8C285" />
      </g>
    </svg>
  )
}

// Meeting room interior — the reveal at p=1. Same sketch filter and palette.
// Long board table, seated members, residents in chairs, projection screen
// showing vote tallies, some residents holding tablets.
function MeetingInteriorSvg() {
  return (
    <svg viewBox="0 0 2400 1500" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A hand-drawn sketch of a community meeting in progress, with residents voting on tablets">
      <defs>
        <linearGradient id="mt-wall" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#EFE3CF" />
          <stop offset="1" stopColor="#E2D2B5" />
        </linearGradient>
        <linearGradient id="mt-floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#B58A5C" />
          <stop offset="1" stopColor="#8E6A41" />
        </linearGradient>
        <SketchFilter id="mt-sketch" />
      </defs>

      <g filter="url(#mt-sketch)">
        {/* back wall */}
        <rect width="2400" height="1050" fill="url(#mt-wall)" />
        {/* floor */}
        <rect y="1050" width="2400" height="450" fill="url(#mt-floor)" />
        {/* floorboards */}
        <g stroke={INK} strokeOpacity="0.2" strokeWidth="2">
          <line x1="0" y1="1180" x2="2400" y2="1180" />
          <line x1="0" y1="1300" x2="2400" y2="1300" />
          <line x1="0" y1="1420" x2="2400" y2="1420" />
        </g>

        {/* side windows */}
        <rect x="80" y="180" width="380" height="440" fill="#9FB7C2" {...inkStroke} className="ev-win-glow" />
        <line x1="270" y1="180" x2="270" y2="620" {...inkStroke} />
        <line x1="80"  y1="400" x2="460" y2="400" {...inkStroke} />
        <rect x="60"   y="160" width="420" height="38" fill={WALL_WARM} {...inkStroke} />
        <rect x="60"   y="600" width="420" height="38" fill={WALL_WARM} {...inkStroke} />
        {/* tiny houses visible through window */}
        <g opacity="0.45">
          {[140, 220, 300, 380].map((x, i) => (
            <g key={`mw-${i}`}>
              <rect x={x} y="500" width="44" height="36" fill={WALL_WARM} />
              <path d={`M${x} 500 L${x+22} 482 L${x+44} 500 Z`} fill={ROOF} />
            </g>
          ))}
        </g>

        {/* Florida state seal / flag — civic note */}
        <rect x="2240" y="140" width="14" height="360" fill="#5C3A1F" />
        <rect x="2242" y="140" width="140" height="90" rx="2" fill="#0033A0" opacity="0.85" />
        <circle cx="2312" cy="185" r="28" fill="#FFD700" opacity="0.9" />
        <text x="2312" y="191" textAnchor="middle" fontFamily="Georgia, serif" fontSize="20" fontWeight="700" fill="#0033A0">FL</text>

        {/* PROJECTION SCREEN on back wall */}
        <rect x="780" y="60" width="840" height="480" rx="6" fill="#F4F0E8" {...inkStroke} />
        <rect x="800" y="80" width="800" height="440" rx="4" fill="#FAFAF8" />
        {/* screen content: vote tally */}
        <text x="1200" y="124" textAnchor="middle" fontFamily="Inter, system-ui" fontSize="28" fontWeight="700" fill={INK}>Easy Voice</text>
        <text x="1200" y="156" textAnchor="middle" fontFamily="Inter, system-ui" fontSize="18" fontWeight="500" fill={INK} opacity="0.6">Annual Member Meeting · Vote #3</text>
        {/* vote title */}
        <rect x="820" y="168" width="760" height="2" fill={INK} opacity="0.12" />
        <text x="1200" y="208" textAnchor="middle" fontFamily="Inter, system-ui" fontSize="22" fontWeight="600" fill={INK}>Special Assessment — Pool Renovation</text>
        {/* vote bars */}
        <rect x="830" y="236" width="580" height="38" rx="6" fill="#7D8C5C" opacity="0.25" />
        <rect x="830" y="236" width="580" height="38" rx="6" fill="#7D8C5C" />
        <text x="843" y="261" fontFamily="Inter, system-ui" fontSize="16" fontWeight="600" fill="#FFF">YES — 58 units (72%)</text>
        <rect x="830" y="284" width="222" height="38" rx="6" fill={DOOR} opacity="0.25" />
        <rect x="830" y="284" width="222" height="38" rx="6" fill={DOOR} />
        <text x="843" y="309" fontFamily="Inter, system-ui" fontSize="16" fontWeight="600" fill="#FFF">NO — 22 units (28%)</text>
        {/* quorum confirmed badge */}
        <rect x="830" y="334" width="220" height="30" rx="14" fill="#7D8C5C" />
        <text x="940" y="353" textAnchor="middle" fontFamily="Inter, system-ui" fontSize="13" fontWeight="600" fill="#FFF" letterSpacing="1">QUORUM CONFIRMED</text>
        {/* secret ballot label */}
        <rect x="1060" y="334" width="160" height="30" rx="14" fill={INK} opacity="0.12" />
        <text x="1140" y="353" textAnchor="middle" fontFamily="Inter, system-ui" fontSize="13" fontWeight="500" fill={INK} opacity="0.7" letterSpacing="1">SECRET BALLOT</text>
        {/* vote still open */}
        <text x="1200" y="408" textAnchor="middle" fontFamily="Inter, system-ui" fontSize="14" fill={INK} opacity="0.5">18 of 80 units have not yet voted · closes in 4 min</text>
        <rect x="1080" y="420" width="240" height="44" rx="10" fill={DOOR} />
        <text x="1200" y="447" textAnchor="middle" fontFamily="Inter, system-ui" fontSize="15" fontWeight="700" fill="#FFF">CAST YOUR VOTE</text>

        {/* projector beam */}
        <path d="M1200 540 L1060 900 L1340 900 Z" fill="#FFF8EE" opacity="0.12" />
        <rect x="1170" y="900" width="60" height="18" rx="4" fill="#8E6A41" />

        {/* BOARD TABLE — long rectangular table at the front */}
        <rect x="560" y="840" width="1280" height="60" rx="8" fill="#7C4D2A" {...inkStroke} />
        {/* table top reflection */}
        <rect x="580" y="844" width="1240" height="12" rx="4" fill="#9A6538" opacity="0.5" />
        {/* table legs */}
        <rect x="580"  y="900" width="18" height="80" fill="#5C3A1F" />
        <rect x="1802" y="900" width="18" height="80" fill="#5C3A1F" />

        {/* Name placards on table */}
        {[660, 840, 1080, 1320, 1560, 1740].map((x, i) => (
          <g key={`np-${i}`}>
            <rect x={x} y="823" width="80" height="22" rx="2" fill={INK} opacity="0.75" />
            <rect x={x + 4} y="827" width="72" height="14" rx="1" fill="#F4EFE8" opacity="0.15" />
          </g>
        ))}

        {/* Board members seated behind the table */}
        <Person x={680}  y={720} scale={1.3} hairColor="#3A2A1A" />
        <Person x={880}  y={710} scale={1.3} hairColor="#7C4D2A" />
        <Person x={1100} y={720} scale={1.3} hairColor="#D4A56A" />
        <Person x={1300} y={715} scale={1.3} hairColor="#E8C285" />
        <Person x={1520} y={720} scale={1.3} hairColor="#3A2A1A" />
        <Person x={1720} y={710} scale={1.3} hairColor="#C8A080" />

        {/* podium to the side */}
        <rect x="400" y="820" width="90" height="120" rx="4" fill="#7C4D2A" {...inkStroke} />
        <rect x="376" y="800" width="138" height="24" rx="4" fill="#7C4D2A" {...inkStroke} />
        {/* microphone */}
        <rect x="443" y="766" width="6" height="36" fill={INK} />
        <ellipse cx="446" cy="760" rx="9" ry="12" fill={INK} opacity="0.8" />
        <Person x={446} y={680} scale={1.2} hairColor="#C8A080" />

        {/* Resident rows of chairs — facing the board */}
        {/* row 1 */}
        {[300, 480, 660, 840, 1020, 1200, 1380, 1560, 1740, 1920, 2100].map((x, i) => (
          <g key={`r1-${i}`}>
            <rect x={x - 28} y="1040" width="56" height="44" rx="8" fill={DOOR} opacity="0.65" {...thinInk} />
            <rect x={x - 22} y="1000" width="44" height="42" rx="6" fill={DOOR} opacity="0.55" {...thinInk} />
          </g>
        ))}
        {/* row 1 residents */}
        {[300, 480, 660, 840, 1020, 1200, 1560, 1920].map((x, i) => (
          <Person key={`p1-${i}`} x={x} y={900} scale={1.1} hairColor={['#3A2A1A','#D4A56A','#7C4D2A','#E8C285','#3A2A1A','#C8A080','#7C4D2A','#D4A56A'][i]} />
        ))}
        {/* tablet holders in row 1 */}
        {[480, 1200].map((x, i) => (
          <g key={`tab-${i}`}>
            <rect x={x - 26} y={938} width="52" height="34" rx="4" fill={INK} {...thinInk} />
            <rect x={x - 22} y={942} width="44" height="26" rx="2" fill="#F4EFE8" opacity="0.85" />
            <rect x={x - 18} y={955} width="36" height="5" rx="1" fill={DOOR} opacity="0.75" />
            <rect x={x - 18} y={963} width="26" height="5" rx="1" fill={INK} opacity="0.3" />
          </g>
        ))}

        {/* row 2 */}
        {[260, 440, 620, 800, 980, 1160, 1340, 1520, 1700, 1880, 2060, 2240].map((x, i) => (
          <g key={`r2-${i}`}>
            <rect x={x - 28} y="1240" width="56" height="44" rx="8" fill={WALL_WARM} opacity="0.7" {...thinInk} />
            <rect x={x - 22} y="1200" width="44" height="42" rx="6" fill={WALL_WARM} opacity="0.6" {...thinInk} />
          </g>
        ))}
        {/* row 2 residents */}
        {[260, 620, 980, 1340, 1700, 2060].map((x, i) => (
          <Person key={`p2-${i}`} x={x} y={1100} scale={1.0} hairColor={['#7C4D2A','#E8C285','#3A2A1A','#D4A56A','#C8A080','#7C4D2A'][i]} />
        ))}
        {/* one tablet in row 2 */}
        <g>
          <rect x={1316} y={1138} width="52" height="34" rx="4" fill={INK} {...thinInk} />
          <rect x={1320} y={1142} width="44" height="26" rx="2" fill="#F4EFE8" opacity="0.85" />
          <rect x={1324} y={1155} width="36" height="5" rx="1" fill={DOOR} opacity="0.75" />
          <rect x={1324} y={1163} width="26" height="5" rx="1" fill={INK} opacity="0.3" />
        </g>

        {/* potted plant in the corner */}
        <rect x="2300" y="880" width="70" height="90" rx="6" fill={DOOR} {...inkStroke} />
        <path d="M2335 880 Q2300 780 2318 680 Q2345 760 2352 720 Q2368 800 2360 880 Q2335 840 2335 880" fill={TREE} {...inkStroke} />

        {/* water pitcher on board table */}
        <g transform={`translate(1980, 830)`}>
          <rect x="-16" y="-28" width="32" height="36" rx="4" fill="#F4EFE8" opacity="0.85" {...thinInk} />
          <path d="M16 -20 Q28 -12 16 -4" fill="none" {...thinInk} />
          <ellipse cx="0" cy="-28" rx="18" ry="6" fill="#F4EFE8" opacity="0.85" {...thinInk} />
        </g>
      </g>
    </svg>
  )
}

function EVWhat() {
  return (
    <section className="ev-what" id="what" data-ev-anim>
      <div className="ev-what-left">
        <div className="ev-eyebrow">What is Easy Voice?</div>
        <h2 className="ev-what-title">
          The governance layer your HOA has been quietly hoping for.
        </h2>
        <a href="#waitlist" className="ev-pill-btn">Request early access</a>
      </div>
      <p className="ev-what-body">
        Most associations still run on email chains, paper ballots, and a
        secretary's personal calendar. Easy Voice replaces all of that with
        a platform built for Florida statute compliance from day one —
        legally valid notices, encrypted secret ballots, and a document
        archive that lasts as long as the law requires.
      </p>
    </section>
  )
}

function EVFeatures() {
  return (
    <section className="ev-features" data-ev-anim>
      <div className="ev-card ev-card-accent" data-ev-stagger="1">
        <div className="ev-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8"  y1="2" x2="8"  y2="6" />
            <line x1="3"  y1="10" x2="21" y2="10" />
            <path d="M9 16l2 2 4-4" />
          </svg>
        </div>
        <h3>Notices that hold up in court</h3>
        <p>
          Create a meeting and the system enforces required notice periods
          under FL 718 and 720. Soft warnings when you're cutting it close,
          hard blocks where the statute demands them. Delivery logs retained
          automatically.
        </p>
      </div>

      <div className="ev-card ev-card-dark" data-ev-stagger="2">
        <div className="ev-card-shine" aria-hidden="true" />
        <h3>Ballots even your skeptics will trust</h3>
        <p>
          Open votes for resolutions, encrypted secret ballots for elections
          — enforced by the platform, not the honor system. One vote per
          unit. Proxy rules built in. Results published the moment polls
          close.
        </p>
      </div>

      <div className="ev-card ev-card-dark" data-ev-stagger="3">
        <div className="ev-card-shine" aria-hidden="true" />
        <h3>Seven years of history, always searchable</h3>
        <p>
          Agendas, minutes, draft minutes, supporting documents, notice
          records. Uploaded once, available forever to every authenticated
          owner. Florida's 7-year retention requirement handled without
          a manila folder in sight.
        </p>
      </div>
    </section>
  )
}

function EVStats() {
  return (
    <section className="ev-stats" data-ev-anim>
      <Stat n="48h" l="Board meeting notice auto-enforced" />
      <Stat n="14 days" l="Annual meeting notice enforced" />
      <Stat n="100%" l="Secret ballot for elections — always" />
      <Stat n="7 yrs" l="Document retention, built in" />
    </section>
  )
}
function Stat({ n, l }) {
  return (
    <div className="ev-stat">
      <div className="ev-stat-n">{n}</div>
      <div className="ev-stat-l">{l}</div>
    </div>
  )
}

function EVCompliance() {
  const items = [
    'FL 718.112(2)(c) — Board notice periods',
    'FL 718.112(2)(d) — Annual meeting & elections',
    'FL 720.303(2) — HOA meeting requirements',
    'FL 718.128 — Electronic voting consent',
    'FL 720.317 — Electronic voting resolution',
    'FL 718.111(12) — Minutes retention',
    'FL 720.306(4) — Special meeting notice',
    'FL 718.112(2)(d)(3) — Secret ballot elections',
  ]
  return (
    <section className="ev-compliance" data-ev-anim>
      <div className="ev-compliance-label">
        Florida compliance baked in,<br />not bolted on.
      </div>
      <div className="ev-marquee">
        <div className="ev-marquee-track">
          {[...items, ...items].map((item, i) => (
            <span key={i} className="ev-marquee-item">{item}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

function EVBuiltFor() {
  return (
    <section className="ev-uses" data-ev-anim>
      <div className="ev-uses-left">
        <div className="ev-eyebrow">Easy Voice in action</div>
        <h2 className="ev-uses-title">Built for<br />both sides.</h2>
        <p className="ev-uses-body">
          The board gets the compliance tooling they actually needed.
          Residents get the transparency they were always owed. Same
          platform — two experiences that finally make sense together.
        </p>
      </div>

      <div className="ev-use-card" id="boards" data-ev-stagger="1">
        <div className="ev-use-tag">For admins &amp; boards</div>
        <h3>Run a meeting in 20 minutes, start to finish.</h3>
        <p>
          Create the meeting, set the agenda, send compliant notices with
          one click. Track attendance and quorum live. Open votes and watch
          results come in. Publish minutes on approval. Every step logged
          and timestamped.
        </p>
        <a href="#waitlist" className="ev-use-link">Get on the list <span aria-hidden="true">→</span></a>
      </div>

      <div className="ev-use-card ev-use-card-soft" id="residents" data-ev-stagger="2">
        <div className="ev-use-tag">For owners</div>
        <h3>Know exactly what your association is doing.</h3>
        <p>
          Every meeting notice, every vote outcome, every approved minute —
          visible the moment it happens. Vote from your phone the same day
          the ballot opens. Submit a proxy in three taps if you can't make
          it. No more chasing the secretary for a PDF.
        </p>
        <a href="#waitlist" className="ev-use-link">Get on the list <span aria-hidden="true">→</span></a>
      </div>
    </section>
  )
}

function EVCta() {
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
          source: 'easy-voice',
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
    <section className="ev-waitlist" id="waitlist" data-ev-anim>
      <div className="ev-waitlist-card">
        <div className="ev-waitlist-glow" aria-hidden="true" />
        <div className="ev-waitlist-inner">
          <div className="ev-waitlist-kicker">Early access</div>
          <h2 className="ev-waitlist-title">
            Rolling out one association at a time.
          </h2>
          <p className="ev-waitlist-sub">
            Drop your email and your community's name. We'll reach out when
            we're ready to onboard your association. No spam, no upsell.
          </p>
          <form className="ev-waitlist-form" onSubmit={submit}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={state.status === 'submitting' || state.status === 'success'}
            />
            <input
              type="text"
              value={community}
              onChange={e => setCommunity(e.target.value)}
              placeholder="Association or community name (optional)"
              disabled={state.status === 'submitting' || state.status === 'success'}
            />
            <button
              type="submit"
              className="ev-waitlist-btn"
              disabled={state.status === 'submitting' || state.status === 'success'}
            >
              {state.status === 'submitting' ? 'Adding you...' : state.status === 'success' ? "You're in ✓" : 'Request access'}
            </button>
          </form>
          {state.msg && (
            <div className={`ev-waitlist-msg ${state.status}`}>{state.msg}</div>
          )}
        </div>
      </div>
    </section>
  )
}

function EVFoot() {
  return (
    <footer className="ev-foot">
      <div className="ev-foot-inner">
        <div className="ev-foot-brand">
          <span className="ev-brand-dot" />
          <span>Easy Voice</span>
          <span style={{ fontSize: 13, color: 'var(--ev-ink-dim)', marginLeft: 4 }}>by Residente</span>
        </div>
        <div className="ev-foot-meta">
          <span>© {new Date().getFullYear()} Residente</span>
          <Link to="/" className="ev-foot-link">Residente home</Link>
          <Link to="/login" className="ev-foot-link">Sign in</Link>
        </div>
      </div>
    </footer>
  )
}
