'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { useT } from '@/lib/i18n'

// Hardening (carried from Genie): wrap network promises, never .catch on Supabase.
const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Can't reach the server")), ms)),
  ])

const numOrNull = (v) => (v === '' || v == null ? null : Number(v))

export default function CommunitySettings() {
  const t = useT()
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

  // Community ownership — current owner from community_owner_info(); the owner
  // (only) also gets the transfer picker fed by community_owner_candidates().
  // Both RPCs come from ownership-and-role-walls.sql; on an older DB they fail
  // quietly and the card simply doesn't render.
  const [owner, setOwner] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [transferSel, setTransferSel] = useState('')
  const [stepDown, setStepDown] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferErr, setTransferErr] = useState('')

  const loadOwner = useCallback(async () => {
    if (!hasSupabase || !communityId) return
    try {
      const { data, error } = await supabase.rpc('community_owner_info')
      if (!error && data) setOwner(Array.isArray(data) ? (data[0] ?? null) : data)
    } catch { /* pre-migration DB — no ownership card */ }
  }, [communityId])
  useEffect(() => { loadOwner() }, [loadOwner])

  const isOwner = !!owner?.owner_profile_id && owner.owner_profile_id === profile?.id
  useEffect(() => {
    if (!hasSupabase || !isOwner) { setCandidates([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('community_owner_candidates')
        if (!cancelled && !error && data) setCandidates(data)
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  }, [isOwner])

  const transferOwnership = async () => {
    if (!transferSel) return
    const who = candidates.find(c => c.profile_id === transferSel)
    const tail = stepDown
      ? t('admin.community.transferConfirmStepDown')
      : t('admin.community.transferConfirmKeepRole')
    if (!window.confirm(t('admin.community.transferConfirmMsg', { community: form?.name || t('admin.community.yourCommunity'), member: who?.full_name || t('admin.community.thisMember'), tail }))) return
    setTransferBusy(true); setTransferErr('')
    try {
      const { error } = await withTimeout(
        supabase.rpc('community_transfer_ownership', { p_community: communityId, p_new_owner: transferSel, p_step_down: stepDown })
      )
      if (error) throw error
      setTransferSel('')
      setSuccessMsg(t('admin.community.transferSuccess', { member: who?.full_name || t('admin.community.theNewOwner') }))
      // Stepping down ends your own admin access — leave the admin area now
      // rather than waiting for the next permissions check to bounce you.
      if (stepDown) { window.location.href = '/app'; return }
      await loadOwner()
    } catch (err) {
      setTransferErr(err?.message || t('admin.community.transferFailed'))
    }
    setTransferBusy(false)
  }

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
      setError(err?.message || t('admin.community.loadError')); setStatus('error')
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
        // Fiscal year is not hand-editable — it tracks the current calendar year
        // automatically, so the board never has to remember to bump it.
        fiscal_year: new Date().getFullYear(),
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
      setStatus('ready'); setSuccessMsg(t('admin.community.settingsSaved'))
    } catch (err) {
      setError(err?.message || t('admin.community.saveFailed')); setStatus('error')
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
      <div className="admin-kicker">{t('admin.community.kicker')}</div>
      <h1 className="admin-h1">{t('admin.community.pageTitle')}</h1>
      <p className="admin-dek">
        {t('admin.community.pageDek')}
      </p>

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {status === 'loading' && <div className="admin-note">{t('admin.community.loading')}</div>}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          {t('admin.community.noCommunity')}
        </div>
      )}

      {status === 'error' && !form && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.community.retry')}</button>
        </div>
      )}

      {form && (
        <div>
          <div className="grid2">
            {/* ---- Association details ---- */}
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>{t('admin.community.assocDetailsTitle')}</h2>
                  <div className="sub">{t('admin.community.assocDetailsSub')}</div>
                </div>
              </div>
              {field('name', t('admin.community.fieldCommunityName'), { placeholder: 'Sunset Lakes' })}
              {field('location', t('admin.community.fieldLocation'), { placeholder: 'Miramar, FL' })}
              <div className="grid2" style={{ gap: 16 }}>
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.community.fieldType')}</span>
                  <Dropdown
                    value={form.association_type === 'condo' ? 'condo' : 'hoa'}
                    onChange={v => setField('association_type', v)}
                    ariaLabel={t('admin.community.ariaAssocType')}
                    options={[
                      { value: 'hoa', label: t('admin.community.typeHoa') },
                      { value: 'condo', label: t('admin.community.typeCondo') },
                    ]}
                  />
                </label>
                {field('unit_count', t('admin.community.fieldHomesUnits'), { type: 'number', placeholder: '120' })}
              </div>
              <div className="grid2" style={{ gap: 16 }}>
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.community.fieldFiscalYear')}</span>
                  <div className="admin-input-wrap">
                    <input
                      name="fiscal_year"
                      type="number"
                      className="admin-input"
                      value={new Date().getFullYear()}
                      readOnly
                      disabled
                      aria-readonly="true"
                    />
                  </div>
                  <span className="field-hint" style={{ whiteSpace: 'pre-line' }}>{t('admin.community.hintFiscalYear')}</span>
                </label>
                {field('monthly_dues', t('admin.community.fieldMonthlyDues'), { type: 'number', placeholder: '38', prefix: '$' })}
              </div>
              <div className="card-cta">
                <button type="button" onClick={save} className="admin-primary-btn" disabled={status === 'saving'}>
                  {status === 'saving' ? t('admin.community.saving') : t('admin.community.saveDetails')}
                </button>
              </div>
            </div>

            {/* ---- At a glance — automated dues snapshot (read-only) ---- */}
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>{t('admin.community.atAGlanceTitle')}</h2>
                  <div className="sub">{t('admin.community.atAGlanceSub')}</div>
                </div>
              </div>
              {/* Projections compute live from the homes & dues set in Association
                  details; the three actuals (rate / collected / outstanding) come
                  from the live community dues summary. Nothing to save here. */}
              <div className="dues-stats">
                {[
                  { l: t('admin.community.statBilledMonth'),   v: billedMonth ? money(billedMonth) : '—',
                    hint: homes ? `${homes} home${homes === 1 ? '' : 's'} × ${money(dues)}` : t('admin.community.hintSetHomesDues') },
                  { l: t('admin.community.statBilledYear'),    v: billedMonth ? money(billedMonth * 12) : '—',
                    hint: t('admin.community.hintBilledYear') },
                  { l: t('admin.community.statPerHomeYear'),   v: dues ? money(dues * 12) : '—',
                    hint: t('admin.community.hintPerHomeYear') },
                  { l: t('admin.community.statCollectionRate'), v: summary ? `${summary.rate}%` : '—',
                    hint: summary ? `${summary.paid} paid · ${summary.due} due · ${summary.late} late` : t('admin.community.hintCollectionRate') },
                  { l: t('admin.community.statCollectedToDate'), v: summary ? money(summary.collected) : '—',
                    hint: t('admin.community.hintCollectedToDate') },
                  { l: t('admin.community.statOutstanding'),   v: summary ? money(summary.outstanding) : '—',
                    hint: t('admin.community.hintOutstanding') },
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
                <h2>{t('admin.community.billingTitle')}</h2>
                <div className="sub">{t('admin.community.billingSub')}</div>
              </div>
            </div>
            {field('interest_apr', t('admin.community.fieldInterestApr'), {
              type: 'number', placeholder: '18',
              hint: t('admin.community.hintInterestApr'),
            })}
            <div className="grid2" style={{ gap: 12 }}>
              {field('late_fee_flat', t('admin.community.fieldLateFeeFlat'), { type: 'number', placeholder: '25', prefix: '$' })}
              {field('late_fee_pct', t('admin.community.fieldLateFeePct'), { type: 'number', placeholder: '5' })}
            </div>
            <span className="field-hint" style={{ display: 'block', marginTop: 8 }}>
              {t('admin.community.hintLateFee')}
            </span>
            {field('amenity_refund_cutoff_hours', t('admin.community.fieldAmenityCutoff'), {
              type: 'number', placeholder: '24',
              hint: t('admin.community.hintAmenityCutoff'),
            })}
            {field('association_address', t('admin.community.fieldAssocAddress'), {
              placeholder: '123 Main St, Miramar, FL 33025',
              hint: t('admin.community.hintAssocAddress'),
            })}
            {field('association_officer_name', t('admin.community.fieldOfficerName'), {
              placeholder: 'Jane Doe, President',
              hint: t('admin.community.hintOfficerName'),
            })}
            <div className="card-cta">
              <button type="button" onClick={save} className="admin-primary-btn" disabled={status === 'saving'}>
                {status === 'saving' ? t('admin.community.saving') : t('admin.community.saveCompliance')}
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
                  <div className="wsrow-title">{t('admin.community.budgetRowTitle')}</div>
                  <div className="wsrow-desc">{t('admin.community.budgetRowDesc')}</div>
                </div>
                <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>

          {/* ---- Community ownership — a transferable hat, not a possession.
                  Boards rotate; the owner hands the role to another member with
                  an account. Residente can also reassign it from the Platform
                  Console if a community is ever orphaned. ---- */}
          {owner && (
            <div className="card">
              <div className="card-head" style={{ marginBottom: 0 }}>
                <div>
                  <h2>{t('admin.community.ownershipTitle')}</h2>
                  <div className="sub">
                    {t('admin.community.ownershipOwnerLabel')}: <strong>{owner.owner_name || owner.owner_email || '—'}</strong>
                    {owner.owner_email && owner.owner_name ? ` (${owner.owner_email})` : ''}
                    {isOwner ? ` — ${t('admin.community.ownershipThatIsYou')}` : ''}
                  </div>
                </div>
              </div>
              {isOwner && (
                <div style={{ marginTop: 14 }}>
                  {candidates.length === 0 ? (
                    <div className="sub">
                      {t('admin.community.ownershipNoCandidates')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <label className="admin-field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
                        <span className="admin-field-label">{t('admin.community.transferFieldLabel')}</span>
                        <Dropdown
                          value={transferSel}
                          onChange={setTransferSel}
                          placeholder={t('admin.community.transferPlaceholder')}
                          ariaLabel={t('admin.community.ariaNewOwner')}
                          options={candidates.map(c => ({
                            value: c.profile_id,
                            label: `${c.full_name || c.email || 'Member'}${c.board_position ? ` · ${c.board_position}` : ''}`,
                          }))}
                        />
                      </label>
                      <button
                        type="button"
                        className="admin-primary-btn"
                        disabled={!transferSel || transferBusy}
                        onClick={transferOwnership}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {transferBusy ? t('admin.community.transferring') : t('admin.community.transferBtn')}
                      </button>
                    </div>
                  )}
                  {transferErr && <div className="admin-err-inline" style={{ display: 'block', marginTop: 10 }}>{transferErr}</div>}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={stepDown} onChange={e => setStepDown(e.target.checked)} style={{ marginTop: 2 }} />
                    <span>{t('admin.community.stepDownLabel')}</span>
                  </label>
                  <div className="field-hint" style={{ marginTop: 10 }}>
                    {t('admin.community.ownershipHint')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Delete community — handled by Residente, not self-serve ---- */}
          <div className="card">
            <div className="card-head comm-delete-head" style={{ marginBottom: 0, alignItems: 'center' }}>
              <div>
                <h2>{t('admin.community.deleteTitle')}</h2>
                <div className="sub">
                  {t('admin.community.deleteSub', { community: form?.name || t('admin.community.yourCommunity') })}
                </div>
              </div>
              <Link
                href="/admin/support"
                className="admin-primary-btn comm-delete-btn"
                style={{ textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, alignSelf: 'center' }}
              >
                {t('admin.community.contactResidente')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
