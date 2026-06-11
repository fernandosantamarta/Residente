'use client'

import { ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'

// Themed hover tooltip that pops in and follows the cursor. Wraps any element;
// the bubble is portalled to <body> so it never gets clipped and works the same
// on the admin and resident sides. Styling lives in globals.css (.tip-pop).
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  if (!text) return <>{children}</>
  return (
    <>
      <span
        className="tip-anchor"
        onMouseEnter={e => setPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
      >
        {children}
      </span>
      {pos && typeof document !== 'undefined' && createPortal(
        <div
          className="tip-pop"
          style={{
            // Offset from the cursor; clamp near the right/bottom edges so the
            // bubble stays on screen.
            left: Math.min(pos.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 272),
            top: pos.y + 18,
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}
