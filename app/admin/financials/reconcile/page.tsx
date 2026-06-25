'use client'

// Bank reconciliation — exception queue.
//
// Plaid imports the association's real bank activity (public.bank_transactions);
// the GL spine is the regenerable double-entry projection of what the app
// recorded. The service-role matcher (app/api/admin/reconcile, run server-side)
// auto-links high-confidence singletons and flags the rest. THIS page is the
// human side of locked decision #4: a financials.manage officer Confirms a
// suggested match or marks it an exception. It NEVER moves money — it only flips
// match_status / matched_entry_id via the reconcile_set_status RPC (which enforces
// the permission + own-community in the database). See supabase/reconciliation.sql.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { useAccountingAccess } from '@/hooks/useAccountingAccess'
import { useT } from '@/lib/i18n'
import { CASH_CODES } from '@/lib/gl/reconcile'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100
const fmt$ = (n: any) => '$' + round2(Math.abs(Number(n) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface EntryInfo { entry_date: string | null; fund: string; source_type: string; memo: string | null; cashDelta: number }

export default function ReconcilePage() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const { can, loading: permLoading } = usePermissions()
  const canManage = can('financials.manage')
  const { enabled: acctEnabled, loading: acctLoading } = useAccountingAccess()

  const [bankTx, setBankTx] = useState<any[]>([])
  const [entryById, setEntryById] = useState<Record<string, EntryInfo>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { if (!msg) return; const timer = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(timer) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [btRes, geRes, glLinesRes] = await Promise.all([
        // Tolerant: the .select errors (not throws) if the recon columns / table
        // aren't created yet, so the page degrades to a "run the SQL" note.
        withTimeout(supabase.from('bank_transactions')
          .select('id, posted_date, amount, name, merchant_name, plaid_category, pending, match_status, matched_entry_id, match_confidence, matched_at')
          .eq('community_id', communityId).order('posted_date', { ascending: false })),
        withTimeout(supabase.from('gl_journal_entries')
          .select('id, entry_date, fund, source_type, memo').eq('community_id', communityId)),
        withTimeout(supabase.from('gl_entry_lines')
          .select('entry_id, debit, credit, gl_accounts!inner(code)')
          .eq('community_id', communityId).in('gl_accounts.code', [...CASH_CODES])),
      ])
      const { data: bt, error: btErr } = btRes as any
      if (btErr) throw btErr
      const { data: ge } = geRes as any
      const { data: gl } = glLinesRes as any

      // Per-entry net cash movement (debit − credit on 1000/1010), for display.
      const cashByEntry = new Map<string, number>()
      for (const l of (gl || []) as any[]) {
        const id = String(l.entry_id)
        cashByEntry.set(id, (cashByEntry.get(id) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0))
      }
      const map: Record<string, EntryInfo> = {}
      for (const e of (ge || []) as any[]) {
        map[String(e.id)] = {
          entry_date: e.entry_date ?? null, fund: e.fund, source_type: e.source_type,
          memo: e.memo ?? null, cashDelta: round2(cashByEntry.get(String(e.id)) || 0),
        }
      }
      setBankTx(bt || []); setEntryById(map); setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.reconcile.errLoad')); setStatus('error')
    }
  }, [communityId, t])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const review: any[] = [], auto: any[] = []
    let confirmed = 0
    for (const tx of bankTx) {
      const s = tx.match_status || 'unmatched'
      if (s === 'confirmed') confirmed += 1
      else if (s === 'auto') auto.push(tx)
      else review.push(tx) // unmatched + exception
    }
    return { review, auto, confirmed }
  }, [bankTx])

  // ---- the one write path: reconcile_set_status (RPC enforces perm + community) ----
  const act = async (bankTxId: string, entryId: string | null, newStatus: 'confirmed' | 'exception' | 'unmatched') => {
    if (!canManage) return
    setBusy(bankTxId); setError('')
    try {
      const { error } = await supabase.rpc('reconcile_set_status', {
        p_bank_tx: bankTxId, p_entry: entryId, p_status: newStatus,
      })
      if (error) throw error
      setMsg(newStatus === 'confirmed' ? t('admin.reconcile.msgConfirmed') : newStatus === 'exception' ? t('admin.reconcile.msgFlagged') : t('admin.reconcile.msgCleared'))
      await load()
    } catch (err: any) {
      setError(err?.message || t('admin.reconcile.errUpdate'))
    } finally { setBusy(null) }
  }

  const dirLabel = (amt: number) => (Number(amt) >= 0 ? t('admin.reconcile.dirOut') : t('admin.reconcile.dirIn'))
  const dirColor = (amt: number) => (Number(amt) >= 0 ? '#B42318' : '#067647')
  const fundLabel = (f: string) => (f === 'reserve' ? t('admin.reconcile.fundReserve') : t('admin.reconcile.fundOperating'))

  const BankLine = ({ tx }: { tx: any }) => (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>
        {tx.merchant_name || tx.name || t('admin.reconcile.bankTxnFallback')}
        {tx.pending ? <span style={{ marginLeft: 6, fontSize: 11, color: '#B54708', fontWeight: 600 }}>{t('admin.reconcile.pending')}</span> : null}
      </div>
      <div style={{ fontSize: 12.5, opacity: 0.75 }}>
        {tx.posted_date || '—'}
        {tx.plaid_category ? ` · ${tx.plaid_category}` : ''}
        {' · '}
        <span style={{ color: dirColor(tx.amount), fontWeight: 600 }}>{fmt$(tx.amount)} {dirLabel(tx.amount)}</span>
      </div>
    </div>
  )

  const Suggestion = ({ entryId, confidence }: { entryId: string | null; confidence: any }) => {
    if (!entryId) return <div style={{ fontSize: 12.5, opacity: 0.7 }}>{t('admin.reconcile.noEntry')}</div>
    const e = entryById[entryId]
    if (!e) return <div style={{ fontSize: 12.5, opacity: 0.7 }}>{t('admin.reconcile.entryGone')}</div>
    const conf = confidence != null ? ` · ${t('admin.reconcile.confidence', { pct: Math.round(Number(confidence) * 100) })}` : ''
    return (
      <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 2 }}>
        <span style={{ opacity: 0.6 }}>{t('admin.reconcile.suggestedPrefix')} </span>
        <span style={{ fontWeight: 600 }}>{e.memo || e.source_type}</span>
        {' '}<span style={{ opacity: 0.7 }}>({e.entry_date || '—'} · {fundLabel(e.fund)} · {fmt$(e.cashDelta)} {dirLabel(-e.cashDelta)})</span>
        <span style={{ opacity: 0.55 }}>{conf}</span>
      </div>
    )
  }

  // Paid feature gate: bank reconciliation needs the accounting add-on. Not
  // entitled → show the upsell instead of the queue (server routes also 403).
  if (!acctLoading && !acctEnabled) {
    return (
      <div className="admin-page cset">
        <div className="admin-kicker"><Link href="/admin/financials" style={{ color: 'inherit', textDecoration: 'none' }}>&larr; {t('admin.financials.pageTitle')}</Link></div>
        <h1 className="admin-h1">{t('admin.reconcile.title')}</h1>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{t('admin.accounting.upsellTitle')} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {t('admin.accounting.upsellPrice')}</span></h2>
              <div className="sub" style={{ maxWidth: 560 }}>{t('admin.accounting.upsellBody')}</div>
            </div>
            <Link href="/admin/billing" className="admin-primary-btn" style={{ textDecoration: 'none' }}>{t('admin.accounting.upsellCta')}</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker"><Link href="/admin/financials" style={{ color: 'inherit', textDecoration: 'none' }}>&larr; {t('admin.financials.pageTitle')}</Link></div>
      <h1 className="admin-h1">{t('admin.reconcile.title')}</h1>
      <p className="admin-dek">{t('admin.reconcile.dek')}</p>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.financials.noCommunity')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.reconcile.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.financials.loading')}</div>}

      {status === 'ready' && (
        <>
          {!permLoading && !canManage && (
            <div className="admin-note admin-note-info" style={{ marginBottom: 14 }}>{t('admin.reconcile.permNote')}</div>
          )}
          {error && <div className="admin-note admin-note-err" style={{ marginBottom: 14 }}>{error}</div>}

          {/* Summary chips */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: t('admin.reconcile.chipReview'), n: groups.review.length, c: '#B54708' },
              { label: t('admin.reconcile.chipAuto'), n: groups.auto.length, c: '#0E7490' },
              { label: t('admin.reconcile.chipConfirmed'), n: groups.confirmed, c: '#067647' },
            ].map(s => (
              <div key={s.label} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '8px 14px', background: '#fff' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.c, lineHeight: 1 }}>{s.n}</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Needs review (exception + unmatched) */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.reconcile.reviewTitle')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({groups.review.length})</span></h2>
              <div className="sub">{t('admin.reconcile.reviewSub')}</div></div></div>
            {groups.review.length === 0 ? (
              <div className="admin-note" style={{ marginTop: 4 }}>{t('admin.reconcile.reviewEmpty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {groups.review.map(tx => (
                  <div key={tx.id} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 220, flex: 1 }}>
                        <BankLine tx={tx} />
                        <Suggestion entryId={tx.matched_entry_id} confidence={tx.match_confidence} />
                      </div>
                      {canManage && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {tx.matched_entry_id && (
                            <button className="admin-primary-btn" disabled={busy === tx.id} onClick={() => act(tx.id, tx.matched_entry_id, 'confirmed')}>
                              {busy === tx.id ? '…' : t('admin.reconcile.btnConfirmMatch')}
                            </button>
                          )}
                          {tx.match_status !== 'exception' && (
                            <button className="admin-btn-ghost" disabled={busy === tx.id} onClick={() => act(tx.id, tx.matched_entry_id ?? null, 'exception')}>{t('admin.reconcile.btnFlag')}</button>
                          )}
                          {tx.matched_entry_id && (
                            <button className="admin-btn-ghost" disabled={busy === tx.id} onClick={() => act(tx.id, null, 'unmatched')}>{t('admin.reconcile.btnNotMatch')}</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Auto-matched (machine) — confirm to lock, or reject to the queue */}
          {groups.auto.length > 0 && (
            <div className="card">
              <div className="card-head"><div><h2>{t('admin.reconcile.autoTitle')} <span style={{ opacity: 0.55, fontWeight: 400 }}>({groups.auto.length})</span></h2>
                <div className="sub">{t('admin.reconcile.autoSub')}</div></div></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {groups.auto.map(tx => (
                  <div key={tx.id} style={{ border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 220, flex: 1 }}>
                        <BankLine tx={tx} />
                        <Suggestion entryId={tx.matched_entry_id} confidence={tx.match_confidence} />
                      </div>
                      {canManage && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button className="admin-primary-btn" disabled={busy === tx.id} onClick={() => act(tx.id, tx.matched_entry_id, 'confirmed')}>
                            {busy === tx.id ? '…' : t('admin.reconcile.btnConfirm')}
                          </button>
                          <button className="admin-btn-ghost" disabled={busy === tx.id} onClick={() => act(tx.id, tx.matched_entry_id, 'exception')}>{t('admin.reconcile.btnReject')}</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {bankTx.length === 0 && (
            <div className="admin-note admin-note-info">
              {t('admin.reconcile.noTxnsPre')} <Link href="/admin/budget" style={{ fontWeight: 600 }}>{t('admin.financials.budgetRowTitle')}</Link> {t('admin.reconcile.noTxnsSuf')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
