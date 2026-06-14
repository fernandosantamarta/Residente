'use client'

import { useEffect, useRef, useState } from 'react'

// Clamp a block of text to `lines` rows and reveal the rest behind a "More"
// toggle. The toggle only appears when the text is actually truncated, so short
// strings (e.g. on desktop) render normally with no button. preventDefault +
// stopPropagation let it live inside a clickable parent (the wsrow Links) without
// triggering navigation.
export function ClampText({
  text,
  lines = 2,
  className,
}: {
  text: string
  lines?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) setTruncated(el.scrollHeight > el.clientHeight + 1)
  }, [text, lines])

  const clampStyle = !open
    ? {
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical' as const,
        overflow: 'hidden',
      }
    : undefined

  return (
    <div className={className}>
      <span ref={ref} style={clampStyle}>{text}</span>
      {(truncated || open) && (
        <button
          type="button"
          className="clamp-more"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen((o) => !o)
          }}
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  )
}
