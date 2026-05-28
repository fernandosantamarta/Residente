'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// Themed custom dropdown — replaces native <select> so we can fully
// style the popup panel (rounded corners, orange highlight, no blue
// OS selection). Closes on outside click and Escape.
//
// Searchable mode (`searchable: true`):
//   - The trigger itself becomes a typeable input — no separate search
//     bar inside the popup.
//   - Type to filter the options live.
//   - With `onCreate`, an "+ Add <query>" row appears when the typed
//     text doesn't match any option, so one control both picks AND
//     creates.
export function Dropdown<T extends string>({
  value, onChange, options, ariaLabel, placeholder,
  searchable = false, onCreate, onDelete,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  ariaLabel?: string
  placeholder?: string
  searchable?: boolean
  onCreate?: (query: string) => void
  /** Optional per-option delete. When set, hovering an option reveals
   *  a red × on the right that calls this with the option value. */
  onDelete?: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Reset query when popup closes.
  useEffect(() => { if (!open) setQuery('') }, [open])

  const selected = options.find(o => o.value === value)

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const q = query.trim().toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, query, searchable])

  // Show the create row when search has typed text that doesn't match
  // any option label exactly.
  const showCreateRow =
    !!onCreate &&
    !!query.trim() &&
    !options.some(o => o.label.toLowerCase() === query.trim().toLowerCase())

  const submitCreate = () => {
    if (!onCreate || !query.trim()) return
    onCreate(query.trim())
    setOpen(false)
  }

  const pickOption = (v: T) => { onChange(v); setOpen(false) }

  return (
    <div className={`ad-dd${open ? ' open' : ''}${searchable ? ' searchable' : ''}`} ref={ref}>
      {searchable ? (
        <div className="ad-dd-trigger ad-dd-trigger-search">
          <input
            type="text"
            className="ad-dd-trigger-input"
            value={open ? query : (selected?.label || '')}
            onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (filtered.length === 1) pickOption(filtered[0].value)
                else if (showCreateRow) submitCreate()
              } else if (e.key === 'ArrowDown' && !open) {
                setOpen(true)
              }
            }}
            placeholder={placeholder ?? 'Search…'}
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
          />
          <button
            type="button"
            className="ad-dd-trigger-chev-btn"
            onClick={() => setOpen(v => !v)}
            tabIndex={-1}
            aria-label={open ? 'Close' : 'Open'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ad-dd-trigger"
          onClick={() => setOpen(v => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <span className="ad-dd-trigger-label">
            {selected?.label ?? placeholder ?? '—'}
          </span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      {open && (
        <div className="ad-dd-panel" role="listbox">
          {filtered.map(o => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`ad-dd-option-row${o.value === value ? ' active' : ''}`}
            >
              <button
                type="button"
                className="ad-dd-option"
                onClick={() => pickOption(o.value)}
              >
                {o.label}
              </button>
              {onDelete && (
                <button
                  type="button"
                  className="ad-dd-option-del"
                  onClick={e => { e.stopPropagation(); onDelete(o.value) }}
                  aria-label={`Delete ${o.label}`}
                  title={`Delete ${o.label}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {filtered.length === 0 && !showCreateRow && (
            <div className="ad-dd-empty">No matches.</div>
          )}
          {showCreateRow && (
            <button
              type="button"
              className="ad-dd-create"
              onClick={submitCreate}
            >
              <span className="ad-dd-create-plus" aria-hidden="true">+</span>
              <span>Add &ldquo;{query.trim()}&rdquo;</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
