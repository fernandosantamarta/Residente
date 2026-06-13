'use client'

// Budget — the single home for the operating budget. Set the annual figure and
// categories (which feed the resident Home cards), link the bank read-only via
// Plaid to track actual spending against each line, and log manual expenses.
// Stripe (collecting dues/fines) lives on Financial reporting; this page is
// about planning + tracking what the association spends.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { BudgetCategories } from '../BudgetCategories'
import { ExpensesLog } from '../community/ExpensesLog'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmt$ = (n: any) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

// Plaid Link is loaded on demand (only when an admin clicks "Link bank") so the
// CDN script never costs the rest of the app. Resolves to window.Plaid once ready.
const PLAID_SDK = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
function loadPlaid(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any
    if (w.Plaid) { resolve(w.Plaid); return }
    const existing = document.querySelector(`script[src="${PLAID_SDK}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(w.Plaid))
      existing.addEventListener('error', () => reject(new Error('Could not load Plaid')))
      return
    }
    const s = document.createElement('script')
    s.src = PLAID_SDK; s.async = true
    s.onload = () => resolve(w.Plaid)
    s.onerror = () => reject(new Error('Could not load Plaid'))
    document.head.appendChild(s)
  })
}

export default function BudgetPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [budgets, setBudgets] = useState<any[]>([])
  const [bankTx, setBankTx] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [plaidBusy, setPlaidBusy] = useState(false)
  const [plaidErr, setPlaidErr] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const t = useT()

  useEffect(() => { if (!msg) return; const timer = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(timer) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [cRes, bRes, btRes] = await Promise.all([
        withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
        withTimeout(supabase.from('budget_categories').select('*').eq('community_id', communityId).order('sort_order')),
        // Bank feed (Plaid) — tolerant: returns an error object (not a throw) if the
        // table isn't created yet, so this never breaks the page before the SQL is run.
        withTimeout(supabase.from('bank_transactions').select('id, amount, mapped_budget_category_id, posted_date, name, merchant_name, plaid_category').eq('community_id', communityId).order('posted_date', { ascending: false })),
      ])
      const { data: c } = cRes as any
      const { data: b } = bRes as any
      const { data: bt } = btRes as any
      setCommunity(c || null); setBudgets(b || []); setBankTx(bt || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.budget.errorLoadBudget')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // ---- annual budget headline figure ----
  const [annual, setAnnual] = useState<string>('')
  const [annualSaving, setAnnualSaving] = useState(false)
  useEffect(() => { if (community) setAnnual(community.annual_budget ?? '') }, [community])
  const saveAnnual = async () => {
    setAnnualSaving(true); setError('')
    try {
      const patch = { annual_budget: annual === '' ? null : Number(annual) }
      const { error } = (await withTimeout(supabase.from('communities').update(patch).eq('id', communityId))) as any
      if (error) throw error
      setMsg(t('admin.budget.annualBudgetSaved')); load()
    } catch (err: any) { setError(err?.message || t('admin.budget.errorSaveAnnual')) }
    finally { setAnnualSaving(false) }
  }

  // ---- Budget vs Actual (actuals from the Plaid bank feed) ----
  // Plaid sign: positive amount = money OUT of the account, i.e. spending.
  const actuals = useMemo(() => {
    const byCat = new Map<string, number>()
    let unmapped = 0
    for (const tx of bankTx) {
      const amt = Number(tx.amount) || 0
      if (amt <= 0) continue
      if (tx.mapped_budget_category_id) byCat.set(tx.mapped_budget_category_id, (byCat.get(tx.mapped_budget_category_id) || 0) + amt)
      else unmapped += amt
    }
    return { byCat, unmapped }
  }, [bankTx])
  const opBudgets = useMemo(() => budgets.filter(b => !b.is_reserve), [budgets])

  // ---- Plaid ("link your bank", read-only) ----
  const linkBank = async () => {
    setPlaidBusy(true); setPlaidErr('')
    try {
      const { data, error } = await supabase.functions.invoke('plaid-link-token', { body: {} })
      if (error) throw error
      const linkToken = data?.link_token
      if (!linkToken) throw new Error(data?.error || t('admin.budget.errorStartBankLink'))
      const Plaid = await loadPlaid()
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (public_token: string, metadata: any) => {
          try {
            const { error: exErr } = await supabase.functions.invoke('plaid-link-exchange', {
              body: { public_token, institution_name: metadata?.institution?.name ?? null },
            })
            if (exErr) throw exErr
            setMsg(t('admin.budget.bankLinkedSyncing'))
            await syncBank()
          } catch (err: any) {
            setPlaidErr(err?.message || t('admin.budget.errorFinishBankLink'))
          } finally { setPlaidBusy(false) }
        },
        onExit: (err: any) => {
          if (err) setPlaidErr(err?.display_message || err?.error_message || t('admin.budget.bankLinkCancelled'))
          setPlaidBusy(false)
        },
      })
      handler.open()
    } catch (err: any) {
      setPlaidErr(err?.message || t('admin.budget.errorStartBankLink')); setPlaidBusy(false)
    }
  }

  const syncBank = async () => {
    setSyncBusy(true); setPlaidErr('')
    try {
      const { error } = await supabase.functions.invoke('plaid-sync-transactions', { body: {} })
      if (error) throw error
      setMsg(t('admin.budget.bankFeedSynced')); await load()
    } catch (err: any) {
      setPlaidErr(err?.message || t('admin.budget.errorSyncBankFeed'))
    } finally { setSyncBusy(false) }
  }

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">{t('admin.budget.kicker')}</div>
      <h1 className="admin-h1">{t('admin.budget.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.budget.dekBefore')}<Link href="/admin/financials" style={{ color: 'var(--pink)', fontWeight: 600 }}>{t('admin.budget.dekLink')}</Link>{t('admin.budget.dekAfter')}
      </p>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.budget.noCommunity')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.budget.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.budget.loading')}</div>}

      {status === 'ready' && (
        <>
          {/* Annual operating budget — the headline figure residents' rings use. */}
          <div className="card">
            <div className="card-head"><div><h2>{t('admin.budget.annualBudgetTitle')}</h2><div className="sub">{t('admin.budget.annualBudgetSub')}</div></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label className="admin-field"><span className="admin-field-label">{t('admin.budget.annualBudgetLabel')}</span>
                <input className="admin-input" type="number" min="0" step="1000" placeholder="62000"
                  value={annual} onChange={e => setAnnual(e.target.value)} /></label>
            </div>
            <div className="card-cta">
              <button className="admin-primary-btn" disabled={annualSaving} onClick={saveAnnual}>{annualSaving ? t('admin.budget.saving') : t('admin.budget.saveAnnualBtn')}</button>
            </div>
          </div>

          {/* Budget categories — the plan (shared editor; feeds Home cards). */}
          <BudgetCategories communityId={communityId!} onSaved={(m) => { setMsg(m); load() }} />

          {/* Budget vs actual — actuals auto-tracked from the Plaid bank feed. */}
          <div className="card">
            <div className="card-head">
              <div><h2>{t('admin.budget.budgetVsActualTitle')}</h2>
                <div className="sub">{t('admin.budget.budgetVsActualSub')}</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, opacity: 0.65 }}>
                  {bankTx.length > 0 ? t('admin.budget.txSynced', { count: bankTx.length }) : t('admin.budget.noBankFeed')}
                </span>
                {community?.plaid_status === 'active' ? (
                  <>
                    <span className="admin-success" style={{ margin: 0, fontSize: 12 }}><span className="admin-success-check" aria-hidden>✓</span>{t('admin.budget.bankLinked')}</span>
                    <button className="admin-btn-ghost" disabled={syncBusy} onClick={syncBank}>{syncBusy ? t('admin.budget.syncing') : t('admin.budget.syncNow')}</button>
                  </>
                ) : (
                  <button className="admin-primary-btn" disabled={plaidBusy} onClick={linkBank}>{plaidBusy ? t('admin.budget.opening') : t('admin.budget.linkBankBtn')}</button>
                )}
              </div>
            </div>
            {plaidErr && <div className="admin-note admin-note-err" style={{ marginTop: 10 }}>{plaidErr}</div>}

            {opBudgets.length === 0 ? (
              <p style={{ fontSize: 13, opacity: 0.7, margin: '8px 0 0' }}>{t('admin.budget.noCategoriesHint')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {opBudgets.map(b => {
                  const budgeted = Number(b.budget) || 0
                  const actual = actuals.byCat.get(b.id) || 0
                  const pct = budgeted > 0 ? Math.round(actual / budgeted * 100) : null
                  const over = budgeted > 0 && actual > budgeted
                  const barColor = over ? '#B42318' : pct != null && pct >= 85 ? '#B54708' : '#067647'
                  return (
                    <div key={b.id} style={{ border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
                        <span style={{ fontWeight: 600 }}>{b.name || t('admin.budget.untitled')}</span>
                        <span style={{ opacity: 0.8 }}>
                          {fmt$(actual)} <span style={{ opacity: 0.5 }}>/ {fmt$(budgeted)}</span>
                          {pct != null && <span style={{ color: barColor, fontWeight: 600 }}> · {pct}%</span>}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 4, background: 'rgba(0,0,0,0.06)', marginTop: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, pct ?? 0)}%`, background: barColor }} />
                      </div>
                      {over && <div style={{ fontSize: 11.5, color: '#B42318', marginTop: 4 }}>{t('admin.budget.overBudget', { amount: fmt$(actual - budgeted) })}</div>}
                    </div>
                  )
                })}
              </div>
            )}

            {actuals.unmapped > 0 && (
              <div className="admin-note admin-note-warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                {t('admin.budget.unmappedSpending', { amount: fmt$(actuals.unmapped) })}
              </div>
            )}
          </div>

          {/* Expenses log — manual dated spend entries. */}
          <ExpensesLog communityId={communityId!} />
        </>
      )}
    </div>
  )
}
