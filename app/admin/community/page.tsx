'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'

// Hardening (carried from Genie): wrap network promises, never .catch on Supabase.
const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Can't reach the server")), ms)),
  ])

const numOrNull = (v) => (v === '' || v == null ? null : Number(v))

export default function CommunitySettings() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [form, setForm] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | none | error | saving | saved
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  // Live community-wide dues aggregate (collected / outstanding / collection
  // rate) from the community_dues_summary RPC — the same totals the resident
  // Reports tile uses. Aggregates only, no per-resident rows. Stays null until
  // it loads (and on any error), so the dues card just shows '—' for actuals.
  const [summary, setSummary] = useState(null)

  // Auto-dismiss the green confirmation banner after 4s, matching the Rules page.
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
        supabase.from('communities').select('*').eq('id', communityId).single()
      )
      if (error) throw error
      setForm(data); setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load the community'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // Pull the live dues aggregate once the community is known. Best-effort: any
  // failure (older DB without the RPC, no roster yet) just leaves actuals at '—'.
  useEffect(() => {
    if (!hasSupabase || !communityId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('community_dues_summary', { p_community: communityId })
        if (!cancelled && !error && data) setSummary(Array.isArray(data) ? data[0] : data)
      } catch { /* non-fatal — projections still render */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const save = async (e) => {
    e.preventDefault()
    setStatus('saving'); setError('')
    try {
      const patch = {
        name: (form.name || '').trim() || 'My Community',
        location: (form.location || '').trim() || null,
        // Only write association_type when the column actually exists in this
        // DB (select('*') surfaces it as a key) — older schemas omit it.
        ...('association_type' in (form || {})
          ? { association_type: form.association_type === 'condo' ? 'condo' : 'hoa' }
          : {}),
        unit_count: numOrNull(form.unit_count),
        fiscal_year: numOrNull(form.fiscal_year),
        monthly_dues: numOrNull(form.monthly_dues),
        // FL compliance config — annual APR replaces the legacy monthly rate.
        // null = charge nothing (the platform never invents interest/fees).
        interest_apr: numOrNull(form.interest_apr),
        late_fee_flat: numOrNull(form.late_fee_flat),
        late_fee_pct: numOrNull(form.late_fee_pct),
        // Column is NOT NULL (default 24) — never write null.
        amenity_refund_cutoff_hours: numOrNull(form.amenity_refund_cutoff_hours) ?? 24,
        association_address: (form.association_address || '').trim() || null,
        association_officer_name: (form.association_officer_name || '').trim() || null,
      }
      const { error } = await withTimeout(
        supabase.from('communities').update(patch).eq('id', communityId)
      )
      if (error) throw error
      setStatus('ready'); setSuccessMsg('Community settings saved.')
    } catch (err) {
      setError(err?.message || 'Save failed'); setStatus('error')
    }
  }

  // Shared field renderer — keeps every control on the page using the same
  // admin-field / admin-input tokens the rest of the admin uses.
  const field = (key, label, opts: { prefix?: string; type?: string; placeholder?: string; hint?: string } = {}) => (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      <div className="admin-input-wrap">
        {opts.prefix && <span className="admin-input-prefix">{opts.prefix}</span>}
        <input
          name={key}
          type={opts.type || 'text'}
          className="admin-input"
          value={form[key] ?? ''}
          placeholder={opts.placeholder}
          onChange={e => setField(key, e.target.value)}
        />
      </div>
      {opts.hint && <span className="field-hint">{opts.hint}</span>}
    </label>
  )

  // Live dues math — drives the two stat tiles in the dues card.
  const homes = Number(form?.unit_count) || 0
  const dues = Number(form?.monthly_dues) || 0
  const billedMonth = homes * dues
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US')

  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Community</div>
      <h1 className="admin-h1">Community settings</h1>
      <p className="admin-dek">
        Your association&rsquo;s details, dues, and operating budget. Changes here flow to every resident&rsquo;s cockpit.
      </p>

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked to your account yet. Run the one-time setup SQL, then reload.
        </div>
      )}

      {status === 'error' && !form && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {form && (
        <div>
          <div className="grid2">
            {/* ---- Association details ---- */}
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Association details</h2>
                  <div className="sub">Shown across the app</div>
                </div>
              </div>
              {field('name', 'Community name', { placeholder: 'Sunset Lakes' })}
              {field('location', 'Location', { placeholder: 'Miramar, FL' })}
              <div className="grid2" style={{ gap: 16 }}>
                <label className="admin-field">
                  <span className="admin-field-label">Type</span>
                  <Dropdown
                    value={form.association_type === 'condo' ? 'condo' : 'hoa'}
                    onChange={v => setField('association_type', v)}
                    ariaLabel="Association type"
                    options={[
                      { value: 'hoa', label: 'Homeowners (Ch. 720)' },
                      { value: 'condo', label: 'Condominium (Ch. 718)' },
                    ]}
                  />
                </label>
                {field('unit_count', 'Homes / units', { type: 'number', placeholder: '120' })}
              </div>
              <div className="grid2" style={{ gap: 16 }}>
                {field('fiscal_year', 'Fiscal year', { type: 'number', placeholder: '2026' })}
                {field('monthly_dues', 'Per-home monthly dues', { type: 'number', placeholder: '38', prefix: '$' })}
              </div>
              <div className="card-cta">
                <button type="button" onClick={save} className="admin-primary-btn" disabled={status === 'saving'}>
                  {status === 'saving' ? 'Saving…' : 'Save details'}
                </button>
              </div>
            </div>

            {/* ---- At a glance — automated dues snapshot (read-only) ---- */}
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>At a glance</h2>
                  <div className="sub">Updates automatically from your homes &amp; dues</div>
                </div>
              </div>
              {/* Projections compute live from the homes & dues set in Association
                  details; the three actuals (rate / collected / outstanding) come
                  from the live community dues summary. Nothing to save here. */}
              <div className="dues-stats">
                {[
                  { l: 'Billed / month',   v: billedMonth ? money(billedMonth) : '—',
                    hint: homes ? `${homes} home${homes === 1 ? '' : 's'} × ${money(dues)}` : 'Set homes & dues' },
                  { l: 'Billed / year',    v: billedMonth ? money(billedMonth * 12) : '—',
                    hint: 'Monthly dues × 12' },
                  { l: 'Per home / year',  v: dues ? money(dues * 12) : '—',
                    hint: 'What each home pays annually' },
                  { l: 'Collection rate',  v: summary ? `${summary.rate}%` : '—',
                    hint: summary ? `${summary.paid} paid · ${summary.due} due · ${summary.late} late` : 'Collected of what’s billed' },
                  { l: 'Collected to date', v: summary ? money(summary.collected) : '—',
                    hint: 'Payments recorded across the roster' },
                  { l: 'Outstanding',      v: summary ? money(summary.outstanding) : '—',
                    hint: 'Balances still owed today' },
                ].map(s => (
                  <div className="dues-stat" key={s.l}>
                    <div className="dues-stat-main">
                      <span className="dues-stat-l">{s.l}</span>
                      <span className="dues-stat-hint">{s.hint}</span>
                    </div>
                    <span className="dues-stat-v">{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Billing & compliance (Florida statutory settings) ---- */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Billing &amp; compliance</h2>
                <div className="sub">Florida late-payment, amenity, and lien settings (FS 718 / 720)</div>
              </div>
            </div>
            {field('interest_apr', 'Late-payment interest (% per year)', {
              type: 'number', placeholder: '18',
              hint: 'Florida cap is 18%/year, simple interest. Leave blank to charge no interest.',
            })}
            <div className="grid2" style={{ gap: 12 }}>
              {field('late_fee_flat', 'Admin late fee — flat', { type: 'number', placeholder: '25', prefix: '$' })}
              {field('late_fee_pct', 'Admin late fee — percent', { type: 'number', placeholder: '5' })}
            </div>
            <span className="field-hint" style={{ display: 'block', marginTop: 8 }}>
              Per delinquent month. The statute caps the late fee at the greater of $25 or 5% of the installment; the platform applies the greater of the two values above.
            </span>
            {field('amenity_refund_cutoff_hours', 'Amenity cancellation window (hours)', {
              type: 'number', placeholder: '24',
              hint: 'Residents who cancel a paid booking at least this many hours before the slot are refunded automatically. After it, the board can still refund manually. Default 24.',
            })}
            {field('association_address', 'Association mailing address', {
              placeholder: '123 Main St, Miramar, FL 33025',
              hint: 'Used on liens, statutory notices, and estoppel certificates.',
            })}
            {field('association_officer_name', 'Authorized officer', {
              placeholder: 'Jane Doe, President',
              hint: 'Signs liens and certificates.',
            })}
            <div className="card-cta">
              <button type="button" onClick={save} className="admin-primary-btn" disabled={status === 'saving'}>
                {status === 'saving' ? 'Saving…' : 'Save compliance'}
              </button>
              {status === 'error' && <span className="admin-err-inline" style={{ marginLeft: 12 }}>{error}</span>}
            </div>
          </div>

          {/* ---- Operating budget — now lives on its own page ---- */}
          <div className="card">
            <div className="wslist">
              <Link href="/admin/budget" className="wsrow">
                <span className="wsrow-glyph" style={{ color: '#E14909', background: '#E1490918' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>
                </span>
                <div className="wsrow-main">
                  <div className="wsrow-title">Operating budget</div>
                  <div className="wsrow-desc">Annual budget, categories, bank tracking &amp; expenses now live on the Budget page.</div>
                </div>
                <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>

          {/* ---- Delete community — handled by Residente, not self-serve ---- */}
          <div className="card">
            <div className="card-head" style={{ marginBottom: 0, alignItems: 'center' }}>
              <div>
                <h2>Delete community</h2>
                <div className="sub">
                  Closing {form?.name || 'your community'}? Deleting removes every resident,
                  payment, document, and record — so we do it for you, safely.
                </div>
              </div>
              <Link
                href="/admin/support"
                className="admin-primary-btn"
                style={{ textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, alignSelf: 'center' }}
              >
                Contact Residente
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
