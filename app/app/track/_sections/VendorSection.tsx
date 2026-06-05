'use client'

import Link from 'next/link'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import {
  useVendorRatings,
  type Rating,
  type Stars,
} from '@/lib/vendor-ratings'
import { useAuth } from '@/app/providers'
import { supabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'
import { RequestDialog } from './RequestDialog'
import { DetailDialog } from './DetailDialog'

// Vendor — board-curated list of trusted service providers, now a section
// of the Easy Track hub. The data lives in code for now (demo seed); when
// the vendor table is wired, swap VENDORS for the real query.

type VendorCat =
  | 'property' | 'cleaning' | 'security' | 'plumbing' | 'electrical' | 'hvac'

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


const CATEGORY_GRID: { key: VendorCat; label: string }[] = [
  { key: 'property',   label: 'Property Maintenance' },
  { key: 'cleaning',   label: 'Cleaning' },
  { key: 'security',   label: 'Security' },
  { key: 'plumbing',   label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'hvac',       label: 'HVAC' },
]

export function VendorSection() {
  const t = useT()
  const catLabel = (k: VendorCat) => t(`vendors.cat.${k}`)
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<'all' | VendorCat>('all')
  const [rateOpen, setRateOpen] = useState<string | null>(null)   // vendor_id being rated
  const [request, setRequest] = useState<null | 'request' | 'recommend'>(null)
  const [allOpen, setAllOpen] = useState(false)            // "View all" vendors popup
  const [vendorOpen, setVendorOpen] = useState<Vendor | null>(null)  // single vendor detail
  const ratings = useVendorRatings()

  // Vendor guidelines: the board uploads a PDF on the Documents page (category
  // "Vendor & Contracts", title containing "guideline"). We find that row and
  // open it via a signed URL. Until one is uploaded, "View Guidelines" opens a
  // popup with the default policy instead of dead-navigating to /app/documents.
  const [guidelinesDoc, setGuidelinesDoc] = useState<any | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideBusy, setGuideBusy] = useState(false)
  const [guideErr, setGuideErr] = useState('')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!supabase || !communityId) return
      try {
        const { data, error } = await supabase
          .from('documents').select('*')
          .eq('community_id', communityId)
          .ilike('title', '%guideline%')
          .order('uploaded_at', { ascending: false })
        if (cancelled || error || !data || data.length === 0) return
        // Prefer a vendor-category guidelines doc; else the newest match.
        const vendorGuide = data.find((d: any) => (d.category || '').toLowerCase().includes('vendor')) || data[0]
        setGuidelinesDoc(vendorGuide)
      } catch { /* no guidelines uploaded yet — fall back to the popup */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  const openGuidelines = async () => {
    if (!guidelinesDoc || !supabase) { setGuideOpen(true); return }
    setGuideBusy(true); setGuideErr('')
    try {
      const { data, error } = await supabase.storage
        .from('documents').createSignedUrl(guidelinesDoc.storage_path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('No link')
      window.open(data.signedUrl, '_blank', 'noopener')
    } catch {
      setGuideErr(t('vendors.guidelines.openError'))
      setGuideOpen(true)
    } finally {
      setGuideBusy(false)
    }
  }

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


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vendors.filter(v => {
      if (active !== 'all' && v.category !== active) return false
      if (!q) return true
      const hay = `${v.name} ${catLabel(v.category)} ${v.blurb || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [search, active, vendors, t])
  const featured = filtered.filter(v => v.featured)

  return (
    <section id="vendor" className="ven-wrap ev-section">
      <div className="voice-page-head">
        <h2 className="voice-page-title">{t('vendors.title')}</h2>
        <p className="voice-page-sub">
          {t('vendors.subtitle')}
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
            placeholder={t('vendors.searchPlaceholder')}
          />
        </div>
        <select name="vendor-category" className="ven-select" value={active}
          onChange={e => setActive(e.target.value as any)}>
          <option value="all">{t('vendors.allCategories')}</option>
          {CATEGORY_GRID.map(c => (
            <option key={c.key} value={c.key}>{catLabel(c.key)}</option>
          ))}
        </select>
      </div>

      <div className="ven-grid">
        {/* MAIN COLUMN */}
        <div className="ven-col">
          {/* Featured vendors */}
          {featured.length > 0 && (
            <section className="ven-card">
              <div className="ven-card-head">
                <h2 className="ven-card-title">{t('vendors.featured')}</h2>
                <span className="ven-card-meta">{t('vendors.boardPreferred')}</span>
              </div>
              <div className="ven-featured">
                {featured.map(v => (
                  <FeaturedCard
                    key={v.id}
                    v={v}
                    catLabel={catLabel(v.category)}
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
              <h2 className="ven-card-title">{t('vendors.allVendors')}</h2>
              <button type="button" className="ven-card-link" onClick={() => setAllOpen(true)}>{t('vendors.viewAll')}</button>
            </div>
            <div className="ven-table">
              <div className="ven-row ven-row-head">
                <span>{t('vendors.colVendor')}</span>
                <span>{t('vendors.colCategory')}</span>
                <span>{t('vendors.colRating')}</span>
                <span>{t('vendors.colContact')}</span>
              </div>
              {filtered.length === 0 ? (
                <div className="ven-empty">{t('vendors.noMatch')}</div>
              ) : (
                filtered.map(v => (
                  <div key={v.id} className="ven-row">
                    <button type="button" className="ven-row-name ven-row-name-btn"
                      onClick={() => setVendorOpen(v)}>{v.name}</button>
                    <span className="ven-row-cat">{catLabel(v.category)}</span>
                    <span className="ven-row-rating">
                      <button type="button" className="ven-rate-btn"
                        onClick={() => setRateOpen(v.id)}
                        title={ratings.myRating(v.id) ? t('vendors.editYourRating') : t('vendors.rateThisVendor')}>
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
          <section className="ven-card ven-need">
            <div className="ven-need-icon" aria-hidden="true"><IconHelp /></div>
            <div className="ven-need-body">
              <div className="ven-need-title">{t('vendors.needRecommendation')}</div>
              <div className="ven-need-sub">
                {t('vendors.needRecommendationSub')}
              </div>
            </div>
            <button type="button" className="ven-cta-primary"
              onClick={() => setRequest('request')}>
              {t('vendors.requestRecommendations')}
            </button>
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
          eyebrow={t('vendors.title')}
          title={request === 'recommend' ? t('vendors.recommendDialogTitle') : t('vendors.requestDialogTitle')}
          defaultSubject={request === 'recommend' ? t('vendors.recommendSubject') : t('vendors.requestSubject')}
          bodyPlaceholder={request === 'recommend'
            ? t('vendors.recommendBodyPlaceholder')
            : t('vendors.requestBodyPlaceholder')}
          onClose={() => setRequest(null)}
        />
      )}

      {/* View all vendors — full list in a popup, each row opens its detail. */}
      {allOpen && (
        <DetailDialog
          eyebrow={t('vendors.title')}
          title={t('vendors.allVendors')}
          period={filtered.length === 1
            ? t('vendors.countVendorOne', { count: filtered.length })
            : t('vendors.countVendorOther', { count: filtered.length })}
          size="wide"
          onClose={() => setAllOpen(false)}
        >
          <div className="rd-list">
            {filtered.length === 0 ? (
              <p className="rd-detail-foot-note" style={{ marginTop: 0 }}>{t('vendors.noMatch')}</p>
            ) : filtered.map(v => (
              <button type="button" className="rd-list-row" key={v.id}
                onClick={() => { setAllOpen(false); setVendorOpen(v) }}>
                <span className="ven-fcard-icon">{categoryIcon(v.category)}</span>
                <span className="rd-list-body">
                  <span className="rd-list-title">{v.name}</span>
                  <span className="rd-list-meta">{catLabel(v.category)}</span>
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
          eyebrow={catLabel(vendorOpen.category)}
          title={vendorOpen.name}
          onClose={() => setVendorOpen(null)}
          footer={
            <button type="button" className="ven-cta-primary"
              onClick={() => { const id = vendorOpen.id; setVendorOpen(null); setRateOpen(id) }}>
              {ratings.myRating(vendorOpen.id) ? t('vendors.editMyRating') : t('vendors.rateThisVendor')}
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
              <div className="rd-bd-row"><span className="rd-bd-cat">{t('vendors.phone')}</span>
                <span className="rd-bd-amt"><a href={`tel:${vendorOpen.contact.phone}`}>{vendorOpen.contact.phone}</a></span><span /></div>
            )}
            {vendorOpen.contact.email && (
              <div className="rd-bd-row"><span className="rd-bd-cat">{t('vendors.email')}</span>
                <span className="rd-bd-amt"><a href={`mailto:${vendorOpen.contact.email}`}>{vendorOpen.contact.email}</a></span><span /></div>
            )}
          </div>
        </DetailDialog>
      )}

      {/* Vendor guidelines — fallback popup when no PDF is uploaded yet, or on
          an open error. When a doc exists, "View Guidelines" opens it directly. */}
      {guideOpen && (
        <DetailDialog
          eyebrow={t('vendors.title')}
          title={t('vendors.guidelines')}
          onClose={() => setGuideOpen(false)}
          footer={guidelinesDoc ? (
            <button type="button" className="ven-cta-primary" disabled={guideBusy}
              onClick={openGuidelines}>{guideBusy ? t('vendors.opening') : t('vendors.openGuidelinesPdf')}</button>
          ) : undefined}
        >
          <p className="rd-report-blurb">
            {t('vendors.guidelinesSub')}
          </p>
          {guideErr && <p className="rd-detail-foot-note" style={{ color: '#c0392b' }}>{guideErr}</p>}
          {!guidelinesDoc && (
            <p className="rd-detail-foot-note">
              {t('vendors.guidelinesEmpty')}
            </p>
          )}
        </DetailDialog>
      )}
    </section>
  )
}

// -- sub-components ------------------------------------------------


function FeaturedCard({
  v, catLabel, avg, count, myRating, onRate,
}: {
  v: Vendor
  catLabel: string
  avg: number | null
  count: number
  myRating: Rating | undefined
  onRate: () => void
}) {
  const t = useT()
  return (
    <div className="ven-fcard">
      <div className="ven-fcard-head">
        <div className="ven-fcard-icon">{categoryIcon(v.category)}</div>
        {v.badge && <span className="ven-fcard-badge">{v.badge}</span>}
      </div>
      <div className="ven-fcard-name">{v.name}</div>
      <div className="ven-fcard-cat">{catLabel}</div>
      {v.blurb && <div className="ven-fcard-blurb">{v.blurb}</div>}
      <div className="ven-fcard-rating">
        <RatingDisplay avg={avg} count={count} mine={!!myRating} />
        <button type="button" className="ven-rate-cta" onClick={onRate}>
          {myRating ? t('vendors.editMyRating') : t('vendors.rateThisVendor')}
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
  const t = useT()
  if (avg == null) {
    return (
      <span className="ven-rating ven-rating-empty">
        <StarSvg />
        <span>{t('vendors.noRatingsYet')}</span>
      </span>
    )
  }
  return (
    <span className="ven-rating">
      <StarSvg />
      <span className="ven-rating-avg">{avg.toFixed(1)}</span>
      <span className="ven-rating-count">({count})</span>
      {mine && <span className="ven-rating-mine">{t('vendors.yours')}</span>}
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
  const t = useT()
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
            <div className="ven-rd-eyebrow">{t(`vendors.cat.${vendor.category}`)}</div>
            <h2 className="ven-rd-title">{t('vendors.rateName', { name: vendor.name })}</h2>
          </div>
          <button type="button" className="ven-rd-close" aria-label={t('vendors.close')} onClick={onClose}>×</button>
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
                  aria-label={n === 1 ? t('vendors.starAriaOne', { n }) : t('vendors.starAriaOther', { n })}
                >
                  <StarSvg />
                </button>
              )
            })}
            <span className="ven-rd-stars-label">
              {stars === 1 ? t('vendors.starsOfFiveOne', { stars }) : t('vendors.starsOfFiveOther', { stars })}
            </span>
          </div>
          <label className="ven-rd-field">
            <span className="ven-rd-field-label">{t('vendors.review')} <span className="ven-rd-optional">{t('vendors.optional')}</span></span>
            <textarea
              name="review"
              className="ven-rd-textarea"
              rows={4}
              value={review}
              onChange={e => setReview(e.target.value)}
              placeholder={t('vendors.reviewPlaceholder')}
            />
          </label>
          {current && (
            <p className="ven-rd-note">
              {t('vendors.ratedOn', { date: current.created_at })}
            </p>
          )}
        </div>
        <footer className="ven-rd-foot">
          {current && (
            <button type="button" className="ven-rd-danger" onClick={remove}>
              {t('vendors.removeMyRating')}
            </button>
          )}
          <div className="ven-rd-foot-right">
            <button type="button" className="ven-cta-secondary" onClick={onClose}>{t('vendors.cancel')}</button>
            <button type="button" className="ven-cta-primary" onClick={save}>
              {current ? t('vendors.updateRating') : t('vendors.submitRating')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
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

function IconHelp()  { return <Svg><><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5"/><circle cx="12" cy="17.5" r="0.5" fill="currentColor"/></></Svg> }

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
