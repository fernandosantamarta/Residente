'use client'

import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useState } from 'react'
import {
  AmenityInput,
  AmenityKind,
  KIND_LABEL,
  TIME_SLOTS,
  fmtSlot,
  priceLabel,
  useManageAmenities,
  useAmenityBookings,
} from '@/lib/amenities'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const PAGE_SIZE = 8

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtResDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const KIND_OPTIONS: { value: AmenityKind; label: string }[] = [
  { value: 'clubhouse', label: 'Clubhouse' },
  { value: 'pool',      label: 'Pool' },
  { value: 'gym',       label: 'Fitness' },
  { value: 'court',     label: 'Courts' },
  { value: 'marina',    label: 'Marina' },
  { value: 'other',     label: 'Other' },
]

type FormState = {
  name: string
  kind: AmenityKind
  description: string
  location: string
  capacity: string
  hours: string
  priceDollars: string
  slotMinutes: string
  bookable: boolean
  rules: string   // one rule per line
}

const EMPTY: FormState = {
  name: '', kind: 'clubhouse', description: '', location: '',
  capacity: '', hours: '', priceDollars: '', slotMinutes: '60',
  bookable: true, rules: '',
}

function formToInput(f: FormState): AmenityInput {
  return {
    name: f.name.trim(),
    kind: f.kind,
    description: f.description.trim() || undefined,
    location: f.location.trim() || undefined,
    capacity: f.capacity.trim() ? Math.max(1, Number(f.capacity)) : undefined,
    hours: f.hours.trim() || undefined,
    rules: f.rules.split('\n').map(r => r.trim()).filter(Boolean),
    priceCents: f.priceDollars.trim() ? Math.round(Number(f.priceDollars) * 100) : 0,
    bookable: f.bookable,
    slotMinutes: f.slotMinutes.trim() ? Math.max(15, Number(f.slotMinutes)) : 60,
  }
}

export function AmenitiesAdmin() {
  const { amenities, addAmenity, updateAmenity, removeAmenity, canUseDb } = useManageAmenities()
  const { reservations, residents, cancel: cancelReservation, refund: refundReservation, bookFor, updateReservation } = useAmenityBookings()

  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState('')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [resPage, setResPage] = useState(1)

  // "Book for a resident" form.
  const [bf, setBf] = useState({ residentId: '', amenityId: '', date: todayISO(), slot: '', party: '1', note: '' })
  const [bfErr, setBfErr] = useState('')

  // Inline "edit a reservation" form — opens under the reservation row.
  const [editingResId, setEditingResId] = useState<string | null>(null)
  const [rf, setRf] = useState({ amenityId: '', date: '', slot: '', party: '1', note: '' })
  const [rfErr, setRfErr] = useState('')
  const [savingRes, setSavingRes] = useState(false)

  const amenityName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of amenities) m[a.id] = a.name
    return m
  }, [amenities])
  const bookableAmenities = useMemo(() => amenities.filter(a => a.bookable), [amenities])
  const sortedReservations = useMemo(
    () => [...reservations].sort((a, b) => (a.reservedDate + a.startTime).localeCompare(b.reservedDate + b.startTime)),
    [reservations],
  )

  const submitBookFor = async () => {
    if (!bf.residentId || !bf.amenityId || !bf.slot) { setBfErr('Pick a resident, an amenity, and a time.'); return }
    const am = amenities.find(a => a.id === bf.amenityId)
    try {
      await bookFor({
        profileId: bf.residentId,
        amenityId: bf.amenityId,
        reservedDate: bf.date,
        startTime: bf.slot,
        partySize: Math.max(1, Number(bf.party) || 1),
        note: bf.note.trim() || undefined,
        priceCents: am?.priceCents ?? 0,
      })
      setBf(prev => ({ ...prev, slot: '', note: '' }))
      setBfErr('')
      const who = residents.find(r => r.id === bf.residentId)?.name || 'the resident'
      setSuccessMsg(`Booked ${am?.name || 'amenity'} for ${who}.`)
    } catch (e: any) {
      const dup = e?.code === '23505' || /duplicate|unique/i.test(e?.message || '')
      setBfErr(dup ? 'That slot is already booked. Pick another time.' : (e?.message || 'Could not book that slot.'))
    }
  }

  const startEditRes = (r: typeof reservations[number]) => {
    setEditingResId(r.id)
    setRf({
      amenityId: r.amenityId,
      date:      r.reservedDate,
      slot:      r.startTime,
      party:     String(r.partySize || 1),
      note:      r.note ?? '',
    })
    setRfErr('')
  }
  const cancelEditRes = () => { setEditingResId(null); setRfErr('') }

  const submitEditRes = async (id: string) => {
    if (!rf.amenityId || !rf.slot) { setRfErr('Pick an amenity and a time.'); return }
    setSavingRes(true)
    try {
      await updateReservation(id, {
        amenityId:    rf.amenityId,
        reservedDate: rf.date,
        startTime:    rf.slot,
        partySize:    Math.max(1, Number(rf.party) || 1),
        note:         rf.note.trim() || null,
      })
      setEditingResId(null)
      setRfErr('')
      setSuccessMsg('Reservation updated.')
    } catch (e: any) {
      const dup = e?.code === '23505' || /duplicate|unique/i.test(e?.message || '')
      setRfErr(dup ? 'That slot is already booked. Pick another time.' : (e?.message || 'Could not update the reservation.'))
    } finally {
      setSavingRes(false)
    }
  }

  const onCancelRes = async (id: string, who: string) => {
    if (!window.confirm(`Cancel ${who}'s reservation?`)) return
    try {
      await cancelReservation(id)
      setSuccessMsg('Reservation cancelled.')
    } catch (e: any) {
      setError(e?.message || 'Could not cancel the reservation.')
    }
  }

  // Board override: refund a card-paid booking regardless of the cancellation
  // window (goodwill / past-cutoff). Issues a full Stripe refund.
  const onRefundRes = async (id: string, who: string) => {
    if (!window.confirm(`Refund ${who}'s payment in full? This cannot be undone.`)) return
    try {
      const r = await refundReservation(id)
      if (r.refunded) setSuccessMsg('Refund issued.')
      else setError(r.error || 'Could not issue the refund.')
    } catch (e: any) {
      setError(e?.message || 'Could not issue the refund.')
    }
  }

  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const sorted = useMemo(
    () => [...amenities].sort((a, b) => a.name.localeCompare(b.name)),
    [amenities],
  )

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const startEdit = (id: string) => {
    const a = amenities.find(x => x.id === id)
    if (!a) return
    setEditingId(id)
    setForm({
      name: a.name,
      kind: a.kind,
      description: a.description ?? '',
      location: a.location ?? '',
      capacity: a.capacity != null ? String(a.capacity) : '',
      hours: a.hours ?? '',
      priceDollars: a.priceCents ? String(a.priceCents / 100) : '',
      slotMinutes: String(a.slotMinutes),
      bookable: a.bookable,
      rules: a.rules.join('\n'),
    })
    setError('')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => { setEditingId(null); setForm(EMPTY); setError('') }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    const input = formToInput(form)
    try {
      if (editingId) {
        await updateAmenity(editingId, input)
        setSuccessMsg(`Saved changes to "${input.name}".`)
      } else {
        await addAmenity(input)
        setSuccessMsg(`Added "${input.name}". Residents can book it now.`)
      }
      setForm(EMPTY)
      setEditingId(null)
      setError('')
    } catch (err: any) {
      setError(err?.message || 'Could not save the amenity.')
    }
  }

  const onRemove = async (id: string, name: string) => {
    if (!window.confirm(`Remove "${name}"? It will stop showing for residents. Existing reservations are kept.`)) return
    try {
      await removeAmenity(id)
      if (editingId === id) cancelEdit()
      setSuccessMsg(`Removed "${name}".`)
    } catch (err: any) {
      setError(err?.message || 'Could not remove the amenity.')
    }
  }

  return (
    <div className="admin-schedule">
      <div className="admin-h-wrap">
        <div className="admin-kicker">Amenities</div>
        <h1 className="admin-h1">Bookable amenities</h1>
        <p className="admin-dek">
          Define the amenities residents can reserve. Each one shows on the
          <strong> Amenities</strong> tab of their <strong>Schedule</strong>, with
          your hours and rules. Mark something <em>not</em> bookable to show it as
          an info-only card (no reservations).
        </p>
      </div>

      {!canUseDb && (
        <div className="admin-note admin-note-err">
          Connect to your community to manage amenities. (No Supabase session detected.)
        </div>
      )}
      {error && <div className="admin-note admin-note-err">{error}</div>}
      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {/* ---------- ADD / EDIT ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>{editingId ? 'Edit amenity' : 'Add an amenity'}</h2>
          <span className="admin-sched-card-sub">
            {editingId ? 'Update the details below.' : 'It appears for residents as soon as you save.'}
          </span>
        </div>
        <form className="admin-sched-form" onSubmit={onSubmit}>
          <label className="admin-field">
            <span>Name</span>
            <input type="text" value={form.name} onChange={set('name')} placeholder="e.g. Clubhouse, Resort Pool" required />
          </label>

          <div className="admin-field">
            <span>Kind</span>
            <Dropdown<AmenityKind>
              value={form.kind}
              onChange={v => setForm(prev => ({ ...prev, kind: v }))}
              options={KIND_OPTIONS}
              ariaLabel="Amenity kind"
            />
          </div>

          <label className="admin-field">
            <span>Location <em>(optional)</em></span>
            <input type="text" value={form.location} onChange={set('location')} placeholder="e.g. Main building, Center courtyard" />
          </label>

          <label className="admin-field">
            <span>Hours <em>(optional)</em></span>
            <input type="text" value={form.hours} onChange={set('hours')} placeholder="e.g. Daily 8am–10pm" />
          </label>

          <label className="admin-field">
            <span>Capacity <em>(optional)</em></span>
            <input type="number" min={1} value={form.capacity} onChange={set('capacity')} placeholder="Max party size" />
          </label>

          <label className="admin-field">
            <span>Price per booking <em>(USD, blank = free)</em></span>
            <input type="number" min={0} step="1" value={form.priceDollars} onChange={set('priceDollars')} placeholder="0" />
          </label>

          <label className="admin-field">
            <span>Slot length <em>(minutes)</em></span>
            <input type="number" min={15} step="15" value={form.slotMinutes} onChange={set('slotMinutes')} placeholder="60" />
          </label>

          <label className="admin-field admin-field-check">
            <input type="checkbox" checked={form.bookable} onChange={e => setForm(prev => ({ ...prev, bookable: e.target.checked }))} />
            <span>Residents can reserve this (uncheck for an info-only card)</span>
          </label>

          <label className="admin-field admin-field-wide">
            <span>Description <em>(optional)</em></span>
            <textarea rows={2} value={form.description} onChange={set('description')} placeholder="A short line shown in the booking popup." />
          </label>

          <label className="admin-field admin-field-wide">
            <span>Rules <em>(one per line)</em></span>
            <textarea rows={3} value={form.rules} onChange={set('rules')} placeholder={'Reserve 48 hours ahead\nNo glass containers\nClean up after your event'} />
          </label>

          <div className="admin-sched-form-foot" style={{ display: 'flex', gap: 10 }}>
            <button type="submit" className="admin-primary-btn">
              {editingId ? 'Save changes' : 'Add amenity'}
            </button>
            {editingId && (
              <button type="button" className="admin-btn-ghost" onClick={cancelEdit}>Cancel</button>
            )}
          </div>
        </form>
      </section>

      {/* ---------- LIST ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>Your amenities</h2>
          <span className="admin-sched-card-sub">{amenities.length} total</span>
        </div>
        {amenities.length === 0 ? (
          <div className="admin-sched-empty">No amenities yet. Add one above.</div>
        ) : (
          <>
            <div className="admin-sched-list">
              {paginate(sorted, page, PAGE_SIZE).map(a => (
                <div key={a.id} className="admin-sched-row">
                  <span className={`amen-res-dot kind-${a.kind}`} aria-hidden="true" />
                  <div className="admin-sched-row-body">
                    <div className="admin-sched-row-title">{a.name}</div>
                    <div className="admin-sched-row-meta">
                      {KIND_LABEL[a.kind]}
                      {a.location && <> · {a.location}</>}
                      {a.hours && <> · {a.hours}</>}
                      {a.capacity && <> · up to {a.capacity}</>}
                      {' · '}{priceLabel(a.priceCents)}
                      {!a.bookable && <> · info only</>}
                    </div>
                  </div>
                  <div className="admin-amen-row-actions">
                    <button className="admin-sched-row-del" onClick={() => startEdit(a.id)} aria-label={`Edit ${a.name}`}>Edit</button>
                    <button className="admin-sched-row-del" onClick={() => onRemove(a.id, a.name)} aria-label={`Remove ${a.name}`}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={sorted.length} onPageChange={setPage} />
          </>
        )}
      </section>

      {/* ---------- BOOK FOR A RESIDENT ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>Book for a resident</h2>
          <span className="admin-sched-card-sub">Front-desk or phone request — reserve a slot on their behalf.</span>
        </div>
        {bookableAmenities.length === 0 ? (
          <div className="admin-sched-empty">Add a bookable amenity above first.</div>
        ) : (
          <div className="admin-sched-form">
            <div className="admin-field">
              <span>Resident</span>
              <Dropdown<string>
                value={bf.residentId}
                onChange={v => setBf(prev => ({ ...prev, residentId: v }))}
                ariaLabel="Resident"
                options={[{ value: '', label: 'Select a resident…' }, ...residents.map(r => ({ value: r.id, label: r.name }))]}
              />
            </div>
            <div className="admin-field">
              <span>Amenity</span>
              <Dropdown<string>
                value={bf.amenityId}
                onChange={v => setBf(prev => ({ ...prev, amenityId: v }))}
                ariaLabel="Amenity"
                options={[{ value: '', label: 'Select an amenity…' }, ...bookableAmenities.map(a => ({ value: a.id, label: a.name }))]}
              />
            </div>
            <label className="admin-field">
              <span>Date</span>
              <input type="date" min={todayISO()} value={bf.date} onChange={e => setBf(prev => ({ ...prev, date: e.target.value }))} />
            </label>
            <div className="admin-field">
              <span>Time</span>
              <Dropdown<string>
                value={bf.slot}
                onChange={v => setBf(prev => ({ ...prev, slot: v }))}
                ariaLabel="Time"
                options={[{ value: '', label: 'Select a time…' }, ...TIME_SLOTS.map(t => ({ value: t, label: fmtSlot(t) }))]}
              />
            </div>
            <label className="admin-field">
              <span>Party size</span>
              <input type="number" min={1} value={bf.party} onChange={e => setBf(prev => ({ ...prev, party: e.target.value }))} />
            </label>
            <label className="admin-field">
              <span>Note <em>(optional)</em></span>
              <input type="text" value={bf.note} onChange={e => setBf(prev => ({ ...prev, note: e.target.value }))} placeholder="e.g. Birthday party" />
            </label>
            {bfErr && <div className="admin-field-wide"><div className="admin-note admin-note-err">{bfErr}</div></div>}
            <div className="admin-sched-form-foot">
              <button type="button" className="admin-primary-btn" onClick={submitBookFor}>Book reservation</button>
            </div>
          </div>
        )}
      </section>

      {/* ---------- UPCOMING RESERVATIONS ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>Reservations</h2>
          <span className="admin-sched-card-sub">{reservations.length} active — who&rsquo;s booked what.</span>
        </div>
        {reservations.length === 0 ? (
          <div className="admin-sched-empty">No reservations yet.</div>
        ) : (
          <>
            <div className="admin-sched-list">
              {paginate(sortedReservations, resPage, PAGE_SIZE).map(r => (
                <Fragment key={r.id}>
                <div className="admin-sched-row">
                  <div className="admin-sched-row-body">
                    <div className="admin-sched-row-title">
                      {r.residentName} · {amenityName[r.amenityId] || 'Amenity'}
                      {r.paymentStatus === 'paid' && r.refundStatus === 'none' && <span className="amen-pay-tag paid">Paid</span>}
                      {r.paymentStatus === 'pending' && <span className="amen-pay-tag pending">Payment pending</span>}
                      {r.refundStatus === 'refunded' && <span className="amen-pay-tag refunded">Refunded</span>}
                      {r.refundStatus === 'failed' && <span className="amen-pay-tag failed">Refund failed</span>}
                    </div>
                    <div className="admin-sched-row-meta">
                      {fmtResDate(r.reservedDate)} · {fmtSlot(r.startTime)}
                      {r.partySize > 1 && <> · {r.partySize} people</>}
                      {r.note && <> · “{r.note}”</>}
                    </div>
                  </div>
                  <div className="admin-sched-row-actions">
                    <button
                      className="admin-btn-ghost"
                      onClick={() => (editingResId === r.id ? cancelEditRes() : startEditRes(r))}
                      aria-label={`Edit ${r.residentName}'s reservation`}
                    >
                      {editingResId === r.id ? 'Close' : 'Edit'}
                    </button>
                    {(r.paymentStatus === 'paid' && (r.refundStatus === 'none' || r.refundStatus === 'failed')) && (
                      <button
                        className="admin-btn-ghost"
                        onClick={() => onRefundRes(r.id, r.residentName)}
                        aria-label={`Refund ${r.residentName}'s payment`}
                      >
                        Refund
                      </button>
                    )}
                    <button
                      className="admin-sched-row-del"
                      onClick={() => onCancelRes(r.id, r.residentName)}
                      aria-label={`Cancel ${r.residentName}'s reservation`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                {editingResId === r.id && (
                  <div style={{ padding: '4px 8px 16px', borderTop: '1px solid rgba(15, 28, 46, 0.08)' }}>
                    <div className="admin-sched-form">
                      <div className="admin-field">
                        <span>Amenity</span>
                        <Dropdown<string>
                          value={rf.amenityId}
                          onChange={v => setRf(prev => ({ ...prev, amenityId: v }))}
                          ariaLabel="Amenity"
                          options={sorted.map(a => ({ value: a.id, label: a.name }))}
                        />
                      </div>
                      <label className="admin-field">
                        <span>Date</span>
                        <input type="date" value={rf.date} onChange={e => setRf(prev => ({ ...prev, date: e.target.value }))} />
                      </label>
                      <div className="admin-field">
                        <span>Time</span>
                        <Dropdown<string>
                          value={rf.slot}
                          onChange={v => setRf(prev => ({ ...prev, slot: v }))}
                          ariaLabel="Time"
                          options={[{ value: '', label: 'Select a time…' }, ...TIME_SLOTS.map(t => ({ value: t, label: fmtSlot(t) }))]}
                        />
                      </div>
                      <label className="admin-field">
                        <span>Party size</span>
                        <input type="number" min={1} value={rf.party} onChange={e => setRf(prev => ({ ...prev, party: e.target.value }))} />
                      </label>
                      <label className="admin-field admin-field-wide">
                        <span>Note <em>(optional)</em></span>
                        <input type="text" value={rf.note} onChange={e => setRf(prev => ({ ...prev, note: e.target.value }))} placeholder="e.g. Birthday party" />
                      </label>
                      {rfErr && <div className="admin-field-wide"><div className="admin-note admin-note-err">{rfErr}</div></div>}
                      <div className="admin-sched-form-foot" style={{ display: 'flex', gap: 10 }}>
                        <button type="button" className="admin-primary-btn" onClick={() => submitEditRes(r.id)} disabled={savingRes}>
                          {savingRes ? 'Saving…' : 'Save changes'}
                        </button>
                        <button type="button" className="admin-btn-ghost" onClick={cancelEditRes}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
                </Fragment>
              ))}
            </div>
            <Pagination page={resPage} pageSize={PAGE_SIZE} total={sortedReservations.length} onPageChange={setResPage} />
          </>
        )}
      </section>
    </div>
  )
}
