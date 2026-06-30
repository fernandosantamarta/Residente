'use client'

// Collections payoff card — the one notification an owner in collections sees up
// top: the live statutory payoff with a "Pay to clear" CTA, plus a quiet link
// down to Quick actions (where the payment-plan + legal-protection flows live).
// Shown only when the owner has an OPEN collection case.

import { useState, useEffect } from 'react'
import { casePayoff } from '@/lib/dues'
import { useMyPaymentPlan } from '@/lib/payment-plans'
import { useCheckout } from '@/components/CheckoutProvider'
import { stripeEnabled, supabase, hasSupabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'
import { nextEscalation, isOpenStage, NOTICE_KIND_LABELS, type CollectionStage } from '@/lib/compliance/collections'
import { PaymentPlanCard } from './PaymentPlanCard'
import { LegalHoldCard } from './LegalHoldCard'
import { DetailDialog } from './DetailDialog'

// Plain-language meaning of each statutory notice, for the resident Notices tab.
const NOTICE_MEANING_KEY: Record<string, string> = {
  late_assessment_30: 'pay.noticeMeaning30',
  intent_to_lien_45: 'pay.noticeMeaningLien',
  intent_to_foreclose_45: 'pay.noticeMeaningForeclose',
  tenant_rent_demand: 'pay.noticeMeaningTenant',
}
const NOTICE_METHOD_KEY: Record<string, string> = {
  both: 'pay.methodBoth', certified_mail: 'pay.methodCertified',
  first_class: 'pay.methodFirstClass', hand: 'pay.methodHand', electronic: 'pay.methodElectronic',
}
// Color-code each notice by escalation severity (amber → orange → red), teal for
// the tenant demand (a different track).
const NOTICE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  late_assessment_30:     { color: '#B45309', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)' },
  intent_to_lien_45:      { color: '#C2410C', bg: 'rgba(234,88,12,0.10)',  border: 'rgba(234,88,12,0.50)' },
  intent_to_foreclose_45: { color: '#B42318', bg: 'rgba(220,38,38,0.10)',  border: 'rgba(220,38,38,0.50)' },
  tenant_rent_demand:     { color: '#0E7490', bg: 'rgba(14,116,144,0.10)', border: 'rgba(14,116,144,0.40)' },
}
// Notice kind → the letter doc type to open on the resident document route.
const NOTICE_DOC: Record<string, string> = {
  late_assessment_30: 'notice_30', intent_to_lien_45: 'intent_to_lien',
  intent_to_foreclose_45: 'intent_to_foreclose', tenant_rent_demand: 'tenant_demand',
}

// Exact-cents money for the collection payoff, so the resident sees the same
// figure as the admin ledger AND the amount actually charged at checkout (the
// app-wide fmtMoney rounds to whole dollars, e.g. $399.52 -> $400).
const fmt$ = (n: number | string | null | undefined): string =>
  '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Resident-facing one-liner for each statutory collection stage, and the next
// step the board could take from it (only the stages with a waiting-period
// countdown). Keys resolve via useT; es/pt fall back to English.
const STAGE_STATUS_KEY: Record<string, string> = {
  delinquent: 'pay.collStatusDelinquent',
  notice_30: 'pay.collStatusNotice30',
  intent_to_lien: 'pay.collStatusIntentLien',
  lien_recorded: 'pay.collStatusLien',
  intent_to_foreclose: 'pay.collStatusIntentForeclose',
  foreclosure: 'pay.collStatusForeclosure',
}
const NEXT_ACTION_KEY: Record<string, string> = {
  notice_30: 'pay.collNextIntentLien',
  intent_to_lien: 'pay.collNextLien',
  intent_to_foreclose: 'pay.collNextForeclose',
}

// Escalating visual severity — the further down the ladder, the bolder + redder
// the status reads, so it draws more attention as the stakes rise (mild amber at
// delinquent → deep red at foreclosure).
const STAGE_SEVERITY: Record<string, number> = {
  delinquent: 1, notice_30: 1, intent_to_lien: 2,
  lien_recorded: 3, intent_to_foreclose: 3, foreclosure: 4,
}
// Distinct HUE + growing TITLE size per tier so the escalation is obvious at a
// glance: amber (early) → orange (lien warning) → red (lien recorded) → deep red
// (foreclosure). `size` is the headline size; the countdown + notices stay at a
// steady base so only the message grows.
const SEV_STYLE: Record<number, { color: string; bg: string; border: string; weight: number; size: number }> = {
  1: { color: '#B45309', bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.45)', weight: 700, size: 13.5 }, // amber
  2: { color: '#C2410C', bg: 'rgba(234,88,12,0.15)',  border: 'rgba(234,88,12,0.55)',  weight: 800, size: 15 },   // orange
  3: { color: '#B42318', bg: 'rgba(220,38,38,0.14)',  border: 'rgba(220,38,38,0.55)',  weight: 800, size: 16.5 }, // red
  4: { color: '#7F1D1D', bg: 'rgba(127,29,29,0.18)',  border: 'rgba(127,29,29,0.65)',  weight: 900, size: 18 },   // deep red
}

// Smooth-scroll the page to the Quick Actions tile (id="quick-actions"), set by
// both the desktop and mobile Pay sections.
function scrollToQuickActions(e: React.MouseEvent) {
  e.preventDefault()
  if (typeof document === 'undefined') return
  document.getElementById('quick-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function CollectionPayoffCard({ resident, community, payments }: { resident: any; community: any; payments: any[] }) {
  const t = useT()
  const { openCheckout } = useCheckout()
  const { openCase, plan, loading } = useMyPaymentPlan()
  const [detailOpen, setDetailOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [notices, setNotices] = useState<{ id: string; kind: string; sent_at: string | null }[]>([])

  // The statutory notices already sent on the owner's own case, for the
  // expandable status detail (RLS: "owner reads own collection notices").
  useEffect(() => {
    const cid = (openCase as any)?.id
    if (!hasSupabase || !supabase || !cid) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('ev_collection_notices')
        .select('id, kind, sent_at').eq('case_id', cid).order('sent_at', { ascending: false })
      if (!cancelled) setNotices((data as any) || [])
    })()
    return () => { cancelled = true }
  }, [(openCase as any)?.id])

  // Only render during an active collection — nothing for owners in good standing.
  if (loading || !openCase) return null

  // Active includes admin-created plans (no request_status) — same rule as
  // PaymentPlanCard so the top card and the plan popup agree.
  const onActivePlan = String(plan?.status ?? '') === 'active' && plan?.request_status !== 'requested' && plan?.request_status !== 'denied'
  let payoff: ReturnType<typeof casePayoff> | null = null
  try {
    if (resident) {
      const extraCosts = (Number((openCase as any).cost_balance) || 0) + (Number((openCase as any).mailing_cost_balance) || 0)
      payoff = casePayoff(resident, community, payments || [], { extraCosts, fines: Number((openCase as any).fine_balance) || 0 })
    }
  } catch { payoff = null }
  // Show the running balance even while on a plan — it drops as installments
  // post (each recorded installment is a real payment against the case), so the
  // owner watches the total go down. The plan context moves into the intro line.
  const showPayoff = !!payoff && payoff.payoff > 0
  const r = payoff?.remaining

  // Where the case sits on the statutory ladder + the live countdown to the next
  // step, surfaced to the owner when they're NOT on a plan (a plan pauses this).
  const stage = String((openCase as any)?.stage ?? 'delinquent') as CollectionStage
  const inLadder = isOpenStage(stage)
  const esc = inLadder ? nextEscalation(openCase as any) : null
  const daysToNext = esc?.readyAt ? Math.max(0, Math.ceil((esc.readyAt.getTime() - Date.now()) / 86400000)) : null
  const sev = SEV_STYLE[STAGE_SEVERITY[stage] || 1]

  const pay = () => {
    if (!payoff) return
    openCheckout({
      fn: 'create-checkout',
      body: { resident_id: resident.id, amount: payoff.payoff, applied_to_case: openCase.id },
      returnUrl: '/app/track?submitted=1#pay',
    })
  }

  const chips: [string, number][] = r
    ? [
        [t('pay.collPrincipal'), r.principal], [t('pay.collInterest'), r.interest],
        [t('pay.collFees'), r.lateFee], [t('pay.collCosts'), r.cost],
        ...(Number(r.fine) > 0 ? ([[t('pay.collFines'), r.fine]] as [string, number][]) : []),
      ]
    : []

  return (
    <section className="pay-card" id="collections" style={{ overflow: 'hidden', padding: 0 }}>
      {/* Zesty header — a full-bleed orange band flush with the card top (rounded
          top corners match the card, no background leaks at the edges): the
          (larger) label on the left, the live payoff on the right, same line. */}
      <div style={{ background: 'linear-gradient(135deg, #E14909 0%, #F2922A 100%)', color: '#fff', padding: '18px 22px', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.95 }}>{t('pay.collTitle')}</div>
        {showPayoff
          ? <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05, whiteSpace: 'nowrap' }}>{t('pay.collTotal', { amount: fmt$(payoff!.payoff) })}</div>
          : <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.95, whiteSpace: 'nowrap' }}>{t('pay.collOnPlan')}</div>}
      </div>

      <div style={{ padding: '12px 20px 16px' }}>
        {showPayoff && (
          <>
            <p className="pay-plan-intro" style={{ marginTop: 0, marginBottom: 0 }}>{onActivePlan ? t('pay.collOnPlan') : t('pay.collIntro')}</p>
            {/* Collection status + countdown — only when NOT on a plan (a plan
                pauses escalation, so we don't show a ladder countdown there). */}
            {!onActivePlan && inLadder && (
              <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.45, color: sev.color, background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 10, padding: '10px 12px' }}>
                <button type="button" onClick={() => setDetailOpen(o => !o)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', boxSizing: 'border-box', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <span>
                    <span style={{ display: 'block', fontWeight: sev.weight, fontSize: sev.size, lineHeight: 1.3 }}>{t(STAGE_STATUS_KEY[stage] || 'pay.collStatusDelinquent')}</span>
                    {daysToNext != null && NEXT_ACTION_KEY[stage] && (
                      <span style={{ display: 'block', marginTop: 3, opacity: 0.9 }}>
                        {daysToNext > 0
                          ? t('pay.collNextInDays', { action: t(NEXT_ACTION_KEY[stage]), days: daysToNext })
                          : t('pay.collNextAnyTime', { action: t(NEXT_ACTION_KEY[stage]) })}
                      </span>
                    )}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                    style={{ flexShrink: 0, marginTop: 2, transform: detailOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {detailOpen && (
                  <div style={{ marginTop: 10, borderTop: `1px solid ${sev.border}`, paddingTop: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.75, marginBottom: 6 }}>{t('pay.collNoticesSent')}</div>
                    {notices.length === 0 ? (
                      <div style={{ opacity: 0.8 }}>{t('pay.collNoticesNone')}</div>
                    ) : (
                      <>
                        {notices.map(n => (
                          <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0' }}>
                            <span>{(NOTICE_KIND_LABELS as Record<string, string>)[n.kind] || n.kind}</span>
                            <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>{n.sent_at || '—'}</span>
                          </div>
                        ))}
                        {/* Jump down to the Notices tab AND open it (color-coded,
                            opens each letter). The event is caught by
                            CollectionNoticesCard below. */}
                        <button type="button"
                          onClick={() => {
                            if (typeof document !== 'undefined') document.getElementById('quick-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ev:open-collection-notices'))
                          }}
                          style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, fontWeight: 700, color: sev.color }}>
                          {t('pay.collSeeAllNotices')}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* On a plan the card stays clean — just the running total + the link
                down to the plan. The breakdown + full "Pay now" belong to the
                lump-sum payoff, not the installment flow. Off a plan, the payoff
                breakdown lives in its own dropdown (sectioned rows + total). */}
            {!onActivePlan && (
              <div style={{ margin: '14px 0' }}>
                <button type="button" onClick={() => setBreakdownOpen(o => !o)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: '#B54708' }}>
                  {breakdownOpen ? t('pay.collHideBreakdown') : t('pay.collViewBreakdown')}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                    style={{ transform: breakdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {breakdownOpen && (
                  <div style={{ marginTop: 10, border: '1px solid rgba(10,36,64,0.10)', borderRadius: 10, overflow: 'hidden' }}>
                    {chips.map(([label, val], i) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 12px', fontSize: 13, color: '#344054', borderTop: i ? '1px solid #EEF0F2' : 'none' }}>
                        <span>{label}</span>
                        <span style={{ fontWeight: 600, color: '#1F2233' }}>{fmt$(Number(val) || 0)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 12px', fontSize: 13.5, fontWeight: 800, color: '#0A2440', borderTop: '2px solid #E5E2DA', background: 'rgba(0,0,0,0.02)' }}>
                      <span>{t('pay.collBreakdownTotal')}</span>
                      <span>{fmt$(payoff!.payoff)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Action row — Pay on the left, the quiet link to Quick actions pushed
            all the way to the right (where the plan + legal flows live). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {showPayoff && stripeEnabled && !onActivePlan && (
            <button type="button" className="pay-cta-primary" onClick={pay}>
              {t('pay.collPay')}
            </button>
          )}
          <a href="#quick-actions" onClick={scrollToQuickActions} className="pay-coll-help"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: '#B54708', textDecoration: 'none', cursor: 'pointer' }}>
            {t('pay.collMoreHelp')}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  )
}

// CollectionQuickActions — the payment-plan + legal-protection rows, shown only
// when the owner has an open collection case. Rendered two ways:
//   default    — a bare group meant to sit INSIDE the existing right-column
//                Quick Actions tile (desktop), with a divider above it.
//   standalone — its own tile with a heading + id="quick-actions" (mobile, which
//                has no right-column tile of its own).
export function CollectionQuickActions({ resident, community, payments, standalone }: { resident: any; community?: any; payments?: any[]; standalone?: boolean }) {
  const t = useT()
  const { openCase, loading } = useMyPaymentPlan()
  if (loading || !openCase) return null

  const rows = (
    <>
      <PaymentPlanCard resident={resident} community={community} payments={payments} variant="row" />
      <LegalHoldCard variant="row" />
      <CollectionNoticesCard />
    </>
  )

  if (standalone) {
    return (
      <section className="pay-card pay-tile-tight" id="quick-actions">
        <h3 className="pay-tile-title">{t('pay.collQuickActions')}</h3>
        <div className="pay-quick">{rows}</div>
      </section>
    )
  }

  return (
    <div className="pay-quick" style={{ borderTop: '1px solid var(--ev-border, #e5e2da)', marginTop: 10, paddingTop: 10 }}>
      {rows}
    </div>
  )
}

// CollectionNoticesCard — a Quick Actions row that opens a popup listing every
// statutory notice on the owner's case (type, date sent, delivery method,
// mailed-to address) with a plain-language explanation of each. Read from the
// owner's own ev_collection_notices (RLS-scoped).
function CollectionNoticesCard() {
  const t = useT()
  const { openCase, loading } = useMyPaymentPlan()
  const [open, setOpen] = useState(false)
  const [notices, setNotices] = useState<any[]>([])

  useEffect(() => {
    const cid = (openCase as any)?.id
    if (!hasSupabase || !supabase || !cid) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('ev_collection_notices')
        .select('id, kind, sent_at, method, tracking_number, mailed_to_record_address')
        .eq('case_id', cid).order('sent_at', { ascending: false })
      if (!cancelled) setNotices((data as any) || [])
    })()
    return () => { cancelled = true }
  }, [(openCase as any)?.id])

  // Open this popup when the "See all notices" link on the status card fires.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('ev:open-collection-notices', onOpen)
    return () => window.removeEventListener('ev:open-collection-notices', onOpen)
  }, [])

  if (loading || !openCase) return null
  const caseId = (openCase as any)?.id

  const fmtD = (d: string | null) => {
    if (!d) return '—'
    try { return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return d }
  }

  return (
    <>
      <button type="button" className="pay-quick-row" onClick={() => setOpen(true)}>
        <span className="pay-quick-icon"><MailIcon /></span>
        <span className="pay-quick-body">
          <span className="pay-quick-title">{t('pay.noticesTitle')}</span>
          <span className="pay-quick-desc">{t('pay.noticesRowDesc', { count: notices.length })}</span>
        </span>
        <svg className="pay-quick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {open && (
        <DetailDialog eyebrow={t('pay.noticesEyebrow')} title={t('pay.noticesTitle')} onClose={() => setOpen(false)}>
          {notices.length === 0 ? (
            <p className="pay-plan-intro">{t('pay.noticesEmpty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notices.map(n => {
                const label = (NOTICE_KIND_LABELS as Record<string, string>)[n.kind] || n.kind
                const meaning = NOTICE_MEANING_KEY[n.kind] ? t(NOTICE_MEANING_KEY[n.kind]) : ''
                const method = NOTICE_METHOD_KEY[n.method] ? t(NOTICE_METHOD_KEY[n.method]) : n.method
                const ns = NOTICE_STYLE[n.kind] || { color: '#475467', bg: 'rgba(10,36,64,0.035)', border: 'rgba(10,36,64,0.12)' }
                const docType = caseId ? NOTICE_DOC[n.kind] : null
                const inner = (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 700, color: ns.color, fontSize: 13.5 }}>{label}</div>
                      {docType && <span style={{ color: ns.color, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{t('pay.noticesViewLetter')} &rarr;</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#475467', marginTop: 3 }}>
                      {t('pay.noticesSent')} {fmtD(n.sent_at)}{n.method ? ` · ${method}` : ''}{n.tracking_number ? ` · #${n.tracking_number}` : ''}
                    </div>
                    {n.mailed_to_record_address && (
                      <div style={{ fontSize: 12, color: '#667085', marginTop: 2 }}>{t('pay.noticesMailedTo')} {n.mailed_to_record_address}</div>
                    )}
                    {meaning && <div style={{ fontSize: 12.5, color: '#475467', marginTop: 7, lineHeight: 1.45 }}>{meaning}</div>}
                  </>
                )
                const box: React.CSSProperties = { display: 'block', textDecoration: 'none', color: 'inherit', background: ns.bg, border: `1px solid ${ns.border}`, borderRadius: 12, padding: '12px 14px' }
                return docType
                  ? <a key={n.id} href={`/app/collections/${caseId}/document?type=${docType}`} style={{ ...box, cursor: 'pointer' }}>{inner}</a>
                  : <div key={n.id} style={box}>{inner}</div>
              })}
            </div>
          )}
        </DetailDialog>
      )}
    </>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
    </svg>
  )
}
