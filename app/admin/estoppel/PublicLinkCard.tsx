'use client'

// Public estoppel front-door control. Generates/enables a per-community token
// and surfaces the shareable link a title/closing company uses to request +
// pay for an estoppel certificate without a Residente login. Requires the
// community's Stripe (Connect) to be active so the fee lands with the HOA.

import { useEffect, useState } from 'react'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'

// Opaque, URL-safe token. Random per community; the board can regenerate it.
function newToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function PublicLinkCard({ communityId }: { communityId: string }) {
  const t = useT()
  const [token, setToken] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [connectActive, setConnectActive] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase) { setLoading(false); return }
      try {
        const { data } = await supabase.from('communities')
          .select('estoppel_public_token, estoppel_public_enabled, stripe_connect_status')
          .eq('id', communityId).single()
        if (cancelled) return
        setToken((data as any)?.estoppel_public_token ?? null)
        setEnabled(!!(data as any)?.estoppel_public_enabled)
        setConnectActive((data as any)?.stripe_connect_status === 'active')
      } catch { /* columns may not exist yet (run estoppel-front-door.sql) */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [communityId])

  const link = token && typeof window !== 'undefined' ? `${window.location.origin}/estoppel-request/${token}` : ''

  const enable = async () => {
    setBusy(true); setErr('')
    try {
      const tok = token || newToken()
      const { error } = await supabase.from('communities')
        .update({ estoppel_public_token: tok, estoppel_public_enabled: true }).eq('id', communityId)
      if (error) throw error
      setToken(tok); setEnabled(true)
    } catch (e: any) { setErr(e?.message || t('admin.estoppel.publicLink.errEnable')) }
    finally { setBusy(false) }
  }

  const disable = async () => {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('communities')
        .update({ estoppel_public_enabled: false }).eq('id', communityId)
      if (error) throw error
      setEnabled(false)
    } catch (e: any) { setErr(e?.message || t('admin.estoppel.publicLink.errDisable')) }
    finally { setBusy(false) }
  }

  const regenerate = async () => {
    if (!window.confirm(t('admin.estoppel.publicLink.confirmRegen'))) return
    setBusy(true); setErr('')
    try {
      const tok = newToken()
      const { error } = await supabase.from('communities')
        .update({ estoppel_public_token: tok }).eq('id', communityId)
      if (error) throw error
      setToken(tok)
    } catch (e: any) { setErr(e?.message || t('admin.estoppel.publicLink.errRegen')) }
    finally { setBusy(false) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ }
  }

  if (loading) return null

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div>
        <h2>{t('admin.estoppel.publicLink.title')}</h2>
        <div className="sub">{t('admin.estoppel.publicLink.sub')}</div>
      </div></div>

      {connectActive === false && (
        <div className="admin-note admin-note-warn" style={{ marginBottom: 12 }}>{t('admin.estoppel.publicLink.connectWarn')}</div>
      )}

      {enabled && token ? (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input readOnly value={link} className="admin-input" style={{ flex: '1 1 280px', fontSize: 13 }} onFocus={e => e.currentTarget.select()} />
            <button type="button" className="admin-primary-btn" onClick={copy}>{copied ? t('admin.estoppel.publicLink.copied') : t('admin.estoppel.publicLink.copy')}</button>
            <a className="admin-btn-ghost" href={link} target="_blank" rel="noopener noreferrer">{t('admin.estoppel.publicLink.preview')}</a>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={disable} disabled={busy} style={{ background: 'none', border: 'none', color: '#B42318', fontSize: 13, cursor: 'pointer', padding: 0 }}>{t('admin.estoppel.publicLink.disable')}</button>
            <button type="button" onClick={regenerate} disabled={busy} style={{ background: 'none', border: 'none', color: '#667085', fontSize: 13, cursor: 'pointer', padding: 0 }}>{t('admin.estoppel.publicLink.regenerate')}</button>
          </div>
          <p style={{ fontSize: 12, color: '#98A2B3', marginTop: 10, lineHeight: 1.5 }}>{t('admin.estoppel.publicLink.howto')}</p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: '#475467', marginTop: 0 }}>{t('admin.estoppel.publicLink.enableDek')}</p>
          <button type="button" className="admin-primary-btn" onClick={enable} disabled={busy}>{busy ? t('admin.estoppel.publicLink.enabling') : t('admin.estoppel.publicLink.enable')}</button>
        </>
      )}
      {err && <div className="admin-note admin-note-err" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  )
}
