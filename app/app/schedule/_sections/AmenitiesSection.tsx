'use client'

import { useMemo, useState } from 'react'
import { DetailDialog } from '@/app/app/track/_sections/DetailDialog'
import {
  Amenity,
  AmenityKind,
  KIND_LABEL,
  TIME_SLOTS,
  fmtSlot,
  priceLabel,
  useAmenityHub,
} from '@/lib/amenities'

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Simple line-art glyph per kind so cards have character without stock photos
// (the sketch theme draws, it doesn't photograph).
function KindIcon({ kind }: { kind: AmenityKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'pool':
      return <svg viewBox="0 0 24 24" {...common}><path d="M2 16c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2" /><path d="M8 14V5a2 2 0 0 1 4 0M16 14V5a2 2 0 0 1 4 0" /></svg>
    case 'clubhouse':
      return <svg viewBox="0 0 24 24" {...common}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>
    case 'gym':
      return <svg viewBox="0 0 24 24" {...common}><path d="M6 8v8M18 8v8M4 10v4M20 10v4M6 12h12" /></svg>
    case 'court':
      return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M12 5v14M3 12h18" /></svg>
    case 'marina':
      return <svg viewBox="0 0 24 24" {...common}><path d="M12 3v18M8 7h8M5 12a7 7 0 0 0 14 0" /><circle cx="12" cy="4" r="1.5" /></svg>
    default:
      return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></svg>
  }
}

export function AmenitiesSection() {
  const { amenities, reservations, byAmenity, live, book, cancel, takenSlots } = useAmenityHub()

  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<AmenityKind | 'all'>('all')
  const [active, setActive] = useState<Amenity | null>(null)

  // Kinds present in the catalog, in catalog order, for the filter chips.
  const kinds = useMemo(() => {
    const seen: AmenityKind[] = []
    for (const a of amenities) if (!seen.includes(a.kind)) seen.push(a.kind)
    return seen
  }, [amenities])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return amenities.filter(a => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false) ||
        (a.location?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [amenities, query, kindFilter])

  const upcoming = useMemo(
    () => [...reservations].sort((a, b) => (a.reservedDate + a.startTime).localeCompare(b.reservedDate + b.startTime)),
    [reservations],
  )

  return (
    <div className="amen-wrap">
      {!live && (
        <div className="amen-demo-note">
          Showing a sample amenity set. Once your board adds amenities, they appear here automatically.
        </div>
      )}

      {/* Search + kind filter */}
      <div className="amen-controls">
        <div className="amen-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            placeholder="Search amenities"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search amenities"
          />
        </div>
        <div className="amen-chips">
          <button className={`amen-chip${kindFilter === 'all' ? ' on' : ''}`} onClick={() => setKindFilter('all')}>
            All
          </button>
          {kinds.map(k => (
            <button key={k} className={`amen-chip${kindFilter === k ? ' on' : ''}`} onClick={() => setKindFilter(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="amen-layout">
        {/* Cards */}
        <div className="amen-main">
          <div className="amen-section-head">Explore amenities</div>
          {filtered.length === 0 ? (
            <div className="amen-empty">No amenities match that search.</div>
          ) : (
            <div className="amen-grid">
              {filtered.map(a => {
                const taken = takenSlots(a.id, todayISO()).size
                const open = a.bookable ? Math.max(0, TIME_SLOTS.length - taken) : 0
                return (
                  <button key={a.id} className="amen-card" onClick={() => setActive(a)}>
                    <div className={`amen-card-art kind-${a.kind}`}>
                      <KindIcon kind={a.kind} />
                    </div>
                    <div className="amen-card-body">
                      <div className="amen-card-top">
                        <span className="amen-card-name">{a.name}</span>
                        <span className={`amen-badge${a.bookable ? '' : ' info'}`}>
                          {a.bookable ? `${open} slots today` : 'Info only'}
                        </span>
                      </div>
                      {a.location && <div className="amen-card-loc">{a.location}</div>}
                      <div className="amen-card-foot">
                        <span className="amen-card-price">{priceLabel(a.priceCents)}</span>
                        <span className="amen-card-cta">{a.bookable ? 'Reserve' : 'Details'} →</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* My Reservations */}
        <aside className="amen-side">
          <div className="amen-side-card">
            <div className="amen-side-head">My reservations</div>
            {upcoming.length === 0 ? (
              <div className="amen-side-empty">
                No reservations yet. Pick an amenity to book your first slot.
              </div>
            ) : (
              <ul className="amen-res-list">
                {upcoming.map(r => {
                  const a = byAmenity[r.amenityId]
                  return (
                    <li key={r.id} className="amen-res">
                      <span className={`amen-res-dot kind-${a?.kind ?? 'other'}`} />
                      <div className="amen-res-body">
                        <div className="amen-res-name">{a?.name ?? 'Amenity'}</div>
                        <div className="amen-res-meta">
                          {fmtDate(r.reservedDate)} · {fmtSlot(r.startTime)}
                          {r.partySize > 1 && <> · {r.partySize} people</>}
                        </div>
                      </div>
                      <button className="amen-res-cancel" onClick={() => cancel(r.id)} aria-label="Cancel reservation">
                        Cancel
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="amen-side-card amen-help">
            <div className="amen-help-title">How booking works</div>
            <p className="amen-help-text">
              Reservations are free and confirm instantly. Book up to one slot at a
              time, and cancel any time from this list.
            </p>
          </div>
        </aside>
      </div>

      {active && (
        <BookDialog
          amenity={active}
          taken={takenSlots(active.id, todayISO())}
          takenForDate={(iso: string) => takenSlots(active.id, iso)}
          onClose={() => setActive(null)}
          onBook={async input => { await book(input); setActive(null) }}
        />
      )}
    </div>
  )
}

function BookDialog({
  amenity, onClose, onBook, takenForDate,
}: {
  amenity: Amenity
  taken: Set<string>
  takenForDate: (iso: string) => Set<string>
  onClose: () => void
  onBook: (input: {
    amenityId: string; reservedDate: string; startTime: string
    endTime?: string; partySize: number; note?: string; priceCents: number
  }) => Promise<void>
}) {
  const [date, setDate] = useState(todayISO())
  const [slot, setSlot] = useState<string>('')
  const [party, setParty] = useState(1)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const taken = takenForDate(date)
  const cap = amenity.capacity ?? 99

  const submit = async () => {
    if (!slot || busy) return
    setBusy(true)
    setErr('')
    try {
      // onBook closes the dialog on success; if it throws (e.g. the DB's
      // unique-slot index rejects a slot another resident just grabbed —
      // their booking is invisible to us under RLS) we keep the dialog open
      // and explain, rather than failing silently.
      await onBook({
        amenityId: amenity.id,
        reservedDate: date,
        startTime: slot,
        partySize: Math.min(Math.max(1, party), cap),
        note: note.trim() || undefined,
        priceCents: amenity.priceCents,
      })
    } catch (e: any) {
      const dup = e?.code === '23505' || /duplicate|unique/i.test(e?.message || '')
      setErr(dup ? 'That slot was just booked by someone else. Pick another time.' : 'Could not book that slot. Please try again.')
      setSlot('')
    } finally {
      setBusy(false)
    }
  }

  const footer = amenity.bookable ? (
    <>
      <button type="button" className="ven-cta-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="ven-cta-primary" onClick={submit} disabled={!slot || busy}>
        {busy ? 'Booking…' : 'Reserve'}
      </button>
    </>
  ) : undefined

  return (
    <DetailDialog
      eyebrow={KIND_LABEL[amenity.kind]}
      title={amenity.name}
      onClose={onClose}
      footer={footer}
    >
      {amenity.description && <p className="amen-dlg-desc">{amenity.description}</p>}

      <div className="amen-dlg-facts">
        {amenity.location && <div><span>Location</span><strong>{amenity.location}</strong></div>}
        {amenity.hours && <div><span>Hours</span><strong>{amenity.hours}</strong></div>}
        {amenity.capacity && <div><span>Capacity</span><strong>{amenity.capacity} people</strong></div>}
        <div><span>Cost</span><strong>{priceLabel(amenity.priceCents)}</strong></div>
      </div>

      {amenity.rules.length > 0 && (
        <div className="amen-dlg-rules">
          <div className="amen-dlg-subhead">Rules</div>
          <ul>{amenity.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      {amenity.bookable ? (
        <div className="amen-book">
          <div className="amen-dlg-subhead">Book a slot</div>
          <div className="amen-book-row">
            <label className="amen-field">
              <span>Date</span>
              <input type="date" min={todayISO()} value={date} onChange={e => { setDate(e.target.value); setSlot('') }} />
            </label>
            <label className="amen-field">
              <span>Party size</span>
              <input type="number" min={1} max={cap} value={party} onChange={e => setParty(Number(e.target.value))} />
            </label>
          </div>

          <div className="amen-field">
            <span>Time</span>
            <div className="amen-slots">
              {TIME_SLOTS.map(t => {
                const isTaken = taken.has(t)
                return (
                  <button
                    key={t}
                    type="button"
                    className={`amen-slot${slot === t ? ' on' : ''}${isTaken ? ' taken' : ''}`}
                    disabled={isTaken}
                    onClick={() => setSlot(t)}
                    title={isTaken ? 'Already booked' : undefined}
                  >
                    {fmtSlot(t)}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="amen-field">
            <span>Note <small>(optional)</small></span>
            <input type="text" placeholder="e.g. Birthday party" value={note} onChange={e => setNote(e.target.value)} />
          </label>

          {err && <div className="amen-book-err" role="alert">{err}</div>}
        </div>
      ) : (
        <div className="amen-dlg-note">This amenity is open access — no reservation needed.</div>
      )}
    </DetailDialog>
  )
}
