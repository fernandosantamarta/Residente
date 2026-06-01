'use client'

import Link from 'next/link'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import {
  useVendorRatings,
  type Rating,
  type Stars,
} from '@/lib/vendor-ratings'
import { supabase } from '@/lib/supabase'
import { RequestDialog } from './RequestDialog'
import { DetailDialog } from './DetailDialog'

// Vendor — board-curated list of trusted service providers, now a section
// of the Easy Track hub. The data lives in code for now (demo seed); when
// the vendor table is wired, swap VENDORS for the real query.

type VendorCat =
  | 'property' | 'cleaning' | 'security' | 'plumbing' | 'electrical' | 'hvac'

const CATEGORY_LABEL: Record<VendorCat, string> = {
  property:   'Property Maintenance',
  cleaning:   'Cleaning',
  security:   'Security',
  plumbing:   'Plumbing',
  electrical: 'Electrical',
  hvac:       'HVAC',
}

type Vendor = {
  id: string
  name: string
  category: VendorCat
  contact: { phone?: string; email?: string }
  featured?: boolean
  blurb?: string
  badge?: string         // e.g. "Preferred"
}

const VENDORS: Vendor[] = [
  { id: 'v1',  name: 'GreenScape Landscaping',     category: 'property',   contact: { phone: '(305) 555-0142', email: 'hello@greenscape.com' },     featured: true, blurb: 'Lawn, planters, irrigation. Weekly visits.',         badge: 'Preferred' },
  { id: 'v2',  name: 'Coastal Maintenance',         category: 'property',   contact: { phone: '(305) 555-0188', email: 'service@coastalmaint.com' }, featured: true, blurb: 'General repairs, painting, common-area touch-ups.', badge: 'Preferred' },
  { id: 'v3',  name: 'Shield Security',             category: 'security',   contact: { phone: '(305) 555-0199', email: 'ops@shieldsecurity.com' },   featured: true, blurb: 'Gate, cameras, after-hours patrol.',                badge: 'Preferred' },
  { id: 'v4',  name: 'Flow Right Plumbing',         category: 'plumbing',   contact: { phone: '(305) 555-0211', email: 'fix@flowrightplumbing.com' }, featured: true, blurb: 'Same-day leak response, fixture installs.',         badge: 'Preferred' },
  { id: 'v5',  name: 'Sunset Electrical Solutions', category: 'electrical', contact: { phone: '(305) 555-0244', email: 'work@sunsetelec.com' }, blurb: 'Lighting, panels, EV chargers.' },
  { id: 'v6',  name: 'Pristine Cleaning Co.',       category: 'cleaning',   contact: { phone: '(305) 555-0277', email: 'book@pristine.com' }, blurb: 'Deep cleans, common areas, post-construction.' },
  { id: 'v7',  name: 'BluFresh Elevator Services',  category: 'property',   contact: { phone: '(305) 555-0290', email: 'support@blufresh.com' }, blurb: 'Annual inspections, repairs, mods.' },
  { id: 'v8',  name: 'Apex HVAC Pros',              category: 'hvac',       contact: { phone: '(305) 555-0312', email: 'svc@apexhvac.com' }, blurb: 'Service contracts, emergency replacements.' },
  { id: 'v9',  name: 'Atlas Pest Control',          category: 'property',   contact: { phone: '(305) 555-0331', email: 'hello@atlaspest.com' }, blurb: 'Quarterly perimeter treatment, common-area abatement.' },
]

const EMERGENCY_CONTACTS = [
  { id: 'e1', label: '24/7 Hotline',           phone: '(305) 555-0001', desc: 'On-call manager — anything urgent.' },
  { id: 'e2', label: 'After-Hours Maintenance', phone: '(305) 555-0002', desc: 'Coastal Maintenance after 6 PM.' },
  { id: 'e3', label: 'Water Emergency',        phone: '(305) 555-0003', desc: 'Flow Right Plumbing — leaks, no water.' },
]

const CATEGORY_GRID: { key: VendorCat; label: string }[] = [
  { key: 'property',   label: 'Property Maintenance' },
  { key: 'cleaning',   label: 'Cleaning' },
  { key: 'security',   label: 'Security' },
  { key: 'plumbing',   label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'hvac',       label: 'HVAC' },
]

export function VendorSection() {
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<'all' | VendorCat>('all')
  const [rateOpen, setRateOpen] = useState<string | null>(null)   // vendor_id being rated
  const [request, setRequest] = useState<null | 'request' | 'recommend'>(null)
  const [allOpen, setAllOpen] = useState(false)            // "View all" vendors popup
  const [vendorOpen, setVendorOpen] = useState<Vendor | null>(null)  // single vendor detail
  const ratings = useVendorRatings()

  // Board-curated vendors from Supabase. Falls back to the in-code demo
  // seed when the table is empty or unreachable, so the page never breaks.
  const [dbVendors, setDbVendors] = useState<Vendor[] | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!supabase) return
      try {
        const { data, error } = await supabase
          .from('vendors').select('*')
          .order('featured', { ascending: false })
          .order('created_at', { ascending: false })
        if (cancelled || error || !data || data.length === 0) return
        setDbVendors(data.map((r: any) => ({
          id: r.id,
          name: r.name,
          category: r.category as VendorCat,
          contact: { phone: r.phone || undefined, email: r.email || undefined },
          featured: r.featured,
          blurb: r.blurb || undefined,
          badge: r.badge || undefined,
        })))
      } catch { /* fall back to demo seed */ }
    })()
    return () => { cancelled = true }
  }, [])
  const vendors = dbVendors ?? VENDORS

  const counts = useMemo(() => {
    const map: Record<VendorCat, number> = {
      property: 0, cleaning: 0, security: 0, plumbing: 0, electrical: 0, hvac: 0,
    }
    for (const v of vendors) map[v.category]++
    return map
  }, [vendors])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vendors.filter(v => {
      if (active !== 'all' && v.category !== active) return false
      if (!q) return true
      const hay = `${v.name} ${CATEGORY_LABEL[v.category]} ${v.blurb || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [search, active, vendors])
  const featured = filtered.filter(v => v.featured)

  return (
    <section id="vendor" className="ven-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">Vendors</h2>
        <p className="voice-page-sub">
          Trusted service providers who help keep our community safe,
          beautiful, and well-maintained.
        </p>
      </div>

      <div className="ven-toolbar">
        <div className="ven-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <input
            name="vendor-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vendors by name, service, or location…"
          />
        </div>
        <select name="vendor-category" className="ven-select" value={active}
          onChange={e => setActive(e.target.value as any)}>
          <option value="all">All Categories</option>
          {CATEGORY_GRID.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="ven-grid">
        {/* MAIN COLUMN */}
        <div className="ven-col">
          {/* Vendor categories — icon grid */}
          <section className="ven-card">
            <h2 className="ven-card-title">Vendor Categories</h2>
            <div className="ven-cat-grid">
              <CategoryTile k="all" label="All" count={vendors.length}
                active={active === 'all'} onClick={() => setActive('all')} />
              {CATEGORY_GRID.map(c => (
                <CategoryTile
                  key={c.key} k={c.key} label={c.label} count={counts[c.key]}
                  active={active === c.key}
                  onClick={() => setActive(c.key)}
                />
              ))}
            </div>
          </section>

          {/* Featured vendors */}
          {featured.length > 0 && (
            <section className="ven-card">
              <div className="ven-card-head">
                <h2 className="ven-card-title">Featured Vendors</h2>
                <span className="ven-card-meta">Board-preferred</span>
              </div>
              <div className="ven-featured">
                {featured.map(v => (
                  <FeaturedCard
                    key={v.id}
                    v={v}
                    avg={ratings.averageFor(v.id)}
                    count={ratings.countFor(v.id)}
                    myRating={ratings.myRating(v.id)}
                    onRate={() => setRateOpen(v.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* All vendors table */}
          <section className="ven-card">
            <div className="ven-card-head">
              <h2 className="ven-card-title">All Vendors</h2>
              <button type="button" className="ven-card-link" onClick={() => setAllOpen(true)}>View all</button>
            </div>
            <div className="ven-table">
              <div className="ven-row ven-row-head">
                <span>Vendor</span>
                <span>Category</span>
                <span>Rating</span>
                <span>Contact</span>
              </div>
              {filtered.length === 0 ? (
                <div className="ven-empty">No vendors match these filters.</div>
              ) : (
                filtered.map(v => (
                  <div key={v.id} className="ven-row">
                    <button type="button" className="ven-row-name ven-row-name-btn"
                      onClick={() => setVendorOpen(v)}>{v.name}</button>
                    <span className="ven-row-cat">{CATEGORY_LABEL[v.category]}</span>
                    <span className="ven-row-rating">
                      <button type="button" className="ven-rate-btn"
                        onClick={() => setRateOpen(v.id)}
                        title={ratings.myRating(v.id) ? 'Edit your rating' : 'Rate this vendor'}>
                        <RatingDisplay
                          avg={ratings.averageFor(v.id)}
                          count={ratings.countFor(v.id)}
                          mine={!!ratings.myRating(v.id)}
                        />
                      </button>
                    </span>
                    <span className="ven-row-contact">
                      {v.contact.phone && <a href={`tel:${v.contact.phone}`}>{v.contact.phone}</a>}
                      {v.contact.email && (
                        <a href={`mailto:${v.contact.email}`} className="ven-row-email">{v.contact.email}</a>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <aside className="ven-aside">
          <section className="ven-card ven-tile-tight">
            <h3 className="ven-tile-title">Quick Actions</h3>
            <div className="ven-quick">
              <QuickRow icon={<IconPlus />}
                title="Request a Vendor"
                desc="Open a service request the board will route."
                onClick={() => setRequest('request')} />
              <QuickRow icon={<IconStar />}
                title="Recommend a Vendor"
                desc="Suggest a service provider you trust."
                onClick={() => setRequest('recommend')} />
              <QuickRow icon={<IconList />}
                title="View Service Requests"
                desc="See the status of your open requests."
                href="/app/voice#contact" />
            </div>
          </section>

          <section className="ven-card ven-need">
            <div className="ven-need-icon" aria-hidden="true"><IconHelp /></div>
            <div className="ven-need-body">
              <div className="ven-need-title">Need a recommendation?</div>
              <div className="ven-need-sub">
                Not sure who to choose? Let our management team help match
                you with the right vendor.
              </div>
            </div>
            <button type="button" className="ven-cta-primary"
              onClick={() => setRequest('request')}>
              Request Recommendations
            </button>
          </section>

          <section className="ven-card ven-guide">
            <div className="ven-guide-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z"/>
                <path d="m9 12 2 2 4-4"/>
              </svg>
            </div>
            <div className="ven-guide-body">
              <div className="ven-guide-title">Vendor Guidelines</div>
              <div className="ven-guide-sub">
                All vendors must be approved by management before performing work.
              </div>
            </div>
            <Link href="/app/documents" className="ven-cta-secondary">View Guidelines</Link>
          </section>

          <section className="ven-card ven-emerg">
            <h3 className="ven-tile-title">Emergency Contacts</h3>
            <div className="ven-emerg-list">
              {EMERGENCY_CONTACTS.map(c => (
                <a key={c.id} href={`tel:${c.phone}`} className="ven-emerg-row">
                  <span className="ven-emerg-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>
                    </svg>
                  </span>
                  <span className="ven-emerg-body">
                    <span className="ven-emerg-label">{c.label}</span>
                    <span className="ven-emerg-phone">{c.phone}</span>
                    <span className="ven-emerg-desc">{c.desc}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {rateOpen && (
        <RatingDialog
          vendor={vendors.find(v => v.id === rateOpen)!}
          current={ratings.myRating(rateOpen)}
          onSave={ratings.submit}
          onRemove={ratings.remove}
          onClose={() => setRateOpen(null)}
        />
      )}

      {request && (
        <RequestDialog
          eyebrow="Vendors"
          title={request === 'recommend' ? 'Recommend a vendor' : 'Request a vendor'}
          defaultSubject={request === 'recommend' ? 'Vendor recommendation: ' : 'Vendor request: '}
          bodyPlaceholder={request === 'recommend'
            ? 'Who do you recommend, and what have they done well?'
            : 'What service do you need? Any preferred timing?'}
          onClose={() => setRequest(null)}
        />
      )}

      {/* View all vendors — full list in a popup, each row opens its detail. */}
      {allOpen && (
        <DetailDialog
          eyebrow="Vendors"
          title="All Vendors"
          period={`${filtered.length} vendor${filtered.length === 1 ? '' : 's'}`}
          size="wide"
          onClose={() => setAllOpen(false)}
        >
          <div className="rd-list">
            {filtered.length === 0 ? (
              <p className="rd-detail-foot-note" style={{ marginTop: 0 }}>No vendors match these filters.</p>
            ) : filtered.map(v => (
              <button type="button" className="rd-list-row" key={v.id}
                onClick={() => { setAllOpen(false); setVendorOpen(v) }}>
                <span className="ven-fcard-icon">{categoryIcon(v.category)}</span>
                <span className="rd-list-body">
                  <span className="rd-list-title">{v.name}</span>
                  <span className="rd-list-meta">{CATEGORY_LABEL[v.category]}</span>
                </span>
                <svg className="rd-list-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        </DetailDialog>
      )}

      {/* A single vendor, opened in place. */}
      {vendorOpen && (
        <DetailDialog
          eyebrow={CATEGORY_LABEL[vendorOpen.category]}
          title={vendorOpen.name}
          onClose={() => setVendorOpen(null)}
          footer={
            <button type="button" className="ven-cta-primary"
              onClick={() => { const id = vendorOpen.id; setVendorOpen(null); setRateOpen(id) }}>
              {ratings.myRating(vendorOpen.id) ? 'Edit my rating' : 'Rate this vendor'}
            </button>
          }
        >
          <div className="rd-report-meta">
            {vendorOpen.badge && <span className="ven-fcard-badge">{vendorOpen.badge}</span>}
            <RatingDisplay
              avg={ratings.averageFor(vendorOpen.id)}
              count={ratings.countFor(vendorOpen.id)}
              mine={!!ratings.myRating(vendorOpen.id)}
            />
          </div>
          {vendorOpen.blurb && <p className="rd-report-blurb">{vendorOpen.blurb}</p>}
          <div className="rd-bd-table">
            {vendorOpen.contact.phone && (
              <div className="rd-bd-row"><span className="rd-bd-cat">Phone</span>
                <span className="rd-bd-amt"><a href={`tel:${vendorOpen.contact.phone}`}>{vendorOpen.contact.phone}</a></span><span /></div>
            )}
            {vendorOpen.contact.email && (
              <div className="rd-bd-row"><span className="rd-bd-cat">Email</span>
                <span className="rd-bd-amt"><a href={`mailto:${vendorOpen.contact.email}`}>{vendorOpen.contact.email}</a></span><span /></div>
            )}
          </div>
        </DetailDialog>
      )}
    </section>
  )
}

// -- sub-components ------------------------------------------------

function CategoryTile({
  k, label, count, active, onClick,
}: {
  k: 'all' | VendorCat
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`ven-cat${active ? ' on' : ''}`} onClick={onClick}>
      <span className="ven-cat-icon">{categoryIcon(k)}</span>
      <span className="ven-cat-label">{label}</span>
      <span className="ven-cat-count">{count}</span>
    </button>
  )
}

function FeaturedCard({
  v, avg, count, myRating, onRate,
}: {
  v: Vendor
  avg: number | null
  count: number
  myRating: Rating | undefined
  onRate: () => void
}) {
  return (
    <div className="ven-fcard">
      <div className="ven-fcard-head">
        <div className="ven-fcard-icon">{categoryIcon(v.category)}</div>
        {v.badge && <span className="ven-fcard-badge">{v.badge}</span>}
      </div>
      <div className="ven-fcard-name">{v.name}</div>
      <div className="ven-fcard-cat">{CATEGORY_LABEL[v.category]}</div>
      {v.blurb && <div className="ven-fcard-blurb">{v.blurb}</div>}
      <div className="ven-fcard-rating">
        <RatingDisplay avg={avg} count={count} mine={!!myRating} />
        <button type="button" className="ven-rate-cta" onClick={onRate}>
          {myRating ? 'Edit my rating' : 'Rate this vendor'}
        </button>
      </div>
      <div className="ven-fcard-contact">
        {v.contact.phone && (
          <a href={`tel:${v.contact.phone}`} className="ven-fcard-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>
            </svg>
            {v.contact.phone}
          </a>
        )}
        {v.contact.email && (
          <a href={`mailto:${v.contact.email}`} className="ven-fcard-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/>
            </svg>
            {v.contact.email}
          </a>
        )}
      </div>
    </div>
  )
}

// Rating display — average + count, with a small "★ Your rating" hint
// when the resident has submitted one.
function RatingDisplay({
  avg, count, mine,
}: {
  avg: number | null
  count: number
  mine: boolean
}) {
  if (avg == null) {
    return (
      <span className="ven-rating ven-rating-empty">
        <StarSvg />
        <span>No ratings yet</span>
      </span>
    )
  }
  return (
    <span className="ven-rating">
      <StarSvg />
      <span className="ven-rating-avg">{avg.toFixed(1)}</span>
      <span className="ven-rating-count">({count})</span>
      {mine && <span className="ven-rating-mine">Yours</span>}
    </span>
  )
}

function StarSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="m12 2 2.9 6.2 6.8.6-5.1 4.6 1.5 6.6L12 16.8 5.9 20l1.5-6.6L2.3 8.8l6.8-.6z"/>
    </svg>
  )
}

// Rating dialog — star picker (1-5) + optional text review. Save
// upserts the resident's rating; Remove deletes it.
function RatingDialog({
  vendor, current, onSave, onRemove, onClose,
}: {
  vendor: Vendor
  current: Rating | undefined
  onSave: (vendor_id: string, stars: Stars, review: string) => void | Promise<void>
  onRemove: (vendor_id: string) => void | Promise<void>
  onClose: () => void
}) {
  const [stars, setStars] = useState<Stars>((current?.stars as Stars) || 5)
  const [hover, setHover] = useState<number>(0)
  const [review, setReview] = useState<string>(current?.review || '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = () => {
    void onSave(vendor.id, stars, review)
    onClose()
  }
  const remove = () => {
    void onRemove(vendor.id)
    onClose()
  }

  return (
    <div className="ven-rd-backdrop" onClick={onClose}>
      <div className="ven-rd-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <header className="ven-rd-head">
          <div>
            <div className="ven-rd-eyebrow">{CATEGORY_LABEL[vendor.category]}</div>
            <h2 className="ven-rd-title">Rate {vendor.name}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="ven-rd-body">
          <div className="ven-rd-stars" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map(n => {
              const filled = (hover || stars) >= n
              return (
                <button
                  key={n}
                  type="button"
                  className={`ven-rd-star${filled ? ' on' : ''}`}
                  onClick={() => setStars(n as Stars)}
                  onMouseEnter={() => setHover(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  <StarSvg />
                </button>
              )
            })}
            <span className="ven-rd-stars-label">
              {stars} of 5 {stars === 1 ? 'star' : 'stars'}
            </span>
          </div>
          <label className="ven-rd-field">
            <span className="ven-rd-field-label">Review <span className="ven-rd-optional">(optional)</span></span>
            <textarea
              name="review"
              className="ven-rd-textarea"
              rows={4}
              value={review}
              onChange={e => setReview(e.target.value)}
              placeholder="What did the vendor do well? Anything for neighbors to know?"
            />
          </label>
          {current && (
            <p className="ven-rd-note">
              You rated this vendor on {current.created_at}. Submitting again will update your review.
            </p>
          )}
        </div>
        <footer className="ven-rd-foot">
          {current && (
            <button type="button" className="ven-rd-danger" onClick={remove}>
              Remove my rating
            </button>
          )}
          <div className="ven-rd-foot-right">
            <button type="button" className="ven-cta-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="ven-cta-primary" onClick={save}>
              {current ? 'Update rating' : 'Submit rating'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function QuickRow({
  icon, title, desc, href, onClick,
}: {
  icon: ReactNode; title: string; desc: string; href?: string; onClick?: () => void
}) {
  const inner = (
    <>
      <span className="ven-quick-icon">{icon}</span>
      <span className="ven-quick-body">
        <span className="ven-quick-title">{title}</span>
        <span className="ven-quick-desc">{desc}</span>
      </span>
      <svg className="ven-quick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </>
  )
  return href
    ? <Link href={href} className="ven-quick-row">{inner}</Link>
    : <button type="button" className="ven-quick-row" onClick={onClick}>{inner}</button>
}

// -- icons ---------------------------------------------------------

function categoryIcon(k: 'all' | VendorCat): ReactNode {
  switch (k) {
    case 'all':        return <Svg><><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/></></Svg>
    case 'property':   return <Svg><><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></></Svg>
    case 'cleaning':   return <Svg><><path d="M3 21h18"/><path d="M5 21V11l7-7 7 7v10"/><path d="M9 21v-5h6v5"/></></Svg>
    case 'security':   return <Svg><><path d="M12 3 4 6v6c0 4.5 3.2 8.5 8 9 4.8-.5 8-4.5 8-9V6z"/></></Svg>
    case 'plumbing':   return <Svg><><path d="M5 21V8a2 2 0 0 1 2-2h4l3 3h5v12"/><path d="M9 21v-6h6v6"/></></Svg>
    case 'electrical': return <Svg><><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></></Svg>
    case 'hvac':       return <Svg><><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/></></Svg>
  }
}

function IconPlus()  { return <Svg><><path d="M12 5v14M5 12h14"/></></Svg> }
function IconStar()  { return <Svg><><path d="m12 2 2.9 6.2 6.8.6-5.1 4.6 1.5 6.6L12 16.8 5.9 20l1.5-6.6L2.3 8.8l6.8-.6z"/></></Svg> }
function IconList()  { return <Svg><><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></></Svg> }
function IconHelp()  { return <Svg><><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5"/><circle cx="12" cy="17.5" r="0.5" fill="currentColor"/></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
