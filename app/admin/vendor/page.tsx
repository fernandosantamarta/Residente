'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const VENDOR_PAGE_SIZE = 8

const withTimeout = <T,>(p: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

type VendorCat = 'property' | 'cleaning' | 'security' | 'plumbing' | 'electrical' | 'hvac'

const CATS: { value: VendorCat; label: string }[] = [
  { value: 'property',   label: 'Property Maintenance' },
  { value: 'cleaning',   label: 'Cleaning' },
  { value: 'security',   label: 'Security' },
  { value: 'plumbing',   label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac',       label: 'HVAC' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))

const fmtPubDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

const EMPTY = {
  name: '', category: 'property' as VendorCat,
  phone: '', email: '', blurb: '', badge: '', featured: false,
}

type Vendor = {
  id: string
  name: string
  category: string
  phone: string | null
  email: string | null
  blurb: string | null
  badge: string | null
  featured: boolean
  created_at?: string
}

// Admin → Vendors. Board curates the trusted-provider list; every vendor
// shows on each resident's Vendors page (/app/vendor), grouped by category.
export default function VendorAdmin() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<Vendor[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [filterCategory, setFilterCategory] = useState<'all' | VendorCat>('all')
  const [page, setPage] = useState(1)

  // Auto-dismiss the green confirmation banner after 4 seconds.
  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase!.from('vendors').select('*')
          .eq('community_id', communityId)
          .order('featured', { ascending: false })
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      setRows((data as Vendor[]) || [])
      setStatus('ready')
    } catch (err: any) {
      const msg = err?.message || ''
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setStatus('none')
      } else {
        setError(msg || 'Could not load vendors')
        setStatus('error')
      }
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setField = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Give the vendor a name'); return }
    setSaving(true); setError('')
    try {
      const row = {
        community_id: communityId,
        name: form.name.trim(),
        category: form.category,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        blurb: form.blurb.trim() || null,
        badge: form.badge.trim() || null,
        featured: form.featured,
        sort_order: rows.length,
      }
      const { data, error } = await withTimeout(
        supabase!.from('vendors').insert(row).select().single()
      )
      if (error) throw error
      setRows(rs => [data as Vendor, ...rs])
      setForm(EMPTY)
      setSuccessMsg(`Added "${row.name}" to the vendor list.`)
    } catch (err: any) {
      setError(err?.message || 'Could not add the vendor')
    } finally {
      setSaving(false)
    }
  }

  const toggleFeatured = async (v: Vendor) => {
    const next = !v.featured
    setRows(rs => rs.map(r => r.id === v.id ? { ...r, featured: next } : r))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('vendors').update({ featured: next }).eq('id', v.id)
      )
      if (error) throw error
      setSuccessMsg(next ? `Featured "${v.name}".` : `Removed "${v.name}" from featured.`)
    } catch (err: any) {
      setRows(rs => rs.map(r => r.id === v.id ? { ...r, featured: v.featured } : r))   // roll back
      setError(err?.message || 'Could not update that vendor')
    }
  }

  const remove = async (v: Vendor) => {
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== v.id))   // optimistic
    try {
      const { error } = await withTimeout(supabase!.from('vendors').delete().eq('id', v.id))
      if (error) throw error
    } catch (err: any) {
      setRows(prev)   // roll back
      setError(err?.message || 'Could not remove that vendor')
    }
  }

  const filtered = rows.filter(v => filterCategory === 'all' || v.category === filterCategory)
  const visible = paginate(filtered, page, VENDOR_PAGE_SIZE)

  return (
    <div className="admin-page">
      <div className="admin-kicker">Vendors</div>
      <h1 className="admin-h1">Trusted vendors</h1>
      <p className="admin-dek">
        Curate the service providers residents see on their Vendors page.
        Feature the ones the board recommends.
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked yet, or the vendors table isn&rsquo;t set up. Run the
          vendors &amp; reports setup SQL (see supabase/vendors-and-reports.sql),
          then reload.
        </div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          <form className="admin-form" onSubmit={add}>
            <label className="admin-field">
              <span className="admin-field-label">Vendor name</span>
              <input name="name" className="admin-input" placeholder="GreenScape Landscaping"
                value={form.name} onChange={e => setField('name', e.target.value)} />
            </label>
            <div className="admin-field" style={{ maxWidth: 260 }}>
              <span className="admin-field-label">Category</span>
              <Dropdown<VendorCat>
                value={form.category}
                onChange={v => setField('category', v)}
                ariaLabel="Vendor category"
                options={CATS}
              />
            </div>
            <label className="admin-field">
              <span className="admin-field-label">Phone (optional)</span>
              <input name="phone" className="admin-input" placeholder="(305) 555-0142"
                value={form.phone} onChange={e => setField('phone', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Email (optional)</span>
              <input name="email" type="email" className="admin-input" placeholder="hello@greenscape.com"
                value={form.email} onChange={e => setField('email', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Blurb (optional)</span>
              <textarea name="blurb" className="admin-input admin-textarea" rows={2}
                placeholder="Lawn, planters, irrigation. Weekly visits."
                value={form.blurb} onChange={e => setField('blurb', e.target.value)} />
            </label>
            <label className="admin-field" style={{ maxWidth: 200 }}>
              <span className="admin-field-label">Badge (optional)</span>
              <input name="badge" className="admin-input" placeholder="Preferred"
                value={form.badge} onChange={e => setField('badge', e.target.value)} />
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? 'Adding…' : 'Add vendor'}
              </button>
              <span className="admin-field-hint" style={{ alignSelf: 'center' }}>
                Add the vendor, then feature it from the list below.
              </span>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>

          <div className="bc-head" style={{ marginTop: 40, marginBottom: 14 }}>
            <h2 className="bc-title">Vendor list</h2>
            <span className="bc-sub">
              {rows.length} {rows.length === 1 ? 'vendor' : 'vendors'} published.
            </span>
          </div>

          <div className="admin-sched-filters" style={{ marginTop: 4, marginBottom: 12 }}>
            <div className="admin-sched-filter">
              <label>Category</label>
              <Dropdown<'all' | VendorCat>
                value={filterCategory}
                onChange={v => { setFilterCategory(v); setPage(1) }}
                ariaLabel="Filter vendors by category"
                options={[
                  { value: 'all', label: `All (${rows.length})` },
                  ...CATS.map(c => ({
                    value: c.value,
                    label: `${c.label} (${rows.filter(r => r.category === c.value).length})`,
                  })),
                ]}
              />
            </div>
          </div>

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="bc-empty">No vendors yet — add the first one above.</div>
          )}
          {status === 'ready' && rows.length > 0 && filtered.length === 0 && (
            <div className="bc-empty">No vendors in this category.</div>
          )}

          <div className="bd-list">
            {visible.map(v => (
              <div className="bd-row" key={v.id}>
                <div className="bd-main">
                  <div className="bd-title">{v.name}</div>
                  <div className="bd-meta">
                    {v.badge && <><span>{v.badge}</span><span className="bd-dot">·</span></>}
                    <span>{CAT_LABEL[v.category] || v.category}</span>
                    {v.phone && <><span className="bd-dot">·</span><span>{v.phone}</span></>}
                    {v.email && <><span className="bd-dot">·</span><span>{v.email}</span></>}
                    <span className="bd-dot">·</span>
                    <span>Added {fmtPubDate(v.created_at) || '—'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={`admin-btn-ghost${v.featured ? ' on' : ''}`}
                  onClick={() => toggleFeatured(v)}
                  title={v.featured ? 'Unfeature' : 'Feature on the resident page'}
                >
                  {v.featured ? '★ Featured' : '☆ Feature'}
                </button>
                <button type="button" className="bc-del" onClick={() => remove(v)}
                  aria-label="Remove vendor">&times;</button>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={VENDOR_PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
