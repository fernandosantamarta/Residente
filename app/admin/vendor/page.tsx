'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'
import { EasyTrackTabs } from '../EasyTrackTabs'

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
  cost: '', schedule: '',
}

const fmtCost = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

type Vendor = {
  id: string
  name: string
  category: string
  phone: string | null
  email: string | null
  blurb: string | null
  badge: string | null
  featured: boolean
  cost: number | null
  schedule: string | null
  created_at?: string
}

// Admin → Vendors. Board curates the trusted-provider list; every vendor
// shows in the Vendors section of each resident's Easy Track hub
// (/app/track#vendor), grouped by category.
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
  // Vendor-guidelines doc — the PDF residents open from "View Guidelines".
  // Stored as a normal library document (category "Vendor & Contracts", title
  // containing "Guidelines") so the resident lookup in VendorSection resolves it.
  const [guidelinesDoc, setGuidelinesDoc] = useState<any | null>(null)
  const [guideBusy, setGuideBusy] = useState(false)
  const guideFileRef = useRef<HTMLInputElement | null>(null)

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

  // Find the current vendor-guidelines doc (same lookup the resident page uses:
  // newest doc whose title contains "guideline", preferring a vendor category).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !supabase || !communityId) return
      try {
        const { data, error } = await withTimeout(
          supabase.from('documents').select('*')
            .eq('community_id', communityId).ilike('title', '%guideline%')
            .order('uploaded_at', { ascending: false })
        )
        if (cancelled || error || !data?.length) return
        setGuidelinesDoc(data.find((d: any) => (d.category || '').toLowerCase().includes('vendor')) || data[0])
      } catch { /* documents table/bucket not set up — no guidelines yet */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  // Upload (or replace) the guidelines file. Writes the same row shape the
  // Documents page uses, then drops the previous vendor-guidelines doc so
  // residents always open the latest.
  const onPickGuide = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setGuideBusy(true); setError('')
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'pdf'
      const path = `${communityId}/${crypto.randomUUID()}.${ext}`
      const up = await withTimeout(supabase!.storage.from('documents').upload(path, file))
      if (up.error) throw up.error
      const row = {
        community_id: communityId, title: 'Vendor Guidelines',
        category: 'Vendor & Contracts', storage_path: path, file_size: file.size,
      }
      const { data, error } = await withTimeout(supabase!.from('documents').insert(row).select().single())
      if (error) { supabase!.storage.from('documents').remove([path]); throw error }
      const prev = guidelinesDoc
      setGuidelinesDoc(data)
      setSuccessMsg('Vendor guidelines uploaded.')
      // Tidy up the prior vendor-guidelines doc (only if it was ours).
      if (prev && (prev.category || '').toLowerCase().includes('vendor')) {
        try {
          await supabase!.storage.from('documents').remove([prev.storage_path])
          await supabase!.from('documents').delete().eq('id', prev.id)
        } catch { /* leave the old one — the newest still wins the lookup */ }
      }
    } catch (err: any) {
      setError(err?.message || 'Could not upload the guidelines file')
    } finally {
      setGuideBusy(false)
    }
  }

  const viewGuidelines = async () => {
    if (!guidelinesDoc || !supabase) return
    setGuideBusy(true); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase.storage.from('documents').createSignedUrl(guidelinesDoc.storage_path, 3600)
      )
      if (error || !data?.signedUrl) throw error || new Error('No link')
      window.open(data.signedUrl, '_blank', 'noopener')
    } catch {
      setError('Could not open the guidelines file')
    } finally {
      setGuideBusy(false)
    }
  }

  const removeGuidelines = async () => {
    if (!guidelinesDoc) return
    const doc = guidelinesDoc
    setGuidelinesDoc(null)   // optimistic
    try {
      await withTimeout(supabase!.storage.from('documents').remove([doc.storage_path]))
      const { error } = await withTimeout(supabase!.from('documents').delete().eq('id', doc.id))
      if (error) throw error
      setSuccessMsg('Vendor guidelines removed.')
    } catch (err: any) {
      setGuidelinesDoc(doc)   // roll back
      setError(err?.message || 'Could not remove the guidelines file')
    }
  }

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
        cost: form.cost.trim() ? Number(form.cost) : null,
        schedule: form.schedule.trim() || null,
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
    <div className="admin-page cset">
      <EasyTrackTabs active="vendors" />
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
        <div>
          {/* ---- Add a vendor ---- */}
          <form className="card" onSubmit={add}>
            <div className="card-head">
              <div>
                <h2>Add a vendor</h2>
                <div className="sub">Add the provider, then feature it from the list below.</div>
              </div>
            </div>
            <label className="admin-field">
              <span className="admin-field-label">Vendor name</span>
              <input name="name" className="admin-input" placeholder="GreenScape Landscaping"
                value={form.name} onChange={e => setField('name', e.target.value)} />
            </label>
            <div className="grid2" style={{ gap: 12, marginBottom: 14 }}>
              <label className="admin-field">
                <span className="admin-field-label">Category</span>
                <Dropdown<VendorCat>
                  value={form.category}
                  onChange={v => setField('category', v)}
                  ariaLabel="Vendor category"
                  options={CATS}
                />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Phone (optional)</span>
                <input name="phone" className="admin-input" placeholder="(305) 555-0142"
                  value={form.phone} onChange={e => setField('phone', e.target.value)} />
              </label>
            </div>
            <div className="grid2" style={{ gap: 12, marginBottom: 14 }}>
              <label className="admin-field">
                <span className="admin-field-label">Email (optional)</span>
                <input name="email" type="email" className="admin-input" placeholder="hello@greenscape.com"
                  value={form.email} onChange={e => setField('email', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Badge (optional)</span>
                <input name="badge" className="admin-input" placeholder="Preferred"
                  value={form.badge} onChange={e => setField('badge', e.target.value)} />
              </label>
            </div>
            <div className="grid2" style={{ gap: 12, marginBottom: 14 }}>
              <label className="admin-field">
                <span className="admin-field-label">Monthly cost (optional)</span>
                <div className="admin-input-wrap">
                  <span className="admin-input-prefix">$</span>
                  <input name="cost" className="admin-input" type="number" placeholder="500"
                    value={form.cost} onChange={e => setField('cost', e.target.value)} />
                </div>
              </label>
              <label className="admin-field">
                <span className="admin-field-label">When they come (optional)</span>
                <input name="schedule" className="admin-input" placeholder="e.g. Mondays 8–10am"
                  value={form.schedule} onChange={e => setField('schedule', e.target.value)} />
              </label>
            </div>
            <label className="admin-field">
              <span className="admin-field-label">Blurb (optional)</span>
              <textarea name="blurb" className="admin-input admin-textarea" rows={2}
                placeholder="Lawn, planters, irrigation. Weekly visits."
                value={form.blurb} onChange={e => setField('blurb', e.target.value)} />
            </label>
            <div className="card-cta" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
              {error && <span className="admin-err-inline">{error}</span>}
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? 'Adding…' : 'Add vendor'}
              </button>
            </div>
          </form>

          {/* ---- Vendor list ---- */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Vendor list</h2>
                <div className="sub">{rows.length} {rows.length === 1 ? 'vendor' : 'vendors'} published</div>
              </div>
              <div style={{ minWidth: 200 }}>
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
                      {v.schedule && <><span className="bd-dot">·</span><span>{v.schedule}</span></>}
                      {v.phone && <><span className="bd-dot">·</span><span>{v.phone}</span></>}
                      {v.email && <><span className="bd-dot">·</span><span>{v.email}</span></>}
                    </div>
                  </div>
                  {v.cost != null && (
                    <div className="bd-amount">{fmtCost(v.cost)}<span className="bd-amount-per">/mo</span></div>
                  )}
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
          </div>

          {/* ---- Resident-facing guidelines ---- */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Vendor guidelines</h2>
                <div className="sub">The “View Guidelines” link residents see on their Vendors page</div>
              </div>
            </div>
            {guidelinesDoc ? (
              <div className="bd-row">
                <div className="bd-main">
                  <div className="bd-title">{guidelinesDoc.title || 'Vendor Guidelines'}</div>
                  <div className="bd-meta">
                    <span>Published to residents</span>
                    {guidelinesDoc.uploaded_at && <><span className="bd-dot">·</span><span>{fmtPubDate(guidelinesDoc.uploaded_at)}</span></>}
                  </div>
                </div>
                <button type="button" className="admin-btn-ghost" onClick={viewGuidelines} disabled={guideBusy}>
                  View
                </button>
                <button type="button" className="admin-btn-ghost" onClick={() => guideFileRef.current?.click()} disabled={guideBusy}>
                  {guideBusy ? 'Working…' : 'Replace'}
                </button>
                <button type="button" className="bc-del" onClick={removeGuidelines}
                  aria-label="Remove guidelines" disabled={guideBusy}>&times;</button>
              </div>
            ) : (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                  Upload the PDF residents open from “View Guidelines”. Until you add
                  one, they see the default policy text.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="admin-primary-btn" onClick={() => guideFileRef.current?.click()} disabled={guideBusy}>
                    {guideBusy ? 'Uploading…' : 'Upload guidelines'}
                  </button>
                </div>
              </>
            )}
            <p className="field-hint" style={{ marginTop: 12 }}>
              Saved to your document library under <strong>Vendor &amp; Contracts</strong> —
              you can also manage it from <a href="/admin/documents#documents">Documents</a>.
            </p>
            <input ref={guideFileRef} type="file" accept=".pdf,.doc,.docx,application/pdf"
              onChange={onPickGuide} style={{ display: 'none' }} />
          </div>
        </div>
      )}
    </div>
  )
}
