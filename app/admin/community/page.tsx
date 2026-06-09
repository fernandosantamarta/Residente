'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase, signOut } from '@/lib/supabase'
import { deleteCommunity } from '@/lib/signup'
import { DangerAction } from '@/components/DangerAction'
import { Dropdown } from '@/components/Dropdown'
import { ReportsSection } from '../ReportsSection'
import { ReportsScrollHint } from './ReportsScrollHint'

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

      {/* Floating nudge (bottom-right, by the scrollbar) that reports sit below. */}
      <ReportsScrollHint />

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
              <div className="grid2" style={{ gap: 12 }}>
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
              <div className="grid2" style={{ gap: 12 }}>
                {field('fiscal_year', 'Fiscal year', { type: 'number', placeholder: '2026' })}
              </div>
              <div className="card-cta">
                <button type="button" onClick={save} className="admin-primary-btn" disabled={status === 'saving'}>
                  {status === 'saving' ? 'Saving…' : 'Save details'}
                </button>
              </div>
            </div>

            {/* ---- Monthly dues ---- */}
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Monthly dues</h2>
                  <div className="sub">What each home pays</div>
                </div>
              </div>
              {field('monthly_dues', 'Per-home monthly dues', { type: 'number', placeholder: '38', prefix: '$' })}
              <div className="stats">
                <div className="stat">
                  <div className="v">{billedMonth ? money(billedMonth) : '—'}</div>
                  <div className="l">Billed / month</div>
                </div>
                <div className="stat">
                  <div className="v">{billedMonth ? money(billedMonth * 12) : '—'}</div>
                  <div className="l">Billed / year</div>
                </div>
              </div>
              <div className="card-cta">
                <button type="button" onClick={save} className="admin-primary-btn" disabled={status === 'saving'}>
                  {status === 'saving' ? 'Saving…' : 'Save dues'}
                </button>
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
                <span className="wsrow-glyph" style={{ color: '#0E7490', background: '#0E749018' }}>
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

          {/* ---- Reports & exports (moved here from the Reports tab) ---- */}
          <ReportsSection />

          {/* ---- Danger zone ---- */}
          <div className="card danger-card">
            <div className="card-head">
              <div>
                <h2>Danger zone</h2>
                <div className="sub">
                  Permanently deletes {form.name || 'this community'} and all its data, cancels the subscription, and removes every member. This can&apos;t be undone.{' '}
                  Need help instead? <a href="/admin/support" style={{ color: '#E5601F', fontWeight: 700 }}>Contact Residente</a>.
                </div>
              </div>
              <DangerAction
                confirmWord="DELETE"
                confirmLabel="Delete community"
                title="Delete community"
                body={<>This permanently deletes <strong>{form.name || 'this community'}</strong> — every resident, document, payment, meeting, and setting — and cancels the subscription. All members lose access. This can&apos;t be undone.</>}
                onConfirm={async () => {
                  const r = await deleteCommunity()
                  if (r?.error) return r
                  try { await signOut() } catch { /* ignore */ }
                  if (typeof window !== 'undefined') window.location.assign('/')
                  return { ok: true }
                }}
                trigger={(open) => (
                  <button type="button" onClick={open}
                    style={{ flexShrink: 0, padding: '10px 18px', borderRadius: 999, border: '1px solid #c5341a', background: '#fff', color: '#c5341a', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
                    Delete community
                  </button>
                )}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
