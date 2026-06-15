'use client'

// Accounting workspace (Phase 3 productization / Step 6).
//
// The paid "Accounting integrations" add-on home: it gathers the things that turn
// Easy Track's books into a self-keeping ledger — the general ledger & statements,
// the bank feed, and bank reconciliation — into one place. Read-only: nothing here
// moves money. The free Phase-1 statements stay on /admin/financials; THIS page is
// the gated workspace (rollout via NEXT_PUBLIC_ACCOUNTING_ENABLED; when off it shows
// an upsell + a demo preview so the screen still renders). See lib/accounting.ts and
// [[eliminate-back-office-plan]].

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { useT } from '@/lib/i18n'
import { useAccountingAccess } from '@/hooks/useAccountingAccess'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

// Small icon set (stroke, matches the cset wsrow glyphs elsewhere).
const IconBars = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
const IconCheck = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
const IconBook = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
const IconExport = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>

export default function AccountingPage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const { can, loading: permLoading } = usePermissions()
  const canView = can('financials.view')
  const { enabled: acctEnabled } = useAccountingAccess()

  const [snapshot, setSnapshot] = useState<{ review: number; bankLinked: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!acctEnabled || !hasSupabase || !communityId || !canView) return
    try {
      // Light snapshot: how many bank rows still need review + is a bank linked.
      // Tolerant — a missing table/column just leaves the snapshot blank.
      const [btRes, cRes] = await Promise.all([
        withTimeout(supabase.from('bank_transactions').select('match_status').eq('community_id', communityId)),
        withTimeout(supabase.from('communities').select('plaid_status').eq('id', communityId).single()),
      ])
      const rows = ((btRes as any)?.data || []) as { match_status?: string }[]
      const review = rows.filter(r => (r.match_status || 'unmatched') === 'unmatched' || r.match_status === 'exception').length
      const bankLinked = ((cRes as any)?.data?.plaid_status) === 'active'
      setSnapshot({ review, bankLinked })
    } catch { /* snapshot is a nicety; never block the page */ }
  }, [communityId, canView, acctEnabled])
  useEffect(() => { load() }, [load])

  const Header = () => (
    <>
      <div className="admin-kicker">{t('admin.accounting.kicker')}</div>
      <h1 className="admin-h1">{t('admin.accounting.title')}</h1>
      <p className="admin-dek">{t('admin.accounting.dek')}</p>
    </>
  )

  // wsrow card (mirrors the Documents/Budget cards on /admin/financials).
  const Row = ({ href, color, icon, title, desc, badge, comingSoon }: {
    href?: string; color: string; icon: any; title: string; desc: string; badge?: number; comingSoon?: boolean
  }) => {
    const inner = (
      <>
        <span className="wsrow-glyph" style={{ color, background: color + '18' }}>{icon}</span>
        <div className="wsrow-main">
          <div className="wsrow-title">{title}{comingSoon && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, opacity: 0.6 }}>· {t('admin.accounting.comingSoon')}</span>}</div>
          <div className="wsrow-desc">{desc}</div>
        </div>
        {badge ? <span style={{ background: '#B5470818', color: '#B54708', fontWeight: 700, fontSize: 12, borderRadius: 999, padding: '2px 9px', marginRight: 8 }}>{badge}</span> : null}
        {href ? <span className="wsrow-arrow" aria-hidden="true">&rarr;</span> : null}
      </>
    )
    if (!href) return <div className="wsrow" style={{ opacity: 0.55, cursor: 'default' }}>{inner}</div>
    return <Link href={href} className="wsrow">{inner}</Link>
  }

  // The workspace cards — shared by the live view and the (faded) demo preview.
  const WorkspaceCards = ({ demo }: { demo?: boolean }) => (
    <div className="card" style={demo ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
      <div className="wslist">
        <Row href={demo ? undefined : '/admin/financials/reconcile'} color="#067647" icon={<IconCheck />}
          title={t('admin.financials.reconcileRowTitle')} desc={t('admin.financials.reconcileRowDesc')}
          badge={demo ? 3 : (snapshot?.review || undefined)} />
        <Row href={demo ? undefined : '/admin/financials/document?type=balance_sheet'} color="#0E7490" icon={<IconBook />}
          title={t('admin.accounting.cardLedgerTitle')} desc={t('admin.accounting.cardLedgerDesc')} />
        <Row href={demo ? undefined : '/admin/budget'} color="#7A5AF8" icon={<IconBars />}
          title={t('admin.financials.budgetRowTitle')} desc={t('admin.financials.budgetRowDesc')} />
        <Row href={demo ? undefined : '/admin/financials/document?type=cpa_bundle'} color="#B54708" icon={<IconExport />}
          title={t('admin.accounting.cardCpaTitle')} desc={t('admin.accounting.cardCpaDesc')} />
      </div>
    </div>
  )

  return (
    <div className="admin-page cset">
      <Header />

      {!permLoading && !canView && (
        <div className="admin-note admin-note-warn">{t('admin.accounting.permNote')}</div>
      )}

      {canView && !acctEnabled && (
        <>
          {/* Upsell — the add-on is off (rollout flag). Phase-1 statements stay free. */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.accounting.upsellTitle')} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {t('admin.accounting.upsellPrice')}</span></h2>
                <div className="sub" style={{ maxWidth: 560 }}>{t('admin.accounting.upsellBody')}</div>
              </div>
              <Link href="/admin/billing" className="admin-primary-btn" style={{ textDecoration: 'none' }}>{t('admin.accounting.upsellCta')}</Link>
            </div>
          </div>
          <div className="admin-note admin-note-info" style={{ marginBottom: 10 }}>{t('admin.accounting.previewNote')}</div>
          <WorkspaceCards demo />
        </>
      )}

      {canView && acctEnabled && (
        <>
          {/* Live snapshot chips */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '8px 14px', background: '#fff' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#B54708', lineHeight: 1 }}>{snapshot?.review ?? '—'}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{t('admin.accounting.needReview')}</div>
            </div>
            <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '8px 14px', background: '#fff', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: snapshot?.bankLinked ? '#067647' : '#B54708' }}>
                {snapshot?.bankLinked ? `✓ ${t('admin.accounting.bankLinked')}` : t('admin.accounting.bankNotLinked')}
              </span>
            </div>
          </div>
          <WorkspaceCards />
        </>
      )}
    </div>
  )
}
