'use client'

import { useState, useEffect, useRef, forwardRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from './providers'
import { SiteFooter } from '@/components/SiteFooter'

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
      <DashboardPreview />
      <Pricing />
      <CtaBlock />
      <SiteFooter />
    </div>
  )
}

// Anchor scroll that survives the scroll-reveal reflow. A native `#id` jump
// lands short because the data-anim sections between here and the target reveal
// (and grow) AFTER the jump. So we scroll, then re-correct a couple of times as
// the reveals settle — the last call lands exactly on the section.
function scrollToHash(e: React.MouseEvent, hash: string) {
  const el = document.getElementById(hash.replace('#', ''))
  if (!el) return
  e.preventDefault()
  const go = () => el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  go()
  setTimeout(go, 300)
  setTimeout(go, 650)
  history.replaceState(null, '', hash)
}

function LandingNav() {
  const scrolled = useScrolled(32)
  return (
    <header className={`ln-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="ln-nav-inner">
        <a href="#top" className="ln-brand" onClick={(e) => scrollToHash(e, '#top')}>
          <img src="/residente-logo.png" alt="" className="ln-brand-logo" />
          <span className="ln-brand-word">Residente</span>
        </a>
        <nav className="ln-nav-links">
          <a href="#what" onClick={(e) => scrollToHash(e, '#what')}>Product</a>
          <a href="#boards" onClick={(e) => scrollToHash(e, '#boards')}>For boards</a>
          <a href="#residents" onClick={(e) => scrollToHash(e, '#residents')}>For residents</a>
          <a href="#pricing" onClick={(e) => scrollToHash(e, '#pricing')}>Pricing</a>
          <Link href="/login" className="ln-nav-signin">Sign in</Link>
        </nav>
        <Link href="/signup" className="ln-cta-pill">Sign up</Link>
      </div>
    </header>
  )
}

// Sky body — sun by day/sunset, moon at night. Lives outside the
// cinematic SVG as a CSS overlay so xMidYMid slice can't crop it. The
// `mode` prop drives both position and colors:
//   day     — bright yellow sun, upper-right corner (fixed)
//   sunset  — warm orange-red sun, low on the right, clip-path hides the
//             bottom so it reads as rising/setting behind the housetops
//   night   — sleepy crescent moon in the upper-right corner
function SunOverlay({ mode }: { mode: TimeOfDay }) {
  if (mode === 'night') {
    return (
      <div className="ln-hero-moon" aria-hidden="true">
        <svg viewBox="-100 -100 200 200">
          <circle r="78" fill="#C8D3E5" opacity="0.16" />
          <circle r="58" fill="#C8D3E5" opacity="0.28" />
          <circle r="46" fill="#F4EFE8" stroke="#1F2233" strokeWidth="2.2" />
          <circle cx="-14" cy="-10" r="6" fill="#C8C0BC" opacity="0.55" />
          <circle cx="12"  cy="6"  r="4" fill="#C8C0BC" opacity="0.55" />
          <circle cx="-4"  cy="14" r="3" fill="#C8C0BC" opacity="0.55" />
          {/* sleepy face */}
          <path d="M-13 -3 L-7 -3" fill="none" stroke="#1F2233" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M7 -3 L13 -3"   fill="none" stroke="#1F2233" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M-10 10 Q0 16 10 10" fill="none" stroke="#1F2233" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </div>
    )
  }

  // Day / sunrise / sunset: same friendly sun, palette varies.
  //   day      — bright yellow, upper-right corner
  //   sunrise  — pink-coral, right side at focal-window height
  //   sunset   — orange-red, right side at focal-window height
  // Sunrise vs sunset is distinguished by sky palette (sunrise = orange-pink,
  // sunset = orange-red) and the sun's own pink-vs-red tint.
  const isSunrise = mode === 'sunrise'
  const isSunset  = mode === 'sunset'
  // Swapped vs an earlier round: the fierier red-orange now belongs to
  // sunrise, the cooler pink-coral to sunset (matches Fernando's mental
  // model of which palette feels like which time of day).
  const body  = isSunrise ? '#E16040' : isSunset ? '#FF7A6E' : '#FFC97A'
  const glow  = isSunrise ? '#FFA888' : isSunset ? '#FFC4B0' : '#FFE3B8'
  const rays  = isSunrise ? '#B83B07' : isSunset ? '#D44862' : '#E6A95E'
  const positionClass = (isSunrise || isSunset) ? ' ln-hero-sun-low' : ''
  return (
    <div className={`ln-hero-sun${positionClass}`} aria-hidden="true">
      <svg viewBox="-100 -100 200 200">
        <circle r="80" fill={glow} opacity="0.18" />
        <circle r="62" fill={glow} opacity="0.32" />
        <g className="ln-sun-spin">
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * Math.PI) / 6
            const x1 = Math.cos(a) * 68
            const y1 = Math.sin(a) * 68
            const x2 = Math.cos(a) * 92
            const y2 = Math.sin(a) * 92
            return (
              <line key={i} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)}
                    stroke={rays} strokeWidth="4" strokeLinecap="round" />
            )
          })}
        </g>
        <circle r="46" fill={body} stroke="#1F2233" strokeWidth="2.2" />
        <circle cx="-14" cy="-6" r="3" fill="#1F2233" />
        <circle cx="14"  cy="-6" r="3" fill="#1F2233" />
        <path d="M-14 10 Q0 22 14 10" fill="none" stroke="#1F2233" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// Plane: pulled out of the cinematic SVG so it sits in front of the sun
// overlay (z-index above .ln-hero-sun). Traverses the full stage width
// via CSS translateX; vw-based animation in landing.css.
function PlaneOverlay() {
  // Two-layer structure so the ambient-op fade (used to hide overlays
  // during the cinematic zoom) doesn't fight the plane's own fade-in /
  // fade-out keyframes. Outer .ln-hero-plane carries --ambient-op
  // opacity; inner .ln-hero-plane-inner carries the drift animation
  // (transform + its own opacity). The two opacities multiply, so the
  // plane disappears with the rest of the sky overlays on scroll.
  const c = 'var(--plane-color, #1F2233)'
  const s = 'var(--plane-stroke, none)'
  const sw = 'var(--plane-stroke-w, 0)'
  return (
    <div className="ln-hero-plane" aria-hidden="true">
      <div className="ln-hero-plane-inner">
        <svg viewBox="-60 -20 120 40">
          <g transform="scale(1.4)" stroke={s} strokeWidth={sw as string} strokeLinejoin="round" strokeLinecap="round">
            <ellipse cx="0" cy="0" rx="26" ry="3.5" fill={c} />
            <path d="M22 -2 L34 0 L22 2 Z" fill={c} />
            <path d="M-22 -2 L-14 -2 L-18 -11 Z" fill={c} />
            <path d="M-4 1 L10 1 L-2 12 L-12 10 Z" fill={c} />
            {/* Contrail puffs — no stroke (they're faint by design) */}
            <circle cx="-34" cy="0" r="2.5" fill={c} stroke="none" opacity="0.35" />
            <circle cx="-44" cy="0" r="3"   fill={c} stroke="none" opacity="0.22" />
            <circle cx="-56" cy="1" r="3.5" fill={c} stroke="none" opacity="0.12" />
          </g>
        </svg>
      </div>
    </div>
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
type TimeOfDay = 'day' | 'sunrise' | 'sunset' | 'night'

// Mode buckets:
//   night    — 7pm to 5:30am  (sky dark, moon)
//   sunrise  — 5:30-7am       (pink sky, sun rising on the LEFT)
//   day      — 7am to 5pm     (default — bright sky, corner sun)
//   sunset   — 5-7pm          (orange-red sky, sun setting on the RIGHT)
function detectTimeOfDay(): TimeOfDay {
  const h = new Date().getHours() + new Date().getMinutes() / 60
  if (h < 5.5 || h >= 19) return 'night'
  if (h < 7)              return 'sunrise'
  if (h >= 17)            return 'sunset'
  return 'day'
}

function Hero() {
  // Refs everywhere — scroll-driven values write straight to the DOM in
  // the rAF callback below. React only re-renders Hero on mode/enabled
  // change (rare), NOT on every scroll tick. Without this, the 78-child
  // CommunitySvg JSX tree was being walked once per scroll frame, which
  // produced visible popping when scrolling fast back into the hero.
  const pinRef      = useRef<HTMLDivElement | null>(null)
  const stageRef    = useRef<HTMLDivElement | null>(null)
  const svgRef      = useRef<SVGSVGElement   | null>(null)
  const interiorRef = useRef<HTMLDivElement | null>(null)
  const cap1Ref     = useRef<HTMLSpanElement | null>(null)
  const cap2Ref     = useRef<HTMLSpanElement | null>(null)
  const cap3Ref     = useRef<HTMLSpanElement | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState<TimeOfDay>('day')

  // Time-of-day mode + URL ?mock= override for previewing.
  // setMode runs client-side only, so SSR always sees 'day' (matches CSS
  // default) — no hydration mismatch.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mock = params.get('mock')
    const apply = () => {
      if (mock === 'day' || mock === 'sunrise' || mock === 'sunset' || mock === 'night') {
        setMode(mock)
      } else {
        setMode(detectTimeOfDay())
      }
    }
    apply()
    if (!mock) {
      const id = setInterval(apply, 60_000)
      return () => clearInterval(id)
    }
  }, [])

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

  // Applies all p-derived DOM state imperatively. No React state, no
  // re-renders — every value goes straight to the relevant element.
  const applyP = (p: number) => {
    const ZOOM_END = 0.78
    const INTERIOR_FADE_END = 0.85
    const zp = Math.min(1, p / ZOOM_END)
    const zoom = Math.pow(12, zp)
    const vbW = 2400 / zoom
    const vbH = 1500 / zoom
    const vbX = 1200 - vbW / 2
    const vbY = 750  - vbH / 2
    const viewBox = `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`
    svgRef.current?.setAttribute('viewBox', viewBox)

    const interiorOpacity = Math.max(0, Math.min(1, (p - ZOOM_END) / (INTERIOR_FADE_END - ZOOM_END)))
    if (interiorRef.current) interiorRef.current.style.opacity = String(interiorOpacity)

    const ambientOp = Math.max(0, 1 - p / 0.35)
    stageRef.current?.style.setProperty('--ambient-op', String(ambientOp))

    const cap1 = Math.max(0, Math.min(1, 1 - p / 0.30))
    const cap2 = Math.max(0, Math.min(1, Math.min((p - 0.30) / 0.15, (0.68 - p) / 0.15)))
    const cap3 = Math.max(0, Math.min(1, (p - 0.72) / 0.18))
    if (cap1Ref.current) cap1Ref.current.style.opacity = String(cap1)
    if (cap2Ref.current) cap2Ref.current.style.opacity = String(cap2)
    if (cap3Ref.current) cap3Ref.current.style.opacity = String(cap3)
  }

  useEffect(() => {
    if (!enabled) {
      // Static fallback (mobile / reduced motion): pin the scene at
      // p=1 — fully zoomed in with the interior visible.
      applyP(1)
      return
    }

    // Lerp-smoothed cinematic. The scroll handler only updates a TARGET
    // p; a continuously running rAF loop eases the actual rendered p
    // toward the target by 15% per frame. Fast scroll-back stops looking
    // like a series of frame snapshots and reads as a smooth dolly-out
    // because the visible state can never jump more than ~15% of the
    // remaining distance per 16ms tick.
    let targetP = 0
    let currentP = 0
    let raf = 0
    const LERP_RATE = 0.15
    const EPS = 0.0005

    const computeTarget = () => {
      const el = pinRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const span = el.offsetHeight - window.innerHeight
      if (span <= 0) { targetP = 0; return }
      const scrolled = Math.min(span, Math.max(0, -rect.top))
      targetP = scrolled / span
    }

    const tick = () => {
      raf = 0
      const delta = targetP - currentP
      // Only forward easing here. Backward scroll is handled in the
      // scroll-settle timer in markScrolling() — the SVG stays frozen
      // throughout the scroll-back motion and only updates once on
      // scroll-stop. That's what kills the per-frame visual churn.
      if (delta <= 0) return
      if (delta < EPS) {
        currentP = targetP
        applyP(currentP)
        return
      }
      currentP += delta * LERP_RATE
      applyP(currentP)
      raf = requestAnimationFrame(tick)
    }

    // Mark the stage as actively scrolling. The CSS rule hides every
    // sky overlay (sun/moon/plane) while .is-scrolling is on, so they
    // can't visibly flash during fast scroll-back. Cleared 200ms after
    // the last scroll event, at which point a CSS transition fades the
    // overlays back in based on var(--ambient-op).
    let scrollEndTimer: ReturnType<typeof setTimeout> | undefined
    const markScrolling = () => {
      const stage = stageRef.current
      if (!stage) return
      if (!stage.classList.contains('is-scrolling')) {
        stage.classList.add('is-scrolling')
      }
      if (scrollEndTimer) clearTimeout(scrollEndTimer)
      scrollEndTimer = setTimeout(() => {
        stage.classList.remove('is-scrolling')
        // After scroll settles, snap currentP to wherever the target
        // actually is and apply that final state once. No frame-by-frame
        // updates during the scroll itself — that's what caused the
        // perceived flashing on fast scroll-back. 80ms is short enough
        // that the user perceives the cinematic catching up as
        // instantaneous, long enough that micro scroll-bounces between
        // events don't fire it repeatedly.
        currentP = targetP
        applyP(currentP)
      }, 80)
    }

    const onScroll = () => {
      computeTarget()
      markScrolling()
      const delta = targetP - currentP
      if (delta < 0) {
        // Backward scroll: apply each new target immediately so the
        // dolly-out tracks the scroll wheel. With overlays hidden and
        // house animations disabled by .is-scrolling, the per-event
        // SVG repaint is just static geometry — no flicker risk —
        // and the user feels the cinematic respond instantly instead
        // of lagging behind a settle timer.
        currentP = targetP
        applyP(currentP)
        return
      }
      // Forward scroll (zooming in) eases via the lerp tick.
      if (!raf) raf = requestAnimationFrame(tick)
    }

    // Initial state: read scroll, snap currentP to target (no fade-in).
    computeTarget()
    currentP = targetP
    applyP(currentP)

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (scrollEndTimer) clearTimeout(scrollEndTimer)
      stageRef.current?.classList.remove('is-scrolling')
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [enabled])

  return (
    <section className="ln-hero" id="top">
      <div className={`ln-hero-pin${enabled ? '' : ' is-static'}`} ref={pinRef}>
        <div
          className="ln-hero-stage"
          data-time={mode}
          ref={stageRef}
        >
          <div className="ln-zoom-scene" aria-hidden="true">
            <CommunitySvg ref={svgRef} mode={mode} />
          </div>
          <div
            className="ln-zoom-interior"
            ref={interiorRef}
            style={{ opacity: 0 }}
            aria-hidden="true"
          >
            <InteriorSvg />
          </div>

          <SunOverlay mode={mode} />
          <PlaneOverlay />

          <div className="ln-hero-overlay">
            <div className="ln-hero-inner">
              <div className="ln-hero-eyebrow">Resident portal · Early access</div>
              <h1 className="ln-hero-title">
                {enabled && (
                  <>
                    <span className="ln-hero-title-stack" ref={cap1Ref} style={{ opacity: 1 }}>
                      Your community,<br />finally clear.
                    </span>
                    <span className="ln-hero-title-stack" ref={cap2Ref} style={{ opacity: 0 }}>
                      Your home,<br />at the heart of it.
                    </span>
                  </>
                )}
                <span
                  className="ln-hero-title-stack"
                  ref={cap3Ref}
                  style={enabled ? { opacity: 0 } : undefined}
                >
                  And you,<br />in the loop.
                </span>
              </h1>
              <p className="ln-hero-sub">
                The resident portal that shows where your dues go, what the
                board is up to, and how to pay. All in one place.
              </p>
              <div className="ln-hero-ctas">
                <Link href="/signup" className="ln-hero-btn">Sign up</Link>
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
export const CommunitySvg = forwardRef<SVGSVGElement, { viewBox?: string; mode?: TimeOfDay }>(function CommunitySvg(
  { viewBox = '0 0 2400 1500', mode = 'day' },
  ref,
) {
  const DX = 1200  // door anchor X
  const DY = 750   // door anchor Y (also: ground level / horizon-ish)
  return (
    <svg ref={ref} viewBox={viewBox} preserveAspectRatio="xMidYMid slice" role="img" aria-label="A hand-drawn sketch of a small HOA community">
      <defs>
        <linearGradient id="cm-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="1" stopColor={SKY_BOT} />
        </linearGradient>
        <linearGradient id="ufo-beam" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5BFF8C" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#7BFFB0" stopOpacity="0.35" />
          <stop offset="1" stopColor="#A0FFCC" stopOpacity="0" />
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

      {/* UFO sequence: drifts in from the far left, hovers above the focal
          house, drops a green tractor beam onto the roof, then shoots
          straight up off the top. Outer transform sets the resting Y
          (just above focal-house roof at y=350). Inner .ln-ufo-fly is the
          CSS-animated wrapper that handles drift + shoot-up. The beam
          wrap fades in/out on its own keyframe synced to the same cycle. */}
      <g transform="translate(0, 150)">
        <g className="ln-ufo-fly">
          {/* The tractor beam is drawn separately as the full-length foreground
              cone (.ln-ufo-beam2) so it reaches the ground without being
              occluded by the focal house — see the abduction block below. */}
          <g transform="scale(2.6)">
            {/* saucer dish + rim */}
            <ellipse cx="0" cy="0" rx="44" ry="11" fill="#3A3E55" stroke={INK} strokeWidth="1.6" />
            <ellipse cx="0" cy="-2" rx="36" ry="8" fill="#5A5E75" stroke={INK} strokeWidth="1.2" />
            {/* glass dome */}
            <path d="M-22 -3 Q-22 -22 0 -22 Q22 -22 22 -3 Z" fill="#9FD7E5" stroke={INK} strokeWidth="1.4" />
            <ellipse cx="-8" cy="-13" rx="6" ry="3" fill="#FFFFFF" opacity="0.55" />
            {/* underside green running lights */}
            <circle cx="-26" cy="6" r="3" fill="#5BFF8C" stroke={INK} strokeWidth="0.8" />
            <circle cx="0"   cy="8" r="3.5" fill="#5BFF8C" stroke={INK} strokeWidth="0.8" />
            <circle cx="26"  cy="6" r="3" fill="#5BFF8C" stroke={INK} strokeWidth="0.8" />
          </g>
        </g>
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
      {/* The group the UFO abducts: three residents + the family dog. They
          emerge from the two smaller houses flanking the focal one, walk in to
          gather in the cul-de-sac, and stand (each with its own idle bob/bounce)
          until the saucer parks. The parent .ln-abduct then lifts the whole
          group straight up into the saucer when the beam fires; once the UFO
          has left, a fresh group emerges from the houses again. 24s loop, no
          pop (every position snap happens while opacity is 0). The horizontal
          "come from the houses" motion is on the child .ln-come-* groups so it
          composes with the parent's vertical rise. */}
      <g className="ln-abduct">
        {/* One resident + the family dog emerge from the smaller house on the
            LEFT (x=840). .ln-come-left walks them from that door in to the
            gather spot; the parent .ln-abduct then lifts the whole group. */}
        <g className="ln-come-left">
          <g className="ln-walk">
            <Person x={DX - 34} y={DY + 130} scale={1.0} hairColor="#7C4D2A" />
          </g>
        </g>
        {/* Two residents emerge from the smaller house on the RIGHT (x=1400). */}
        <g className="ln-come-right">
          <g className="ln-walk-a">
            <Person x={DX + 12} y={DY + 138} scale={1.0} hairColor="#D4A56A" />
          </g>
          <g className="ln-walk-b">
            <Person x={DX + 40} y={DY + 152} scale={0.6} hairColor="#E8C285" />
          </g>
        </g>
        {/* Dog comes from the left house too, but is drawn LAST and a little
            lower so it reads as leading the group, in front of the people. */}
        <g className="ln-come-left">
          <g className="ln-dog-bounce">
            <Dog x={DX - 6} y={DY + 225} scale={1.5} />
          </g>
        </g>
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

      {/* UFO tractor beam — the only beam (the old roofline beam was removed to
          avoid a double light). A full-length cone from the saucer underside to
          the cul-de-sac, drawn here so it sits on top of the houses and tints
          the family green as they rise. The figures it abducts are the
          ln-abduct group in the CHARACTERS block above; the beam fades in and
          out with that abduction (beam on roughly 36 to 60 percent of the
          24s cycle). */}
      <g className="ln-ufo-beam2" aria-hidden="true">
        <path d={`M${DX - 30} 175 L${DX + 30} 175 L${DX + 166} 1150 L${DX - 166} 1150 Z`} fill="url(#ufo-beam)" />
      </g>
      </g>
    </svg>
  )
})

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
          <path className="ln-smoke-rise"   d="M1088 1124 Q1082 1108 1092 1092 Q1100 1078 1088 1062" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          <path className="ln-smoke-rise-a" d="M1100 1124 Q1108 1108 1098 1092 Q1090 1078 1102 1062" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          <path className="ln-smoke-rise-b" d="M1112 1124 Q1106 1108 1116 1092 Q1108 1078 1116 1062" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          <path className="ln-smoke-rise-c" d="M1095 1124 Q1100 1110 1095 1096 Q1090 1082 1098 1068" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
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
          <path d="M535 893 Q560 868 585 893" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
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
        <div className="ln-eyebrow">For residents — not a management company</div>
        <h2 className="ln-what-title">
          Manage your own community, easily and effortlessly.
        </h2>
        <Link href="/signup" className="ln-pill-btn">Sign up</Link>
      </div>
      <p className="ln-what-body">
        Residente isn&apos;t a management company, and there&apos;s no middleman —
        it&apos;s software your board and residents run together. Most small HOAs
        still live in email chains, paper notices, and a QuickBooks file only the
        treasurer can read. Residente replaces all of that with a portal residents
        actually want to open — transparent budgets, board decisions in a feed,
        and one-tap dues.
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
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
    'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
    'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
    'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
    'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
    'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
    'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
    'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
    'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  ]
  return (
    <section className="ln-trust" data-anim>
      <div className="ln-trust-label">
        Designed in Florida, for HOAs of every
        <br />size that make up our beautiful country.
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
        <Link href="/signup" className="ln-use-link">Set up your community <span aria-hidden="true">→</span></Link>
      </div>

      <div className="ln-use-card ln-use-card-soft" id="residents" data-stagger="2">
        <div className="ln-use-tag">For residents</div>
        <h3>Finally know what your HOA is doing.</h3>
        <p>
          Your balance, your share of the budget, every board decision since
          you moved in — visible the second you log in. No more chasing the
          treasurer for a PDF.
        </p>
        <Link href="/signup" className="ln-use-link">Join your community <span aria-hidden="true">→</span></Link>
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

function DashboardPreview() {
  return (
    <section className="ln-preview" data-anim>
      <div className="ln-preview-inner">
        <div className="ln-eyebrow">A peek inside</div>
        <h2 className="ln-preview-title">This is what your community sees.</h2>
        <p className="ln-preview-sub">
          Every resident logs into their own cockpit — budgets, board
          decisions, dues, all in one place. Below is the real product,
          loaded with a sample community so you can poke around.
        </p>
        <div className="ln-preview-frame">
          <div className="ln-preview-chrome" aria-hidden="true">
            <span className="ln-preview-dot" />
            <span className="ln-preview-dot" />
            <span className="ln-preview-dot" />
            <span className="ln-preview-url">residente.io/app</span>
          </div>
          <img
            src="/dashboard-preview.png"
            alt="Screenshot of the Residente resident cockpit — sidebar nav, hero greeting, financial overview chart, dues breakdown, and an Up Next rail"
            className="ln-preview-img"
            loading="lazy"
          />
        </div>
        <div className="ln-preview-ctas">
          <Link href="/app?preview=1" className="ln-pill-btn">Try the interactive demo</Link>
        </div>
      </div>
    </section>
  )
}

// Pricing. One product, priced per home and billed to the association.
// Residents pay no software fee — only their own dues/fees, which go to the
// HOA (not us), so the marketing copy avoids the misleading "free" absolute.
// Every plan ships the entire platform; the tiers are purely community-size
// bands (by home count), so the cards carry a price + a size band and the
// full (real, shipped) feature set is listed once below in a shared "every
// plan includes" strip. Launch promo: $1/home first year, sign up by Aug 31 2026.
function Pricing() {
  const TIERS = [
    { name: 'Free',       amt: '$0',  unit: '',             band: 'Up to 25 homes', cta: 'Get started',    href: '/signup', featured: false },
    { name: 'Pro',        amt: '$2',  unit: '/ home / mo',  band: '26–100 homes',   cta: 'Start with Pro', href: '/signup', featured: true  },
    { name: 'Premium',    amt: '$5',  unit: '/ home / mo',  band: '101–500 homes',  cta: 'Choose Premium', href: '/signup', featured: false },
    { name: 'Enterprise', amt: '$10', unit: '/ home / mo',  band: '500+ homes',     cta: 'Talk to us',     href: '/signup', featured: false },
  ]
  const INCLUDED = [
    'Resident cockpit', 'Online dues & fines (Stripe)', 'Live budget rings',
    'Board decisions feed', 'Meeting minutes & voting', 'Document vault',
    'Amenity booking', 'Maintenance & complaint requests', 'Violation tracking & appeals',
    'Community calendar & events', 'Household roster & CSV import', 'English · Spanish · Portuguese',
  ]
  return (
    <section className="ln-pricing" id="pricing" data-anim>
      <div className="ln-pricing-head">
        <div className="ln-eyebrow">Pricing</div>
        <h2 className="ln-pricing-title">One product. Priced by community size.</h2>
        <p className="ln-pricing-sub">
          Every plan includes the entire Residente platform — larger communities
          just pay a little more per home.
        </p>
        <div className="ln-promo" role="note">
          <span className="ln-promo-tag">Launch offer</span>
          <span className="ln-promo-text">
            Sign up by <strong>Aug 31, 2026</strong> and pay just <strong>$1 / home</strong> for your entire first year.
          </span>
        </div>
      </div>

      <div className="ln-tiers">
        {TIERS.map((t, i) => (
          <div key={t.name} className={`ln-tier${t.featured ? ' ln-tier-feature' : ''}`} data-stagger={i + 1}>
            {t.featured && <div className="ln-tier-badge">Most popular</div>}
            <div className="ln-tier-name">{t.name}</div>
            <div className="ln-tier-price">
              <span className="ln-tier-amt">{t.amt}</span>
              {t.unit && <span className="ln-tier-unit">{t.unit}</span>}
            </div>
            <div className="ln-tier-note">{t.band}</div>
            <Link href={t.href} className={`ln-tier-btn${t.featured ? ' ln-tier-btn-accent' : ''}`}>{t.cta}</Link>
          </div>
        ))}
      </div>

      <div className="ln-included">
        <div className="ln-included-label">Every plan includes the whole platform</div>
        <ul className="ln-included-grid">
          {INCLUDED.map(f => <li key={f}>{f}</li>)}
        </ul>
      </div>

      <div className="ln-addons">
        <div className="ln-addons-text">
          <span className="ln-addons-label">Premium &amp; Enterprise add-ons</span>
          <span className="ln-addons-list">API access &amp; webhooks · SSO / SAML sign-in · Accounting integrations</span>
        </div>
        <a href="mailto:hello@residente.io?subject=Residente%20add-ons" className="ln-addons-link">
          Ask us about this <span aria-hidden="true">→</span>
        </a>
      </div>

      <p className="ln-pricing-fine">
        Online payments are powered by Stripe. Standard Stripe processing fees
        are passed through to your association.
      </p>
    </section>
  )
}

function CtaBlock() {
  return (
    <section className="ln-waitlist" id="waitlist" data-anim>
      <div className="ln-waitlist-card">
        <div className="ln-waitlist-glow" aria-hidden="true" />
        <div className="ln-waitlist-inner">
          <div className="ln-waitlist-kicker">Get started</div>
          <h2 className="ln-waitlist-title">
            Bring your community online today.
          </h2>
          <p className="ln-waitlist-sub">
            Set up your association in a few minutes. Free to start for boards and
            managers, free for residents to use. No spam, no upsell.
          </p>
          <div className="ln-waitlist-cta">
            <Link href="/signup" className="ln-waitlist-btn">Sign up</Link>
            <Link href="/login" className="ln-waitlist-signin">I already have an account</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

