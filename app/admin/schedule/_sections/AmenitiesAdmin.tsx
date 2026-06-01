'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import {
  AmenityInput,
  AmenityKind,
  KIND_LABEL,
  priceLabel,
  useManageAmenities,
} from '@/lib/amenities'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const PAGE_SIZE = 8

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

  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState('')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

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
    </div>
  )
}
