'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useAuth } from './providers'

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
  const { session } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (session) router.replace('/app')
  }, [session, router])
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
      <VsEverything />
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
          <Link href="/login" className="ln-nav-signin">Sign in</Link>
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

  // ZOOM-IN arc. p=0 → wide community (zoom=1). p ramps up to ~12 at
  // p=0.78 (we're inside the door frame, it fills the screen, lights
  // visible past the frame). p=0.78 → 1.0: cross-fade to the interior
  // SVG (we crossed the threshold — now we're inside the house).
  //
  // viewBox animation (not CSS transform) — Chromium crashes on a
  // 24000x15000 GPU layer if you `transform: scale(10)` a 2400x1500 SVG.
  const ZOOM_END = 0.78
  const zp = Math.min(1, p / ZOOM_END)
  const zoom = enabled ? Math.pow(12, zp) : 1
  const VBW = 2400, VBH = 1500, CX = 1200, CY = 750
  const vbW = VBW / zoom
  const vbH = VBH / zoom
  const vbX = CX - vbW / 2
  const vbY = CY - vbH / 2
  const viewBox = `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`

  // Interior crossfade — starts fading in once the door fills the frame.
  const interiorOpacity = enabled
    ? Math.max(0, Math.min(1, (p - ZOOM_END) / (1 - ZOOM_END)))
    : 0

  // Three captions arcing across the journey:
  //   p=0    "Your community, finally clear"   (wide view)
  //   p≈0.5  "Your home, at the heart of it"   (focal house close-up)
  //   p=1    "And you, in the loop."           (interior, you're inside)
  const cap1 = Math.max(0, Math.min(1, 1 - p / 0.30))                        // 1→0 over 0..0.30
  const cap2 = Math.max(0, Math.min(1, Math.min((p - 0.30) / 0.15, (0.68 - p) / 0.15))) // 0→1→0
  const cap3 = Math.max(0, Math.min(1, (p - 0.72) / 0.18))                   // 0→1 over 0.72..0.90

  return (
    <section className="ln-hero" id="top">
      <div className={`ln-hero-pin${enabled ? '' : ' is-static'}`} ref={pinRef}>
        <div className="ln-hero-stage">
          <div className="ln-zoom-scene" aria-hidden="true">
            <CommunitySvg viewBox={viewBox} />
          </div>
          <div
            className="ln-zoom-interior"
            style={{ opacity: interiorOpacity }}
            aria-hidden="true"
          >
            <InteriorSvg />
          </div>

          <div className="ln-hero-overlay">
            <div className="ln-hero-inner">
              <div className="ln-hero-eyebrow">Resident portal · Early access</div>
              <h1 className="ln-hero-title">
                {enabled && (
                  <>
                    <span className="ln-hero-title-stack" style={{ opacity: cap1 }}>
                      Your community,<br />finally clear.
                    </span>
                    <span className="ln-hero-title-stack" style={{ opacity: cap2 }}>
                      Your home,<br />at the heart of it.
                    </span>
                  </>
                )}
                <span
                  className="ln-hero-title-stack"
                  style={enabled ? { opacity: cap3 } : undefined}
                >
                  And you,<br />in the loop.
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

// Hand-drawn ink stroke applied to every shape so the whole scene reads
// as someone's pencil sketch instead of a vector diagram.
const INK = '#1F2233'
const inkStroke = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: 'round', strokeLinecap: 'round' }
const thinInk   = { stroke: INK, strokeWidth: 1.4, strokeOpacity: 0.6, strokeLinecap: 'round' }

// The "sketch wobble" filter — feTurbulence + feDisplacementMap pushes
// every pixel a few units in a noise pattern, which turns straight SVG
// edges into wavy hand-drawn ones. baseFrequency controls how busy the
// scribble looks; scale controls how far the edges wobble. Tuned to
// read as "drawn with a pen" without dissolving the silhouette.
function SketchFilter({ id }) {
  return (
    <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="7" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  )
}

// Generic neighbourhood house. Used for every house in CommunitySvg
// except the focal one (which is drawn inline with extra detail).
// All shapes get an ink outline so the whole community reads as a sketch.
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

// Tiny stick-figure family used to populate the scene. Hand-drawn ink
// silhouettes (oval head + simple body line). Scales naturally with the
// viewBox zoom so they're proportionate to the houses they stand near.
function Person({ x, y, scale = 1, color = INK, hairColor }) {
  const s = scale
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* body */}
      <path d={`M0 ${10*s} L0 ${36*s} M-${8*s} ${50*s} L0 ${36*s} L${8*s} ${50*s} M-${10*s} ${22*s} L${10*s} ${22*s}`}
            fill="none" stroke={color} strokeWidth={2*s} strokeLinecap="round" strokeLinejoin="round" />
      {/* head */}
      <circle cx="0" cy={3*s} r={7*s} fill={hairColor || '#F4D6B8'} stroke={color} strokeWidth={1.8*s} />
    </g>
  )
}
function Dog({ x, y, scale = 1 }) {
  const s = scale
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* body */}
      <ellipse cx="0" cy="0" rx={14*s} ry={6*s} fill="#B88A5C" stroke={INK} strokeWidth={1.6*s} />
      {/* head */}
      <circle cx={12*s} cy={-3*s} r={5*s} fill="#B88A5C" stroke={INK} strokeWidth={1.6*s} />
      {/* ears */}
      <path d={`M${10*s} ${-7*s} L${8*s} ${-12*s} L${14*s} ${-9*s} Z`} fill="#8B6543" stroke={INK} strokeWidth={1.2*s} />
      {/* legs */}
      <line x1={-8*s} y1={5*s} x2={-8*s} y2={11*s} stroke={INK} strokeWidth={1.6*s} strokeLinecap="round" />
      <line x1={-3*s} y1={5*s} x2={-3*s} y2={11*s} stroke={INK} strokeWidth={1.6*s} strokeLinecap="round" />
      <line x1={6*s}  y1={5*s} x2={6*s}  y2={11*s} stroke={INK} strokeWidth={1.6*s} strokeLinecap="round" />
      <line x1={10*s} y1={5*s} x2={10*s} y2={11*s} stroke={INK} strokeWidth={1.6*s} strokeLinecap="round" />
      {/* tail */}
      <path d={`M${-13*s} ${-2*s} Q${-20*s} ${-8*s} ${-18*s} ${-12*s}`} fill="none" stroke={INK} strokeWidth={1.6*s} strokeLinecap="round" />
    </g>
  )
}

// One comprehensive scene. ViewBox 2400x1500 matches a 1440x900 stage
// exactly (1.6:1), so nothing gets sliced. The focal terracotta door is
// at the dead center (1200, 750) — that's the zoom anchor. Drawn from
// back-to-front so the foreground layers (focal house, foreground trees)
// occlude the rest correctly.
export function CommunitySvg({ viewBox = '0 0 2400 1500' }: { viewBox?: string }) {
  const DX = 1200  // door anchor X
  const DY = 750   // door anchor Y (also: ground level / horizon-ish)
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid slice" role="img" aria-label="A hand-drawn sketch of a small HOA community">
      <defs>
        <linearGradient id="cm-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="1" stopColor={SKY_BOT} />
        </linearGradient>
        <linearGradient id="cm-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={GROUND_T} />
          <stop offset="1" stopColor={GROUND_B} />
        </linearGradient>
        <SketchFilter id="cm-sketch" />
      </defs>
      {/* Filter removed from the animating hero — feTurbulence +
          feDisplacementMap on a viewBox that changes every scroll
          tick crushes perf on Safari/Mac. The ink strokes + ambient
          window/tree animations carry enough hand-drawn character on
          their own. */}
      <g>

      {/* Sky + ground */}
      <rect width="2400" height={DY + 50} fill="url(#cm-sky)" />
      <rect y={DY + 50} width="2400" height={1500 - DY - 50} fill="url(#cm-ground)" />

      {/* Ink-style plane drifting across the left half of the sky.
          Three nested <g>: outer for vertical position (SVG transform),
          middle for the CSS fly animation, inner for scale so the
          translate/animation/scale don't collide. */}
      <g transform="translate(0, 180)">
        <g className="ln-plane-fly">
          <g transform="scale(1.8)">
            {/* fuselage */}
            <ellipse cx="0" cy="0" rx="26" ry="3.5" fill={INK} />
            {/* nose cone */}
            <path d="M22 -2 L34 0 L22 2 Z" fill={INK} />
            {/* vertical tail fin */}
            <path d="M-22 -2 L-14 -2 L-18 -11 Z" fill={INK} />
            {/* main wing (sweeping back) */}
            <path d="M-4 1 L10 1 L-2 12 L-12 10 Z" fill={INK} />
            {/* small contrail puffs */}
            <circle cx="-34" cy="0" r="2.5" fill={INK} opacity="0.35" />
            <circle cx="-44" cy="0" r="3"   fill={INK} opacity="0.22" />
            <circle cx="-56" cy="1" r="3.5" fill={INK} opacity="0.12" />
          </g>
        </g>
      </g>

      {/* Friendly morning sun on the right side of the sky. Rays rotate
          slowly, body has a gentle glow halo. Drawn after the sky so
          it's visible, but before the houses so anything in front
          (focal house, etc.) still occludes if needed. */}
      <g transform="translate(2080, 220)">
        <circle r="80" fill="#FFE3B8" opacity="0.18" />
        <circle r="62" fill="#FFE3B8" opacity="0.32" />
        <g className="ln-sun-spin">
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * Math.PI) / 6
            const x1 = Math.cos(a) * 68
            const y1 = Math.sin(a) * 68
            const x2 = Math.cos(a) * 92
            const y2 = Math.sin(a) * 92
            return (
              <line key={i} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)}
                    stroke="#E6A95E" strokeWidth="4" strokeLinecap="round" />
            )
          })}
        </g>
        <circle r="46" fill="#FFC97A" {...inkStroke} />
        {/* tiny smile + eyes so the sun reads as friendly */}
        <circle cx="-14" cy="-6" r="3" fill={INK} />
        <circle cx="14"  cy="-6" r="3" fill={INK} />
        <path d="M-14 10 Q0 22 14 10" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      </g>

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
          // Removed back-row house at x=900: its right 30 units (1000-1030)
          // were being hidden by the focal house body (x=1000-1400), which
          // read as the focal house "cutting" its left neighbour.
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

      {/* house body — black ink outline to match every other house */}
      <rect x={DX - 200} y={DY - 200} width="400" height="280" fill={WALL_LITE} {...inkStroke} />
      {/* subtle siding so the wall reads as material at extreme zoom */}
      <g stroke="#1F2233" strokeOpacity="0.06" strokeWidth="1">
        {Array.from({ length: 14 }).map((_, i) => (
          <line key={i} x1={DX - 200} y1={DY - 200 + i * 20} x2={DX + 200} y2={DY - 200 + i * 20} />
        ))}
      </g>
      {/* roof */}
      <path d={`M${DX - 206} ${DY - 200} L${DX} ${DY - 400} L${DX + 206} ${DY - 200} Z`} fill={ROOF_LITE} {...inkStroke} />
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
      <text x={DX} y={DY - 178} textAnchor="middle" fontFamily="Inter, system-ui" fontSize="16" fontWeight="700" fill={WALL_LITE}>11</text>

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

      {/* mailbox — right of the front door, in the yard. Red flag on
          the right side of the box waves gently. */}
      <rect x={DX + 86} y={DY + 20} width="8" height="80" fill="#5C5238" {...thinInk} />
      <rect x={DX + 72} y={DY + 4}  width="36" height="20" rx="3" fill="#1F2233" />
      {/* tiny slot detail on the box */}
      <rect x={DX + 78} y={DY + 11} width="14" height="2" fill={WALL_LITE} opacity="0.6" />

      {/* === CHARACTERS — give the neighbourhood life === */}
      {/* family walking up the path toward the focal door — bobbing at
          slightly different phases so they don't look in lock-step */}
      <g className="ln-walk">
        <Person x={DX - 30} y={DY + 130} scale={1.0} hairColor="#7C4D2A" />
      </g>
      <g className="ln-walk-a">
        <Person x={DX + 10} y={DY + 140} scale={1.0} hairColor="#D4A56A" />
      </g>
      <g className="ln-walk-b">
        <Person x={DX + 38} y={DY + 155} scale={0.6} hairColor="#E8C285" />
      </g>
      {/* dog bouncing on the lawn */}
      <g className="ln-dog-bounce">
        <Dog x={DX - 130} y={DY + 145} scale={1.4} />
      </g>
      {/* neighbour pushing a stroller on the grass in front of the
          x=320 house (between foreground trees at x=290 and x=550 so
          nothing overlaps) */}
      <g className="ln-walk-c">
        <Person x={DX - 900} y={DY + 390} scale={1.1} hairColor="#3A2A1A" />
      </g>
      <g transform={`translate(${DX - 880}, ${DY + 408})`}>
        <rect x="-12" y="-4" width="24" height="16" rx="3" fill="#C76F45" {...thinInk} />
        {/* stroller wheels spin */}
        <g transform="translate(-8, 14)">
          <g className="ln-wheel-spin">
            <circle r="3" fill={INK} />
            <line x1="-3" y1="0" x2="3" y2="0" stroke={WALL_LITE} strokeWidth="0.8" />
          </g>
        </g>
        <g transform="translate(8, 14)">
          <g className="ln-wheel-spin">
            <circle r="3" fill={INK} />
            <line x1="-3" y1="0" x2="3" y2="0" stroke={WALL_LITE} strokeWidth="0.8" />
          </g>
        </g>
      </g>
      {/* kid on a bike on the grass in front of the x=1870 house */}
      <g className="ln-walk-a">
        <Person x={DX + 700} y={DY + 390} scale={0.9} hairColor="#E8C285" />
      </g>
      <g transform={`translate(${DX + 700}, ${DY + 418})`}>
        {/* bike wheels with spokes so the spin reads as motion */}
        <g transform="translate(-10, 12)">
          <g className="ln-wheel-spin">
            <circle r="7" fill="none" stroke={INK} strokeWidth="1.8" />
            <line x1="-6" y1="0" x2="6" y2="0" stroke={INK} strokeWidth="1.2" />
            <line x1="0" y1="-6" x2="0" y2="6" stroke={INK} strokeWidth="1.2" />
          </g>
        </g>
        <g transform="translate(10, 12)">
          <g className="ln-wheel-spin">
            <circle r="7" fill="none" stroke={INK} strokeWidth="1.8" />
            <line x1="-6" y1="0" x2="6" y2="0" stroke={INK} strokeWidth="1.2" />
            <line x1="0" y1="-6" x2="0" y2="6" stroke={INK} strokeWidth="1.2" />
          </g>
        </g>
        {/* frame: crossbar + seat post (don't spin) */}
        <line x1="-10" y1="12" x2="10" y2="12" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        <line x1="0" y1="12" x2="0" y2="0" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {/* one wide-shot neighbour on the grass at the far right */}
      <g className="ln-walk-b">
        <Person x={DX + 1000} y={DY + 400} scale={0.9} hairColor="#7C4D2A" />
      </g>
      </g>
    </svg>
  )
}

/* ============================================================
   InteriorSvg — the reveal frame at p=1. Camera has crossed the
   threshold and we're now inside the focal house: a cozy living room
   with someone on the couch holding a tablet that's showing the
   Residente product (budget rings + decision feed visible on the
   screen). Same sketch filter as the exterior so the two scenes feel
   like the same artist drew them.
   ============================================================ */
export function InteriorSvg() {
  return (
    <svg viewBox="0 0 2400 1500" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A hand-drawn sketch of the home's interior, with a resident checking the Residente app">
      <defs>
        <linearGradient id="int-wall" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#EFE3CF" />
          <stop offset="1" stopColor="#E2D2B5" />
        </linearGradient>
        <linearGradient id="int-floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#B58A5C" />
          <stop offset="1" stopColor="#8E6A41" />
        </linearGradient>
        <SketchFilter id="int-sketch" />
      </defs>

      <g>
        {/* back wall */}
        <rect width="2400" height="1050" fill="url(#int-wall)" />
        {/* floor */}
        <rect y="1050" width="2400" height="450" fill="url(#int-floor)" />
        {/* floorboards */}
        <g stroke={INK} strokeOpacity="0.2" strokeWidth="2">
          <line x1="0" y1="1180" x2="2400" y2="1180" />
          <line x1="0" y1="1300" x2="2400" y2="1300" />
          <line x1="0" y1="1420" x2="2400" y2="1420" />
        </g>

        {/* window on the left — view of the community we just came from */}
        <rect x="120" y="200" width="500" height="500" fill="#9FB7C2" {...inkStroke} className="ln-win-glow" />
        <line x1="370" y1="200" x2="370" y2="700" {...inkStroke} />
        <line x1="120" y1="450" x2="620" y2="450" {...inkStroke} />
        <rect x="100" y="180" width="540" height="40" fill={WALL_WARM} {...inkStroke} />
        <rect x="100" y="680" width="540" height="40" fill={WALL_WARM} {...inkStroke} />
        {/* tiny house silhouettes in the window — continuity with outside */}
        <g opacity="0.5">
          {[180, 280, 380, 480, 560].map((x, i) => (
            <g key={`win-${i}`}>
              <rect x={x} y="540" width="50" height="40" fill={WALL_WARM} />
              <path d={`M${x} 540 L${x+25} 520 L${x+50} 540 Z`} fill={ROOF} />
            </g>
          ))}
        </g>

        {/* potted plant by the window */}
        <g>
          <rect x="700" y="820" width="80" height="100" rx="6" fill="#C76F45" {...inkStroke} />
          <path d="M740 820 Q700 700 720 600 Q750 680 760 640 Q780 720 770 820 Q740 770 740 820" fill={TREE} {...inkStroke} />
        </g>

        {/* couch */}
        <g>
          <rect x="1300" y="980" width="800" height="200" rx="20" fill="#C76F45" {...inkStroke} />
          <rect x="1320" y="900" width="180" height="200" rx="14" fill="#A8552F" {...inkStroke} />
          <rect x="1520" y="900" width="180" height="200" rx="14" fill="#A8552F" {...inkStroke} />
          <rect x="1720" y="900" width="180" height="200" rx="14" fill="#A8552F" {...inkStroke} />
          <rect x="1920" y="900" width="180" height="200" rx="14" fill="#A8552F" {...inkStroke} />
          {/* couch legs */}
          <rect x="1320" y="1180" width="20" height="40" fill={INK} />
          <rect x="2060" y="1180" width="20" height="40" fill={INK} />
        </g>

        {/* coffee table */}
        <g>
          <rect x="1000" y="1150" width="260" height="30" rx="6" fill="#7C4D2A" {...inkStroke} />
          <rect x="1020" y="1180" width="14" height="80" fill="#5C3A1F" />
          <rect x="1226" y="1180" width="14" height="80" fill="#5C3A1F" />
          {/* mug on the table */}
          <ellipse cx="1100" cy="1142" rx="22" ry="8" fill="#F4EFE8" {...thinInk} />
          <rect x="1078" y="1130" width="44" height="20" fill="#F4EFE8" {...thinInk} />
          <path d="M1124 1132 Q1140 1138 1124 1148" fill="none" {...thinInk} />
          {/* coffee surface — darker ellipse inside the mug rim */}
          <ellipse cx="1100" cy="1138" rx="17" ry="5" fill="#3A2415" />
          {/* highlight on the coffee surface so it reads as liquid */}
          <ellipse cx="1095" cy="1136.5" rx="6" ry="1.4" fill="#6B4A2C" opacity="0.7" />
          {/* animated steam — four wavy wisps rising and fading at
              staggered phases. Thicker stroke + longer curves + higher
              peak opacity than v1 so the steam actually reads from
              across the room. */}
          <path className="ln-smoke-rise"   d="M1088 1124 Q1082 1108 1092 1092 Q1100 1078 1088 1062" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
          <path className="ln-smoke-rise-a" d="M1100 1124 Q1108 1108 1098 1092 Q1090 1078 1102 1062" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
          <path className="ln-smoke-rise-b" d="M1112 1124 Q1106 1108 1116 1092 Q1108 1078 1116 1062" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
          <path className="ln-smoke-rise-c" d="M1095 1124 Q1100 1110 1095 1096 Q1090 1082 1098 1068" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
        </g>

        {/* second parent, leaning toward the tablet — orange jumper,
            warm-blonde hair. Breathes at offset phase so the couch
            scene reads as two people watching together. */}
        <g className="ln-interior-breathe-a">
          {/* torso */}
          <path d="M1410 990 Q1410 905 1465 895 Q1520 905 1520 990 L1500 1090 L1430 1090 Z" fill="#C76F45" {...inkStroke} />
          {/* head, tilted slightly toward the first parent */}
          <circle cx="1465" cy="852" r="42" fill="#F4D6B8" {...inkStroke} />
          {/* hair */}
          <path d="M1423 852 Q1423 810 1467 802 Q1510 810 1507 852 Q1507 834 1487 834 Q1467 826 1452 834 Q1423 840 1423 852" fill="#7C4D2A" {...inkStroke} />
          {/* arm reaching toward the tablet */}
          <path d="M1518 970 Q1530 1000 1500 1040" fill="none" {...inkStroke} />
        </g>

        {/* kid playing in the foreground — bounces excitedly */}
        <g className="ln-interior-bounce">
          {/* body */}
          <path d="M880 1140 Q880 1080 920 1075 Q960 1080 960 1140 L955 1210 L885 1210 Z" fill="#7D8C5C" {...inkStroke} />
          {/* head */}
          <circle cx="920" cy="1040" r="30" fill="#F4D6B8" {...inkStroke} />
          {/* hair, slightly tousled */}
          <path d="M890 1040 Q890 1010 920 1003 Q950 1010 950 1040 Q950 1024 935 1024 Q920 1018 905 1024 Q890 1030 890 1040" fill="#D4A56A" {...inkStroke} />
          {/* arms raised — playing */}
          <path d="M885 1140 Q860 1110 855 1078" fill="none" {...inkStroke} />
          <path d="M955 1140 Q985 1115 990 1078" fill="none" {...inkStroke} />
          {/* legs */}
          <line x1="900" y1="1210" x2="900" y2="1260" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <line x1="940" y1="1210" x2="940" y2="1260" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        </g>

        {/* person on the couch holding a tablet */}
        <g className="ln-interior-breathe">
          {/* torso */}
          <path d="M1560 980 Q1560 880 1620 870 Q1680 880 1680 980 L1660 1090 L1580 1090 Z" fill="#4F2B8C" {...inkStroke} />
          {/* head */}
          <circle cx="1620" cy="820" r="48" fill="#E8C285" {...inkStroke} />
          {/* hair */}
          <path d="M1572 820 Q1572 770 1620 760 Q1680 770 1668 820 Q1668 800 1640 800 Q1620 790 1600 800 Q1572 810 1572 820" fill="#3A2A1A" {...inkStroke} />
          {/* arms holding tablet */}
          <path d="M1580 950 Q1520 990 1500 1050" fill="none" {...inkStroke} />
          <path d="M1660 950 Q1720 990 1740 1050" fill="none" {...inkStroke} />
          {/* tablet */}
          <rect x="1480" y="1030" width="280" height="180" rx="12" fill="#1F2233" {...inkStroke} />
          <rect x="1495" y="1045" width="250" height="150" rx="6" fill="#F4EFE8" />
          {/* tiny "Residente" UI on the tablet */}
          <text x="1505" y="1062" fontFamily="Inter, system-ui" fontSize="12" fontWeight="700" fill={INK}>Residente</text>
          {/* budget rings */}
          <circle cx="1530" cy="1110" r="22" fill="none" stroke="#C76F45" strokeWidth="6" />
          <circle cx="1580" cy="1110" r="22" fill="none" stroke="#7D8C5C" strokeWidth="6" />
          <circle cx="1630" cy="1110" r="22" fill="none" stroke="#4F2B8C" strokeWidth="6" />
          {/* decision feed lines */}
          <rect x="1665" y="1085" width="68" height="6" rx="2" fill={INK} opacity="0.6" />
          <rect x="1665" y="1100" width="50" height="6" rx="2" fill={INK} opacity="0.4" />
          <rect x="1665" y="1115" width="68" height="6" rx="2" fill={INK} opacity="0.6" />
          <rect x="1665" y="1130" width="40" height="6" rx="2" fill={INK} opacity="0.4" />
          {/* Optimistic state — everything's current, nothing to do.
              Sage green keeps it in palette but reads as "calm, done"
              instead of the terracotta call-to-action. */}
          <rect x="1505" y="1160" width="230" height="20" rx="4" fill="#7D8C5C" />
          <text x="1620" y="1174" fontFamily="Inter, system-ui" fontSize="10" fontWeight="700" fill="#F4EFE8" textAnchor="middle">YOU&apos;RE ALL CLEAR ✓</text>
        </g>

        {/* family dog napping by the couch — bigger so it actually
            reads as a pet, not a smudge */}
        <Dog x={1170} y={1248} scale={3.0} />

        {/* grandfather next to grandma — burgundy sweater, gray
            receding hair, white mustache, hand resting on grandma's
            arm so they read as a couple */}
        <g className="ln-interior-breathe">
          {/* torso */}
          <path d="M1770 985 Q1770 905 1825 895 Q1880 905 1880 985 L1865 1090 L1785 1090 Z" fill="#7C3A3A" {...inkStroke} />
          {/* head */}
          <circle cx="1825" cy="852" r="40" fill="#F4D6B8" {...inkStroke} />
          {/* receding gray hair (smaller crown patch) */}
          <path d="M1797 838 Q1800 815 1825 810 Q1850 815 1853 838 Q1853 822 1838 822 Q1825 817 1813 822 Q1797 826 1797 838" fill="#A8A29C" {...inkStroke} />
          {/* white mustache */}
          <path d="M1812 868 Q1825 874 1838 868" fill="none" stroke="#D6D2CC" strokeWidth="3" strokeLinecap="round" />
          {/* arm reaching toward grandma's arm — affectionate */}
          <path d="M1878 980 Q1898 985 1912 990" fill="none" {...inkStroke} />
        </g>

        {/* grandparent on the right end of the couch — silver hair,
            little round glasses, teal cardigan. Same gentle breathe
            as the other adults. */}
        <g className="ln-interior-breathe">
          {/* torso */}
          <path d="M1900 985 Q1900 905 1955 895 Q2010 905 2010 985 L1995 1090 L1915 1090 Z" fill="#3D7B7E" {...inkStroke} />
          {/* head */}
          <circle cx="1955" cy="852" r="40" fill="#F4D6B8" {...inkStroke} />
          {/* silver hair */}
          <path d="M1915 852 Q1915 810 1955 802 Q1995 810 1995 852 Q1995 832 1975 832 Q1955 824 1940 832 Q1915 838 1915 852" fill="#C8C0BC" {...inkStroke} />
          {/* arm resting on the couch arm */}
          <path d="M2008 980 Q2030 1000 2040 1042" fill="none" {...inkStroke} />
          {/* little round reading glasses */}
          <circle cx="1942" cy="850" r="7" fill="none" stroke={INK} strokeWidth="1.5" />
          <circle cx="1968" cy="850" r="7" fill="none" stroke={INK} strokeWidth="1.5" />
          <line x1="1949" y1="850" x2="1961" y2="850" stroke={INK} strokeWidth="1.5" />
        </g>

        {/* teenager standing on the left, headphones on, watching the
            chaos in the room. Rust-orange hoodie, dark hair. */}
        <g className="ln-interior-breathe">
          {/* torso */}
          <path d="M520 1040 Q520 960 560 952 Q600 960 600 1040 L595 1180 L525 1180 Z" fill="#9B4A28" {...inkStroke} />
          {/* head */}
          <circle cx="560" cy="912" r="32" fill="#F4D6B8" {...inkStroke} />
          {/* hair */}
          <path d="M528 912 Q528 874 560 866 Q592 874 592 912 Q592 898 576 898 Q560 892 545 898 Q528 902 528 912" fill="#3A2A1A" {...inkStroke} />
          {/* headphone band over the top of the head */}
          <path d="M535 893 Q560 868 585 893" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" fill-opacity="0" />
          {/* ear cups */}
          <ellipse cx="532" cy="902" rx="6" ry="9" fill={INK} />
          <ellipse cx="588" cy="902" rx="6" ry="9" fill={INK} />
          {/* arms hanging at sides */}
          <path d="M525 1030 Q510 1075 510 1130" fill="none" {...inkStroke} />
          <path d="M595 1030 Q610 1075 610 1130" fill="none" {...inkStroke} />
        </g>

        {/* younger sibling sitting cross-legged on the floor next to
            the bouncing kid — light-blue overalls, dark hair */}
        <g className="ln-interior-breathe-a">
          {/* body (seated) */}
          <ellipse cx="800" cy="1232" rx="34" ry="22" fill="#9FB7C2" {...inkStroke} />
          {/* head */}
          <circle cx="800" cy="1175" r="24" fill="#F4D6B8" {...inkStroke} />
          {/* hair */}
          <path d="M776 1175 Q776 1153 800 1148 Q826 1153 824 1175 Q824 1163 812 1163 Q800 1158 788 1163 Q776 1167 776 1175" fill="#3A2A1A" {...inkStroke} />
          {/* small arm pointing toward the older kid */}
          <path d="M770 1218 Q748 1208 742 1188" fill="none" {...inkStroke} />
        </g>

        {/* picture frames on the back wall */}
        <g>
          <rect x="900" y="280" width="160" height="120" fill="#F4EFE8" {...inkStroke} />
          <path d="M920 380 L960 320 L990 360 L1020 300 L1040 380" fill="none" stroke={TREE} strokeWidth="3" />
          <rect x="1100" y="320" width="120" height="100" fill="#F4EFE8" {...inkStroke} />
          <circle cx="1160" cy="370" r="20" fill="#FFE3B8" {...thinInk} />
        </g>

        {/* lamp behind the couch */}
        <g>
          <rect x="2210" y="1000" width="14" height="200" fill="#5C3A1F" />
          <path d="M2160 880 L2270 880 L2250 980 L2180 980 Z" fill="#FFE3B8" {...inkStroke} />
          <circle cx="2217" cy="900" r="46" fill="#FFE3B8" opacity="0.55" />
        </g>
      </g>
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
      <Stat n="100%" l="Of activity visible to residents" />
      <Stat n="30 sec" l="To pay your dues" />
      <Stat n="20 min" l="To set up a community" />
      <Stat n="0" l="Spreadsheets you'll keep" />
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
          The board gets the back-office they actually wanted — a household
          roster, dues collection, a vote-by-vote decisions log, a budget
          editor that doesn&apos;t require QuickBooks, and a document vault
          that finally replaces the email thread.
        </p>
        <p className="ln-uses-body">
          Residents get the transparency they&apos;d been quietly hoping
          for — every dollar of dues accounted for, every board decision
          visible the second it&apos;s made, and every receipt and PDF
          waiting in the same place, no PDF chase required.
        </p>
        <p className="ln-uses-body">
          Same product, two experiences. Setup takes about twenty minutes
          per community. From then on, both sides spend less time chasing
          each other and more time enjoying where they live.
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

// Positioning section. The visual structure of a comparison table —
// "old way" on the left, "Residente" on the right — but the punchline
// rejects the comparison: Residente is a new category, not a faster
// spreadsheet. Sits between "Built for both sides" (how it works) and
// the waitlist CTA (sign me up) so the reader closes on "this is why".
function VsEverything() {
  return (
    <section className="ln-vs" data-anim>
      <div className="ln-vs-inner">
        <div className="ln-eyebrow">Why Residente</div>
        <h2 className="ln-vs-title">Residente vs everything else.</h2>

        <div className="ln-vs-grid">
          <div className="ln-vs-old">
            <div className="ln-vs-col-label">The way it&apos;s been done</div>
            <ul className="ln-vs-list">
              <li><span className="ln-vs-tool">Spreadsheets</span> — read-only, treasurer-controlled</li>
              <li><span className="ln-vs-tool">QuickBooks</span> — opaque to the residents paying into it</li>
              <li><span className="ln-vs-tool">WhatsApp threads</span> — buried, unsearchable, half the community missing</li>
              <li><span className="ln-vs-tool">Manila folders</span> — locked in someone&apos;s garage</li>
              <li><span className="ln-vs-tool">Email chains</span> — forwarded, lost, never quite the right people</li>
            </ul>
          </div>

          <div className="ln-vs-new">
            <div className="ln-vs-col-label">Residente</div>
            <p className="ln-vs-statement">Can&apos;t be compared.</p>
            <p className="ln-vs-body">
              We&apos;re the first company to put the resident first — in
              the inner loop of community management. Every household,
              every decision, every dollar. Everyone is part of it.
            </p>
          </div>
        </div>
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
          <Link href="/login" className="ln-foot-link">Already a resident? Sign in</Link>
        </div>
      </div>
    </footer>
  )
}
