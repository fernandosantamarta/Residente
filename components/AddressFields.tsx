'use client'

// Structured US address entry that composes to a single "Street, City, ST ZIP"
// string (the format the rest of the app + Lob expect). Separate boxes so an
// address is always complete + mailable; State defaults to FL and Country to the
// US (US is implied and never written into the string). Stored as one column —
// no schema change. `onChange` fires live; optional `onCommit` fires on blur
// (for the roster's commit-on-blur rows).

import { useState } from 'react'

function parse(value: string): { street: string; city: string; state: string; zip: string } {
  const parts = String(value || '').split(',').map(p => p.trim()).filter(Boolean)
  let street = '', city = '', state = '', zip = ''
  if (parts.length) street = parts[0]
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    const m = last.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/)
    if (m) { state = m[1].toUpperCase(); zip = m[2] || ''; if (parts.length >= 3) city = parts[parts.length - 2] }
    else city = parts[1]
  }
  return { street, city, state, zip }
}

function compose(p: { street: string; city: string; state: string; zip: string }): string {
  const tail = [p.state.trim(), p.zip.trim()].filter(Boolean).join(' ')
  return [p.street.trim(), p.city.trim(), tail].filter(Boolean).join(', ')
}

export function AddressFields({
  value, onChange, onCommit, stateDefault = 'FL',
}: {
  value: string
  onChange: (composed: string) => void
  onCommit?: (composed: string) => void
  stateDefault?: string
}) {
  const init = parse(value)
  const [street, setStreet] = useState(init.street)
  const [city, setCity] = useState(init.city)
  const [state, setState] = useState(init.state || stateDefault)
  const [zip, setZip] = useState(init.zip)

  const composed = (over: Partial<{ street: string; city: string; state: string; zip: string }> = {}) =>
    compose({ street, city, state, zip, ...over })
  const push = (over: Partial<{ street: string; city: string; state: string; zip: string }>) => onChange(composed(over))
  const commit = () => onCommit?.(composed())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input className="admin-input" placeholder="Street address" value={street}
        onChange={e => { setStreet(e.target.value); push({ street: e.target.value }) }} onBlur={commit} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.7fr 0.9fr', gap: 8 }}>
        <input className="admin-input" placeholder="City" value={city}
          onChange={e => { setCity(e.target.value); push({ city: e.target.value }) }} onBlur={commit} />
        <input className="admin-input" placeholder="State" maxLength={2} value={state}
          onChange={e => { const v = e.target.value.toUpperCase(); setState(v); push({ state: v }) }} onBlur={commit} />
        <input className="admin-input" placeholder="ZIP" value={zip}
          onChange={e => { setZip(e.target.value); push({ zip: e.target.value }) }} onBlur={commit} />
      </div>
      <input className="admin-input" value="United States" disabled aria-label="Country" style={{ opacity: 0.6 }} />
    </div>
  )
}
