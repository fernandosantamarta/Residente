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
import { useT } from '@/lib/i18n'

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
  const t = useT()
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
    if (!bf.residentId || !bf.amenityId || !bf.slot) { setBfErr(t('admin.scheduleAmenitiesAdmin.errPickResidentAmenityTime')); return }
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
      const who = residents.find(r => r.id === bf.residentId)?.name || t('admin.scheduleAmenitiesAdmin.theResident')
      setSuccessMsg(t('admin.scheduleAmenitiesAdmin.successBooked', { amenity: am?.name || t('admin.scheduleAmenitiesAdmin.amenity'), who }))
    } catch (e: any) {
      const dup = e?.code === '23505' || /duplicate|unique/i.test(e?.message || '')
      setBfErr(dup ? t('admin.scheduleAmenitiesAdmin.errSlotAlreadyBooked') : (e?.message || t('admin.scheduleAmenitiesAdmin.errCouldNotBook')))
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
    if (!rf.amenityId || !rf.slot) { setRfErr(t('admin.scheduleAmenitiesAdmin.errPickAmenityTime')); return }
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
      setSuccessMsg(t('admin.scheduleAmenitiesAdmin.successResUpdated'))
    } catch (e: any) {
      const dup = e?.code === '23505' || /duplicate|unique/i.test(e?.message || '')
      setRfErr(dup ? t('admin.scheduleAmenitiesAdmin.errSlotAlreadyBooked') : (e?.message || t('admin.scheduleAmenitiesAdmin.errCouldNotUpdateRes')))
    } finally {
      setSavingRes(false)
    }
  }

  const onCancelRes = async (id: string, who: string) => {
    if (!window.confirm(t('admin.scheduleAmenitiesAdmin.confirmCancelRes', { who }))) return
    try {
      await cancelReservation(id)
      setSuccessMsg(t('admin.scheduleAmenitiesAdmin.successResCancelled'))
    } catch (e: any) {
      setError(e?.message || t('admin.scheduleAmenitiesAdmin.errCouldNotCancelRes'))
    }
  }

  // Board override: refund a card-paid booking regardless of the cancellation
  // window (goodwill / past-cutoff). Issues a full Stripe refund.
  const onRefundRes = async (id: string, who: string) => {
    if (!window.confirm(t('admin.scheduleAmenitiesAdmin.confirmRefund', { who }))) return
    try {
      const r = await refundReservation(id)
      if (r.refunded) setSuccessMsg(t('admin.scheduleAmenitiesAdmin.successRefundIssued'))
      else setError(r.error || t('admin.scheduleAmenitiesAdmin.errCouldNotRefund'))
    } catch (e: any) {
      setError(e?.message || t('admin.scheduleAmenitiesAdmin.errCouldNotRefund'))
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
    if (!form.name.trim()) { setError(t('admin.scheduleAmenitiesAdmin.errNameRequired')); return }
    const input = formToInput(form)
    try {
      if (editingId) {
        await updateAmenity(editingId, input)
        setSuccessMsg(t('admin.scheduleAmenitiesAdmin.successSavedChanges', { name: input.name }))
      } else {
        await addAmenity(input)
        setSuccessMsg(t('admin.scheduleAmenitiesAdmin.successAdded', { name: input.name }))
      }
      setForm(EMPTY)
      setEditingId(null)
      setError('')
    } catch (err: any) {
      setError(err?.message || t('admin.scheduleAmenitiesAdmin.errCouldNotSave'))
    }
  }

  const onRemove = async (id: string, name: string) => {
    if (!window.confirm(t('admin.scheduleAmenitiesAdmin.confirmRemove', { name }))) return
    try {
      await removeAmenity(id)
      if (editingId === id) cancelEdit()
      setSuccessMsg(t('admin.scheduleAmenitiesAdmin.successRemoved', { name }))
    } catch (err: any) {
      setError(err?.message || t('admin.scheduleAmenitiesAdmin.errCouldNotRemove'))
    }
  }

  return (
    <div className="admin-schedule">
      <div className="admin-h-wrap">
        <div className="admin-kicker">{t('admin.scheduleAmenitiesAdmin.kicker')}</div>
        <h1 className="admin-h1">{t('admin.scheduleAmenitiesAdmin.pageTitle')}</h1>
        <p className="admin-dek">
          {t('admin.scheduleAmenitiesAdmin.dekPart1')}
          <strong> {t('admin.scheduleAmenitiesAdmin.dekAmenitiesWord')}</strong>{t('admin.scheduleAmenitiesAdmin.dekPart2')}<strong>{t('admin.scheduleAmenitiesAdmin.dekScheduleWord')}</strong>{t('admin.scheduleAmenitiesAdmin.dekPart3')}<em>{t('admin.scheduleAmenitiesAdmin.dekNotWord')}</em>{t('admin.scheduleAmenitiesAdmin.dekPart4')}
        </p>
      </div>

      {!canUseDb && (
        <div className="admin-note admin-note-err">
          {t('admin.scheduleAmenitiesAdmin.noDbNote')}
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
          <h2>{editingId ? t('admin.scheduleAmenitiesAdmin.editAmenityTitle') : t('admin.scheduleAmenitiesAdmin.addAmenityTitle')}</h2>
          <span className="admin-sched-card-sub">
            {editingId ? t('admin.scheduleAmenitiesAdmin.editAmenitySub') : t('admin.scheduleAmenitiesAdmin.addAmenitySub')}
          </span>
        </div>
        <form className="admin-sched-form" onSubmit={onSubmit}>
          <label className="admin-field">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldName')}</span>
            <input type="text" value={form.name} onChange={set('name')} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderName')} required />
          </label>

          <div className="admin-field">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldKind')}</span>
            <Dropdown<AmenityKind>
              value={form.kind}
              onChange={v => setForm(prev => ({ ...prev, kind: v }))}
              options={KIND_OPTIONS}
              ariaLabel={t('admin.scheduleAmenitiesAdmin.ariaAmenityKind')}
            />
          </div>

          <label className="admin-field">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldLocation')} <em>({t('admin.scheduleAmenitiesAdmin.optional')})</em></span>
            <input type="text" value={form.location} onChange={set('location')} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderLocation')} />
          </label>

          <label className="admin-field">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldHours')} <em>({t('admin.scheduleAmenitiesAdmin.optional')})</em></span>
            <input type="text" value={form.hours} onChange={set('hours')} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderHours')} />
          </label>

          <label className="admin-field">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldCapacity')} <em>({t('admin.scheduleAmenitiesAdmin.optional')})</em></span>
            <input type="number" min={1} value={form.capacity} onChange={set('capacity')} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderCapacity')} />
          </label>

          <label className="admin-field">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldPrice')} <em>({t('admin.scheduleAmenitiesAdmin.fieldPriceNote')})</em></span>
            <input type="number" min={0} step="1" value={form.priceDollars} onChange={set('priceDollars')} placeholder="0" />
          </label>

          <label className="admin-field">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldSlotLength')} <em>({t('admin.scheduleAmenitiesAdmin.minutes')})</em></span>
            <input type="number" min={15} step="15" value={form.slotMinutes} onChange={set('slotMinutes')} placeholder="60" />
          </label>

          <label className="admin-field admin-field-check">
            <input type="checkbox" checked={form.bookable} onChange={e => setForm(prev => ({ ...prev, bookable: e.target.checked }))} />
            <span>{t('admin.scheduleAmenitiesAdmin.checkBookable')}</span>
          </label>

          <label className="admin-field admin-field-wide">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldDescription')} <em>({t('admin.scheduleAmenitiesAdmin.optional')})</em></span>
            <textarea rows={2} value={form.description} onChange={set('description')} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderDescription')} />
          </label>

          <label className="admin-field admin-field-wide">
            <span>{t('admin.scheduleAmenitiesAdmin.fieldRules')} <em>({t('admin.scheduleAmenitiesAdmin.onePerLine')})</em></span>
            <textarea rows={3} value={form.rules} onChange={set('rules')} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderRules')} />
          </label>

          <div className="admin-sched-form-foot" style={{ display: 'flex', gap: 10 }}>
            <button type="submit" className="admin-primary-btn">
              {editingId ? t('admin.scheduleAmenitiesAdmin.btnSaveChanges') : t('admin.scheduleAmenitiesAdmin.btnAddAmenity')}
            </button>
            {editingId && (
              <button type="button" className="admin-btn-ghost" onClick={cancelEdit}>{t('admin.scheduleAmenitiesAdmin.btnCancel')}</button>
            )}
          </div>
        </form>
      </section>

      {/* ---------- LIST ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>{t('admin.scheduleAmenitiesAdmin.yourAmenitiesTitle')}</h2>
          <span className="admin-sched-card-sub">{t('admin.scheduleAmenitiesAdmin.totalCount', { count: amenities.length })}</span>
        </div>
        {amenities.length === 0 ? (
          <div className="admin-sched-empty">{t('admin.scheduleAmenitiesAdmin.emptyAmenities')}</div>
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
                      {a.capacity && <> · {t('admin.scheduleAmenitiesAdmin.upTo', { count: a.capacity })}</>}
                      {' · '}{priceLabel(a.priceCents)}
                      {!a.bookable && <> · {t('admin.scheduleAmenitiesAdmin.infoOnly')}</>}
                    </div>
                  </div>
                  <div className="admin-amen-row-actions">
                    <button className="admin-sched-row-edit" onClick={() => startEdit(a.id)} aria-label={t('admin.scheduleAmenitiesAdmin.ariaEditAmenity', { name: a.name })}>{t('admin.scheduleAmenitiesAdmin.btnEdit')}</button>
                    <button className="admin-sched-row-del" onClick={() => onRemove(a.id, a.name)} aria-label={t('admin.scheduleAmenitiesAdmin.ariaRemoveAmenity', { name: a.name })}>{t('admin.scheduleAmenitiesAdmin.btnRemove')}</button>
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
          <h2>{t('admin.scheduleAmenitiesAdmin.bookForResidentTitle')}</h2>
          <span className="admin-sched-card-sub">{t('admin.scheduleAmenitiesAdmin.bookForResidentSub')}</span>
        </div>
        {bookableAmenities.length === 0 ? (
          <div className="admin-sched-empty">{t('admin.scheduleAmenitiesAdmin.emptyBookable')}</div>
        ) : (
          <div className="admin-sched-form">
            <div className="admin-field">
              <span>{t('admin.scheduleAmenitiesAdmin.fieldResident')}</span>
              <Dropdown<string>
                value={bf.residentId}
                onChange={v => setBf(prev => ({ ...prev, residentId: v }))}
                ariaLabel={t('admin.scheduleAmenitiesAdmin.fieldResident')}
                options={[{ value: '', label: t('admin.scheduleAmenitiesAdmin.selectResident') }, ...residents.map(r => ({ value: r.id, label: r.name }))]}
              />
            </div>
            <div className="admin-field">
              <span>{t('admin.scheduleAmenitiesAdmin.fieldAmenity')}</span>
              <Dropdown<string>
                value={bf.amenityId}
                onChange={v => setBf(prev => ({ ...prev, amenityId: v }))}
                ariaLabel={t('admin.scheduleAmenitiesAdmin.fieldAmenity')}
                options={[{ value: '', label: t('admin.scheduleAmenitiesAdmin.selectAmenity') }, ...bookableAmenities.map(a => ({ value: a.id, label: a.name }))]}
              />
            </div>
            <label className="admin-field">
              <span>{t('admin.scheduleAmenitiesAdmin.fieldDate')}</span>
              <input type="date" min={todayISO()} value={bf.date} onChange={e => setBf(prev => ({ ...prev, date: e.target.value }))} />
            </label>
            <div className="admin-field">
              <span>{t('admin.scheduleAmenitiesAdmin.fieldTime')}</span>
              <Dropdown<string>
                value={bf.slot}
                onChange={v => setBf(prev => ({ ...prev, slot: v }))}
                ariaLabel={t('admin.scheduleAmenitiesAdmin.fieldTime')}
                options={[{ value: '', label: t('admin.scheduleAmenitiesAdmin.selectTime') }, ...TIME_SLOTS.map(ts => ({ value: ts, label: fmtSlot(ts) }))]}
              />
            </div>
            <label className="admin-field">
              <span>{t('admin.scheduleAmenitiesAdmin.fieldPartySize')}</span>
              <input type="number" min={1} value={bf.party} onChange={e => setBf(prev => ({ ...prev, party: e.target.value }))} />
            </label>
            <label className="admin-field">
              <span>{t('admin.scheduleAmenitiesAdmin.fieldNote')} <em>({t('admin.scheduleAmenitiesAdmin.optional')})</em></span>
              <input type="text" value={bf.note} onChange={e => setBf(prev => ({ ...prev, note: e.target.value }))} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderNote')} />
            </label>
            {bfErr && <div className="admin-field-wide"><div className="admin-note admin-note-err">{bfErr}</div></div>}
            <div className="admin-sched-form-foot">
              <button type="button" className="admin-primary-btn" onClick={submitBookFor}>{t('admin.scheduleAmenitiesAdmin.btnBookReservation')}</button>
            </div>
          </div>
        )}
      </section>

      {/* ---------- UPCOMING RESERVATIONS ---------- */}
      <section className="admin-sched-card">
        <div className="admin-sched-card-head">
          <h2>{t('admin.scheduleAmenitiesAdmin.reservationsTitle')}</h2>
          <span className="admin-sched-card-sub">{t('admin.scheduleAmenitiesAdmin.reservationsSub', { count: reservations.length })}</span>
        </div>
        {reservations.length === 0 ? (
          <div className="admin-sched-empty">{t('admin.scheduleAmenitiesAdmin.emptyReservations')}</div>
        ) : (
          <>
            <div className="admin-sched-list">
              {paginate(sortedReservations, resPage, PAGE_SIZE).map(r => (
                <Fragment key={r.id}>
                <div className="admin-sched-row">
                  <div className="admin-sched-row-body">
                    <div className="admin-sched-row-title">
                      {r.residentName} · {amenityName[r.amenityId] || t('admin.scheduleAmenitiesAdmin.amenity')}
                      {r.paymentStatus === 'paid' && r.refundStatus === 'none' && <span className="amen-pay-tag paid">{t('admin.scheduleAmenitiesAdmin.tagPaid')}</span>}
                      {r.paymentStatus === 'pending' && <span className="amen-pay-tag pending">{t('admin.scheduleAmenitiesAdmin.tagPaymentPending')}</span>}
                      {r.refundStatus === 'refunded' && <span className="amen-pay-tag refunded">{t('admin.scheduleAmenitiesAdmin.tagRefunded')}</span>}
                      {r.refundStatus === 'failed' && <span className="amen-pay-tag failed">{t('admin.scheduleAmenitiesAdmin.tagRefundFailed')}</span>}
                    </div>
                    <div className="admin-sched-row-meta">
                      {fmtResDate(r.reservedDate)} · {fmtSlot(r.startTime)}
                      {r.partySize > 1 && <> · {t('admin.scheduleAmenitiesAdmin.people', { count: r.partySize })}</>}
                      {r.note && <> · "{r.note}"</>}
                    </div>
                  </div>
                  <div className="admin-sched-row-actions">
                    <button
                      className="admin-btn-ghost"
                      onClick={() => (editingResId === r.id ? cancelEditRes() : startEditRes(r))}
                      aria-label={t('admin.scheduleAmenitiesAdmin.ariaEditReservation', { who: r.residentName })}
                    >
                      {editingResId === r.id ? t('admin.scheduleAmenitiesAdmin.btnClose') : t('admin.scheduleAmenitiesAdmin.btnEdit')}
                    </button>
                    {(r.paymentStatus === 'paid' && (r.refundStatus === 'none' || r.refundStatus === 'failed')) && (
                      <button
                        className="admin-btn-ghost"
                        onClick={() => onRefundRes(r.id, r.residentName)}
                        aria-label={t('admin.scheduleAmenitiesAdmin.ariaRefundPayment', { who: r.residentName })}
                      >
                        {t('admin.scheduleAmenitiesAdmin.btnRefund')}
                      </button>
                    )}
                    <button
                      className="admin-sched-row-del"
                      onClick={() => onCancelRes(r.id, r.residentName)}
                      aria-label={t('admin.scheduleAmenitiesAdmin.ariaCancelReservation', { who: r.residentName })}
                    >
                      {t('admin.scheduleAmenitiesAdmin.btnCancelRes')}
                    </button>
                  </div>
                </div>

                {editingResId === r.id && (
                  <div style={{ padding: '4px 8px 16px', borderTop: '1px solid rgba(15, 28, 46, 0.08)' }}>
                    <div className="admin-sched-form">
                      <div className="admin-field">
                        <span>{t('admin.scheduleAmenitiesAdmin.fieldAmenity')}</span>
                        <Dropdown<string>
                          value={rf.amenityId}
                          onChange={v => setRf(prev => ({ ...prev, amenityId: v }))}
                          ariaLabel={t('admin.scheduleAmenitiesAdmin.fieldAmenity')}
                          options={sorted.map(a => ({ value: a.id, label: a.name }))}
                        />
                      </div>
                      <label className="admin-field">
                        <span>{t('admin.scheduleAmenitiesAdmin.fieldDate')}</span>
                        <input type="date" value={rf.date} onChange={e => setRf(prev => ({ ...prev, date: e.target.value }))} />
                      </label>
                      <div className="admin-field">
                        <span>{t('admin.scheduleAmenitiesAdmin.fieldTime')}</span>
                        <Dropdown<string>
                          value={rf.slot}
                          onChange={v => setRf(prev => ({ ...prev, slot: v }))}
                          ariaLabel={t('admin.scheduleAmenitiesAdmin.fieldTime')}
                          options={[{ value: '', label: t('admin.scheduleAmenitiesAdmin.selectTime') }, ...TIME_SLOTS.map(ts => ({ value: ts, label: fmtSlot(ts) }))]}
                        />
                      </div>
                      <label className="admin-field">
                        <span>{t('admin.scheduleAmenitiesAdmin.fieldPartySize')}</span>
                        <input type="number" min={1} value={rf.party} onChange={e => setRf(prev => ({ ...prev, party: e.target.value }))} />
                      </label>
                      <label className="admin-field admin-field-wide">
                        <span>{t('admin.scheduleAmenitiesAdmin.fieldNote')} <em>({t('admin.scheduleAmenitiesAdmin.optional')})</em></span>
                        <input type="text" value={rf.note} onChange={e => setRf(prev => ({ ...prev, note: e.target.value }))} placeholder={t('admin.scheduleAmenitiesAdmin.placeholderNote')} />
                      </label>
                      {rfErr && <div className="admin-field-wide"><div className="admin-note admin-note-err">{rfErr}</div></div>}
                      <div className="admin-sched-form-foot" style={{ display: 'flex', gap: 10 }}>
                        <button type="button" className="admin-primary-btn" onClick={() => submitEditRes(r.id)} disabled={savingRes}>
                          {savingRes ? t('admin.scheduleAmenitiesAdmin.btnSaving') : t('admin.scheduleAmenitiesAdmin.btnSaveChanges')}
                        </button>
                        <button type="button" className="admin-btn-ghost" onClick={cancelEditRes}>{t('admin.scheduleAmenitiesAdmin.btnCancel')}</button>
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
