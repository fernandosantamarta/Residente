'use client'

// A small floating nudge pinned to the bottom-right (by the scrollbar) telling
// the board that Reports & exports live further down the Community page. Clicking
// it smooth-scrolls to the #reports section. It fades out once that section is
// nearly in view, so it only nags while you're up top.

import { useEffect, useState } from 'react'

export function ReportsScrollHint() {
  const [show, setShow] = useState(true)

  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById('reports')
      if (!el) { setShow(true); return }
      // Hide once the reports section's top reaches the lower part of the viewport.
      const nearlyVisible = el.getBoundingClientRect().top < window.innerHeight * 0.85
      setShow(!nearlyVisible)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const toReports = () =>
    document.getElementById('reports')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <>
      <style>{`@keyframes reports-hint-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(4px) } }`}</style>
      <button
        type="button"
        onClick={toReports}
        aria-label="Jump to reports below"
        style={{
          position: 'fixed', right: 18, bottom: 22, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderRadius: 999, cursor: 'pointer',
          background: '#E14909', color: '#fff', border: 'none',
          fontSize: 13, fontWeight: 600, letterSpacing: '0.01em',
          boxShadow: '0 6px 20px rgba(225,73,9,0.35)',
          opacity: show ? 1 : 0,
          transform: show ? 'translateY(0)' : 'translateY(10px)',
          pointerEvents: show ? 'auto' : 'none',
          transition: 'opacity .25s ease, transform .25s ease',
        }}
      >
        Reports below
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
          style={{ animation: 'reports-hint-bob 1.2s ease-in-out infinite' }}>
          <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
        </svg>
      </button>
    </>
  )
}
