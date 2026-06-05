'use client'

import { useEffect, useMemo, useState } from 'react'
import { DetailDialog } from '@/app/app/track/_sections/DetailDialog'
import { useT } from '@/lib/i18n'
import {
  Amenity,
  AmenityKind,
  KIND_LABEL,
  TIME_SLOTS,
  fmtSlot,
  priceLabel,
  useAmenityHub,
  withinRefundWindow,
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
  const t = useT()
  const { amenities, reservations, byAmenity, live, book, cancel, takenSlots, refundCutoffHours } = useAmenityHub()

  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<AmenityKind | 'all'>('all')
  const [active, setActive] = useState<Amenity | null>(null)
  // Returned from Stripe checkout — confirm, then strip the query param so a
  // refresh doesn't re-show it. The 'paid' badge arrives via realtime.
  const [justPaid, setJustPaid] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('amenity_paid') === '1') {
      setJustPaid(true)
      params.delete('amenity_paid')
      const qs = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
    }
  }, [])

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
      {justPaid && (
        <div className="amen-paid-note" role="status">
          {t('schedule.amenPaidNote')}
        </div>
      )}
      {!live && (
        <div className="amen-demo-note">
          {t('schedule.amenDemoNote')}
        </div>
      )}

      {/* Search + kind filter */}
      <div className="amen-controls">
        <div className="amen-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            placeholder={t('schedule.searchAmenities')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label={t('schedule.searchAmenities')}
          />
        </div>
        <div className="amen-chips">
          <button className={`amen-chip${kindFilter === 'all' ? ' on' : ''}`} onClick={() => setKindFilter('all')}>
            {t('schedule.all')}
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
          <div className="amen-section-head">{t('schedule.exploreAmenities')}</div>
          {filtered.length === 0 ? (
            <div className="amen-empty">{t('schedule.noAmenitiesMatch')}</div>
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
                          {a.bookable ? t('schedule.slotsToday', { count: open }) : t('schedule.infoOnly')}
                        </span>
                      </div>
                      {a.location && <div className="amen-card-loc">{a.location}</div>}
                      <div className="amen-card-foot">
                        <span className="amen-card-price">{priceLabel(a.priceCents)}</span>
                        <span className="amen-card-cta">{a.bookable ? t('schedule.reserve') : t('schedule.details')} →</span>
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
            <div className="amen-side-head">{t('schedule.myReservations')}</div>
            {upcoming.length === 0 ? (
              <div className="amen-side-empty">
                {t('schedule.noReservationsYet')}
              </div>
            ) : (
              <ul className="amen-res-list">
                {upcoming.map(r => {
                  const a = byAmenity[r.amenityId]
                  // A card-paid booking still inside the window refunds on cancel;
                  // past the window it just frees the slot (board can refund).
                  const refundable = r.paymentStatus === 'paid' && r.refundStatus === 'none'
                  const inWindow = refundable && withinRefundWindow(r, refundCutoffHours)
                  const cancelLabel = !refundable
                    ? t('schedule.cancel')
                    : inWindow
                      ? t('schedule.cancelRefund')
                      : t('schedule.cancelNoRefund', { hours: refundCutoffHours })
                  return (
                    <li key={r.id} className="amen-res">
                      <span className={`amen-res-dot kind-${a?.kind ?? 'other'}`} />
                      <div className="amen-res-body">
                        <div className="amen-res-name">
                          {a?.name ?? t('schedule.amenity')}
                          {r.paymentStatus === 'paid' && r.refundStatus === 'none' && <span className="amen-pay-tag paid">{t('schedule.paid')}</span>}
                          {r.paymentStatus === 'pending' && <span className="amen-pay-tag pending">{t('schedule.paymentPending')}</span>}
                          {r.refundStatus === 'refunded' && <span className="amen-pay-tag refunded">{t('schedule.refunded')}</span>}
                          {r.refundStatus === 'pending' && <span className="amen-pay-tag pending">{t('schedule.refundPending')}</span>}
                          {r.refundStatus === 'failed' && <span className="amen-pay-tag failed">{t('schedule.refundFailed')}</span>}
                        </div>
                        <div className="amen-res-meta">
                          {fmtDate(r.reservedDate)} · {fmtSlot(r.startTime)}
                          {r.partySize > 1 && <> · {t('schedule.peopleCount', { count: r.partySize })}</>}
                        </div>
                      </div>
                      <button className="amen-res-cancel" onClick={() => cancel(r.id)} aria-label={t('schedule.cancelReservation')}>
                        {cancelLabel}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="amen-side-card amen-help">
            <div className="amen-help-title">{t('schedule.howBookingWorks')}</div>
            <p className="amen-help-text">
              {t('schedule.howBookingWorksBody')}
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
  const t = useT()
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
      setErr(dup ? t('schedule.slotJustBooked') : t('schedule.bookFailed'))
      setSlot('')
    } finally {
      setBusy(false)
    }
  }

  const footer = amenity.bookable ? (
    <>
      <button type="button" className="ven-cta-secondary" onClick={onClose}>{t('schedule.cancel')}</button>
      <button type="button" className="ven-cta-primary" onClick={submit} disabled={!slot || busy}>
        {busy ? t('schedule.booking') : amenity.priceCents > 0 ? `${t('schedule.reserve')} · ${priceLabel(amenity.priceCents)}` : t('schedule.reserve')}
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
        {amenity.location && <div><span>{t('schedule.location')}</span><strong>{amenity.location}</strong></div>}
        {amenity.hours && <div><span>{t('schedule.hours')}</span><strong>{amenity.hours}</strong></div>}
        {amenity.capacity && <div><span>{t('schedule.capacity')}</span><strong>{t('schedule.peopleCount', { count: amenity.capacity })}</strong></div>}
        <div><span>{t('schedule.cost')}</span><strong>{priceLabel(amenity.priceCents)}</strong></div>
      </div>

      {amenity.rules.length > 0 && (
        <div className="amen-dlg-rules">
          <div className="amen-dlg-subhead">{t('schedule.rules')}</div>
          <ul>{amenity.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      {amenity.bookable ? (
        <div className="amen-book">
          <div className="amen-dlg-subhead">{t('schedule.bookASlot')}</div>
          <div className="amen-book-row">
            <label className="amen-field">
              <span>{t('schedule.date')}</span>
              <input type="date" min={todayISO()} value={date} onChange={e => { setDate(e.target.value); setSlot('') }} />
            </label>
            <label className="amen-field">
              <span>{t('schedule.partySize')}</span>
              <input type="number" min={1} max={cap} value={party} onChange={e => setParty(Number(e.target.value))} />
            </label>
          </div>

          <div className="amen-field">
            <span>{t('schedule.time')}</span>
            <div className="amen-slots">
              {TIME_SLOTS.map(slotTime => {
                const isTaken = taken.has(slotTime)
                return (
                  <button
                    key={slotTime}
                    type="button"
                    className={`amen-slot${slot === slotTime ? ' on' : ''}${isTaken ? ' taken' : ''}`}
                    disabled={isTaken}
                    onClick={() => setSlot(slotTime)}
                    title={isTaken ? t('schedule.alreadyBooked') : undefined}
                  >
                    {fmtSlot(slotTime)}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="amen-field">
            <span>{t('schedule.note')} <small>{t('schedule.optional')}</small></span>
            <input type="text" placeholder={t('schedule.notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />
          </label>

          {err && <div className="amen-book-err" role="alert">{err}</div>}
        </div>
      ) : (
        <div className="amen-dlg-note">{t('schedule.openAccessNote')}</div>
      )}
    </DetailDialog>
  )
}
